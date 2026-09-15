---
name: review
description: One-pass, report-only code review of a milestone's changes against its specs. Use for /lean:review [git-range].
argument-hint: [git range, default: since last review]
disable-model-invocation: true
context: fork
model: sonnet
background: false
---

# Review (report only)

Range: $ARGUMENTS

You are reviewing. Do not edit any files.

1. **Range.** Use the argument if given. Otherwise run `lean status` and review `<Last review sha>..HEAD`, or the last 30 commits if no review is recorded. Start with `git diff --stat <range>`.
2. **Context.** Find the T-ids in the commit messages, then their cards in `.lean/tasks/done/` and their specs in `.lean/specs/`. Read only the Decisions and Acceptance sections. Run `zk find` for gotchas in the areas touched.
3. **Read the diff by area** (`git diff <range> -- <path>`), not all at once.
4. **Look for, in this order:**
   - correctness against the spec's acceptance criteria and decisions
   - race conditions, trust boundaries, access and security rules, data loss
   - logic without tests
   - error handling on unreliable networks
   - known zk gotchas being repeated
   - needless complexity
5. **Output, 40 lines or less:**
   - one line per finding: `BLOCKER|MAJOR|MINOR  path:line — problem → suggested fix`
   - `Notes:` the output of `zk lint`, one line per stale note (omit if ok)
   - then `Not checked:` followed by anything you skipped
   - no praise, and no summaries of what the code does
   - last line: `After fixes: lean reviewed HEAD`
