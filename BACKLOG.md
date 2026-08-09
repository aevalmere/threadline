# BACKLOG.md — v1.1 and beyond

The parking lot. Nothing here gets built before **August 31, 2026**.

When the user asks for something on this list mid-build: remind them of the ship date, append it here (or note the extra ask under an existing entry), and carry on with the current ROADMAP item.

---

## Explicit v1 non-goals

Hard NO for v1. Listed so a future session doesn't mistake their absence for an oversight.

| Item | Note |
|---|---|
| Billing | No payments, plans, or seats. Internal tool. |
| Roles & permissions | One trusted workspace; auth is the only wall. Adding roles means rewriting every RLS policy. |
| Native mobile apps | Responsive web only. |
| Voice / video | |
| Collaborative co-editing (Yjs / CRDT) | P4 ships a soft edit-lock banner instead. |
| Email digests, push notifications | In-app bell only. |
| Read receipts | |
| Edit history | Messages keep `edited_at`, not versions. |
| Custom emoji | |
| Per-channel notification prefs | |
| Kanban automations | |
| Backlink graph visualization | The "Linked items" list panel covers the need. |
| External search service | Postgres FTS only — no Meilisearch, Typesense, Algolia, Elasticsearch. |

## Promoted to v1 stretch

These two are the **only** backlog items allowed to jump the queue, and only if the P6 bug-bash is quiet by Aug 30:

- **DMs as private 2-person channels** — near-zero new infra on the existing schema.
- **Emoji reactions** — one join table.

## Ideas parked during the build

*(append here as they come up — one line each, with the date and who asked)*

## Ideas parked during the build

- **2026-08-09 (Ethan)** — Persist the optimistic send queue across a page reload. Today a failed send keeps its bubble and Retry across a channel switch, but not a browser reload: `pending` is React state, so refreshing loses the unsent text. Closing it means writing the queue to localStorage keyed by channel and rehydrating on mount. Narrow (send must fail *and* the user must reload), so it is parked rather than built.
- **2026-08-09 (Ethan)** — Deep-linkable thread pages: a `/channels/:channelId/t/:rootId` route so a thread has a shareable URL and a focused mobile view, alongside the inline expansion. Ethan asked for "separate page threads" while questioning whether Discord-style threads would suit the workflow better. Conclusion: keep chat threads lightweight, because P3 forum posts already own the heavy titled-discussion niche and shipping both would give the team two overlapping tools. **Consider pulling this forward into P2** — "create task from message" needs jump-to-exact-message navigation, which is most of the same machinery.
- **2026-08-09 (Ethan)** — Richer thread affordance: show last-reply time and participant avatars next to "N replies", instead of the bare count.
- **2026-08-09 (Ethan)** — Database-level guard for the one-level-deep thread rule: a trigger that rewrites a nested `thread_root_id` to its true root on insert. Today only the client enforces it (`threadRootFor`), and P3 reuses `messages` for forum comments. Verified 2026-08-09 that live data has zero violations.
