---
name: plan
description: Turn an agreed spec into small, testable task cards. Use for /lean:plan S-NNN.
argument-hint: <S-NNN>
disable-model-invocation: true
---

# Spec → task cards

Spec: $ARGUMENTS

## 1. Load (cheap)

- Read the spec.
- Run `zk find` on the spec's tags and look for gotcha and pattern notes. Use `zk show` only for the relevant ones.
- Run `lean tasks --all` to see existing cards so you don't duplicate work.
- Locate code with Grep and Glob. Read only the parts a card will touch. Use a subagent only if the code area is both unknown and large.

## 2. Slice

A card is one commit and about 15–60 minutes of agent work. It touches 6 files or fewer and can be tested on its own.

- `title:` plain words a non-developer would understand, 8 words or fewer, describing what will work once the card is done. No function names, file names, acronyms or jargon; those go in Goal and Steps. For example, "Judges' 7th vote closes voting instantly", not "Close transaction core + submitJudgeVote tracer".
- Cards that deploy or release get `deploy: true` in frontmatter, so `lean start` can warn when no security review covers the latest sensitive changes.

- Order: contracts and types → pure logic → server paths → UI → deploy and ops.
- Set `tdd: strict` for logic (state machines, calculations, access rules, security). Set `tdd: after` for UI and config. If `.lean/config.json` has `tddStrict` globs, follow them.
- In `depends:`, list only real prerequisites, so work that can run in parallel stays visible.
- In `files:`, list the exact paths to create or modify. Parallel safety is checked against this list.
- Steps must be concrete: what to add where, function names, test cases by name. Don't write full code listings; include a snippet only for a tricky signature or contract. The code gets written once, in `/lean:do`.
- "Done when" lists exact commands and observable outcomes, and cites the spec's acceptance ids (A1…).
- Gotchas from zk go in a "Watch" section as one-line bullets with the note id.

## 3. Write cards

Run `lean new-id task --count <n>`. Write each card to `.lean/tasks/T-NNN-<slug>.md`, 60 lines or less:

```
---
id: T-NNN
title: ...
spec: S-NNN
status: todo
depends: [T-001]
files: [path/a.ts, path/b.test.ts]
tdd: strict
---
## Goal
## Steps
1. ...
## Done when
- [ ] `<command>` passes
- [ ] A3: ...
## Watch
- ... (zk 20260914-153012)
```

Keep frontmatter lists inline (`[a, b]`). Add `branch: <name>` only when earlier unfinished work exists on a branch.

## 4. Check coverage

Every acceptance id in the spec must appear in at least one card's "Done when". Fix any gaps before finishing, then add a `## Cards` section listing the T-ids to the spec.

## 5. Finish

Run `lean tasks`. Run `lean check-parallel` on the cards that are ready together. Report in 5 lines or less: the cards created, which are ready now, which can run in parallel, and the next step `/lean:do`.
