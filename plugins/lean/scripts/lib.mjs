import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.lean', 'state.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const globalHome = () => process.env.LEAN_HOME || path.join(os.homedir(), '.lean');

export function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

export function parseArgs(argv, booleans = []) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) opt[key.slice(0, eq)] = key.slice(eq + 1);
    else if (booleans.includes(key)) opt[key] = true;
    else opt[key] = argv[++i] ?? '';
  }
  return { pos, opt };
}

export const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

export const today = () => new Date().toLocaleDateString('sv-SE');

const unquote = (s) => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);

// Minimal frontmatter: `key: value`, `key: [a, b]`, or block lists (`  - a`).
export function parseNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = [];
      data[lastKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    lastKey = kv[1];
    const v = kv[2].trim();
    data[lastKey] = v.startsWith('[') && v.endsWith(']') ? list(v.slice(1, -1)).map(unquote) : unquote(v);
  }
  return { data, body: m[2] };
}

export function serialize(data, body) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

const num = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

export function loadCards(root) {
  const cards = [];
  for (const [sub, inDone] of [['tasks', false], [path.join('tasks', 'done'), true]]) {
    const dir = path.join(root, '.lean', sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/^T-\d+.*\.md$/i.test(f)) continue;
      const file = path.join(dir, f);
      const { data, body } = parseNote(fs.readFileSync(file, 'utf8'));
      const id = String(data.id || f.match(/^T-\d+/i)[0]).toUpperCase();
      cards.push({ id, file, data, body, done: inDone || data.status === 'done' });
    }
  }
  return cards.sort((a, b) => num(a.id) - num(b.id));
}

export function readyCards(cards) {
  const done = new Set(cards.filter((c) => c.done).map((c) => c.id));
  return cards.filter(
    (c) => !c.done && c.data.status !== 'doing' && list(c.data.depends).every((d) => done.has(d.toUpperCase()))
  );
}

// Focus is computed from the cards so it can never go stale: the active spec, its progress, and what's next.
export function focusLine(root, cards = loadCards(root)) {
  if (!cards.length) return 'no cards yet — next: /lean:grill <topic>';
  const open = cards.filter((c) => !c.done);
  const doing = open.filter((c) => c.data.status === 'doing');
  const ready = readyCards(cards);
  const pick = doing[0] || ready[0] || open[0] || cards[cards.length - 1];
  const specId = pick.data.spec ? String(pick.data.spec).toUpperCase() : null;
  const inScope = specId ? cards.filter((c) => String(c.data.spec || '').toUpperCase() === specId) : cards;
  const specTitle = specId ? loadSpecs(root).find((s) => s.id === specId)?.data.title : null;

  const parts = [specId ? `${specId} ${specTitle || ''}`.trim() : 'All cards'];
  parts.push(`${inScope.filter((c) => c.done).length}/${inScope.length} done`);
  if (!open.length) parts.push('all cards done — next: /lean:review, then /lean:grill the next phase');
  else if (doing.length) parts.push(`now: ${doing.map((c) => c.id).join(', ')}`);
  else if (ready.length) parts.push(`next: ${ready[0].id} ${ready[0].data.title || ''}`.trim());
  else parts.push('open cards are waiting on dependencies');
  return parts.join(' · ');
}

export function render(root) {
  const st = readJson(path.join(root, '.lean', 'state.json'), {});
  const cards = loadCards(root);
  const open = cards.filter((c) => !c.done);
  const doing = open.filter((c) => c.data.status === 'doing');
  const ready = readyCards(cards);
  const waiting = open.length - doing.length - ready.length;
  const label = (c) => `${c.id} ${c.data.title || ''}`.trim();

  const out = [`# STATE — ${st.project || path.basename(root)}`];
  out.push(`Focus: ${focusLine(root, cards)}`);
  if (st.note) out.push(`Note: ${st.note}`);
  out.push(`Now: ${doing.length ? doing.map(label).join('; ') : '—'}`);
  const readyText = ready.length
    ? ready.slice(0, 6).map(label).join('; ') + (ready.length > 6 ? ` (+${ready.length - 6})` : '')
    : '—';
  out.push(`Ready: ${readyText}${waiting > 0 ? ` · waiting on deps: ${waiting}` : ''}`);
  if (st.blockers?.length) {
    out.push('Blockers:');
    st.blockers.forEach((b, i) => out.push(`  ${i + 1}. ${b}`));
  }
  if (st.recent?.length) {
    out.push('Recent:');
    for (const r of st.recent.slice(0, 5)) {
      const commit = r.commit ? ` @${r.commit}` : '';
      const notes = r.notes?.length ? ` zk:${r.notes.join(',')}` : '';
      out.push(`  - ${r.date} ${r.id} ${r.title || ''}${commit}${notes}`);
    }
  }
  if (st.reviewed) out.push(`Last review: ${st.reviewed}`);
  if (st.secured) out.push(`Last security review: ${st.secured.sha} (${st.secured.date})`);
  return out.join('\n');
}

