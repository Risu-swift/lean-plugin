#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  findRoot,
  git,
  globalHome,
  parseArgs,
  list,
  readJson,
  writeJson,
  loadCards,
  readyCards,
  serialize,
  render,
  writeState,
  today,
  buildReport,
  loadNotes,
  searchNotes,
  noteLine,
  applyLine,
  loadSpecs,
  researchOf,
  needsResearch,
} from './lib.mjs';

const HELP = `lean — project state and task cards

  lean init [--project name]                   create .lean/ in the git root
  lean status                                  compact state (same as session start)
  lean tasks [--all]                           open cards: READY / wait / doing
  lean next                                    ready cards
  lean new-id spec|task [--count n]            next S-/T- ids
  lean start T-NNN [T-NNN ...]                 mark cards doing (several for --parallel); one card also
                                               prints its top related notes
  lean notes T-NNN                             top related notes for a card (read-only; used by workers)
  lean reset T-NNN [T-NNN ...]                 put cards back to todo (abandoned or failed); an unmerged
                                               worker branch is recorded on the card as branch:
  lean done T-NNN [--commit sha] [--notes id,id] [--no-tests "<why>"]
                                               refuses unless its commits or uncommitted changes include a
                                               test file; run it before the card commit so one commit holds
                                               code and record; removes merged worker worktrees
  lean check-parallel T-a T-b ...              deps done, no shared files
  lean batch [--spec S-NNN]                    next cards to run together: ready, disjoint files, ≤ maxAgents
  lean check-plan S-NNN                        waves, plus merge suggestions: chains, shared files, budget, size
  lean research [S-NNN] [--close]              research questions (R1…) and their answers; no id lists specs
                                               that need research; --close marks the spec agreed once all
                                               are answered
  lean test [--fast] [--cmd "<command>"] [--force]
                                               run tests, print only failures + summary; reuses a passing
                                               run when no code changed since (--force reruns)
  lean doctor [--fix]                          leftover worker worktrees and merged branches;
                                               --fix removes merged/empty ones, keeps locked/dirty/unmerged
  lean audit [--no-npm]                        zero-token security scan: secrets, tracked key/env files,
                                               open rules, npm audit, sensitive files changed since last review
  lean secured [sha]                           record that a security review covered the code up to sha
  lean report [--since YYYY-MM-DD] [--out file.md]   markdown progress report
  lean ui [--port n] [--no-open] | lean ui --stop    local read-only dashboard
  lean focus [note]                            pin a note under the automatic focus line
                                               (cleared by the next lean done; no text clears it)
  lean block <text> | unblock <n> | reviewed [sha]`;

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt } = parseArgs(rest, ['all', 'fast', 'stop', 'no-open', 'no-npm', 'force', 'fix', 'close']);
const die = (m) => {
  console.error(`lean: ${m}`);
  process.exit(1);
};

const need = () => findRoot() || die('no .lean/ found — run `lean init`');
const statePath = (r) => path.join(r, '.lean', 'state.json');
const configOf = (r) => readJson(path.join(r, '.lean', 'config.json'), {});

function mutate(r, fn) {
  const st = readJson(statePath(r), {});
  delete st.focus; // replaced by the computed focus line + optional note
  fn(st);
  writeJson(statePath(r), st);
  writeState(r);
}

function card(r, id) {
  if (!id) die(`usage: lean ${cmd} T-NNN`);
  return loadCards(r).find((c) => c.id === id.toUpperCase()) || die(`card ${id} not found`);
}

function saveCard(c, file = c.file) {
  fs.writeFileSync(file, serialize(c.data, c.body));
  if (path.resolve(file) !== path.resolve(c.file)) fs.unlinkSync(c.file);
}

const norm = (f) => f.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const overlaps = (a, b) => a === b || a.startsWith(b.replace(/\/?$/, '/')) || b.startsWith(a.replace(/\/?$/, '/'));
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

function filesTouchedBy(r, c) {
  const touched = new Set();
  const add = (out) => (out || '').split(/\r?\n/).forEach((f) => f.trim() && touched.add(f.trim()));
  add(git(`-C "${r}" log --grep=${c.id}: --name-only --format=`));
  if (opt.commit) add(git(`-C "${r}" diff --name-only ${opt.commit}~1 ${opt.commit}`));
  // Uncommitted work counts too: lean done runs before the card commit, or inside a --no-commit merge.
  add(git(`-C "${r}" diff --name-only HEAD`));
  add(git(`-C "${r}" ls-files --others --exclude-standard`));
  return [...touched];
}

// ---- security helpers ----
const DEFAULT_SECURE_PATHS = ['**/*.rules', '**/auth/**', '**/functions/**', '**/firebase.json', '**/.env*'];

