# lean

A Claude Code plugin for a token-lean workflow: **grill → (research) → plan → do → compound**. Research runs only when grilling finds facts nobody can answer yet. Memory is kept as Zettelkasten notes, and nothing runs an LLM in the background.

Inspired by [grilling / grill-me](https://github.com/mattpocock/skills), [Superpowers](https://github.com/obra/superpowers) and [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).

## Install

Requirements: [Claude Code](https://claude.com/claude-code), Node 22+ and git.

1. In Claude Code, add the marketplace and install the plugin:

   ```
   /plugin marketplace add Risu-swift/lean-plugin
   /plugin install lean@lean
   ```

   Or from a shell (no leading slash):

   ```
   claude plugin marketplace add Risu-swift/lean-plugin
   claude plugin install lean@lean
   ```

2. Restart Claude Code so the skills, hook and output style load.
3. In each project, run `lean init` once, then fill in `.lean/config.json` (`test`, `testFast`, `parallel`).
4. Check it works: `/lean:grill <topic>` should start an interview.

To update later: `/plugin marketplace update lean`, then reinstall the plugin.

### From a local clone

For working on the plugin itself:

```
git clone https://github.com/Risu-swift/lean-plugin.git
```

Then in Claude Code:

```
/plugin marketplace add ./lean-plugin
/plugin install lean@lean
```

## Commands

| Skill | Purpose |
|---|---|
| `/lean:grill <topic>` | Interview in rounds until nothing is assumed, then write `.lean/specs/S-NNN-*.md` |
| `/lean:research S-NNN` | Only when grill left `R1…` questions (library abilities, hardware, limits, speed): one Sonnet researcher per question finds a sourced answer from docs, the web or a throwaway spike, then you settle the decisions that waited. `/lean:plan` refuses until it's done |
| `/lean:plan S-NNN` | Break a spec into task cards (`.lean/tasks/T-NNN-*.md`) |
| `/lean:do [T-NNN…] [--parallel]` | Test first for logic, verify, commit, save notes. `--parallel` runs cards in worktrees |
| `/lean:do --phase S-NNN` | Runs a whole spec in parallel waves in one sitting: `lean batch` → workers → merge → repeat, stopping at HUMAN cards |
| `/lean:debug <symptom>` | Root cause first, then a regression test and a gotcha note |
| `/lean:compound` | Turn session learnings into atomic notes |
| `/lean:review [range]` | One report-only Sonnet review per milestone |
| `/lean:secure [range]` | Report-only security review (Sonnet, forked). It starts from `lean audit`, writes `.lean/security/<date>.md`, and turns blocker/major findings into cards once you confirm |

Output style: `lean-focus` is forced on while the plugin is enabled. It's adapted from [i-have-adhd](https://github.com/ayghri/i-have-adhd): answer first, lists capped at 5, no filler, one next action.

Status line (optional, costs no tokens): add this to `~/.claude/settings.json`:
`"statusLine": {"type": "command", "command": "node \"<path-to-clone>/plugins/lean/scripts/statusline.mjs\""}`
Use a clone path, not the plugin cache: the cache folder name changes with each version.
It shows project, git branch, current card, done/total, ready count, blockers, model, context % and 5-hour quota %.

CLIs on the Bash PATH:
- `lean status|tasks|next|start|reset|done|check-parallel|batch|check-plan|research|notes|new-id|test|doctor|audit|secured|report|ui|focus|block|reviewed`
  - `lean research [S-NNN] [--close]` lists a spec's research questions as OPEN or done (no id: every spec that needs research); `--close` marks the spec agreed, and refuses while a question is open. `lean check-plan` flags open questions too
  - `lean batch [--spec S-NNN]` prints the next cards to run together (ready, disjoint files, up to `parallel.maxAgents`, the ones unblocking the most work first) and the waves left
  - `lean check-plan S-NNN` shows the waves a plan needs and suggests merges: chains, cards sharing files, more cards than ~1 per 2 acceptance criteria, oversized cards
  - One commit per card: run `lean done` before committing (it counts uncommitted test files), and the sha shown in STATE is looked up from git
  - `lean start T-x` also prints the card's top 3 related notes beyond its Watch list (`lean notes T-x` prints them any time); `lean start T-a T-b ...` marks several cards as in progress (used by `--parallel`); `lean reset T-x` puts an abandoned card back to Ready and records an unmerged worker branch as `branch:`
  - `lean done` refuses unless the card's commits changed a test file. Use `--no-tests "<why>"` when tests truly aren't possible; `HUMAN:` cards are exempt. It also removes merged worker worktrees and their branches.
  - `lean doctor [--fix]` lists leftover worker worktrees (merged, empty, unmerged, dirty, locked) and merged branches; `--fix` removes only merged and empty worktrees and merged branches
  - The focus line is computed from the cards (active spec, progress, now/next). `lean focus "<note>"` pins a temporary note that clears at the next `lean done`.
  - `lean test`: runs the suite and prints only failures plus a summary (saves tokens on every card). A pass is reused while the code (HEAD plus uncommitted changes, ignoring `.lean/`) is unchanged; a passing full run also covers `--fast`. `--force` reruns.
  - `lean report --out docs/reports/<date>.md`: markdown progress report for clients
  - `lean ui`: read-only local dashboard at http://127.0.0.1:4777 with four views: board, notes search, notes graph, specs with acceptance coverage and the report. It updates live, and `lean ui --stop` stops it (it also stops itself after an hour idle).
- `zk find|show|new|link|supersede|lint|ls|tags`
  - `zk find <words>` returns the top 5 ranked notes, each with its `Apply:` line, so `zk show` is rarely needed. Ranking uses whole words and word starts (not substrings), splits camelCase identifiers, weights title over tags over body, and favors rare words
  - `zk new` refuses when a similar note already exists and prints its file to edit; `--force` creates it anyway
  - `zk supersede <old> <new>` marks a note replaced; `find` and `ls` hide it unless `--all`
  - `zk lint` flags dangling links and project notes that cite files no longer in the repo

Recommended user setting for `--parallel`: `"worktree": { "baseRef": "head" }`. Without it, worker worktrees branch from `origin/<default>` and miss unpushed commits.

## Development

`npm test` (Node 22+, no dependencies) runs the CLI tests in throwaway git repos. After editing, run `claude plugin marketplace update lean` and update the plugin so the cache picks up the change. Record changes in [CHANGELOG.md](CHANGELOG.md) and bump the version in both `plugin.json` and `marketplace.json`.

## Git sync per card

To pull when a card starts and push when it ends, set `"sync": true` in `.lean/config.json`. `lean start` then runs `git pull --rebase=merges --autostash` first and stops if the pull fails. After each card commit, `/lean:do` runs `lean sync` (pull, then push); parallel and phase runs push once per wave. A branch with no upstream is skipped with a hint. `lean sync` also works by hand.

## Id prefixes

Task and spec ids default to `T-NNN` and `S-NNN`. To use your own, set `ids` in `.lean/config.json`:

```json
"ids": { "task": "TASK", "spec": "FEAT" }
```

`lean new-id` then prints `TASK-001` and `FEAT-001`. Prefixes are uppercased and must start with a letter (letters, digits, `_`); anything else falls back to the default. Cards and specs with the old `T-`/`S-` prefix are still read, and numbering carries on from them.

## Issue tracker (Linear)

lean keeps its own `T-`/`S-` numbering. To link cards and specs to issues in a tracker such as Linear, add `tracker` to `.lean/config.json`:

```json
"tracker": { "field": "linear", "url": "https://linear.app/<workspace>/issue/{id}", "team": "MED" }
```

- Each card and spec can then carry the issue id in that frontmatter field, e.g. `linear: MED-23`.
- `lean tasks`, `lean next`, STATE, `lean report` and the dashboard show `T-014 · MED-23`; the report and dashboard link to `url`.
- Commit subjects become `T-014: <title> (MED-23)`. `lean start`, `lean notes` and `lean done` print the exact subject. The id goes last so lean still finds the card's commit, and Linear links the commit by the id in its message.
- When a Linear MCP tool is available, `/lean:grill` creates the spec's issue and `/lean:plan` creates one sub-issue per card, with `depends:` as "blocked by", then writes the ids back. `team` picks the Linear team (otherwise you are asked once). Without the tool the fields stay empty, with a warning.
- Without `tracker`, lean behaves exactly as before.

## Layout

```
.lean/
  state.json, STATE.md    generated by `lean`; injected at session start (~300 tokens)
  config.json             test commands, tddStrict globs, parallel settings, id prefixes
  specs/S-NNN-*.md
  tasks/T-NNN-*.md        open cards → tasks/done/
  zk/<id>-<slug>.md       project notes      (global notes: ~/.lean/zk)
```

## Token rules

- No background LLM calls. The only hook is SessionStart, which prints STATE.
- All skills use `disable-model-invocation`, so their descriptions never load until you type the command.
- Notes are searched, never loaded whole.
- Subagents are used only for `--parallel` workers (Sonnet), research questions (Sonnet, one per question, 150-word replies) and review (Sonnet, forked).
- One card per session, then `/clear`.

## License

[MIT](LICENSE)
