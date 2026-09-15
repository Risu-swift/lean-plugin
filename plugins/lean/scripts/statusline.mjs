#!/usr/bin/env node
// Status line: lean progress, deadline, last test, model, context and 5h quota. Runs outside the model (no tokens).
// Fits COLUMNS (set by Claude Code) by dropping detail step by step, so it never wraps.
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, loadCards, readyCards, readJson, today } from './lib.mjs';

const ANSI = /\x1b\[[0-9;]*m/g;
const color = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const dim = (s) => color('2', s);
const visible = (s) => [...s.replace(ANSI, '')].length;
const short = (s, n) => ([...s].length > n ? [...s].slice(0, Math.max(0, n - 1)).join('') + '…' : s);
const RED = '31';
const YELLOW = '33';
const GREEN = '32';

function branch(dir) {
  try {
    let gitPath = path.join(dir, '.git');
    if (fs.statSync(gitPath).isFile()) {
      gitPath = path.resolve(dir, fs.readFileSync(gitPath, 'utf8').replace(/^gitdir:\s*/, '').trim());
    }
    const head = fs.readFileSync(path.join(gitPath, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
  } catch {
    return null;
  }
}

let data = {};
try {
  data = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {}

const cwd = data.workspace?.current_dir || data.cwd || process.cwd();
const width = Math.max(20, (parseInt(process.env.COLUMNS, 10) || 120) - 4);

const info = { name: path.basename(cwd), branch: null, lean: false, doing: [] };
try {
  const root = findRoot(cwd);
  info.branch = branch(root || cwd);
  if (root) {
    const st = readJson(path.join(root, '.lean', 'state.json'), {});
    const cfg = readJson(path.join(root, '.lean', 'config.json'), {});
    const last = readJson(path.join(root, '.lean', 'last-test.json'), null);
    const cards = loadCards(root);
    Object.assign(info, {
      lean: true,
      name: st.project || path.basename(root),
      done: cards.filter((x) => x.done).length,
      total: cards.length,
      ready: readyCards(cards).length,
      blockers: st.blockers?.length || 0,
      doing: cards
        .filter((x) => !x.done && x.data.status === 'doing')
        .map((x) => ({ id: x.id, title: x.data.title || '' })),
      testFailed: last?.ok === false,
      days: cfg.deadline ? Math.ceil((new Date(cfg.deadline) - new Date(today())) / 864e5) : null,
      deadlineLabel: cfg.deadlineLabel || cfg.deadline,
    });
  }
} catch {}

const model = data.model?.display_name;
const cw = data.context_window || {};
const fiveH = data.rate_limits?.five_hour?.used_percentage;

// Context: large windows show tokens (cost grows with tokens, not %), small ones show %.
function contextPart(d) {
  const tokens = cw.total_input_tokens;
  const big = (cw.context_window_size || 0) >= 500000 && tokens != null;
  if (!big && cw.used_percentage == null) return null;
  const pct = cw.used_percentage ?? 0;
  const heavy = big ? tokens >= 150000 : pct >= 60;
  const warm = big ? tokens >= 80000 : pct >= 40;
  const label = big ? `ctx ${Math.round(tokens / 1000)}k` : `ctx ${Math.round(pct)}%`;
  return color(heavy ? RED : warm ? YELLOW : GREEN, label + (heavy && d < 4 ? ' → /clear' : ''));
}

function quotaPart(d) {
  if (fiveH == null) return null;
  const code = fiveH >= 80 ? RED : fiveH >= 50 ? YELLOW : GREEN;
  return color(code, `5h ${Math.round(fiveH)}%` + (fiveH >= 80 && d < 4 ? ' → wrap up' : ''));
}

// One card: id + title. Several (parallel run): all ids, or a count when space is tight.
function nowPart(d) {
  const titleMax = [36, 24, 14, 0, 0, 0][d];
  if (!info.doing.length) return dim('▶ idle');
  if (info.doing.length === 1) {
    const [c] = info.doing;
    return color('1;33', `▶ ${c.id}${titleMax ? ` ${short(c.title, titleMax)}` : ''}`);
  }
  return color('1;33', d < 3 ? `▶ ${info.doing.map((c) => c.id).join(' ')}` : `▶ ${info.doing.length} cards`);
}

// d = detail level: 0 shows everything, 5 is the bare minimum.
function render(d) {
  const parts = [];
  const nameMax = [40, 24, 16, 12][d] ?? 0;
  if (nameMax) {
    const br = info.branch && d < 2 ? dim(` ⎇ ${short(info.branch, d ? 16 : 28)}`) : '';
    parts.push(color('1;36', short(info.name, nameMax)) + br);
  }
  if (info.lean) {
    parts.push(nowPart(d));
    let progress = color(GREEN, `✓${info.done}/${info.total}`);
    if (d < 5) progress += ` ${dim('·')} ${info.ready}${d < 3 ? ' ready' : 'r'}`;
    if (info.blockers) progress += ` ${color(RED, `⚠${info.blockers}`)}`;
    if (info.testFailed) progress += ` ${color(RED, d < 3 ? 'tests ✗' : '✗')}`;
    if (info.days != null && d < 5) {
      const code = info.days <= 3 ? RED : info.days <= 7 ? YELLOW : '2';
      const text = d < 2 && info.deadlineLabel ? `⏳${info.days}d → ${info.deadlineLabel}` : `⏳${info.days}d`;
      progress += ` ${color(code, text)}`;
    }
    parts.push(progress);
  }
  const meta = [];
  if (model && d < 3) meta.push(model);
  const ctx = d < 5 ? contextPart(d) : null;
  if (ctx) meta.push(ctx);
  const quota = quotaPart(d);
  if (quota) meta.push(quota);
  if (meta.length) parts.push(meta.join(dim(' · ')));
  return parts.join(dim(' │ '));
}

let out = render(0);
for (let d = 1; d <= 5 && visible(out) > width; d++) out = render(d);
if (visible(out) > width) out = short(out.replace(ANSI, ''), width);

process.stdout.write(out.replace(/[\r\n]+/g, ' '));
