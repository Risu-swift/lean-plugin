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
  assert.match(r.out, /no test file in its commits or uncommitted changes/);
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

test('done counts uncommitted test files, so one commit holds the code and the record', (t) => {
  const p = project(t);
  p.card('T-001', { title: 'Add a', files: ['src/a.js', 'src/a.test.js'] });
  p.write('src/a.js', '1');
  p.write('src/a.test.js', 'test');
  const r = p.lean('done', 'T-001', '--notes', 'z1');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /next: commit the work and \.lean\/ together as "T-001: Add a"/);
  const sha = p.commit('T-001: Add a');
  assert.equal(p.git('status', '--porcelain'), '', 'nothing left for a separate mark-done commit');
  assert.match(p.lean('status').out, new RegExp(`T-001 Add a @${sha}`));
});

test('batch picks ready cards with disjoint files, most-unblocking first, and hands HUMAN cards back', (t) => {
  const p = project(t);
  p.config({ parallel: { maxAgents: 2 } });
  p.card('T-001', { files: ['a.js'] });
  p.card('T-002', { files: ['a.js'] });
  p.card('T-003', { files: ['c.js'] });
  p.card('T-004', { files: ['d.js'], depends: ['T-003'] });
  p.card('T-005', { files: ['e.js'], depends: ['T-003'] });
  p.card('T-006', { title: 'HUMAN: deploy', depends: ['T-001', 'T-002', 'T-004', 'T-005'] });
  const done = (...ids) => ids.forEach((id) => assert.equal(p.lean('done', id, '--no-tests', 'fixture').code, 0));

  let out = p.lean('batch').out;
  assert.match(out, /^batch: T-003 T-001$/m, 'T-003 unblocks two cards; T-002 shares a.js with T-001');
  assert.match(out, /^waves left: 4$/m);
  done('T-001', 'T-003');
  assert.match(p.lean('batch').out, /^batch: T-002 T-004$/m, 'capped at maxAgents');
  done('T-002', 'T-004');
  assert.match(p.lean('batch').out, /^batch: T-005$/m);
  done('T-005');
  assert.match(p.lean('batch').out, /^human: T-006 HUMAN: deploy/m);
  done('T-006');
  assert.match(p.lean('batch').out, /^phase done/m);
});

test('check-plan reports waves and suggests merges for conflicts, re-touches, chains and over-budget plans', (t) => {
  const spec = (p, criteria) =>
    p.write('.lean/specs/S-001-demo.md', `---\nid: S-001\ntitle: Demo\nstatus: agreed\n---\n## Problem\nx\n## Acceptance\n${criteria.map((a) => `- ${a}: works`).join('\n')}\n## Risks\nnone\n`);
  const s = { spec: 'S-001' };

  const p = project(t);
  spec(p, ['A1', 'A2']);
  p.card('T-001', { ...s, files: ['src/types.ts'] });
  p.card('T-002', { ...s, files: ['src/a.ts', 'src/shared.ts'] });
  p.card('T-003', { ...s, files: ['src/b.ts', 'src/shared.ts'] });
  p.card('T-004', { ...s, files: ['src/c.ts'], depends: ['T-001'] });
  p.card('T-005', { ...s, files: ['src/a.ts', 'src/shared.ts'], depends: ['T-002'] });
  const out = p.lean('check-plan', 'S-001').out;
  assert.match(out, /S-001: 5 cards \(5 open\) · 2 acceptance criteria · 3 waves at up to 3 agents/);
  assert.match(out, /wave 1: T-001 T-002\n\s+wave 2: T-003 T-004\n\s+wave 3: T-005/);
  assert.match(out, /budget: 5 cards for 2 acceptance criteria/);
  assert.match(out, /conflict: T-002 \+ T-003 share shared\.ts/);
  assert.match(out, /re-touch: T-002 \+ T-005 both edit a\.ts, shared\.ts/);
  assert.match(out, /chain: T-001 → T-004/);

  const clean = project(t);
  spec(clean, ['A1', 'A2', 'A3', 'A4']);
  clean.card('T-001', { ...s, files: ['src/x.ts'] });
  clean.card('T-002', { ...s, files: ['src/y.ts'] });
  assert.match(clean.lean('check-plan', 'S-001').out, /1 waves[\s\S]*No suggestions/);
});

