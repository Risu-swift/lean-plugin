import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { project } from './helpers.mjs';

const idOf = (out) => out.match(/created [PG] (\S+)/)[1];
const hitLines = (out) => out.split('\n').filter((l) => /^[PG] /.test(l));

test('new notes are found by claim words and tags; --global goes to the global vault', (t) => {
  const p = project(t);
  const r = p.zk('new', '--type', 'gotcha', '--title', 'Emulator ports collide between workers', '--tags', 'emulator,parallel', '--body', 'Why: x\\nApply: y');
  assert.match(r.out, /created P \d{8}-\d{6}/);
  assert.match(p.zk('find', 'ports').out, /Emulator ports collide[^\n]*\n {4}Apply: y/);
  assert.match(p.zk('find', '--tag', 'parallel').out, /Emulator ports collide/);
  assert.match(p.zk('find', 'nothing-like-this').out, /no matches/);
  assert.match(p.zk('show', idOf(r.out)).out, /Why: x\nApply: y/);

  assert.match(p.zk('new', '--type', 'fact', '--title', 'Git worktrees need unique branches', '--global').out, /created G/);
  assert.equal(fs.readdirSync(path.join(p.home, 'zk')).length, 1);
});

test('find matches whole words, splits identifiers, ranks rare words, and caps at 5', (t) => {
  const p = project(t);
  const add = (title, body = '', tags = '') => p.zk('new', '--type', 'fact', '--title', title, '--tags', tags, '--body', body, '--force');
  add('Emulator port collides in parallel runs', 'Apply: set LEAN_PORT_OFFSET per worker', 'emulator');
  add('Weekly report goes to the client', 'Apply: lean report every Friday');
  add('Operator moves between pitches', 'Apply: call advanceToNextPitch only from CLOSED');

  let out = p.zk('find', 'port').out;
  assert.match(out, /Emulator port collides/);
  assert.doesNotMatch(out, /Weekly report/, '"port" does not match "report"');
  assert.match(out, /Apply: set LEAN_PORT_OFFSET per worker/);
  assert.match(p.zk('find', 'next', 'pitch').out, /Operator moves between pitches/);
  assert.match(p.zk('find', 'advanceToNextPitch').out, /Operator moves between pitches/);

  out = p.zk('find', 'emulator', 'weekly').out;
  assert.equal(hitLines(out).length, 2, 'both terms are rare, so both notes rank');

  for (let i = 0; i < 7; i++) add(`Emulator fact number ${i}`);
  assert.equal(hitLines(p.zk('find', 'emulator').out).length, 5);
});

test('new refuses a note that repeats an existing claim, unless --force', (t) => {
  const p = project(t);
  p.zk('new', '--type', 'gotcha', '--title', 'Emulator ports collide between parallel workers', '--body', 'Apply: offset ports per worker');
  p.zk('new', '--type', 'fact', '--title', 'Vitest web tests run without a window object');
  const dup = ['new', '--type', 'gotcha', '--title', 'Parallel workers collide on emulator ports'];

  const r = p.zk(...dup);
  assert.equal(r.code, 2);
  assert.match(r.out, /similar note exists \(\d+% overlap\), nothing created/);
  assert.match(r.out, /Emulator ports collide between parallel workers/);
  assert.match(r.out, /file: .*emulator-ports-collide/);
  assert.equal(fs.readdirSync(path.join(p.dir, '.lean', 'zk')).length, 2);

  assert.match(p.zk(...dup, '--force').out, /created P/);
  assert.match(p.zk('new', '--type', 'fact', '--title', 'Deploy needs the billing account linked').out, /created P/);
});

test('supersede hides the old note from find and ls, --all shows it', (t) => {
  const p = project(t);
  const old = idOf(p.zk('new', '--type', 'decision', '--title', 'Timer closes all voting').out);
  const next = idOf(p.zk('new', '--type', 'decision', '--title', 'Timer closes audience voting only', '--force').out);
  assert.equal(p.zk('supersede', old, next).code, 0);

  let out = p.zk('find', 'timer').out;
  assert.match(out, /audience voting only/);
  assert.doesNotMatch(out, /closes all voting/);
  assert.doesNotMatch(p.zk('ls').out, /closes all voting/);

  out = p.zk('find', 'timer', '--all').out;
  assert.match(out, new RegExp(`closes all voting\\s+\\(superseded by ${next}\\)`));

  assert.match(p.zk('show', old).out, new RegExp(`superseded_by: ${next}`));
  const shown = p.zk('show', next).out;
  assert.match(shown, new RegExp(`supersedes: \\[${old}\\]`));
  assert.match(shown, new RegExp(`links: \\[${old}\\]`));
});

test('lint flags dangling links and project notes citing missing files', (t) => {
  const p = project(t);
  p.write('functions/src/close.ts', 'x');
  p.commit('code');
  const add = (...args) => p.zk('new', '--force', ...args);
  add('--type', 'gotcha', '--title', 'Close path detail', '--body', 'Apply: see src/close.ts, lib/gone.ts and https://example.com/a/b.html');
  add('--type', 'fact', '--title', 'Points nowhere', '--links', '20000101-000000');
  const oldId = idOf(add('--type', 'fact', '--title', 'Old note', '--body', 'lib/also-gone.ts').out);
  const newId = idOf(add('--type', 'fact', '--title', 'New note').out);
  p.zk('supersede', oldId, newId);

  const out = p.zk('lint').out;
  assert.match(out, /cites missing lib\/gone\.ts · Close path detail/);
  assert.doesNotMatch(out, /src\/close\.ts|example\.com/, 'tail of a tracked path and URLs are fine');
  assert.match(out, /links → 20000101-000000: no such note/);
  assert.doesNotMatch(out, /also-gone/, 'superseded notes are not path-checked');
  assert.match(out, /2 issue\(s\)/);
});
