# DECISIONS.md

Append-only. Newest at the bottom. **Never rewrite or delete an entry** — if a decision is reversed, add a new entry that supersedes it and say so.

Log an entry when: a locked-stack rule is bent, the schema deviates from `SPEC.md`, a bug survives two failed attempts (Non-negotiable 6), or a non-obvious tradeoff is made that a future session would otherwise re-litigate.

---

## #1 — 2026-08-09 — The stack

**Decision.** Vite + React + TypeScript SPA (react-router) · Supabase for Postgres / Auth / Realtime / Storage · shadcn/ui + Tailwind · BlockNote (free core only) · dnd-kit · Postgres full-text search · Cloudflare Pages auto-deploying from GitHub `main`.

**Why.**
- **SPA, not Next.js.** The entire backend is Supabase, so there is no server-side work for a meta-framework to do. A static SPA deploys to Cloudflare Pages for $0 with no ToS friction, and it deletes an entire class of bugs — server-vs-client component confusion, hydration mismatches, env vars leaking across the boundary.
- **Supabase, not a hand-rolled backend.** Postgres, auth, realtime, storage, and row-level security from one vendor with one CLI and one client library. At 5–30 users the free tier is comfortable. Migrations are CLI-managed from day one so production schema is never hand-edited in a dashboard.
- **Magic links, no passwords.** Nothing to reset, nothing to leak, no password UI to build. Public signups are disabled; the user invites teammates from the dashboard — that *is* the access-control system.
- **shadcn/ui.** Source-in-repo components, so there is no upgrade treadmill and no fighting a design system. Chat surfaces get scaffolded from its chat components rather than hand-rolled.
- **Postgres FTS, not Meilisearch/Typesense/Algolia.** One `search_all()` function, zero extra infrastructure, zero extra dollars, zero sync pipeline to keep consistent. At this data volume it is comfortably fast.
- **dnd-kit.** react-beautiful-dnd is unmaintained.
- **BlockNote free core only.** XL packages are paid; the core covers Notion-lite editing.

**Consequence.** These are locked for v1. No swaps, no overlapping additions, no state-management framework without a superseding entry here.

---

## #2 — 2026-08-09 — `messages.id` is `bigint identity`, not `uuid`

**Decision.** `messages.id bigint generated always as identity`. Every other table keeps `uuid default gen_random_uuid()`. Consequently the polymorphic id columns — `links.source_id`, `links.target_id`, `attachments.owner_id`, `notifications.entity_id`, and `search_all`'s `entity_id` — are `text`.

**Why.** Two P1 requirements are literally comparisons on message id: unread counts (`id > channel_members.last_read_message_id`) and reconnect resync (`WHERE id > last_seen`). Random uuids have no meaningful order, so both would need a join against `created_at` — which can tie under concurrent inserts and is therefore not a stable cursor. A monotonic bigint makes unread counts, keyset pagination, and resync one-liners each, and keeps the indexes small on the highest-volume table in the app.

**Cost accepted.** The database holds two id types, so polymorphic columns become `text`. This is cheap because `links` and `attachments` were already specified as polymorphic with integrity enforced in app code. Typed foreign keys stay typed: `tasks.source_message_id bigint`, `tasks.source_post_id uuid`.

---

## #3 — 2026-08-09 — Seed script authenticates without passwords

**Decision.** `scripts/seed.ts` proves the blanket RLS policy (Non-negotiable 2) by minting a real user session through `auth.admin.generateLink({ type: 'magiclink' })` and redeeming the returned `hashed_token` via `verifyOtp` on a plain **anon** client — then running select / insert / update / delete against a live table.

**Why.** The check has to run through the anon client to be worth anything, and magic links can't be clicked from a script. The obvious alternative — give the seed users passwords and call `signInWithPassword` — would put real password credentials in a database whose whole auth story is "magic links only", and would mean storing that password somewhere for the test to read.

