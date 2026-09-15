---
name: compound
description: Capture learnings from this session as atomic Zettelkasten notes so future work gets easier. Use for /lean:compound [focus].
argument-hint: [optional focus]
disable-model-invocation: true
---

# Compound

Focus: $ARGUMENTS

Inspired by Every's Compound Engineering and stored as Zettelkasten notes. Work from what's already in this conversation. Don't re-read files or re-run commands to hunt for learnings.

1. **Candidates.** List what cost time or surprised you: wrong assumptions, tool or framework behavior, constraints you discovered, patterns that worked, decisions made with the user.
2. **Filter.** Keep only what would change what someone does next time. Drop anything obvious from the code, the spec or the git log. Usually 1–5 survive.
3. **For each one:**
   - Run `zk find <2-3 words>`, which searches both the project and global vaults.
   - If a similar note exists, Edit that file (sharpen the claim, add a case, add a tag) instead of creating a new note.
   - Otherwise run `zk new --type decision|gotcha|pattern|fact --title "<the claim as a sentence>" --tags <up to 4, kebab-case> --links <related ids> --source "<T-id, S-id or commit>" --body "Why: ...\nApply: ..."`.
   - If it isn't project-specific (Firebase, Node, Windows, git, test tools...), add `--global`.
4. **Note rules.**
   - One idea per note.
   - The title states the claim ("Firestore listeners need forced long-polling on hotel Wi-Fi"), not a topic ("Firestore").
   - The body is 10 lines or less.
   - Reuse existing tags (`zk tags`) before inventing new ones.
   - Link notes that explain or contradict each other (`zk link a b`).
5. **Report** one line per note: id, created or updated, title.
