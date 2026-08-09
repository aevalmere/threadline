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