**Fallback if `generateLink` proves unreliable.** Switch to password-based seed users, keep the passwords in `.env.local` only, and append a superseding entry here.

**Scope.** The `service_role` key this script needs lives in `.env.local` (gitignored) and is used *only* by `scripts/`. It is never imported from `src/`, never committed, and never placed in a Cloudflare Pages environment variable.

*Superseded in part by #5 — how the verbs are judged.*

---

## #4 — 2026-08-09 — `messages` is published to realtime with an explicit column list

**Decision.** The P0 messages migration adds the table to `supabase_realtime` with a column list that omits `search_tsv`:

```sql
alter publication supabase_realtime add table public.messages (
  id, channel_id, post_id, author_id, thread_root_id,
  body, created_at, edited_at, deleted_at
);
```

Replica identity is left at the default (primary key), **not** `full`.

**Why.** `search_tsv` is a stored generated column created in P0 so that P5 needs no schema change on the busiest table (SPEC.md §3). The intent is that no Postgres Changes payload in P1 ships the tsvector next to `body` — that would be roughly double the websocket bytes per message, for data no client reads. `replica identity full` would similarly multiply WAL volume; it is unnecessary because soft deletes and edits are UPDATEs, which already carry the full new row. Both are Non-negotiable 8 (protect the free tier's realtime budget).

**The saving is intended, not yet measured.** Supabase Realtime reads WAL via `realtime.list_changes` → wal2json, which decodes stored tuples rather than consulting a pgoutput publication's column list, so `search_tsv` may ride along regardless. **Verify against a real payload at G1** and amend this entry with what is actually observed. The column list is harmless either way — `id` is included, so it covers the default replica identity and UPDATE/DELETE replicate legally.

**Constraint this creates.** A future column added to `messages` is **not** replicated until a new migration re-declares the publication's column list. Any migration that adds a client-visible column to `messages` must also `alter publication supabase_realtime set table public.messages (…)` with the new column included.

**Requires Postgres 15+.** Fine — Supabase provisions 17, and `supabase/config.toml` now says 17 to match.

---

## #5 — 2026-08-09 — The RLS check judges rows affected, and tests both directions

**Supersedes the verification method in #3.** The rest of #3 — magic-link session minting, service_role scope — stands.

**What was wrong.** The first version judged each verb on `!error`. That proves nothing. Under RLS a denied UPDATE or DELETE is *not* an error: the rows fail the `USING` clause, zero rows match, and PostgREST returns 204 with no error body. A denied SELECT returns 200 and `[]`. The check would have printed "PASS update / PASS delete" against a table carrying only a select policy — the one thing Non-negotiable 2 asks to be verified, verified hollowly. Caught by the reviewer subagent, which is the whole reason rule 7 exists.

**Decision.** Every assertion is judged on **rows affected**, never on error presence:

| Assertion | Passes when |
|---|---|
| `select` | more than 0 rows visible |
| `insert` | the row comes back from `.select().single()` |
| `update` | `.select()` returns exactly 1 row |
| `delete` | `.select()` returns exactly 1 row |
| `cleanup` | an admin re-query of the probe id returns 0 rows |
| `anon select` | 0 rows, or an error, **without** a session |
| `anon insert` | 0 rows, or an error, **without** a session |

**Why the last two.** Everything above them runs signed-in, so it cannot distinguish a correct policy from an over-permissive one: a policy written `to public` or `to anon`, or a table where `enable row level security` was simply forgotten, passes every signed-in assertion identically. A signed-out client separates the cases — under the intended `to authenticated` policy it must be able to do nothing. This matters more with each phase: P2–P5 add six more tables to the same pattern, and this script is the only thing standing between a copy-paste slip and a silently public table.

**Known remaining gap.** The probe exercises `channels` only. A per-table sweep is cheap to add and should happen when the table count grows — noted here so it is a decision, not an oversight.
