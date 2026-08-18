---
description: Session start ritual — read the memory files, report state, then start the batch
---

Read all of these before saying anything:

- `CLAUDE.md`
- `SPEC.md`
- `ROADMAP.md`
- `DECISIONS.md`
- `BACKLOG.md`
- `git log --oneline -15`

Then report, in this order and nothing more:

1. **Current phase** — which of P0–P6, and its gate.
2. **Last completed item** — the last ticked `ROADMAP.md` checkbox, and the commit that did it.
3. **In-flight item** — what is half-done right now. Check `git status` for uncommitted work. If nothing is in flight, say so.
4. **Open user checklist** — anything still on the async checklists from previous gates, one line each. These ride along; they do not block (DECISIONS #21).
5. **This session's batch** — everything left in the current phase, with the bulk-verification checks named.

Then **start immediately — do not wait for a go** (DECISIONS #21):

- Batch touches schema, auth, or realtime → enter plan mode first; that single approval is the session's one planning touchpoint.
- Otherwise → begin the first item.
- Stop only if the report surfaced a genuine decision only the user can make.

Keep the report short — this is a status line, not a recap of the project. The user wrote these files; they do not need them read back.
