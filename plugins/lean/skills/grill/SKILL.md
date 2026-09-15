---
name: grill
description: Interview the user in rounds until a feature or phase is fully specified, then write a spec. Use for /lean:grill <topic>.
argument-hint: <feature, phase, or idea>
disable-model-invocation: true
---

# Grill → spec

Topic: $ARGUMENTS

Adapted from Matt Pocock's `grilling` skill. The goal is shared understanding with nothing silently assumed, recorded in a short spec.

## 0. Ground yourself cheaply

- Run `zk find <2-3 topic words>` with Bash. Use `zk show <id>` only for notes that look relevant.
- For source docs (SPEC.md, briefs, archives), grep the headings and read only the matching sections. Never read large files whole.
- Finding facts is your job, never the user's. If a fact needs more than about 3 files of digging, send one `Explore` subagent a narrow question and tell it to reply in 150 words or less. While it runs, keep asking the questions that don't depend on it.

## 1. Rounds over the design tree

Map the topic as a design tree: each decision branches into the decisions that depend on it. The **frontier** is the set of open decisions whose prerequisites are settled.

- Each round, ask the whole frontier with the AskUserQuestion tool. It takes up to 4 questions per call, so use several calls for a bigger frontier. Put your recommended option first and label it "(Recommended)". Give each option a one-line consequence.
- A question that depends on another still-open question waits for a later round.
- If an answer is free text, a clarification or a new idea, respond to it briefly, then ask that decision again as a question in the next round.
- After each round, recompute the frontier. Stop when it's empty.
- Spend questions on decisions that are hard to change later: data model, trust boundaries, timing, failure behavior, what is out of scope. Decide trivia by convention and list it under "Defaults" in the spec.

## 2. Confirm

Ask one AskUserQuestion: summarize the settled design in 8 lines or less, with the options "Write the spec" and "Changes first". Write nothing until the user confirms.

## 3. Write

- Run `lean new-id spec` to get `S-NNN`. Give the spec a plain-language title a client would understand, such as "Voting engine that never miscounts". Write `.lean/specs/S-NNN-<slug>.md`, 150 lines or less:

  ```
  ---
  id: S-NNN
  title: ...
  status: agreed
  tags: [a, b]
  ---
  ## Problem          3-5 lines
  ## Decisions        - D1: choice — why (zk <id>)
  ## Defaults         conventions chosen without asking
  ## Out of scope
  ## Acceptance       A1, A2 ... each one testable
  ## Risks
  ```

- For each decision that is non-obvious or costly to reverse, run `zk new --type decision --title "<the decision as a claim>" --tags a,b --source S-NNN --body "Why: ...\nApply: ..."`. Put the note id next to the decision in the spec. Aim for 2–8 notes, not one per question. If `zk new` prints `similar note exists`, cite that note's id instead of creating one; when the decision reverses it, rerun with `--force`, then `zk supersede <old> <new>`.
- Run `lean focus "S-NNN agreed, next: /lean:plan S-NNN"`. This is a temporary note; the focus line itself updates automatically from the cards.
- Report in 3 lines: the spec path, the notes created, and the next step `/lean:plan S-NNN`.
