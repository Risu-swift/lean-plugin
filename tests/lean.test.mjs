import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { project } from './helpers.mjs';

test('new-id continues after open and done cards', (t) => {
  const p = project(t);
  p.card('T-001');
  p.card('T-004', { done: true });
  assert.equal(p.lean('new-id', 'task', '--count', '2').out.trim(), 'T-005\nT-006');
  assert.equal(p.lean('new-id', 'spec').out.trim(), 'S-001');
});

test('next lists only cards whose dependencies are done', (t) => {
  const p = project(t);
  p.card('T-001', { done: true });
  p.card('T-002', { depends: ['T-001'] });
  p.card('T-003', { depends: ['T-002'] });
  const out = p.lean('next').out;
  assert.match(out, /T-002/);
  assert.doesNotMatch(out, /T-003/);
});

test('done refuses a card whose commits changed no test file', (t) => {
  const p = project(t);
  p.card('T-001', { files: ['src/a.js'] });
  p.write('src/a.js', '1');
  p.commit('T-001: add a');
  const r = p.lean('done', 'T-001');
  assert.equal(r.code, 1);
  assert.match(r.out, /none of its commits changed a test file/);
  assert.ok(p.exists('.lean/tasks/T-001-card.md'));
});

test('done moves the card to done/ and records it when a commit changed a test file', (t) => {
  const p = project(t);
  p.card('T-001', { files: ['src/a.js', 'src/a.test.js'] });
  p.write('src/a.test.js', 'test');
  const sha = p.commit('T-001: add a');
  const r = p.lean('done', 'T-001', '--commit', sha, '--notes', 'z1');
  assert.equal(r.code, 0, r.out);
  assert.ok(p.exists('.lean/tasks/done/T-001-card.md'));
  assert.ok(!p.exists('.lean/tasks/T-001-card.md'));
  const state = JSON.parse(p.read('.lean/state.json'));
  assert.deepEqual([state.recent[0].id, state.recent[0].commit, state.recent[0].notes], ['T-001', sha, ['z1']]);
});

test('done accepts --no-tests with a reason, and HUMAN cards need no tests', (t) => {
  const p = project(t);
  p.card('T-001');
  p.card('T-002', { title: 'HUMAN: check the live deploy' });
  assert.equal(p.lean('done', 'T-001', '--no-tests', 'docs only').code, 0);
  assert.match(p.read('.lean/tasks/done/T-001-card.md'), /no_tests: docs only/);
  assert.equal(p.lean('done', 'T-002').code, 0);
});

test('check-parallel flags shared files and same-batch dependencies', (t) => {
  const p = project(t);
  p.card('T-001', { files: ['src/a.js'] });
  p.card('T-002', { files: ['src/a.js'] });
  p.card('T-003', { files: ['src/c.js'], depends: ['T-001'] });
  p.card('T-004', { files: ['src/d.js'] });
  let r = p.lean('check-parallel', 'T-001', 'T-002');
  assert.equal(r.code, 2);
  assert.match(r.out, /both touch src\/a\.js/);
  assert.match(p.lean('check-parallel', 'T-001', 'T-003').out, /T-003 depends on T-001 \(same batch\)/);
  r = p.lean('check-parallel', 'T-001', 'T-004');
  assert.equal(r.code, 0);
  assert.match(r.out, /^OK/);
});