export function writeState(root) {
  const note = '_Generated by the lean CLI. Change it with `lean focus|block|start|done`, not by hand._';
  fs.writeFileSync(path.join(root, '.lean', 'STATE.md'), `${render(root)}\n\n${note}\n`);
}

export const daysUntil = (date) => Math.ceil((new Date(date) - new Date(today())) / 864e5);

export function loadNotes(root) {
  const vaults = [
    ...(root ? [{ scope: 'P', dir: path.join(root, '.lean', 'zk') }] : []),
    { scope: 'G', dir: path.join(globalHome(), 'zk') },
  ];
  const notes = [];
  for (const v of vaults) {
    if (!fs.existsSync(v.dir)) continue;
    for (const f of fs.readdirSync(v.dir)) {
      if (!f.endsWith('.md')) continue;
      const file = path.join(v.dir, f);
      const { data, body } = parseNote(fs.readFileSync(file, 'utf8'));
      notes.push({ scope: v.scope, file, data, body, id: String(data.id || f.slice(0, 15)) });
    }
  }
  return notes.sort((a, b) => b.id.localeCompare(a.id));
}

export function loadSpecs(root) {
  const dir = path.join(root, '.lean', 'specs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^S-\d+.*\.md$/i.test(f))
    .map((f) => {
      const file = path.join(dir, f);
      const { data, body } = parseNote(fs.readFileSync(file, 'utf8'));
      return { id: String(data.id || f.match(/^S-\d+/i)[0]).toUpperCase(), file, data, body };
    })
    .sort((a, b) => num(a.id) - num(b.id));
}

export function buildReport(root, since = new Date(Date.now() - 7 * 864e5).toLocaleDateString('sv-SE')) {
  const st = readJson(path.join(root, '.lean', 'state.json'), {});
  const cfg = readJson(path.join(root, '.lean', 'config.json'), {});
  const cards = loadCards(root);
  const done = cards.filter((c) => c.done);
  const recentDone = done.filter((c) => String(c.data.done || '') >= since);
  const doing = cards.filter((c) => !c.done && c.data.status === 'doing');
  const ready = readyCards(cards);
  const waiting = cards.length - done.length - doing.length - ready.length;
  const pct = cards.length ? Math.round((done.length / cards.length) * 100) : 0;
  const days = cfg.deadline ? daysUntil(cfg.deadline) : null;
  const row = (c) => `- **${c.id}** ${c.data.title || ''}`;
  const section = (title, items) => ['', `## ${title}`, ...(items.length ? items : ['- none'])];

  return [
    `# ${st.project || path.basename(root)} — progress report`,
    '',
    `_${today()}${days != null ? ` · ${days} days to ${cfg.deadlineLabel || cfg.deadline}` : ''}_`,
    '',
    `**Progress:** ${done.length}/${cards.length} tasks done (${pct}%)`,
    '',
    `**Focus:** ${focusLine(root, cards)}`,
    ...(st.note ? ['', `**Note:** ${st.note}`] : []),
    ...section(
      `Done since ${since} (${recentDone.length})`,
      recentDone.map((c) => `${row(c)}${c.data.done ? ` (${c.data.done})` : ''}`)
    ),
    ...section(`In progress (${doing.length})`, doing.map(row)),
    ...section(`Up next (${ready.length})`, ready.slice(0, 8).map(row)),
    ...(waiting > 0 ? ['', `_${waiting} more tasks are waiting on the ones above._`] : []),
    ...section(`Blockers (${st.blockers?.length || 0})`, (st.blockers || []).map((b) => `- ${b}`)),
    '',
  ].join('\n');
}
