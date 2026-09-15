#!/usr/bin/env node
// SessionStart hook: print compact project state. Silent outside lean projects.
import fs from 'node:fs';
import { findRoot, render } from './lib.mjs';

let cwd = process.cwd();
try {
  if (!process.stdin.isTTY) {
    const input = fs.readFileSync(0, 'utf8');
    if (input.trim()) cwd = JSON.parse(input).cwd || cwd;
  }
} catch {}

try {
  const root = findRoot(cwd);
  if (root) {
    console.log(render(root));
    console.log(
      'lean: /lean:grill → /lean:plan → /lean:do (then /clear) · /lean:debug · /lean:compound · /lean:review · ' +
        'memory: `zk find <words>` · state: `lean status|tasks`'
    );
  }
} catch {}
