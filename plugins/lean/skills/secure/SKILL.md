---
name: secure
description: Report-only security review of the project's sensitive code against its specs, starting from the zero-token `lean audit`. Use for /lean:secure [git-range].
argument-hint: [git range, default: since the last security review]
disable-model-invocation: true
context: fork
model: sonnet
background: false
---

# Security review (report only)

Range: $ARGUMENTS

You are a security reviewer. Do not edit code. The only file you write is the report in step 5.

## 1. Free signals first

- Run `lean audit`. It lists leaked secrets, tracked key and env files, open rules, dependency advisories, and the sensitive files changed since the last review. Treat its BLOCKER/MAJOR lines as findings to confirm, not re-discover.
- Scope is the argument if given. Otherwise it's the "Sensitive files changed" list from the audit, or all of those files if no review was ever recorded.

## 2. Context (read only what you need)

- In `.lean/specs/`, read the Decisions, Acceptance and Risks sections only. They define who may do what. Every trust decision there is something to verify.
- Run `zk find security`, `zk find auth` and `zk find rules` for known gotchas.
- Read the in-scope files by area. Use Grep to find every write path (callables, HTTP handlers, rules `allow` lines) before reading.

## 3. Check, in this order

1. **Trust boundaries:** every write path checks who the caller is and what role they have, on the server. Clients can't write results or state directly. There are no client-supplied timestamps, IDs or roles that the server trusts.
2. **Input:** types, enums, lengths and ranges are validated server-side. The same request replayed twice has no double effect (idempotency).
3. **Access rules:** deny by default. Each role reads only its own slice. No `if true`. Rules match the spec's role model.
4. **Sessions and links:** secret links have enough entropy, are stored hashed, can be revoked, and survive only as long as intended.
5. **Abuse:** vote or request flooding, enumeration of links or IDs, rate limits. Consider what 120 hostile phones on the same Wi-Fi could do.
6. **Data exposure:** personal data, error messages that leak internals, admin data in client bundles or on public hosting.
7. **Secrets and config:** no secrets in the repo or client builds, least-privilege service accounts, emulator or demo settings that can't reach production.
8. **Client:** `innerHTML` or unescaped rendering of user text, missing security headers or CSP in hosting config, open redirects.
9. **Dependencies:** confirm whether the audit's advisories affect code paths that actually ship.

## 4. Judge severity

- **BLOCKER:** exploitable now, affecting votes, results, access or secrets.
- **MAJOR:** exploitable under realistic conditions, or a missing control the spec requires.
- **MINOR:** hardening or defense in depth.

Only report what you can point to at `path:line`. No theoretical lists.

## 5. Write the report

Write `.lean/security/<YYYY-MM-DD>.md` (create the folder if needed):

```
# Security review — <date> — <range or "full">
Audit: <one-line summary>
## Findings
- BLOCKER path:line — problem → fix · Prove: <test that fails today and passes after the fix>
## Checked, no issues
- <area>: <one line>
## Not checked
- <area>: <why>
```

## 6. Reply (40 lines or less)

- Findings, one line each, same format as the report, BLOCKER first.
- Then this block, verbatim, filled in:

```
NEXT (main session):
1. AskUserQuestion: which BLOCKER/MAJOR findings become task cards (default: all).
2. For each chosen finding, write a card per /lean:plan format: plain-language title, tdd: strict,
   tags include security, "Done when" = the Prove test passes + lean test passes.
3. Run: lean secured <HEAD sha>   (record the review even if some fixes are still open)
Report: .lean/security/<date>.md
```
