---
name: debug
description: Find the root cause of a bug or failing test before changing code, then fix it with a regression test. Use for /lean:debug <symptom>.
argument-hint: <symptom, failing test, or error>
disable-model-invocation: true
---

# Debug

Symptom: $ARGUMENTS

Adapted from Superpowers' systematic-debugging. No fixes before a root cause.

1. **Reproduce.** Run the smallest command that shows the failure. Read the actual error message and the top stack frames; trim noise with `tail` or `grep`. If the failure is intermittent, loop it and record how often it fails. Run `zk find <error words>`, since it may be a known gotcha.
2. **Compare.** Find a similar code path that works (Grep). List the concrete differences between the working and broken paths: inputs, config, ordering, environment (emulator vs deployed, auth state, network).
3. **Test one hypothesis at a time.** State it as "X causes it because Y". Design the smallest check (a log line, a focused test, a single change) and run it. Revert experiments that fail, and don't stack changes. After 3 disproven hypotheses, stop: summarize what's ruled out and ask the user with AskUserQuestion. It may be a design problem, not a bug.
4. **Fix.** Write a regression test that fails because of the root cause. Make the minimal fix, then run `lean test`.
5. **Record.**
   - Commit with `fix: ...`, and include the T-id if this is inside a card.
   - Always write one note: `zk new --type gotcha --title "<symptom> is caused by <cause>" --tags a,b --body "Symptom: ...\nCause: ...\nFix: ...\nDetect: ..."`. Add `--global` if it's a tool or framework trap.

Report in 6 lines or less: cause, fix, test, note id.
