---
name: research
description: Answer a spec's open research questions (things neither the user nor the code can tell) with sourced findings, then settle the decisions that waited on them. Use for /lean:research S-NNN.
argument-hint: <S-NNN>
disable-model-invocation: true
---

# Research → agreed spec

Spec: $ARGUMENTS

Research runs only when `/lean:grill` left questions under `## Research`. It turns guesses into sourced facts before `/lean:plan` builds cards on them.

## 1. Load

- Run `lean research S-NNN`. It lists each R-question as OPEN or done. If none are open, skip to step 4.
- Read only the spec's Problem, Decisions and Research sections.

## 2. Answer the open questions

- Spawn one `lean:researcher` agent per open question, **all in a single message**, so they run at the same time. Give each: the R-id and question, the Problem and Decisions in 5 lines or less, and the project root. At most 5 at once; run a second round for the rest.
- While they run, do nothing that depends on their answers.
- If a reply's confidence is low, or it says "unclear", decide with the user (AskUserQuestion): accept the risk, spike further, or drop what depends on it. Never quietly upgrade a low-confidence answer.

## 3. Record

For each answer, under its question in the spec, add one line:

```
- R1: Does the NPU driver support INT8 on the Rock 5T?
  → Yes, rknn-toolkit2 ≥ 1.6 (source: <url>; confidence: high; zk <id>)
```

- For each `Note:` that isn't "none", run `zk new --type fact --title "<the claim>" --tags a,b --source S-NNN --body "Source: ...\nApply: ..."` and cite the id on the answer line. If `zk new` prints `similar note exists`, cite that note instead.
- An answer that makes an existing decision wrong also goes under `## Risks` until step 4 settles it.

## 4. Settle what waited

1. List every decision marked `(after R<n>)` in the spec, plus any decision an answer's `Affects:` line says it changes.
2. Ask them all with AskUserQuestion, as in a grill round: recommended option first, labelled "(Recommended)", one-line consequence each, citing the finding.
3. Update the spec's Decisions (drop the `(after R<n>)` marks), Acceptance and Risks to match. If an answer changes the problem itself rather than a decision, stop and suggest `/lean:grill` on that part instead.

## 5. Close

- Run `lean research S-NNN --close`. It refuses while any question is unanswered; answer or remove it (removing needs a one-line reason under Risks).
- Report in 4 lines or less: the answers (one line each, most surprising first), decisions that changed, notes created, and the next step `/lean:plan S-NNN`.