test('start prints the notes most related to a single card, skipping ones its Watch list cites', (t) => {
  const p = project(t);
  const cited = p
    .zk('new', '--type', 'gotcha', '--title', 'Close transaction must re-read the pitch state', '--body', 'Apply: read inside the transaction')
    .out.match(/created P (\S+)/)[1];
  p.zk('new', '--type', 'pattern', '--title', 'Vote close retries on transaction contention', '--tags', 'close-race', '--body', 'Apply: retry 5 times with jitter', '--force');
  p.zk('new', '--type', 'fact', '--title', 'Weekly client report is sent on Fridays');
  p.card('T-001', {
    title: 'Votes never get lost when voting closes',
    files: ['functions/src/closeTransaction.ts'],
    body: `## Watch\n- re-read state (zk ${cited})`,
  });

  const r = p.lean('start', 'T-001');
  assert.match(r.out, /notes for T-001/);
  assert.match(r.out, /Vote close retries on transaction contention/);
  assert.match(r.out, /Apply: retry 5 times with jitter/);
  assert.doesNotMatch(r.out, /must re-read the pitch state/, 'already cited in the card');
  assert.doesNotMatch(r.out, /Weekly client report/);
  assert.match(p.lean('notes', 'T-001').out, /Vote close retries/);

  p.card('T-002');
  p.card('T-003');
  assert.doesNotMatch(p.lean('start', 'T-002', 'T-003').out, /notes for/, 'parallel workers look up their own notes');
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

test('research lists open questions, blocks close until all are answered, and flags check-plan', (t) => {
  const p = project(t);
  const spec = (research) =>
    p.write(
      '.lean/specs/S-001-demo.md',
      `---\nid: S-001\ntitle: Demo board\nstatus: needs-research\ntags: [a, b]\n---\n## Problem\nx\n## Research\n${research}\n## Acceptance\n- A1: works\n`
    );
  spec('- R1: Does the NPU driver support INT8?\n  → Yes, since v1.6 (source: vendor docs)\n- R2: Can it boot from NVMe?');

  assert.match(p.lean('research').out, /S-001 Demo board · 1 open → \/lean:research S-001/);
  assert.match(p.lean('status').out, /Focus: S-001 Demo board needs research — next: \/lean:research S-001/);
  assert.match(p.lean('status').out, /Research: S-001 \(1 open\)/);

  const shown = p.lean('research', 'S-001').out;
  assert.match(shown, /1\/2 open/);
  assert.match(shown, /R1 done  Does the NPU driver support INT8\?\n\s+→ Yes, since v1\.6/);
  assert.match(shown, /R2 OPEN  Can it boot from NVMe\?/);

  const refused = p.lean('research', 'S-001', '--close');
  assert.equal(refused.code, 1);
  assert.match(refused.out, /R2 still open/);
  assert.match(p.read('.lean/specs/S-001-demo.md'), /status: needs-research/);

  p.card('T-001', { spec: 'S-001', files: ['src/a.ts'] });
  assert.match(p.lean('check-plan', 'S-001').out, /research: R2 still open → run \/lean:research S-001/);

  spec('- R1: Does the NPU driver support INT8?\n  → Yes, since v1.6\n- R2: Can it boot from NVMe?\n  Answer: Yes, with the SPI bootloader update');
  const closed = p.lean('research', 'S-001', '--close');
  assert.equal(closed.code, 0, closed.out);
  assert.match(closed.out, /S-001 agreed — next: \/lean:plan S-001/);
  const text = p.read('.lean/specs/S-001-demo.md');
  assert.match(text, /^---\nid: S-001\ntitle: Demo board\nstatus: agreed\ntags: \[a, b\]\n---/);
  assert.equal(p.lean('research').out.trim(), 'no specs need research');
  assert.doesNotMatch(p.lean('check-plan', 'S-001').out, /research:/);
});
