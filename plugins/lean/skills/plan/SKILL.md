---
name: plan
description: Turn an agreed spec into as few task cards as possible, shaped to run in parallel waves. Use for /lean:plan S-NNN.
argument-hint: <S-NNN>
disable-model-invocation: true
---

# Spec → task cards

Spec: $ARGUMENTS

Goal: the phase can finish in one sitting with `/lean:do --phase`. That takes few cards, and cards that don't wait on each other. Every card costs a worker that starts from zero, so an unnecessary card is paid for in full.

## 1. Load (cheap)

- Run `lean research S-NNN`. If the spec is `needs-research` or any question is OPEN, stop: say which ones and suggest `/lean:research S-NNN`. Cards built on guesses get rebuilt.
- Read the spec.
- Run `zk find` on the spec's tags and look for gotcha and pattern notes. Use `zk show` only for the relevant ones.
- Run `lean tasks --all` to see existing cards so you don't duplicate work.
- Locate code with Grep and Glob. Read only the parts a card will touch. Use a subagent only if the code area is both unknown and large.

## 2. Slice for width

- **One card per behavior** a user or operator would notice, built end to end: server, UI and their tests together. Don't split one feature into contract, logic, server and UI cards.
- **Budget:** about 1 card per 2 acceptance criteria, plus at most one contracts card. Going over needs a one-line reason in the card's Goal.
- **Size by concept, not file count:** one area of code, roughly 400 changed lines or less. A mechanical sweep (a rename, a removed field, a path change) goes into the cards that already edit those files, never into a separate cleanup card that re-opens them later.
- **Contracts card first:** if several cards would edit the same shared files (types, path builders, rules skeleton, config), put those edits in one small card the others depend on. After it, cards that can run together must have disjoint `files:`.
- **Merge, don't chain:** if B depends only on A and A only unblocks B, they are one card. Two cards that must edit the same file can't run together anyway, so merge them unless one is the contracts card.
- `depends:` lists only real prerequisites. Each unnecessary dependency costs a wave.
- `files:` lists the exact paths to create or modify. Parallel safety is checked against this list.
- `title:` plain words a non-developer would understand, 8 words or fewer, describing what will work once the card is done. No function names, file names, acronyms or jargon; those go in Goal and Steps. For example, "Judges' 7th vote closes voting instantly", not "Close transaction core + submitJudgeVote tracer".
- Cards that deploy or release get `deploy: true` in frontmatter, so `lean start` can warn when no security review covers the latest sensitive changes.
- `tdd: strict` when the card contains logic (state machines, calculations, access rules, security); `tdd: after` for UI- or config-only cards. In a mixed card, Steps say which parts are test-first. Follow `tddStrict` globs in `.lean/config.json`.
- Steps must be concrete: what to add where, function names, test cases by name. Don't write full code listings; include a snippet only for a tricky signature or contract. The code gets written once, in `/lean:do`.
- "Done when" lists exact commands and observable outcomes, and cites the spec's acceptance ids (A1…).
- Gotchas from zk go in a "Watch" section as one-line bullets with the note id.

## 3. Write cards

Run `lean new-id task --count <n>` and use the ids it prints (`T-` is the default prefix; `ids` in `.lean/config.json` can change it). Write each card to `.lean/tasks/T-NNN-<slug>.md`, 60 lines or less:

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

When a tracker is set, the card also gets `<tracker.field>: <issue id>` in its frontmatter (step 4 fills it). Keep frontmatter lists inline (`[a, b]`). Add `branch: <name>` only when earlier unfinished work exists on a branch.

## 4. Check the plan

1. Every acceptance id in the spec must appear in at least one card's "Done when". Fix any gaps.
2. Run `lean check-plan S-NNN`. For each suggestion, either merge the cards (combine Goal, Steps, Done when and `files:`; union `depends:`; delete the merged-away card file; point other cards' `depends:` at the survivor) or keep it with a one-line reason. Re-run until only justified suggestions remain.
3. Add a `## Cards` section listing the T-ids to the spec.
4. Tracker: if `.lean/config.json` has `tracker` and a matching MCP tool is available (e.g. Linear), create one issue per card as a sub-issue of the spec's issue (the spec's `tracker.field` value; same team). Title = card title, description = Goal + Done when. Then set "blocked by" from each card's `depends:`. Write each returned id into the card's frontmatter under `tracker.field` (e.g. `linear: MED-24`). If the spec has no issue, or the tool is missing or fails, leave the field out and say so in the report; never block the plan on it.

## 5. Finish

Report in 5 lines or less: the number of cards, the waves from `lean check-plan`, any suggestions you kept and why, and the next step `/lean:do --phase S-NNN`.