function globRe(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function sensitiveChangesSinceReview(r) {
  const st = readJson(statePath(r), {});
  const paths = (configOf(r).security?.paths?.length ? configOf(r).security.paths : DEFAULT_SECURE_PATHS).map(globRe);
  const since = st.secured?.sha;
  const changed = since
    ? (git(`diff --name-only ${since} HEAD`) || '').split(/\r?\n/)
    : (git('ls-files') || '').split(/\r?\n/);
  return { since, date: st.secured?.date, files: changed.filter((f) => f && paths.some((re) => re.test(f))) };
}

const mask = (line) =>
  line
    .replace(/(['"`])[^'"`]{6,}\1/g, (_, q) => `${q}•••${q}`)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/, '-----BEGIN … PRIVATE KEY----- •••')
    .slice(0, 110);

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function openBrowser(url) {
  const [bin, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

const gitC = (dir, args) => git(`-C "${dir}" ${args}`);
const splitLines = (s) => (s || '').split(/\r?\n/).filter(Boolean);

// The code under test: HEAD plus uncommitted changes. .lean/ bookkeeping and worker worktrees don't count.
function treeFingerprint(r) {
  const head = gitC(r, 'rev-parse HEAD');
  const skip = '":(exclude).lean" ":(exclude).claude/worktrees"';
  const diff = head && gitC(r, `diff HEAD --binary -- . ${skip}`);
  const untracked = head && gitC(r, `ls-files --others --exclude-standard -- . ${skip}`);
  if (diff == null || untracked == null) return null; // no commits yet, or output too big to fingerprint
  const hash = crypto.createHash('sha1').update(head).update(diff);
  for (const f of splitLines(untracked)) {
    hash.update(f);
    try {
      hash.update(fs.readFileSync(path.join(r, f)));
    } catch {}
  }
  return hash.digest('hex');
}

// ---- worker worktrees (isolation: worktree puts them under .claude/worktrees/) ----
function workerWorktrees(r) {
  const mainLine = new Set(splitLines(gitC(r, 'rev-list --first-parent HEAD')));
  return (gitC(r, 'worktree list --porcelain') || '')
    .split(/\r?\n\r?\n/)
    .map((block) =>
      Object.fromEntries(
        splitLines(block).map((l) => {
          const i = l.indexOf(' ');
          return i < 0 ? [l, true] : [l.slice(0, i), l.slice(i + 1)];
        })
      )
    )
    .filter((w) => w.worktree && w.HEAD && norm(w.worktree).includes('/.claude/worktrees/'))
    .map((w) => {
      const missing = !fs.existsSync(w.worktree);
      const status = missing ? null : gitC(w.worktree, 'status --porcelain');
      return {
        path: w.worktree,
        branch: typeof w.branch === 'string' ? w.branch.replace(/^refs\/heads\//, '') : null,
        sha: w.HEAD,
        missing,
        locked: 'locked' in w,
        dirty: status === null || status.length > 0,
        merged: gitC(r, `merge-base --is-ancestor ${w.HEAD} HEAD`) !== null,
        // A fresh worktree sits on a main-line commit; worker commits only reach main through --no-ff merges.
        own: !mainLine.has(w.HEAD),
      };
    });
}

const WORKTREE_STATES = {
  missing: 'folder is gone',
  locked: 'locked, an agent may still be using it',
  dirty: 'uncommitted changes',
  empty: 'no commits of its own',
  merged: 'merged, safe to remove',
  unmerged: 'unmerged commits',
};

function worktreeState(w) {
  if (w.missing) return 'missing';
  if (w.locked) return 'locked';
  if (w.dirty) return 'dirty';
  if (!w.own) return 'empty';
  return w.merged ? 'merged' : 'unmerged';
}

function removeWorktree(r, w) {
  if (gitC(r, `worktree remove "${w.path}"`) === null) return false;
  if (w.branch) gitC(r, `branch -d "${w.branch}"`);
  return true;
}

function cleanMergedWorktrees(r) {
  const removed = [];
  for (const w of workerWorktrees(r).filter((x) => worktreeState(x) === 'merged')) {
    if (removeWorktree(r, w)) removed.push(w.branch || path.basename(w.path));
    else console.log(`could not remove worktree ${w.path} (see lean doctor)`);
  }
  return removed;
}

// ---- waves: which cards run together ----
const isHuman = (c) => /^HUMAN:/i.test(c.data.title || '');
const depsOf = (c) => list(c.data.depends).map((d) => d.toUpperCase());

// Up to `max` ready cards with disjoint files, the ones unblocking the most open cards first. HUMAN cards never batch.
function pickBatch(cards, ready, max) {
  const unblocks = (id) => cards.filter((c) => !c.done && depsOf(c).includes(id)).length;
  const picked = [];
  const claimed = [];
  for (const c of [...ready].sort((a, b) => unblocks(b.id) - unblocks(a.id) || a.id.localeCompare(b.id))) {
    if (picked.length >= max) break;
    if (isHuman(c)) continue;
    const files = list(c.data.files).map(norm);
    if (!files.length) {
      // Without a file list nothing proves it safe to share a wave.
      if (!picked.length) {
        picked.push(c);
        break;
      }
      continue;
    }
    if (claimed.some((x) => files.some((f) => overlaps(x, f)))) continue;
    picked.push(c);
    claimed.push(...files);
  }
  return picked;
}

// The batches in order, assuming each one lands: how many waves the remaining work needs.
function planWaves(cards, inScope, max) {
  const sim = cards.map((c) => ({ ...c, data: { ...c.data, status: c.done ? c.data.status : 'todo' } }));
  const waves = [];
  for (;;) {
    const ready = readyCards(sim).filter(inScope);
    const batch = pickBatch(sim, ready, max);
    const pick = batch.length ? batch : ready.filter(isHuman).slice(0, 1);
    if (!pick.length) break;
    waves.push(pick.map((c) => c.id));
    for (const c of pick) c.done = true;
  }
  return { waves, stuck: sim.filter((c) => !c.done && inScope(c)).map((c) => c.id) };
}

const maxAgents = (r) => Math.max(1, parseInt(configOf(r).parallel?.maxAgents || 3, 10));

// Notes worth reading before a card, beyond the ones its Watch section already cites.
function cardNotes(r, c, max = 3) {
  const cited = new Set(String(c.body).match(/\b\d{8}-\d{6}(?:-\d+)?\b/g) || []);
  const notes = loadNotes(r).filter((n) => !n.data.superseded_by && !cited.has(n.id));
  const files = list(c.data.files).map((f) => f.replace(/\.[^./]+$/, '').replace(/\b(src|lib|index|__tests__)\b/g, ' '));
  return searchNotes(notes, [c.data.title, ...files].join(' '), max);
}

function printCardNotes(r, c, { quiet = false } = {}) {
  const notes = cardNotes(r, c);
  if (!notes.length) {
    if (!quiet) console.log(`no related notes for ${c.id}`);
    return;
  }
  console.log(`notes for ${c.id} (beyond its Watch list):`);
  for (const n of notes) {
    console.log(`  ${noteLine(n)}`);
    const apply = applyLine(n);
    if (apply) console.log(`      ${apply}`);
  }
}

switch (cmd) {
  case 'init': {
    const r = git('rev-parse --show-toplevel') || process.cwd();
    const L = path.join(r, '.lean');
    for (const d of ['specs', 'tasks/done', 'zk']) fs.mkdirSync(path.join(L, d), { recursive: true });
    if (!fs.existsSync(statePath(r))) {
      writeJson(statePath(r), { project: opt.project || path.basename(r), blockers: [], recent: [], reviewed: null });
    }
    const cfg = path.join(L, 'config.json');
    if (!fs.existsSync(cfg)) {
      writeJson(cfg, {
        test: '',
        testFast: '',
        tddStrict: [],
        deadline: '',
        deadlineLabel: '',
        security: { paths: DEFAULT_SECURE_PATHS, ignore: [] },
        parallel: { maxAgents: 3, setup: '', portEnv: '' },
      });
    }
    const ignore = path.join(L, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'last-test.json\n');
    writeState(r);
    console.log(`initialised ${L}`);
    break;
  }

  case 'status':
    console.log(render(need()));
    break;

  case 'tasks': {
    const r = need();
    const cards = loadCards(r);
    const ready = new Set(readyCards(cards).map((c) => c.id));
    let shown = 0;
    for (const c of cards) {
      if (c.done && !opt.all) continue;
      const s = c.done ? 'done' : c.data.status === 'doing' ? 'doing' : ready.has(c.id) ? 'READY' : 'wait';
      const deps = list(c.data.depends);
      console.log(
        `${c.id.padEnd(6)} ${s.padEnd(5)} ${c.data.title || ''}${deps.length ? `  deps:${deps.join(',')}` : ''}`
      );
      shown++;
    }
    if (!shown) console.log('no open cards');
    break;
  }

  case 'next': {
    const ready = readyCards(loadCards(need()));
    console.log(ready.length ? ready.map((c) => `${c.id} ${c.data.title || ''}`).join('\n') : 'no ready cards');
    break;
  }

  case 'new-id': {
    const r = need();
    const kinds = { spec: ['S', ['specs']], task: ['T', ['tasks', 'tasks/done']] };
    const [prefix, dirs] = kinds[pos[0]] || die('usage: lean new-id spec|task [--count n]');
    let max = 0;
    for (const d of dirs) {
      const p = path.join(r, '.lean', d);
      if (!fs.existsSync(p)) continue;
      for (const f of fs.readdirSync(p)) {
        const m = f.match(new RegExp(`^${prefix}-(\\d+)`, 'i'));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    const count = Math.max(1, parseInt(opt.count || '1', 10));
    const ids = Array.from({ length: count }, (_, i) => `${prefix}-${String(max + 1 + i).padStart(3, '0')}`);
    console.log(ids.join('\n'));
    break;
  }

  case 'start':
  case 'reset': {
    const r = need();
    if (!pos.length) die(`usage: lean ${cmd} T-NNN [T-NNN ...]`);
    const status = cmd === 'start' ? 'doing' : 'todo';
    const unmerged = cmd === 'reset' ? workerWorktrees(r).filter((w) => w.branch && w.own && !w.merged) : [];
    const kept = [];
    const changed = pos.map((id) => {
      const c = card(r, id);
      if (c.done) die(`${c.id} is already done`);
      c.data.status = status;
      // Unmerged worker work stays on its branch; /lean:do step 2 salvages it via `branch:`.
      const w = unmerged.find((x) =>
        splitLines(gitC(r, `log --format=%s HEAD..${x.branch}`)).some((s) => s.startsWith(`${c.id}:`))
      );
      if (w) {
        c.data.branch = w.branch;
        kept.push(`${c.id} → ${w.branch}`);
      }
      saveCard(c);
      return c;
    });
    writeState(r);
    console.log(`${cmd === 'start' ? 'started' : 'reset to todo'}: ${changed.map((c) => c.id).join(', ')}`);
    if (kept.length) console.log(`unmerged work kept on its branch (recorded as branch: on the card): ${kept.join(', ')}`);
    // Parallel workers look up their own notes with `lean notes`.
    if (cmd === 'start' && changed.length === 1) printCardNotes(r, changed[0], { quiet: true });

    const deployCards = cmd === 'start' ? changed.filter((c) => String(c.data.deploy) === 'true') : [];
    if (deployCards.length) {
      const s = sensitiveChangesSinceReview(r);
      const why = !s.since
        ? 'no security review has been recorded'
        : s.files.length
          ? `${s.files.length} sensitive file(s) changed since the last security review (${s.since}, ${s.date})`
          : null;
      if (why) {
        console.log(
          `⚠ SECURITY: ${deployCards.map((c) => c.id).join(', ')} deploys, but ${why}. ` +
            'Run /lean:secure first, or continue only if you have decided to.'
        );
      }
    }
    break;
  }

  case 'done': {
    const r = need();
    const c = card(r, pos[0]);
    const exempt = /^HUMAN:/i.test(c.data.title || '');
    const reason = typeof opt['no-tests'] === 'string' ? opt['no-tests'].replace(/\r?\n/g, ' ').trim() : '';
    if (!exempt && !reason && !filesTouchedBy(r, c).some((f) => TEST_FILE.test(f))) {
      die(
        `${c.id}: no test file in its commits or uncommitted changes. Add tests for its "Done when" items, ` +
          `or finish with --no-tests "<why tests aren't possible>".`
      );
    }
    c.data.status = 'done';
    c.data.done = today();
    if (opt.commit) c.data.commit = opt.commit;
    if (reason) c.data.no_tests = reason;
    const dest = path.join(r, '.lean', 'tasks', 'done', path.basename(c.file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    saveCard(c, dest);
    mutate(r, (st) => {
      const entry = { date: today(), id: c.id, title: c.data.title, commit: opt.commit, notes: list(opt.notes) };
      st.recent = [entry, ...(st.recent || [])].slice(0, 10);
      delete st.note;
    });
    const next = readyCards(loadCards(r)).map((n) => n.id);
    console.log(`done ${c.id}. ready: ${next.join(', ') || 'none'}`);
    if (gitC(r, 'status --porcelain')) console.log(`next: commit the work and .lean/ together as "${c.id}: ${c.data.title || ''}"`);

    const removed = cleanMergedWorktrees(r);
    if (removed.length) console.log(`removed merged worker worktrees: ${removed.join(', ')}`);
    break;
  }

  case 'check-parallel': {
    const r = need();
    const cards = loadCards(r);
    const ids = pos.map((p) => p.toUpperCase());
    if (ids.length < 2) die('give 2+ card ids');
    const done = new Set(cards.filter((c) => c.done).map((c) => c.id));
    const problems = [];
    const claimed = [];
    for (const id of ids) {
      const c = cards.find((x) => x.id === id);
      if (!c) {
        problems.push(`${id}: not found`);
        continue;
      }
      if (c.done) problems.push(`${id}: already done`);
      for (const d of list(c.data.depends).map((x) => x.toUpperCase())) {
        if (ids.includes(d)) problems.push(`${id} depends on ${d} (same batch)`);
        else if (!done.has(d)) problems.push(`${id} waits on ${d}`);
      }
      const files = list(c.data.files).map(norm);
      if (!files.length) problems.push(`${id}: no files listed`);
      for (const f of files) {
        const clash = claimed.find((x) => overlaps(x.f, f));
        if (clash) problems.push(`${id} and ${clash.id} both touch ${f}`);
      }
      files.forEach((f) => claimed.push({ id, f }));
    }
    console.log(problems.length ? `CONFLICT\n- ${problems.join('\n- ')}` : `OK ${ids.join(' ')}`);
    process.exitCode = problems.length ? 2 : 0;
    break;
  }

  case 'test': {
    const r = need();
    const cfg = configOf(r);
    const command = opt.cmd || (opt.fast ? cfg.testFast : cfg.test);
    if (!command) die('no test command — set "test" in .lean/config.json or pass --cmd "<command>"');

    const lastPath = path.join(r, '.lean', 'last-test.json');
    const last = readJson(lastPath, {});
    const passes = last.passes || {};
    const tree = treeFingerprint(r);
    // A passing full suite also covers the fast subset.
    const covering = [command, ...(opt.fast && !opt.cmd && cfg.test ? [cfg.test] : [])];
    const cached = !opt.force && tree && covering.map((c) => passes[c]).find((p) => p?.tree === tree);
    if (cached) {
      const at = new Date(cached.at).toLocaleString('sv-SE');
      console.log(`PASS (cached: no code changes since it passed at ${at}, saved ~${cached.secs}s) ${command}`);
      console.log('rerun anyway: lean test --force');
      break;
    }

    const started = Date.now();
    const run = spawnSync(command, { cwd: r, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const secs = Math.round((Date.now() - started) / 1000);
    const lines = `${run.stdout || ''}\n${run.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
    const ok = run.status === 0;
    const summary = lines
      .filter((l) => /^\s*(Test Files|Tests|Suites?)\s+\d|\d+ (passing|failing)|✖ \d+ problems?|Found \d+ errors?/i.test(l))
      .map((l) => l.trim());

    let shown = summary.slice(-6);
    if (!ok) {
      const hit = /FAIL|✗|×|✖|\bError\b|error TS\d+|AssertionError|Expected|Received|ERR!|Cannot find|is not assignable/;
      const keep = new Set();
      lines.forEach((l, i) => {
        if (!hit.test(l)) return;
        for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) keep.add(j);
      });
      let failures = [...keep].sort((a, b) => a - b).map((i) => lines[i]).filter((l) => l.trim());
      if (failures.length > 60) {
        failures = [...failures.slice(0, 50), `… ${failures.length - 60} lines omitted …`, ...failures.slice(-10)];
      }
      const tail = lines.filter((l) => l.trim()).slice(-8);
      shown = [...failures, '--- last lines ---', ...tail];
    }

    const doing = loadCards(r).find((c) => !c.done && c.data.status === 'doing');
    const at = new Date().toISOString();
    if (ok && tree) passes[command] = { tree, at, secs };
    else delete passes[command];
    writeJson(lastPath, { ok, exit: run.status, secs, cmd: command, card: doing?.id || null, at, passes });
    console.log(`${ok ? 'PASS' : 'FAIL'} (${secs}s, exit ${run.status}) ${command}`);
    if (run.error) console.log(`spawn error: ${run.error.message}`);
    shown.forEach((l) => console.log(l));
    process.exitCode = ok ? 0 : run.status || 1;
    break;
  }

  case 'audit': {
    const r = need();
    const sec = configOf(r).security || {};
    const ignore = [
      ...(sec.ignore || []),
      '**/node_modules/**',
      'docs/archive/**',
      '.lean/**',
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/yarn.lock',
    ].map(globRe);
    const files = (git('ls-files') || '').split(/\r?\n/).filter(Boolean);
    const findings = [];
    const info = new Map();
    const add = (sev, where, what) => findings.push({ sev, where, what });

    const sensitiveName =
      /(^|\/)(\.env(\.[^/]+)?|\.secrets\/.+|[^/]+\.(pem|key|p12|pfx)|[^/]*service[-_]?account[^/]*\.json|[^/]*-firebase-adminsdk-[^/]*\.json|id_(rsa|ed25519)[^/]*)$/i;
    for (const f of files) {
      if (sensitiveName.test(f) && !/\.env\.(example|sample|template)$/i.test(f)) add('BLOCKER', f, 'sensitive file is tracked by git');
    }

    const patterns = [
      ['BLOCKER', /-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
      ['BLOCKER', /\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
      ['BLOCKER', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
      ['BLOCKER', /\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
      ['BLOCKER', /\bsk_live_[A-Za-z0-9]{16,}/, 'Stripe live key'],
      ['MAJOR', /\b(secret|password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*['"`][^'"`\s]{12,}['"`]/i, 'hard-coded credential'],
    ];
    for (const f of files) {
      if (ignore.some((re) => re.test(f))) continue;
      let text;
      try {
        const abs = path.join(r, f);
        if (fs.statSync(abs).size > 1024 * 1024) continue;
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;
      const isTest = TEST_FILE.test(f);
      const isRules = /\.rules$/i.test(f);
      text.split(/\r?\n/).forEach((line, i) => {
        const where = `${f}:${i + 1}`;
        for (const [sev, re, what] of patterns) {
          if (!re.test(line)) continue;
          // Firebase/Google web API keys are public identifiers; they're reported under Info instead.
          if (what === 'hard-coded credential' && /['"`]AIza[0-9A-Za-z_-]{35}['"`]/.test(line)) continue;
          add(isTest && sev === 'MAJOR' ? 'MINOR' : sev, where, `${what}${isTest ? ' (in a test)' : ''}: ${mask(line.trim())}`);
        }
        if (/\bAIza[0-9A-Za-z_-]{35}\b/.test(line) && !info.has(f)) {
          info.set(f, `${where} Google/Firebase web API key — public by design; confirm API key restrictions are set in GCP`);
        }
        if (isRules) {
          const writes = /\b(write|create|update|delete)\b/.test(line);
          if (/\ballow\s+[\w\s,]+:\s*if\s+true\s*;/.test(line)) add(writes ? 'BLOCKER' : 'MAJOR', where, `open rule: ${line.trim()}`);
          else if (/\ballow\s+[\w\s,]+;\s*$/.test(line)) add(writes ? 'BLOCKER' : 'MAJOR', where, `unconditional rule: ${line.trim()}`);
          if (/request\.time\s*<\s*timestamp\.date/.test(line)) add('MAJOR', where, 'expiring test-mode rule');
        }
      });
    }

    let deps = 'skipped';
    if (!opt['no-npm'] && fs.existsSync(path.join(r, 'package.json'))) {
      const run = spawnSync('npm audit --json --omit=dev', {
        cwd: r,
        shell: true,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120000,
      });
      try {
        const report = JSON.parse(run.stdout);
        const v = report.metadata?.vulnerabilities || {};
        deps = `critical ${v.critical || 0}, high ${v.high || 0}, moderate ${v.moderate || 0}, low ${v.low || 0}`;
        for (const x of Object.values(report.vulnerabilities || {})) {
          if (!['critical', 'high'].includes(x.severity)) continue;
          add(x.severity === 'critical' ? 'BLOCKER' : 'MAJOR', `dependency ${x.name}`, `${x.severity} advisory${x.fixAvailable ? ' (fix available)' : ''}`);
        }
      } catch {
        deps = `npm audit failed (offline?): ${(run.stderr || '').split(/\r?\n/).find(Boolean) || 'no output'}`;
      }
    }

    const order = { BLOCKER: 0, MAJOR: 1, MINOR: 2 };
    findings.sort((a, b) => order[a.sev] - order[b.sev]);
    const s = sensitiveChangesSinceReview(r);
    console.log(`lean audit — ${files.length} tracked files`);
    console.log(`Dependencies (production): ${deps}`);
    console.log(`Last security review: ${s.since ? `${s.since} (${s.date})` : 'never'}`);
    console.log(`Sensitive files ${s.since ? 'changed since then' : 'in scope'}: ${s.files.length}`);
    s.files.slice(0, 25).forEach((f) => console.log(`  ${f}`));
    if (s.files.length > 25) console.log(`  … +${s.files.length - 25} more`);
    console.log(findings.length ? `Findings (${findings.length}):` : 'Findings: none');
    findings.slice(0, 40).forEach((x) => console.log(`  ${x.sev.padEnd(7)} ${x.where} — ${x.what}`));
    if (findings.length > 40) console.log(`  … +${findings.length - 40} more`);
    if (info.size) {
      console.log('Info:');
      [...info.values()].slice(0, 5).forEach((l) => console.log(`  ${l}`));
    }
    process.exitCode = findings.some((x) => x.sev === 'BLOCKER') ? 2 : 0;
    break;
  }

  case 'batch': {
    const r = need();
    const removed = cleanMergedWorktrees(r);
    if (removed.length) console.log(`removed merged worker worktrees: ${removed.join(', ')}`);
    const spec = opt.spec ? String(opt.spec).toUpperCase() : null;
    const inScope = (c) => !spec || String(c.data.spec || '').toUpperCase() === spec;
    const all = loadCards(r);
    const open = all.filter((c) => !c.done && inScope(c));
    const ready = readyCards(all).filter(inScope);
    const batch = pickBatch(all, ready, maxAgents(r));
    if (batch.length) {
      console.log(`batch: ${batch.map((c) => c.id).join(' ')}`);
      batch.forEach((c) => console.log(`  ${c.id} ${c.data.title || ''}`));
      console.log(`waves left: ${planWaves(all, inScope, maxAgents(r)).waves.length}`);
    } else if (!open.length) {
      console.log(`phase done${spec ? `: every ${spec} card is done` : ''}`);
    } else if (ready.some(isHuman)) {
      console.log(`human: ${ready.filter(isHuman).map((c) => `${c.id} ${c.data.title}`).join('; ')}`);
    } else {
      const doing = open.filter((c) => c.data.status === 'doing');
      console.log(
        doing.length
          ? `none ready · in progress: ${doing.map((c) => c.id).join(', ')}`
          : `none ready · ${open.length} open card(s) wait on unfinished dependencies`
      );
    }
    break;
  }

  case 'check-plan': {
    const r = need();
    const spec = String(pos[0] || '').toUpperCase() || die('usage: lean check-plan S-NNN');
    const doc = loadSpecs(r).find((s) => s.id === spec) || die(`spec ${spec} not found`);
    const all = loadCards(r);
    const inScope = (c) => String(c.data.spec || '').toUpperCase() === spec;
    const cards = all.filter(inScope);
    if (!cards.length) die(`no cards for ${spec}`);
    const open = cards.filter((c) => !c.done);
    const byId = new Map(all.map((c) => [c.id, c]));
    const ancestors = (id, seen = new Set()) => {
      for (const d of byId.has(id) ? depsOf(byId.get(id)) : []) {
        if (!seen.has(d)) {
          seen.add(d);
          ancestors(d, seen);
        }
      }
      return seen;
    };
    const filesOf = new Map(cards.map((c) => [c.id, list(c.data.files).map(norm)]));
    const suggestions = [];

    const unanswered = researchOf(doc).filter((q) => !q.answer).map((q) => q.id);
    if (needsResearch(doc) || unanswered.length) {
      const which = unanswered.length ? `${unanswered.join(', ')} still open` : 'spec is still needs-research';
      suggestions.push(`research: ${which} → run /lean:research ${spec} before planning on guesses`);
    }

    const acceptance = doc.body.split(/^## /m).find((s) => /^Acceptance/i.test(s)) || '';
    const criteria = new Set(acceptance.match(/\bA\d+\b/g) || []).size;
    const budget = Math.ceil(criteria / 2) + 1;
    const work = cards.filter((c) => !isHuman(c)).length;
    if (criteria && work > budget) {
      suggestions.push(`budget: ${work} cards for ${criteria} acceptance criteria (aim for ≤ ${budget}: ~1 per 2, plus a contracts card)`);
    }

    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const [a, b] = [open[i], open[j]];
        const shared = filesOf.get(a.id).filter((f) => filesOf.get(b.id).some((g) => overlaps(f, g)));
        if (!shared.length) continue;
        const names = shared.map((f) => f.split('/').pop()).join(', ');
        if (!ancestors(a.id).has(b.id) && !ancestors(b.id).has(a.id)) {
          suggestions.push(`conflict: ${a.id} + ${b.id} share ${names}, so they can't run together → merge them, or move the shared edit into a contracts card both depend on`);
        } else if (shared.length >= 2) {
          suggestions.push(`re-touch: ${a.id} + ${b.id} both edit ${names} → merge them, or give all those edits to the earlier card`);
        }
      }
    }

    for (const a of open) {
      const kids = all.filter((c) => !c.done && depsOf(c).includes(a.id));
      if (kids.length === 1 && depsOf(kids[0]).length === 1 && !isHuman(a) && !isHuman(kids[0])) {
        suggestions.push(`chain: ${a.id} → ${kids[0].id} only unblock each other → merge into one card`);
      }
    }

    for (const c of open) {
      const n = filesOf.get(c.id).length;
      if (n > 12) suggestions.push(`size: ${c.id} lists ${n} files → split by behavior, or fold a sweep into the cards that already edit those files`);
      if (!n && !isHuman(c)) suggestions.push(`files: ${c.id} lists no files, so it can never share a wave`);
    }

    const { waves, stuck } = planWaves(all, inScope, maxAgents(r));
    console.log(
      `${spec}: ${cards.length} cards (${open.length} open) · ${criteria} acceptance criteria · ${waves.length} waves at up to ${maxAgents(r)} agents`
    );
    waves.forEach((w, i) => console.log(`  wave ${i + 1}: ${w.join(' ')}`));
    if (stuck.length) console.log(`  never ready: ${stuck.join(' ')} (a dependency is missing or circular)`);
    console.log(
      suggestions.length
        ? `Suggestions (${suggestions.length}):\n${suggestions.map((s) => `- ${s}`).join('\n')}`
        : 'No suggestions: cards are independent wherever they can be.'
    );
    break;
  }

  case 'research': {
    const r = need();
    const specs = loadSpecs(r);
    if (!pos[0]) {
      const waiting = specs.filter(needsResearch);
      if (!waiting.length) console.log('no specs need research');
      for (const s of waiting) {
        const open = researchOf(s).filter((q) => !q.answer).length;
        console.log(`${s.id} ${s.data.title || ''} · ${open} open → /lean:research ${s.id}`);
      }
      break;
    }
    const id = String(pos[0]).toUpperCase();
    const doc = specs.find((s) => s.id === id) || die(`spec ${id} not found`);
    const items = researchOf(doc);
    const open = items.filter((q) => !q.answer);
    console.log(`${id} ${doc.data.title || ''} · status: ${doc.data.status || '—'} · ${open.length}/${items.length} open`);
    for (const q of items) {
      console.log(`  ${q.id} ${q.answer ? 'done' : 'OPEN'}  ${q.question}`);
      if (q.answer) console.log(`       → ${q.answer}`);
    }
    if (!opt.close) break;
    if (open.length) die(`${open.map((q) => q.id).join(', ')} still open — answer them in the spec first`);
    // Edit only the status line, so the rest of the spec's frontmatter keeps its exact formatting.
    const text = fs.readFileSync(doc.file, 'utf8');
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || die(`${id} has no frontmatter`);
    const head = /^status:.*$/m.test(fm[1]) ? fm[1].replace(/^status:.*$/m, 'status: agreed') : `${fm[1]}\nstatus: agreed`;
    fs.writeFileSync(doc.file, text.replace(fm[1], head));
    writeState(r);
    console.log(`${id} agreed — next: /lean:plan ${id}`);
    break;
  }

  case 'notes': {
    const r = need();
    printCardNotes(r, card(r, pos[0]));
    break;
  }

  case 'doctor': {
    const r = need();
    const trees = workerWorktrees(r);
    const checkedOut = new Set(trees.map((w) => w.branch));
    const current = gitC(r, 'branch --show-current');
    const mergedBranches = splitLines(gitC(r, 'for-each-ref --format="%(refname:short)" --merged HEAD refs/heads')).filter(
      (b) => b !== current && !checkedOut.has(b)
    );

    console.log(`Worker worktrees: ${trees.length || 'none'}`);
    for (const w of trees) {
      const s = worktreeState(w);
      const subject = w.own && !w.missing ? ` · ${gitC(r, `log -1 --format=%s ${w.sha}`)}` : '';
      console.log(`  ${s.padEnd(8)} ${w.branch || w.sha.slice(0, 7)}${subject} (${WORKTREE_STATES[s]})`);
    }
    console.log(`Merged branches: ${mergedBranches.join(', ') || 'none'}`);

    const removable = trees.filter((w) => ['merged', 'empty'].includes(worktreeState(w)));
    const missing = trees.some((w) => w.missing);
    if (!opt.fix) {
      console.log(
        removable.length || mergedBranches.length || missing
          ? `Fix: lean doctor --fix removes ${removable.length} worktree(s) and deletes ${mergedBranches.length} merged branch(es)` +
              `${missing ? ', and prunes missing worktrees' : ''}. Locked, dirty and unmerged worktrees are kept.`
          : 'Nothing to clean.'
      );
      break;
    }
    if (missing) gitC(r, 'worktree prune');
    for (const w of removable) console.log(removeWorktree(r, w) ? `removed ${w.path}` : `could not remove ${w.path}`);
    for (const b of mergedBranches) {
      console.log(gitC(r, `branch -d "${b}"`) !== null ? `deleted branch ${b}` : `could not delete branch ${b}`);
    }
    break;
  }

  case 'secured': {
    const sha = git(`rev-parse --short ${pos[0] || 'HEAD'}`) || pos[0] || die('not a git repository');
    mutate(need(), (st) => {
      st.secured = { sha, date: today() };
    });
    console.log(`security review recorded at ${sha}`);
    break;
  }

  case 'report': {
    const md = buildReport(need(), opt.since || undefined);
    if (opt.out) {
      fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
      fs.writeFileSync(opt.out, md);
      console.log(`report written to ${opt.out}`);
    } else {
      console.log(md);
    }
    break;
  }

  case 'ui': {
    const r = need();
    const registry = path.join(globalHome(), 'ui.json');
    const key = path.resolve(r).toLowerCase();
    const entry = readJson(registry, {})[key];

    if (opt.stop) {
      if (entry && isAlive(entry.pid)) {
        process.kill(entry.pid);
        console.log(`stopped lean ui on port ${entry.port}`);
      } else {
        console.log('lean ui is not running for this project');
      }
      const all = readJson(registry, {});
      delete all[key];
      if (fs.existsSync(registry)) writeJson(registry, all);
      break;
    }

    let url = entry && isAlive(entry.pid) ? `http://127.0.0.1:${entry.port}` : null;
    if (!url) {
      const child = spawn(process.execPath, [path.join(here, 'ui-server.mjs'), r, String(opt.port || 4777)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      for (const until = Date.now() + 5000; Date.now() < until && !url; ) {
        const e = readJson(registry, {})[key];
        if (e && e.pid === child.pid) url = `http://127.0.0.1:${e.port}`;
        else Atomics.wait(sleeper, 0, 0, 100);
      }
      if (!url) die(`ui server did not start — run \`node "${path.join(here, 'ui-server.mjs')}" "${r}"\` to see the error`);
    }
    console.log(`lean ui: ${url}  (stop with: lean ui --stop)`);
    if (!opt['no-open']) openBrowser(url);
    break;
  }

  case 'focus': {
    const note = pos.join(' ').trim();
    mutate(need(), (st) => {
      if (note) st.note = note;
      else delete st.note;
    });
    console.log(note ? 'note pinned (cleared by the next lean done)' : 'note cleared');
    break;
  }

  case 'block':
    mutate(need(), (st) => {
      (st.blockers ||= []).push(pos.join(' '));
    });
    console.log('blocker added');
    break;

  case 'unblock': {
    const n = parseInt(pos[0], 10);
    mutate(need(), (st) => {
      st.blockers = (st.blockers || []).filter((_, i) => i !== n - 1);
    });
    console.log('blocker removed');
    break;
  }

  case 'reviewed': {
    const sha = git(`rev-parse --short ${pos[0] || 'HEAD'}`) || pos[0];
    mutate(need(), (st) => {
      st.reviewed = sha;
    });
    console.log(`review recorded at ${sha}`);
    break;
  }

  default:
    console.log(HELP);
}
