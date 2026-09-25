#!/usr/bin/env node
// Read-only local dashboard for one lean project. Started detached by `lean ui`; binds 127.0.0.1 only.
// Exits after an hour without requests (an open tab polls, so it stays up while you look at it).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  globalHome,
  focusLine,
  loadCards,
  loadNotes,
  loadSpecs,
  readyCards,
  readJson,
  writeJson,
  list,
  buildReport,
  daysUntil,
  commitFor,
  idPrefixes,
  trackerOf,
  refUrl,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || process.cwd());
const firstPort = parseInt(process.argv[3] || '4777', 10);
const IDLE_MS = 60 * 60 * 1000;
const registry = path.join(globalHome(), 'ui.json');
const key = root.toLowerCase();
let lastRequest = Date.now();

const rel = (f) => path.relative(root, f).replace(/\\/g, '/');

function snapshot() {
  const st = readJson(path.join(root, '.lean', 'state.json'), {});
  const cfg = readJson(path.join(root, '.lean', 'config.json'), {});
  const cards = loadCards(root);
  const tracker = trackerOf(root);
  const ready = new Set(readyCards(cards).map((c) => c.id));
  return {
    project: st.project || path.basename(root),
    root,
    focus: focusLine(root, cards) + (st.note ? ` · Note: ${st.note}` : ''),
    blockers: st.blockers || [],
    recent: st.recent || [],
    reviewed: st.reviewed || null,
    deadlineLabel: cfg.deadlineLabel || cfg.deadline || null,
    days: cfg.deadline ? daysUntil(cfg.deadline) : null,
    lastTest: readJson(path.join(root, '.lean', 'last-test.json'), null),
    ids: idPrefixes(root).accept,
    cards: cards.map((c) => ({
      id: c.id,
      ref: c.ref,
      refUrl: refUrl(tracker, c.ref),
      title: c.data.title || '',
      status: c.done ? 'done' : c.data.status === 'doing' ? 'doing' : ready.has(c.id) ? 'ready' : 'wait',
      spec: c.data.spec ? String(c.data.spec).toUpperCase() : null,
      depends: list(c.data.depends).map((d) => d.toUpperCase()),
      files: list(c.data.files),
      tdd: c.data.tdd || null,
      branch: c.data.branch || null,
      done: c.data.done || null,
      commit: c.data.commit || (c.done ? commitFor(root, c.id) : null),
      file: rel(c.file),
      body: c.body,
    })),
    specs: loadSpecs(root).map((s) => ({
      id: s.id,
      ref: s.ref,
      refUrl: refUrl(tracker, s.ref),
      title: s.data.title || '',
      status: s.data.status || '',
      file: rel(s.file),
      body: s.body,
    })),
    notes: loadNotes(root).map((n) => ({
      scope: n.scope,
      id: n.id,
      type: n.data.type || '',
      title: n.data.title || '',
      tags: list(n.data.tags),
      links: list(n.data.links),
      source: n.data.source || '',
      created: n.data.created || '',
      body: n.body,
    })),
  };
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  lastRequest = Date.now();
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, 'text/plain', 'forbidden');
  if (req.method !== 'GET') return send(res, 405, 'text/plain', 'read-only');
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(here, 'ui.html')));
    if (url.pathname === '/api/data') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(snapshot()));
    if (url.pathname === '/api/report') {
      return send(res, 200, 'text/markdown; charset=utf-8', buildReport(root, url.searchParams.get('since') || undefined));
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'text/plain', String(e?.stack || e));
  }
});

function register(port) {
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  const all = readJson(registry, {});
  all[key] = { pid: process.pid, port, root };
  writeJson(registry, all);
}

function unregister() {
  const all = readJson(registry, {});
  if (all[key]?.pid !== process.pid) return;
  delete all[key];
  writeJson(registry, all);
}

let port = firstPort;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < firstPort + 20) server.listen(++port, '127.0.0.1');
  else {
    console.error(e);
    process.exit(1);
  }
});
server.on('listening', () => {
  register(port);
  console.log(`lean ui: http://127.0.0.1:${port}`);
});
server.listen(port, '127.0.0.1');

setInterval(() => {
  if (Date.now() - lastRequest < IDLE_MS) return;
  unregister();
  process.exit(0);
}, 60 * 1000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    unregister();
    process.exit(0);
  });
}
