---
name: do
description: Execute task cards: test first where required, verify, commit, capture learnings. Use for /lean:do [T-NNN ...] [--parallel] or /lean:do --phase S-NNN.
argument-hint: [T-NNN ...] [--parallel] | --phase S-NNN
disable-model-invocation: true
---

# Do

Args: $ARGUMENTS

- `--phase S-NNN`: follow the Phase section.
- `--parallel` with 2 or more ids: follow the Parallel section.
- No ids: run `lean next` and take the first ready card.
- Otherwise: one card at a time, in this session.

## Sequential (one card)

1. Run `lean start T-NNN`. If it prints a `⚠ SECURITY` warning (a deploy card with no up-to-date security review), stop and ask with AskUserQuestion whether to run `/lean:secure` first. Read the card, and read `test` / `testFast` from `.lean/config.json`.
2. If the card has `branch:`, earlier unfinished work exists. Run `git diff --stat HEAD...<branch>` and inspect the diff. Bring over what is sound (`git checkout <branch> -- <file>`) and use the rest as reference. It's untested, so don't trust it.
3. `lean start` printed the notes most related to the card, each with its Apply line; the card's Watch section has the rest. Run `zk find <words>` only for a specific question those don't answer.
4. Read only the card's files and what they directly need. Prefer Grep and LSP over reading big files whole. Don't re-read a file you just edited.
5. Build:
   - `tdd: strict`: for each behavior, write the test and run the narrowest test command. Confirm it fails for the expected reason. Write the minimum code, re-run until it passes, then tidy up. Never write production code without a failing test first.
   - `tdd: after`: implement, then add tests covering the "Done when" items.
   - Stay inside `files:`. If the card turns out wrong or bigger than planned, stop and ask with AskUserQuestion. Don't quietly expand scope.
   - After 2 failed fix attempts on the same problem, switch to the `/lean:debug` method: reproduce, then test one hypothesis at a time.
6. Verify before claiming done. Run `lean test`, which runs the full suite from config and prints only failures plus a summary. Use `lean test --fast` for quick loops, or `lean test --cmd "<narrow command>"` to trim any other test command. If no code changed since a passing run, it reports the cached pass instantly; use `--force` only when something outside git changed (env, emulators). Check each "Done when" item against the real output. Never say "should pass".
7. Compound, 0–3 notes. Record only learnings that would change what someone does next time: surprising behavior, a constraint, a pattern worth repeating.
   - Run `zk new --type gotcha|pattern|fact|decision --title "<claim>" --tags a,b --source "T-NNN" --body "Why: ...\nApply: ..."`.
   - If it prints `similar note exists`, Edit the file it names instead. If your note reverses that one, rerun with `--force`, then `zk supersede <old> <new>`.
   - Add `--global` for tool or framework lessons that aren't specific to this project.
8. Run `lean done T-NNN --notes <ids>` before committing. It refuses unless the card's commits or your uncommitted changes include a test file; then add the missing tests (step 5). Only when tests truly aren't possible (e.g. pure config or docs), pass `--no-tests "<reason>"`. `HUMAN:` cards are exempt.
9. Commit the card's files and `.lean/` together: `git add <files> .lean && git commit -m "T-NNN: <title>"`. One commit per card; no separate "mark done" commit.
10. Report in 5 lines or less: what changed, the test result, the notes, and the next ready card. Suggest `/clear` before the next card.

## Merging a worker's branch (Parallel and Phase)

Workers never touch `.lean/`, so the uncommitted card statuses from `lean start` can't conflict. For each returned card, one at a time:

1. `git merge --no-ff --no-commit <branch>`. On a conflict you can't fix trivially: `git merge --abort`, then `lean reset T-x` (it records the branch on the card) and move on.
2. `lean test --fast`. If it fails and the fix isn't trivial: `git merge --abort`, `lean reset T-x`, move on.
3. Write the worker's proposed notes (Sequential step 7), then `lean done T-x --notes <ids>`.
4. `git commit -m "T-x: <title>"`. The merge commit carries both the code and its `.lean/` record.

After the last merge, run the full `lean test` once and fix any failure before doing anything else.

## Parallel (--parallel T-a T-b ...)

1. `lean check-parallel T-a T-b ...` must print OK. That means dependencies are done, the cards don't depend on each other, and they touch different files. If it doesn't, show the conflict and ask how to proceed. Run at most `parallel.maxAgents` cards (from config, default 3).
2. The working tree must be clean apart from `.lean/`, since worktrees branch from HEAD. Then run `lean start T-a T-b ...` so the board, statusline and STATE show every card as in progress.
3. Spawn one `lean:worker` agent per card, **all in a single message**, so they run at the same time. Give each worker:
   - the card path
   - its slot number N (1, 2, 3...)
   - `parallel.setup` and `parallel.portEnv` from the config
   - the `test` command
4. Each worker returns its branch, commit sha, test result and proposed notes.
5. Merge each branch (Merging section).
6. Report one line per card.

## Phase (--phase S-NNN)

Run a whole spec in waves in one sitting. This session only coordinates: every card runs in a worker, even a lone card, so this context stays small.

1. Run `lean check-plan S-NNN`. If it has suggestions for cards that haven't started, show them and ask with AskUserQuestion whether to merge those cards first (as in `/lean:plan` step 4).
2. Repeat:
   1. `lean batch --spec S-NNN` (it also removes merged worker worktrees).
      - `phase done` → go to step 3.
      - `human: T-x …` → stop and give the user that card's steps.
      - `none ready …` → stop and report what blocks.
   2. `lean start <batch ids>`. On a `⚠ SECURITY` warning, stop and ask whether to run `/lean:secure` first.
   3. Spawn one `lean:worker` per batch card, all in a single message (inputs as in Parallel step 3).
   4. Merge each branch (Merging section), including the full `lean test` at the end.
   5. Print one line: `wave N ✓ T-a T-b · reset: T-c · waves left: M`.

   Stop early and report if the full test still fails after one fix attempt, or if a wave ends with every card reset.
3. Report one line per wave, any reset cards and why, and suggest `/lean:review`.
