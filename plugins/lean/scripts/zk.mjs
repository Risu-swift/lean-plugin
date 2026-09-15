#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { findRoot, git, globalHome, parseArgs, list, loadNotes, serialize, today } from './lib.mjs';

const HELP = `zk — Zettelkasten notes (project .lean/zk + global ~/.lean/zk)

  zk find <words> [--type t] [--tag t] [--deep] [--all] [--project|--global] [--limit n]
  zk show <id> [...]                 print notes (id prefix ok)
  zk new --type decision|gotcha|pattern|fact --title "<claim>"
         [--tags a,b] [--links id,id] [--source T-003] [--body "Why: ...\\nApply: ..."] [--global]
  zk link <id> <id>                  two-way link
  zk supersede <old-id> <new-id>     mark a note replaced; find and ls hide it (--all shows it)
  zk lint                            dangling links, project notes citing files that no longer exist
  zk ls [--all] [--project|--global] [--limit n]
  zk tags                            tags in use, by count`;

const TYPES = ['decision', 'gotcha', 'pattern', 'fact'];
const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt } = parseArgs(rest, ['global', 'project', 'deep', 'all']);
const die = (m) => {
  console.error(`zk: ${m}`);
  process.exit(1);
};

const root = findRoot();
const vaults = [
  ...(root ? [{ scope: 'P', dir: path.join(root, '.lean', 'zk') }] : []),
  { scope: 'G', dir: path.join(globalHome(), 'zk') },
];

function loadAll() {
  let out = loadNotes(root);
  if (opt.global) out = out.filter((n) => n.scope === 'G');
  if (opt.project) out = out.filter((n) => n.scope === 'P');
  return out;
}

const current = (notes) => (opt.all ? notes : notes.filter((n) => !n.data.superseded_by));

const fmt = (n) => {
  const tags = list(n.data.tags);
  return `${n.scope} ${n.id} ${String(n.data.type || '?').padEnd(8)} ${n.data.title || ''}${
    tags.length ? '  ' + tags.map((t) => '#' + t).join(' ') : ''
  }${n.data.superseded_by ? `  (superseded by ${n.data.superseded_by})` : ''}`;
};

function stamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function byId(notes, id) {
  const exact = notes.find((n) => n.id === id);
  if (exact) return exact;
  const hits = notes.filter((n) => n.id.startsWith(id));
  if (hits.length !== 1) die(hits.length ? `ambiguous id ${id}` : `no note ${id}`);
  return hits[0];
}

const save = (n) => fs.writeFileSync(n.file, serialize(n.data, n.body));

// Returns true when the link was new.
function link(n, other) {
  const links = list(n.data.links);
  if (links.includes(other)) return false;
  n.data.links = [...links, other];
  return true;
}

const rel = (f) => {
  const r = path.relative(process.cwd(), f);
  return r && !r.startsWith('..') ? r : f;
};
const limit = () => parseInt(opt.limit || '20', 10);

