# lean

A Claude Code plugin for a token-lean workflow: **grill → plan → do → compound**. Memory is kept as Zettelkasten notes, and nothing runs an LLM in the background.

Inspired by [grilling / grill-me](https://github.com/mattpocock/skills), [Superpowers](https://github.com/obra/superpowers) and [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).

## Install (local marketplace)

```
/plugin marketplace add D:/Tools/lean-plugin
/plugin install lean@lean-local
```

In each project, run `lean init` once, then fill in `.lean/config.json` (`test`, `testFast`, `parallel`).

## Commands

| Skill | Purpose |
|---|---|
| `/lean:grill <topic>` | Interview in rounds until nothing is assumed, then write `.lean/specs/S-NNN-*.md` |
| `/lean:plan S-NNN` | Break a spec into task cards (`.lean/tasks/T-NNN-*.md`) |
| `/lean:do [T-NNN…] [--parallel]` | Test first for logic, verify, commit, save notes. `--parallel` runs cards in worktrees |
| `/lean:do --phase S-NNN` | Runs a whole spec in parallel waves in one sitting: `lean batch` → workers → merge → repeat, stopping at HUMAN cards |
| `/lean:debug <symptom>` | Root cause first, then a regression test and a gotcha note |
| `/lean:compound` | Turn session learnings into atomic notes |
| `/lean:review [range]` | One report-only Sonnet review per milestone |
| `/lean:secure [range]` | Report-only security review (Sonnet, forked). It starts from `lean audit`, writes `.lean/security/<date>.md`, and turns blocker/major findings into cards once you confirm |

Output style: `lean-focus` is forced on while the plugin is enabled. It's adapted from [i-have-adhd](https://github.com/ayghri/i-have-adhd): answer first, lists capped at 5, no filler, one next action.

Status line (optional, costs no tokens): add this to `~/.claude/settings.json`:
`"statusLine": {"type": "command", "command": "node \"D:/Tools/lean-plugin/plugins/lean/scripts/statusline.mjs\""}`
It shows project, git branch, current card, done/total, ready count, blockers, model, context % and 5-hour quota %.

CLIs on the Bash PATH:
- `lean status|tasks|next|start|reset|done|check-parallel|batch|check-plan|notes|new-id|test|doctor|audit|secured|report|ui|focus|block|reviewed`
  - `lean batch [--spec S-NNN]` prints the next cards to run together (ready, disjoint files, up to `parallel.maxAgents`, the ones unblocking the most work first) and the waves left
  - `lean check-plan S-NNN` shows the waves a plan needs and suggests merges: chains, cards sharing files, more cards than ~1 per 2 acceptance criteria, oversized cards
  - One commit per card: run `lean done` before committing (it counts uncommitted test files), and the sha shown in STATE is looked up from git
  - `lean start T-x` also prints the card's top 3 related notes beyond its Watch list (`lean notes T-x` prints them any time); `lean start T-a T-b ...` marks several cards as in progress (used by `--parallel`); `lean reset T-x` puts an abandoned card back to Ready and records an unmerged worker branch as `branch:`
  - `lean done` refuses unless the card's commits changed a test file. Use `--no-tests "<why>"` when tests truly aren't possible; `HUMAN:` cards are exempt. It also removes merged worker worktrees and their branches.
  - `lean doctor [--fix]` lists leftover worker worktrees (merged, empty, unmerged, dirty, locked) and merged branches; `--fix` removes only merged and empty worktrees and merged branches
  - The focus line is computed from the cards (active spec, progress, now/next). `lean focus "<note>"` pins a temporary note that clears at the next `lean done`.

Recommended user setting for `--parallel`: `"worktree": { "baseRef": "head" }`. Without it, worker worktrees branch from `origin/<default>` and miss unpushed commits.
  - `lean test`: runs the suite and prints only failures plus a summary (saves tokens on every card). A pass is reused while the code (HEAD plus uncommitted changes, ignoring `.lean/`) is unchanged; a passing full run also covers `--fast`. `--force` reruns.
  - `lean report --out docs/reports/<date>.md`: markdown progress report for clients
  - `lean ui`: read-only local dashboard at http://127.0.0.1:4777 with four views: board, notes search, notes graph, specs with acceptance coverage and the report. It updates live, and `lean ui --stop` stops it (it also stops itself after an hour idle).
- `zk find|show|new|link|supersede|lint|ls|tags`
  - `zk find <words>` returns the top 5 ranked notes, each with its `Apply:` line, so `zk show` is rarely needed. Ranking uses whole words and word starts (not substrings), splits camelCase identifiers, weights title over tags over body, and favors rare words
  - `zk new` refuses when a similar note already exists and prints its file to edit; `--force` creates it anyway
  - `zk supersede <old> <new>` marks a note replaced; `find` and `ls` hide it unless `--all`
  - `zk lint` flags dangling links and project notes that cite files no longer in the repo

## Development

`npm test` (Node 22+, no dependencies) runs the CLI tests in throwaway git repos. After editing, run `claude plugin marketplace update lean-local` and update the plugin so the cache picks up the change.

## Layout

```
.lean/
  state.json, STATE.md    generated by `lean`; injected at session start (~300 tokens)
  config.json             test commands, tddStrict globs, parallel settings
  specs/S-NNN-*.md
  tasks/T-NNN-*.md        open cards → tasks/done/
  zk/<id>-<slug>.md       project notes      (global notes: ~/.lean/zk)
```

## Token rules

- No background LLM calls. The only hook is SessionStart, which prints STATE.
- All skills use `disable-model-invocation`, so their descriptions never load until you type the command.
- Notes are searched, never loaded whole.
- Subagents are used only for `--parallel` workers (Sonnet) and review (Sonnet, forked).
- One card per session, then `/clear`.
