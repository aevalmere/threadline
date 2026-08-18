---
description: Run the current phase's gate — bulk machine checks, acceptance evidence, one batch reviewer run, PASS/FAIL table, async user checklist
---

Run the gate for the current phase in `ROADMAP.md`. Determine the current phase from the last unticked phase; if the user named one in `$ARGUMENTS`, use that instead.

This is the **bulk-verification point of the batch workflow** (CLAUDE.md workflow loop; DECISIONS #21) — items were committed mid-batch on smoke checks only, so the whole battery runs here, once.

## 1. Machine checks

Run all of these and capture real output. Node is not on PATH — prefix with `$env:PATH = "C:\Program Files\nodejs;$env:PATH";`.

```
npm run build      # must exit 0
npm run lint       # must exit 0
npm run test       # full Vitest run, must be green
npm run seed       # live-Supabase probes, must be green
```

The build must run with `VITE_MOCK_BACKEND=false`, or the bundle number is a lie (DECISIONS #20). Also run any scripted live probes the phase calls for (realtime delivery, resync draining — see `scripts/`). A failing check ends the gate. Do not proceed to interpretation, do not explain it away.

## 2. Acceptance walk

Take the phase's GATE line from `ROADMAP.md` and split it into its individual acceptance items. Walk **every** item and attach concrete evidence to each:

- a test name and its result, or
- a scripted probe and its output, or
- a file:line showing the behavior is implemented, or
- an exact manual step the user can run, with the expected result

"Implemented" is not evidence. Prefer a scripted probe over a manual step wherever one can honestly stand in — the user's checklist should hold only what is genuinely human: two devices, a phone, visual judgment, dashboard-only actions. Those go to the checklist in step 5; never mark them PASS on your own authority.

## 3. Reviewer subagent — one run, whole batch

Launch the `reviewer` subagent (fresh context) on the full phase diff:

```
git diff <last gate tag or phase start commit>..HEAD
```

Pass it the diff and the list of touched files — it is read-only and cannot fetch the diff itself. This single run is the batch review Non-negotiable 7 requires (migrations were already reviewed pre-push, mid-batch). Its verdict is binding. A FAIL blocks the gate; fix the cited items and re-run the reviewer. **Never review your own risky work** (Non-negotiable 7).

## 4. Verdict table

Output exactly one table:

| # | Acceptance item | Evidence | PASS / FAIL |
|---|---|---|---|

Human-only items are marked `→ user checklist`, not PASS/FAIL. Final line: `GATE <Gn> (machine): PASS` or `GATE <Gn> (machine): FAIL`.

## 5a. On machine PASS

1. Tick the phase's boxes in `ROADMAP.md`.
2. Commit — conventional message referencing the phase, e.g. `chore(P1): pass gate G1 (machine)`.
3. Print the user's **async production checklist**: numbered, concrete, runnable in ~5 minutes against the live URL, **including every ask queued during the batch** (dashboard actions, classifier-blocked commands). Each step says what to click and what they should see. Record it in `ROADMAP.md` under the gate.
4. **Start the next phase now.** The checklist does not block it (DECISIONS #21); anything it surfaces later is a priority-one bug, fixed before new features. Still blocking: TEAM BETA entry at G2 and the G6 ship checks.

## 5b. On FAIL

List exactly what blocks the gate, each with the file or step that must change. Nothing else — no summary of what did pass, no plan for later, no consolation. Then stop.