switch (cmd) {
  case 'new': {
    if (!TYPES.includes(opt.type)) die(`--type must be one of ${TYPES.join('|')}`);
    if (!opt.title) die('--title required (state the claim as a sentence)');
    const v = vaults.find((x) => x.scope === (opt.global ? 'G' : 'P'));
    if (!v) die('no project .lean/ here — run `lean init` or pass --global');
    fs.mkdirSync(v.dir, { recursive: true });
    opt.global = opt.project = false;
    const all = loadAll();
    const base = stamp();
    let id = base;
    for (let i = 2; all.some((n) => n.id === id); i++) id = `${base}-${i}`;
    const slug = opt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    const links = list(opt.links);
    const data = {
      id,
      type: opt.type,
      title: opt.title.replace(/\r?\n/g, ' '),
      tags: list(opt.tags).map((t) => t.toLowerCase()),
      links,
      source: opt.source || undefined,
      created: today(),
    };
    const body = String(opt.body || '').replace(/\\n/g, '\n').trim() + '\n';
    const file = path.join(v.dir, `${id}-${slug}.md`);
    fs.writeFileSync(file, serialize(data, body));
    for (const l of links) {
      const target = all.find((n) => n.id === l) || all.find((n) => n.id.startsWith(l));
      if (target && link(target, id)) save(target);
    }
    console.log(`created ${v.scope} ${id} ${rel(file)}`);
    break;
  }

  case 'find':
  case 'f': {
    const terms = pos.map((t) => t.toLowerCase());
    let notes = current(loadAll());
    if (opt.type) notes = notes.filter((n) => n.data.type === opt.type);
    if (opt.tag) notes = notes.filter((n) => list(n.data.tags).includes(opt.tag.toLowerCase()));
    const scored = notes
      .map((n) => {
        const hay = [n.data.title, list(n.data.tags).join(' '), n.data.type, n.data.source, opt.deep ? n.body : '']
          .join(' ')
          .toLowerCase();
        return { n, score: terms.length ? terms.filter((t) => hay.includes(t)).length : 1 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.n.id.localeCompare(a.n.id));
    if (!scored.length) {
      console.log(`no matches${opt.deep ? '' : ' (try fewer words or --deep)'}`);
      break;
    }
    scored.slice(0, limit()).forEach((x) => console.log(fmt(x.n)));
    if (scored.length > limit()) console.log(`… ${scored.length - limit()} more (--limit)`);
    break;
  }

  case 'show': {
    if (!pos.length) die('usage: zk show <id> [...]');
    const all = loadAll();
    for (const id of pos) {
      const n = byId(all, id);
      console.log(`== ${n.scope} ${rel(n.file)}\n${fs.readFileSync(n.file, 'utf8').trim()}\n`);
    }
    break;
  }

  case 'link': {
    if (pos.length !== 2) die('usage: zk link <id> <id>');
    const all = loadAll();
    const a = byId(all, pos[0]);
    const b = byId(all, pos[1]);
    if (link(a, b.id)) save(a);
    if (link(b, a.id)) save(b);
    console.log(`linked ${a.id} <-> ${b.id}`);
    break;
  }

  case 'supersede': {
    if (pos.length !== 2) die('usage: zk supersede <old-id> <new-id>');
    const all = loadAll();
    const old = byId(all, pos[0]);
    const next = byId(all, pos[1]);
    if (old.id === next.id) die('a note cannot supersede itself');
    old.data.superseded_by = next.id;
    next.data.supersedes = [...new Set([...list(next.data.supersedes), old.id])];
    link(old, next.id);
    link(next, old.id);
    save(old);
    save(next);
    console.log(`${old.id} superseded by ${next.id} (hidden from find and ls; --all shows it)`);
    break;
  }

  case 'lint': {
    const all = loadNotes(root);
    const ids = new Set(all.map((n) => n.id));
    const tracked = root ? (git(`-C "${root}" ls-files`) || '').split(/\r?\n/).filter(Boolean).map((f) => f.toLowerCase()) : [];
    // A cited path counts as present if it exists from the root or is the tail of a tracked path (src/x.ts → functions/src/x.ts).
    const present = (p) => {
      const q = p.replace(/^\.\//, '').toLowerCase();
      return fs.existsSync(path.join(root, q)) || tracked.some((f) => f === q || f.endsWith(`/${q}`));
    };
    const PATH = /[\w@.-]+(?:\/[\w@.-]+)+\.[a-z][a-z0-9]{0,7}\b/gi;
    const problems = [];
    for (const n of all) {
      for (const key of ['links', 'supersedes', 'superseded_by']) {
        for (const id of list(n.data[key])) if (!ids.has(id)) problems.push(`${n.scope} ${n.id} ${key} → ${id}: no such note`);
      }
      if (n.scope !== 'P' || n.data.superseded_by) continue;
      const text = `${n.data.title || ''}\n${n.body}`.replace(/\w+:\/\/\S+/g, '');
      const missing = [...new Set(text.match(PATH) || [])].filter((p) => !present(p));
      if (missing.length) problems.push(`P ${n.id} cites missing ${missing.join(', ')} · ${n.data.title}`);
    }
    console.log(
      problems.length
        ? `${problems.join('\n')}\n${problems.length} issue(s). Fix the note, or write a replacement and run zk supersede <old> <new>.`
        : `ok, ${all.length} notes checked`
    );
    break;
  }

  case 'ls':
  case 'index': {
    const notes = current(loadAll());
    notes.slice(0, limit()).forEach((n) => console.log(fmt(n)));
    if (!notes.length) console.log('no notes yet');
    else if (notes.length > limit()) console.log(`… ${notes.length - limit()} more (--limit)`);
    break;
  }

  case 'tags': {
    const counts = {};
    for (const n of loadAll()) for (const t of list(n.data.tags)) counts[t] = (counts[t] || 0) + 1;
    const out = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}(${c})`);
    console.log(out.join(' ') || 'no tags yet');
    break;
  }

  default:
    console.log(HELP);
}
