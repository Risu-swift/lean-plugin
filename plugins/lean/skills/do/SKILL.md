---
name: do
description: Execute task cards: test first where required, verify, commit, capture learnings. Use for /lean:do [T-NNN ...] [--parallel].
argument-hint: [T-NNN ...] [--parallel]
disable-model-invocation: true
---

# Do

Args: $ARGUMENTS

- No ids: run `lean next` and take the first ready card.
- `--parallel` with 2 or more ids: follow the Parallel section.
- Otherwise: one card at a time, in this session.

## Sequential (one card)

1. Run `lean start T-NNN`. If it prints a `⚠ SECURITY` warning (a deploy card with no up-to-date security review), stop and ask with AskUserQuestion whether to run `/lean:secure` first. Read the card, and read `test` / `testFast` from `.lean/config.json`.
2. If the card has `branch:`, earlier unfinished work exists. Run `git diff --stat HEAD...<branch>` and inspect the diff. Bring over what is sound (`git checkout <branch> -- <file>`) and use the rest as reference. It's untested, so don't trust it.
3. Run `zk find <area words from the card>`. Use `zk show` only on notes that matter.
4. Read only the card's files and what they directly need. Prefer Grep and LSP over reading big files whole. Don't re-read a file you just edited.
5. Build:
   - `tdd: strict`: for each behavior, write the test and run the narrowest test command. Confirm it fails for the expected reason. Write the minimum code, re-run until it passes, then tidy up. Never write production code without a failing test first.
   - `tdd: after`: implement, then add tests covering the "Done when" items.
   - Stay inside `files:`. If the card turns out wrong or bigger than planned, stop and ask with AskUserQuestion. Don't quietly expand scope.
   - After 2 failed fix attempts on the same problem, switch to the `/lean:debug` method: reproduce, then test one hypothesis at a time.
6. Verify before claiming done. Run `lean test`, which runs the full suite from config and prints only failures plus a summary. Use `lean test --fast` for quick loops, or `lean test --cmd "<narrow command>"` to trim any other test command. If no code changed since a passing run, it reports the cached pass instantly; use `--force` only when something outside git changed (env, emulators). Check each "Done when" item against the real output. Never say "should pass".
7. Commit only the card's files plus `.lean/` changes: `git commit -m "T-NNN: <title>"`.
8. Compound, 0–3 notes. Record only learnings that would change what someone does next time: surprising behavior, a constraint, a pattern worth repeating.
   - Run `zk find` first. If a similar note exists, Edit that file instead of creating a duplicate.
   - Otherwise run `zk new --type gotcha|pattern|fact|decision --title "<claim>" --tags a,b --source "T-NNN @ <sha>" --body "Why: ...\nApply: ..."`.
   - Add `--global` for tool or framework lessons that aren't specific to this project.
9. Run `lean done T-NNN --commit <sha> --notes <ids>`. It refuses if none of the card's commits changed a test file. In that case, add the missing tests (step 5) and commit them. Only when tests truly aren't possible (e.g. pure config or docs), pass `--no-tests "<reason>"`. `HUMAN:` cards are exempt.
10. Report in 5 lines or less: what changed, the test result, the notes, and the next ready card. Suggest `/clear` before the next card.

## Parallel (--parallel T-a T-b ...)

1. `lean check-parallel T-a T-b ...` must print OK. That means dependencies are done, the cards don't depend on each other, and they touch different files. If it doesn't, show the conflict and ask how to proceed. Run at most `parallel.maxAgents` cards (from config, default 3).
2. The working tree must be clean, since worktrees branch from the default branch. Commit `.lean/` changes first. Then run `lean start T-a T-b ...` so the board, statusline and STATE show every card as in progress. Workers never edit `.lean/`, so these uncommitted status changes can't conflict with their merges.
3. Spawn one `lean:worker` agent per card, **all in a single message**, so they run at the same time. Give each worker:
   - the card path
   - its slot number N (1, 2, 3...)
   - `parallel.setup` and `parallel.portEnv` from the config
   - the `test` command
4. Workers don't touch STATE, card status or zk. Each one returns its branch, commit sha, test result and proposed notes.
5. When all workers have returned, merge them one at a time with `git merge --no-ff <branch>`, and run `lean test --fast` after each merge. After the last merge, run the full `lean test` once. If there's a conflict or tests fail, fix it if it's trivial; otherwise stop and ask. If a worker failed, or you decide not to merge its branch, run `lean reset T-x`: the card goes back to Ready with its unmerged branch recorded as `branch:`.
6. For each card: write its proposed notes (step 8 above), then run `lean done`. It removes merged worker worktrees and their branches; if it reports one it couldn't remove, run `lean doctor`.
7. Report one line per card.
