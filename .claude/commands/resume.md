---
description: Session start ritual — read the memory files, report state, propose the next task, and wait
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
4. **Blockers waiting on the user** — anything that cannot move without them (Supabase dashboard actions, Cloudflare clicks, invites, keys). If none, say none.
5. **Today's proposed next task** — the single next unchecked `ROADMAP.md` item, restated concretely, **with its verification check spelled out**.

Then **wait for the user's go.** Do not start work, do not write files, do not run builds.

Keep it short — this is a status report, not a recap of the project. The user wrote these files; they do not need them read back.
