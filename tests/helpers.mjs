import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'lean', 'scripts');
const tmp = (prefix) => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

// A throwaway git repo with `lean init` done and its own global vault (LEAN_HOME).
export function project(t) {
  const dir = tmp('lean-repo-');
  const home = tmp('lean-home-');
  t.after(() => {
    for (const d of [dir, home]) {
      try {
        fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
      } catch {}
    }
  });
  const env = { ...process.env, LEAN_HOME: home };
  const run = (script, args) => {
    const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd: dir, env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const gitIn = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  const p = {
    dir,
    home,
    gitIn,
    git: (...args) => gitIn(dir, ...args),
    lean: (...args) => run('lean.mjs', args),
    zk: (...args) => run('zk.mjs', args),
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    write(rel, text, base = dir) {
      const f = path.join(base, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
      return f;
    },
    commit(msg, cwd = dir) {
      gitIn(cwd, 'add', '-A');
      gitIn(cwd, 'commit', '-qm', msg);
      return gitIn(cwd, 'rev-parse', '--short', 'HEAD');
    },
    config(patch) {
      const f = path.join(dir, '.lean', 'config.json');
      fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch }, null, 2));
    },
    card(id, { title = `${id} card`, status = 'todo', depends = [], files = [], done = false, body = '', spec } = {}) {
      const text = [
        '---',
        `id: ${id}`,
        `title: ${title}`,
        ...(spec ? [`spec: ${spec}`] : []),
        `status: ${status}`,
        `depends: [${depends.join(', ')}]`,
        `files: [${files.join(', ')}]`,
        'tdd: strict',
        '---',
        '## Goal',
        body,
        '',
      ].join('\n');
      return p.write(path.join('.lean', 'tasks', ...(done ? ['done'] : []), `${id}-card.md`), text);
    },
    // A worker worktree like the ones `isolation: worktree` creates, optionally with one commit.
    worktree(name, { commit } = {}) {
      const rel = `.claude/worktrees/${name}`;
      p.git('worktree', 'add', '-q', '-b', `worktree-${name}`, rel);
      const wt = path.join(dir, rel);
      if (commit) {
        p.write(`${name}.test.js`, `// ${name}\n`, wt);
        p.commit(commit, wt);
      }
      return wt;
    },
    merge: (name) => p.git('merge', '-q', '--no-ff', `worktree-${name}`, '-m', `Merge ${name}`),
  };

  p.git('init', '-q', '-b', 'main');
  for (const [k, v] of [
    ['user.name', 'lean test'],
    ['user.email', 'lean@test.local'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ]) {
    p.git('config', k, v);
  }
  p.write('.gitignore', '.claude/worktrees/\n');
  p.write('README.md', 'test repo\n');
  p.commit('init');
  const init = p.lean('init', '--project', 'demo');
  if (init.code !== 0) throw new Error(init.out);
  p.commit('lean init');
  return p;
}
