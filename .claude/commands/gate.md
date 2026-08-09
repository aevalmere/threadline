---
description: Run the current phase's gate — build, tests, acceptance evidence, reviewer subagent, PASS/FAIL table
---

Run the gate for the current phase in `ROADMAP.md`. Determine the current phase from the last unticked phase; if the user named one in `$ARGUMENTS`, use that instead.

## 1. Machine checks

Run all three and capture real output. Node is not on PATH — prefix with `$env:PATH = "C:\Program Files\nodejs;$env:PATH";`.

```
npm run build      # must exit 0
npm run lint       # must exit 0
npm run test       # full Vitest run, must be green
```

A failing check ends the gate. Do not proceed to interpretation, do not explain it away.

## 2. Acceptance walk

Take the phase's GATE line from `ROADMAP.md` and split it into its individual acceptance items. Walk **every** item and attach concrete evidence to each:

- a test name and its result, or
- a file:line showing the behavior is implemented, or
- an exact manual step the user can run, with the expected result

"Implemented" is not evidence. If an item cannot be verified from this machine — anything needing two browsers, a phone, a killed network — say so explicitly and move it to the user's checklist in step 5. Never mark it PASS on your own authority.

## 3. Reviewer subagent

Launch the `reviewer` subagent (fresh context) on the phase diff:

```
git diff <last gate tag or phase start commit>..HEAD
```

Pass it the diff and the list of touched files — it is read-only and cannot fetch the diff itself. Its verdict is binding. A FAIL blocks the gate; fix the cited items and re-run the reviewer. **Never review your own risky work** (Non-negotiable 7).

## 4. Verdict table

Output exactly one table:

| # | Acceptance item | Evidence | PASS / FAIL |
|---|---|---|---|

Plus a final line: `GATE <Gn>: PASS` or `GATE <Gn>: FAIL`.

## 5a. On PASS

1. Tick the phase's boxes in `ROADMAP.md`.
2. Commit — conventional message referencing the phase, e.g. `chore(P0): pass gate G0`.
3. Print the user's **production verification checklist**: numbered, concrete, runnable in ~5 minutes against the live URL. Each step says what to click and what they should see.
4. Name the first task of the next phase and its verification check. Do not start it — the next phase begins only when the user approves this gate.

## 5b. On FAIL

List exactly what blocks the gate, each with the file or step that must change. Nothing else — no summary of what did pass, no plan for later, no consolation. Then stop.
