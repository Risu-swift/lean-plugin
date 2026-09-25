# Changelog

## 0.10.0 — 2026-09-25

- Custom id prefixes: set `"ids": { "task": "TASK", "spec": "FEAT" }` in `.lean/config.json` and `lean new-id` prints `TASK-001` / `FEAT-001`. Defaults stay `T` and `S`; `lean init` writes them to the config.
- Cards and specs are found by the configured prefix plus the defaults, so existing `T-`/`S-` files keep working after a rename, and numbering carries on from them.
- The dashboard links ids with the configured prefixes; `/lean:grill` and `/lean:plan` use whatever `lean new-id` prints.

## 0.9.0 — 2026-09-19

- Optional research phase between grill and plan, for facts neither the user nor the code can give (library abilities, hardware and drivers, service limits, speed).
- `/lean:grill` records such facts as `R1…` questions under `## Research`, marks the decisions that wait on them `(after R<n>)`, and writes the spec as `status: needs-research`.
- `/lean:research S-NNN` runs one `lean:researcher` agent (Sonnet) per open question, in parallel. Each finds a sourced answer from docs, the web or a throwaway spike in the temp dir, and replies in 150 words or less. Findings go into the spec and become `fact` notes; low-confidence answers go to the user; the waiting decisions are then settled in one grill-style round.
- `lean research [S-NNN] [--close]` lists questions as OPEN or done; `--close` marks the spec agreed once all are answered.
- `/lean:plan` refuses a spec with open research; `lean check-plan` flags it; STATE and the focus line point to `/lean:research`.

## 0.8.1 — 2026-09-19

- Published on GitHub under the MIT license. Install with `/plugin marketplace add Risu-swift/lean-plugin`, then `/plugin install lean@lean`.
- The marketplace is renamed from `lean-local` to `lean`. Existing installs need to remove the old marketplace and add it again.
- `bin/lean` and `bin/zk` are now executable, so the CLIs work on macOS and Linux.
- `.gitattributes` keeps LF line endings (CRLF for `.cmd`).
- Raw control characters in `lean.mjs` and `ui.html` are replaced with `\u` escapes. Behavior is unchanged; the files are now diffable text.

## 0.8.0 — 2026-09-15

- `/lean:plan` slices specs by user-visible behavior with a card budget (~1 per 2 acceptance criteria), a contracts card for shared files, and merges for chains and file-sharing cards. It runs `lean check-plan` before finishing.
- `lean check-plan S-NNN`: waves at `maxAgents`, plus budget, conflict, re-touch, chain and size suggestions.
- `lean batch [--spec]`: the next disjoint ready cards, most-unblocking first. Reports HUMAN cards and phase completion, and cleans merged worktrees.
- `/lean:do --phase S-NNN`: batch → workers → merge → repeat in one sitting.
- `lean done` runs before the card commit (it counts uncommitted test files). The sha is looked up from git, so there is no separate mark-done commit.

## 0.7.0 — 2026-09-15

- `zk find`: whole-word and prefix matching, camelCase splitting, title > tags > body, IDF weighting, top 5 with weak hits dropped. Each hit prints its `Apply:` line.
- `zk new` refuses a note similar to an existing one and prints the file to edit; `--force` overrides.
- `lean start T-x` prints the card's top 3 related notes beyond its Watch list; `lean notes T-x` does the same read-only for parallel workers.
- Skills drop the find-before-new and manual card search steps.

## 0.6.0 — 2026-09-15

- `tests/`: node:test suite for `lean` and `zk`.
- `lean done` removes merged worker worktrees; `lean reset` records unmerged worker branches on the card; `lean doctor [--fix]` reports leftovers.
- `lean test` reuses a passing run while HEAD plus uncommitted code is unchanged.
- `zk supersede` hides replaced notes; `zk lint` flags dangling links and notes citing files no longer in the repo.

## 0.5.0 — 2026-09-15

- Initial import.