test('test reuses a passing run until the code changes', (t) => {
  const p = project(t);
  p.write('check.mjs', "import fs from 'node:fs';\nprocess.exit(fs.existsSync('fail.flag') ? 1 : 0);\n");
  p.write('src/a.js', '1');
  p.commit('add check');
  p.config({ test: 'node check.mjs', testFast: 'node check.mjs --fast' });
  const cached = (r) => /^PASS \(cached/.test(r.out);

  let r = p.lean('test');
  assert.equal(r.code, 0, r.out);
  assert.ok(!cached(r));
  assert.ok(cached(p.lean('test')), 'same code, cached');
  assert.ok(cached(p.lean('test', '--fast')), 'a passing full run covers --fast');

  p.lean('focus', 'bookkeeping only');
  assert.ok(cached(p.lean('test')), '.lean/ changes do not count');

  p.write('src/a.js', '2');
  assert.ok(!cached(p.lean('test')), 'tracked change reruns');
  assert.ok(cached(p.lean('test')));

  p.write('src/new.js', 'x');
  assert.ok(!cached(p.lean('test')), 'untracked file reruns');
  assert.ok(!cached(p.lean('test', '--force')), '--force reruns');

  p.write('fail.flag', '');
  r = p.lean('test');
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL/);
  fs.rmSync(path.join(p.dir, 'fail.flag'));
  assert.ok(!cached(p.lean('test')), 'a failure clears the cached pass');
});

// merged (own commit, merged), unmerged (own commit), empty (no commits), dirty (merged but has changes)
function workers(p) {
  p.worktree('agent-merged', { commit: 'T-001: merged work' });
  p.merge('agent-merged');
  p.worktree('agent-unmerged', { commit: 'T-002: unmerged work' });
  const dirty = p.worktree('agent-dirty', { commit: 'T-003: dirty work' });
  p.merge('agent-dirty');
  p.write('scratch.txt', 'wip', dirty);
  p.worktree('agent-empty');
}

test('done removes merged worker worktrees and keeps unmerged, dirty and empty ones', (t) => {
  const p = project(t);
  p.card('T-001');
  workers(p);
  const r = p.lean('done', 'T-001');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /removed merged worker worktrees: worktree-agent-merged/);
  assert.ok(!p.exists('.claude/worktrees/agent-merged'));
  assert.doesNotMatch(p.git('branch'), /worktree-agent-merged/);
  for (const name of ['agent-unmerged', 'agent-dirty', 'agent-empty']) assert.ok(p.exists(`.claude/worktrees/${name}`), name);
});

test('doctor reports worktrees, and --fix removes only merged and empty ones plus merged branches', (t) => {
  const p = project(t);
  workers(p);
  p.worktree('agent-locked', { commit: 'T-004: locked work' });
  p.merge('agent-locked');
  p.git('worktree', 'lock', '.claude/worktrees/agent-locked');
  p.git('branch', 'wip/old');

  let r = p.lean('doctor');
  assert.match(r.out, /merged\s+worktree-agent-merged · T-001: merged work/);
  assert.match(r.out, /unmerged\s+worktree-agent-unmerged · T-002: unmerged work/);
  assert.match(r.out, /dirty\s+worktree-agent-dirty/);
  assert.match(r.out, /empty\s+worktree-agent-empty/);
  assert.match(r.out, /locked\s+worktree-agent-locked/);
  assert.match(r.out, /Merged branches: wip\/old/);
  assert.match(r.out, /removes 2 worktree\(s\) and deletes 1 merged branch/);
  assert.ok(p.exists('.claude/worktrees/agent-merged'), 'report only without --fix');

  r = p.lean('doctor', '--fix');
  assert.ok(!p.exists('.claude/worktrees/agent-merged'), r.out);
  assert.ok(!p.exists('.claude/worktrees/agent-empty'), r.out);
  for (const name of ['agent-unmerged', 'agent-dirty', 'agent-locked']) assert.ok(p.exists(`.claude/worktrees/${name}`), name);
  assert.doesNotMatch(p.git('branch'), /wip\/old|worktree-agent-merged|worktree-agent-empty/);
  assert.match(p.lean('doctor').out, /Nothing to clean/);
});

test('reset puts the card back to todo and records its unmerged worker branch', (t) => {
  const p = project(t);
  p.card('T-002', { status: 'doing' });
  p.worktree('agent-x', { commit: 'T-002: half done' });
  const r = p.lean('reset', 'T-002');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /T-002 → worktree-agent-x/);
  const text = p.read('.lean/tasks/T-002-card.md');
  assert.match(text, /status: todo/);
  assert.match(text, /branch: worktree-agent-x/);
});
