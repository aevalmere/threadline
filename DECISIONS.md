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

---

## #6 — 2026-08-09 — Channel state is a React context, not a state library

**Decision.** The channel list lives in `ChannelsProvider` (`src/lib/channels.tsx`),
a plain React context wrapping the app shell. `src/lib/useChannels.ts` — a
standalone hook that fetched its own copy — is deleted; the sidebar and the
`/channels` page now read the same context.

**Why.** Channel CRUD created the app's first piece of genuinely shared client
state: creating a channel on the `/channels` page has to show up in the sidebar
without a refresh, and two independent `useChannels()` calls each holding their
own `useState` cannot do that. The options were context or a store library.

Non-negotiable 3 forbids adding a state-management framework without an entry
here, and this does not earn one. The shared state is a single array that
changes on explicit user action, with no cross-cutting subscriptions, no
derived-state graph, and no performance problem to solve. Context costs zero
dependencies and zero bundle bytes.

**Consequence for P1.** The provider's `refresh()` is the seam where the
realtime subscription lands. When Postgres Changes on `channels` arrives, it
updates the same context and every consumer follows — no component changes
needed. The local `setChannels` calls after each mutation stay as the optimistic
path so the UI does not wait for a websocket round trip.

**Revisit if** a future phase needs many independent slices of shared state with
cross-slice derivations. Tasks (P2) and docs (P4) are the candidates. If that
happens, supersede this entry rather than quietly adding a library.

---

## #7 — 2026-08-09 — Measured: the realtime payload carries `search_tsv` anyway

**Answers the open question in #4.** Recorded as a new entry rather than an edit,
because the convention at the top of this file is append-only and #5 set the
precedent. #4's decision stands; only its *hoped-for saving* is disproved.

**What was measured.** A script subscribed to Postgres Changes on `messages`
through the anon client with a real user session, and a row was inserted against
the live project. The event arrived, and `payload.new` contained:

```
id, body, post_id, author_id, edited_at, channel_id,
created_at, deleted_at, search_tsv, thread_root_id
```

`search_tsv` is present. The publication column list from #4 — which deliberately
omits it — **did not trim the payload**. This is exactly the failure mode #4
predicted: Supabase Realtime reads WAL through `realtime.list_changes` →
wal2json, which decodes the stored tuple rather than consulting a pgoutput
publication's column list.

**Cost.** For the probe, `body` was 20 bytes and `search_tsv` was 30
(`'probe':3 'realtim':1 'smoke':2`). A tsvector is roughly the size of the text
it indexes, so realtime traffic on the busiest table is about double what #4
intended. At 5–30 teammates this is comfortably inside the free tier, so
**nothing changes now** — Non-negotiable 8's concern is real but not yet binding,
and a schema change here would be scope creep against the ship date.

**The remedy, if it ever bites.** Drop the stored generated column and index the
expression instead: `create index … using gin (to_tsvector('english', body))`.
That gives P5 the same full-text search with no stored tsvector, so nothing rides
along in either the WAL or the payload. It is a new migration (never edit one
that has run) and it changes what `search_all()` queries, so it belongs to P5 or
later — not to a chat item.

**A caveat on #4's stated constraint.** #4 warns that a future column added to
`messages` will not replicate until a migration re-declares the publication's
column list. If the list is not consulted when building payloads, that constraint
probably does not bind either. **Untested** — the measurement only shows that a
listed-*out* column still arrives. Do not rely on either reading without checking.

**The column list stays.** It is harmless, it costs nothing, and it documents the
intent. It is simply not load-bearing.

---

## #8 — 2026-08-09 — The one-level thread rule is enforced by a trigger, and pulled forward from BACKLOG

**Decision.** `flatten_thread_root()`, a `before insert or update of thread_root_id`
trigger on `public.messages`, enforces SPEC.md §1.3 in the database. It was a
BACKLOG entry for about twenty minutes before Ethan chose to build it now; the
backlog line is struck through and the work is a ROADMAP P1 item. Recording the
pull-forward because the repo briefly contradicted itself, and Non-negotiable 4
says a deviation gets written down in the commit that deviates.

**Why now rather than v1.1.** `thread_root_id` is a plain FK to `messages(id)`,
so nesting was schema-legal and only `threadRootFor()` in client code prevented
it. P3 reuses `messages` for forum comments — a second code path that has to get
the same rule right — and the cost of discovering a nested chain after the team
beta is a data migration, not a bug fix.

**Two branches, deliberately different.**

| Case | Behaviour | Why |
|---|---|---|
| Reply targets another reply | **Rewrite** to that reply's root | Exactly what the client already computes, so every caller keeps working |
| Re-parenting a message that has replies | **Raise** | No correct root exists to rewrite to; it would drag a whole thread down a level. No app or seed path issues it, so an exception surfaces a bug instead of hiding one |

**`security definer`.** Kept for consistency with `handle_new_user()` and to keep
the lookups independent of the caller's row visibility. It is belt-and-braces,
not a requirement: Non-negotiable 2 already gives every authenticated user sight
of every row. It grants nobody anything, because Postgres refuses direct calls
to a `returns trigger` function.

**Verification.** `scripts/seed.ts` gained `threadFlatteningCheck`, which sends
what a *buggy* client would — a reply pointing at another reply — and asserts the
stored row came back attached to the root. The existing `src/test/threads.test.ts`
covers only the client helper and is no evidence the database rule exists.

**Known limits, accepted.**
- The flattening climbs exactly one level, which is correct only while the
  invariant already holds. Restoring a pre-trigger backup containing a nested
  chain would perpetuate it rather than repair it.
- `for share` on the root lookup closes the concurrent re-parenting race. It
  costs a row lock per *reply* insert — not per message, since top-level
  messages return before it.

**A property P3 must preserve.** `src/lib/pending.ts` reconciles an optimistic
send against its confirmed row partly on `thread_root_id`. If the trigger ever
rewrites that value for a message the client sent, the optimistic bubble never
reconciles and sticks in "sending" forever. Safe today because the client always
sends `threadRootFor(root)`, which equals what the trigger computes. **The forum
comment path in P3 must keep that true.**

---

## #9 — 2026-08-10 — The attachments bucket is private, and storage policies are bucket-scoped

**Decision.** The `attachments` bucket is created with `public = false`. Reads go
through short-lived signed URLs (`createSignedUrls`, 1 hour, batched and cached
client-side). The 10 MB cap is set as `file_size_limit` on the bucket **and**
checked in the client before upload. `storage.objects` gets four policies scoped
to `bucket_id = 'attachments'`, not the single blanket policy every app table has.

**Why private.** Ethan chose this over a public bucket. A public bucket makes
every uploaded file world-readable forever to anyone holding the link —
forwarded, leaked, or indexed. Paths are unguessable uuids, but that is
obscurity, not access control, and Non-negotiable 2's "auth is the only wall"
should cover files as well as rows. A team pasting screenshots of internal work
into chat should not be creating public URLs by doing so.

**What it costs.** A signed URL per object, which is the one piece of real
complexity this adds. `createSignedUrls` takes a batch, so it is one request per
page of messages rather than one per image, cached by path with its expiry and
re-signed only when stale. Contained to `src/lib/useSignedUrls.ts`.
`getPublicUrl()` must never be used on this bucket — it returns a URL that 400s.

**Why the cap is enforced twice.** The bucket limit is the wall: a client check
alone means anything bypassing the UI can fill the free tier's 1 GB. The client
check exists only so the user gets an instant, readable error instead of
uploading 40 MB and then being refused. `MAX_UPLOAD_BYTES` in
`src/lib/attachments.ts` and `file_size_limit` in the migration are the same
number, and a test asserts the client half against the literal 10485760 so the
two cannot drift silently.

**Why storage.objects does not follow Non-negotiable 2's shape.** That rule says
one blanket policy per table. `storage.objects` is a single table holding the
contents of *every* bucket, so an unscoped `using (true)` there would also
govern every bucket added in a later phase — the opposite of a deliberate
decision. The four policies are scoped by `bucket_id` and otherwise say exactly
what Non-negotiable 2 says: any authenticated teammate, full access, no per-row
ownership. This is the rule's intent applied to a table it did not anticipate,
not an exception to it.

**Bucket creation is idempotent by `do update`, not `do nothing`.** The
dashboard's "New bucket" button defaults to public. Had this been `do nothing`, a
pre-existing bucket of the same name would have left every file world-readable
while the migration reported success.

**Consequences.**
- `attachments` is the second table bound by DECISIONS #4's constraint: a later
  migration adding a client-visible column must re-declare the publication's
  column list. #7 notes that constraint is itself untested.
- Deleting a message leaves its attachment rows and storage objects orphaned —
  no FK, by design (SPEC §1.8). The bytes still count against the 1 GB. A sweep
  belongs in P6 or the backlog, not here.
- Resumable/TUS uploads would need policies on `storage.s3_multipart_uploads`
  and `..._parts`. The 10 MB cap keeps the standard upload path viable; do not
  switch without a follow-up migration.
- `isImage()` accepts `image/svg+xml`, and an SVG opened from a signed URL
  executes script on the storage origin. No session material lives there, so the
  impact is low; noted so it is a known risk rather than an oversight.

---

## #10 — 2026-08-10 — TEMPORARY: the workspace is open to anonymous users

**This entry describes a deliberate, reversible weakening of the only wall the
app has.** It is written to be impossible to miss in a future session.

**Decision.** Migration `20260810052810_temporary_guest_access.sql` adds `to anon`
policies to `profiles`, `channels`, `channel_members`, `messages`, `attachments`
and the `attachments` bucket's `storage.objects`. With `VITE_GUEST_MODE=true`,
`RequireAuth` lets an unauthenticated visitor straight into the app.

**What this exposes.** Anyone who loads the deployed URL can read *and write*
every channel, message and file without signing in. No password, no invite, no
magic link. The URL is the only remaining secret.

**Why it was done anyway.** Ethan asked for it explicitly to test without
logging in, and reaffirmed it after being shown exactly this consequence,
including the alternative (a dev-only guest login that leaves production
untouched). That is his call to make. It is recorded here so nobody later
mistakes it for an accident — Non-negotiable 2 is otherwise unambiguous, and a
future session finding `to anon` policies should assume they are wrong unless
this entry still applies.

**Reverting.** Six `drop policy` statements, listed in full at the top of the
migration, as a **new** migration (Non-negotiable 6 — never edit one that has
run). Then unset `VITE_GUEST_MODE` in `.env.local` and in Cloudflare Pages, and
set `GUEST_MODE=false` so the seed asserts the closed posture again. The
`to authenticated` policies are untouched throughout, so nothing else has to
change and no data moves.

**Guest identity.** `messages.author_id` is `not null`, so guest writes need an
author. The seed creates one shared profile with display name `Guest`, and the
client looks it up by name rather than baking a uuid into the bundle. Every
guest is therefore the same person as far as the data is concerned — there is no
way to tell two guests apart, and nothing tries to.

**The seed check flips rather than dulls.** `GUEST_MODE=true` in `.env.local`
makes the signed-out probes assert that anon *can* read, write and upload. So
the check still fails loudly in both directions: with guest mode off, an
accidental anon policy fails; with it on, a half-applied migration that leaves
guests staring at an empty app also fails. What it can no longer do is notice
that the workspace is public, because right now that is the intended state — the
run prints a warning banner instead.

**Still true while this is on.** The bucket stays private (DECISIONS #9): reads
go through signed URLs, and the unsigned public URL still 400s. Guest mode
widens *who* may ask for a signed URL; it does not make the bucket public.

---

## #11 — 2026-08-10 — Deleting a message destroys its content; supersedes #9's orphan bullet

**Supersedes** the bullet in #9 that read: *"Deleting a message leaves its
attachment rows and storage objects orphaned — no FK, by design (SPEC §1.8). The
bytes still count against the 1 GB. A sweep belongs in P6 or the backlog, not
here."* That is no longer true. The sweep happens at delete time.

**Decision.** Deleting a message sets `deleted_at`, blanks `body` to `''`, and
deletes every attachment row owned by it together with its object in storage.
The row itself stays as a tombstone. SPEC §1.3 is updated to match.

**Why the row survives but its content does not.** Ethan asked for deletes to
actually free storage rather than leave files behind. But a hard `DELETE` on
`messages` would be worse for the product: the realtime payload carries only the
primary key under the default replica identity, so the `channel_id=eq.` filter
cannot match it and other clients would keep showing the message until they
reloaded. A tombstone propagates as an ordinary UPDATE, which always arrives, and
it keeps `thread_root_id` resolvable so a deleted root does not orphan its
replies. Keeping the row costs a few dozen bytes; the content — which is all of
the bytes that matter — genuinely goes.

**Ordering, and what it accepts.** Storage objects first, then attachment rows,
then the message UPDATE. Not atomic, and it cannot be: storage is not in the
database transaction. Two partial states are possible and both are recoverable:

| Fails after | State | Recovery |
|---|---|---|
| `storage.remove()` | rows point at objects that are gone | re-click Delete; `remove()` is idempotent |
| attachment row delete | message not yet tombstoned, files gone | re-click Delete |

Every branch sets a visible error, so no partial state is silent. Storage first
is the deliberate order: the failure that leaves *bytes* behind is the one worth
avoiding, since that is the resource under pressure.

**Known gap.** `deleteAttachment` has no realtime counterpart — only INSERTs on
`attachments` are subscribed — so deleting a single file leaves other clients
rendering it until they reload, against a signed URL that now 404s. Deleting a
whole message is unaffected, because the message UPDATE propagates and the UI
hides attachments on a tombstone. Parked in BACKLOG rather than fixed here: it
needs a DELETE subscription whose payload, under the default replica identity,
carries only the primary key — so it wants the same thought as #4's column-list
question rather than a quick patch.

---

## #12 — 2026-08-10 — An in-memory mock backend for offline development

**Decision.** `VITE_MOCK_BACKEND=true` swaps the Supabase client for
`src/lib/supabase-mock.ts`, an in-memory implementation of the client surface.
No network, no Docker, no cloud project. Rows persist in localStorage; uploaded
blobs live in memory and are gone on reload.

**Why, and what was rejected.** Ethan wanted to test functionality locally
without a backend. The alternative offered was `npx supabase start` — the real
stack in Docker, full fidelity, one codebase, and Docker is already installed on
this machine. He chose the mock for speed and to avoid running Docker at all.
That is a legitimate call for UI iteration; it is recorded here because it comes
with a cost the alternative does not have.

**The cost, stated plainly.** This is a second implementation of the data layer,
and it *will* drift. Specifically it cannot tell you anything about:

| Not tested by the mock | Where it is actually tested |
|---|---|
| RLS — there are no policies; everything is permitted | `npm run seed`'s 15 assertions |
| Realtime — events are emitted synchronously in one tab | G1's two-browser check |
| Constraints, triggers, cascades | the migrations, and the seed's thread probe |
| Signed URLs and bucket privacy | the seed's `private` assertion |

**So a green mock run never means a feature ships.** It means the wiring above
the client boundary is sound.

**Why it mocks at the client boundary.** Faking `supabase` itself leaves every
component, hook and query above it untouched, so there is exactly one
implementation of the product and the mock is a harness rather than a fork. The
cast in `src/lib/supabase.ts` is a deliberate lie confined to one line: the mock
implements the subset of the client enumerated from the real call sites, so
anything new the app calls fails loudly in mock mode rather than silently
misbehaving.

**Two behaviours are reproduced on purpose**, because their absence would let
the mock fake a state the database forbids: the unique `(name, kind)` channel
index returns a `23505`, and thread targets are flattened to their root the way
`flatten_thread_root` does (DECISIONS #8). `src/test/supabase-mock.test.ts`
covers both, plus the query builder and subscription scoping — the mock is
hand-written infrastructure, and a mock that quietly misbehaves sends you
hunting for an app bug that is really a harness bug.

**Remove it if it starts costing more than it saves.** The moment someone
debugs a difference between mock and real, `supabase start` is the better tool.

---

## #13 — 2026-08-10 — Guest access reverted; supersedes #10

**Supersedes #10 entirely.** The workspace is closed again. Non-negotiable 2
holds with no exceptions: one blanket `to authenticated` policy per table, and
`anon` gets nothing.

**Why.** #10 opened the workspace so Ethan could test without logging in. The
in-memory mock backend (#12) turned out to serve that need better — it needs no
account at all, works offline, and exposes nothing — so the tradeoff #10 accepted
had no remaining upside. Ethan's words: *"dont need guest mode because local mode
works."*

**How.** `20260810093222_revert_guest_access.sql` drops the six `to anon`
policies, applied as a new migration rather than by editing #10's (Non-negotiable
6). The client plumbing — `VITE_GUEST_MODE`, `isGuest`, the shared Guest profile
lookup, the sidebar banner, the seed's inverted probes — is removed rather than
left dormant, so there is no switch to flip back on by accident.

**`authorId` survives** on the auth context. It came in with guest mode, but it
is the right shape regardless: one place that answers "whose id goes on rows this
user creates", rather than every writer reaching into `session.user.id`.

**Verified.** `npm run seed` reports `anon select: denied`, `anon insert:
denied`, `anon upload: denied` against production, and the signed-in and storage
assertions still pass — 15/15.

**The exposure window.** The policies were live from 2026-08-10 while the flag
was only ever set in `.env.local`, never in Cloudflare Pages. The deployed site
therefore always required a magic link, and no anonymous session ever reached
production data through the app. The database would have permitted it to anyone
who found the anon key, which is why this was worth reverting rather than
leaving.

---

## #14 — 2026-08-10 — Accounts: invite-code registration, username + password sign-in

**Supersedes the Auth row of the locked stack** in `CLAUDE.md` and all of
SPEC §5. Magic-link sign-in is gone. `CLAUDE.md` and `SPEC.md` are updated in
the same commit (Non-negotiable 4).

**Decision.** Registration is gated by a **shared invite code**, checked inside a
Supabase Edge Function that creates the account with the admin API. Sign-in is
**username + password**. Usernames are unique case-insensitively and are also
the @mention key. Profiles gain `username`, and people can edit their username,
display name and avatar.

**Why an Edge Function, and not a code checked in the browser.** The anon key
ships in the bundle and GoTrue's `signUp` is a public endpoint. A client-side
invite code stops nobody: you call the API directly and skip the UI. So the
check has to run where it cannot be skipped, holding the code as a secret the
bundle never sees. Project-level signups stay **disabled** — that setting is
what makes the Edge Function the only door, and `scripts/seed.ts` asserts it is
still off on every run. `service_role` is unchanged by this: a function secret
is neither client code nor the repo (Non-negotiable 2 and 9).

**`email_for_username` is callable by `anon`, deliberately.** Supabase
authenticates on email + password and the user types a username, so something
reachable without a session must map one to the other. It is one `security
definer` function returning one scalar column — `anon` still cannot read
`profiles` or `auth.users`.

The cost is larger than "it reveals an email", and is stated here in full: it is
an **account-existence oracle**. An unauthenticated caller can confirm which
usernames are real and collect the matching addresses, which also undoes
GoTrue's deliberate refusal to distinguish unknown-email from wrong-password. It
is inherent to username sign-in, not to this implementation. The alternative —
making the auth email synthetic (`user@users.threadline.invalid`) — exposes
nothing but breaks password-reset delivery for everybody, turning every
forgotten password into a manual dashboard job. For a 5–30 person internal tool
behind an invite code, the oracle is the cheaper failure. Ethan chose this after
being shown both.

**Registration auto-confirms the email.** Supabase's built-in SMTP allows only a
few messages an hour, and onboarding is exactly when everybody registers at
once. The invite code is already the access gate, so confirmation would be
gating something already gated. Cost: a typo'd address can never receive a
password reset, and Ethan fixes it in the dashboard.

**Anyone can rename anyone.** The blanket policy on `profiles` (Non-negotiable 2)
now governs a *sign-in identifier* — any authenticated teammate can UPDATE
another teammate's username. That is the rule working as specified in a trusted
workspace, and it must **not** be "fixed" with an ownership policy; `CLAUDE.md`
warns against exactly that. Noted because it looks alarming and is not.

**Verification.** `scripts/seed.ts` gained `accountsCheck`, which asserts the
things this migration claims and the UI cannot prove: `email_for_username`
resolves through a **signed-out** client and is case-insensitive on input, an
unknown username returns null rather than a neighbouring row, the unique index
rejects a duplicate, the format CHECK rejects a malformed name, `handle_new_user`
carries a chosen username and display name through from `raw_user_meta_data`,
colliding email local parts become `name` and `name-2`, and **public signup is
refused with `signup_disabled`**. That last one is the one that matters: without
it the Edge Function is decoration.

**A note on the case-insensitive index.** `profiles_username_lower_key` indexes
`lower(username)`, but the format CHECK only permits `[a-z0-9._-]` — so no
upper-cased username can be stored in the first place, and a plain unique index
would do the same job today. The `lower()` is defensive: it keeps the invariant
if the CHECK is ever relaxed, and it matches how sign-in looks names up. The
seed probe therefore collides on the exact stored value, because an upper-cased
one is refused by the CHECK (23514) before the index is ever consulted — a first
draft asserted 23505 there and could never have passed.

**The username rule is the *fixed points* of `slugify_username()`.** First and
last character alphanumeric, 3–24 characters. The "last" half was missing from
the first draft and the reviewer caught it: the CHECK permitted a trailing `.`,
`-` or `_` while `slugify_username()` strips them, and the two write paths then
disagreed about the same typed name. Registering `bob.` stored `bob` — an
account its owner could not sign into, because `email_for_username()` resolves
the stored name and not the typed one — while `/settings`, which updates the
column directly, would have stored `bob.` verbatim. Worse, a name whose slug
fell under three characters (`a._`) was discarded entirely and replaced with one
derived from the email. `20260810131038_tighten_username_format.sql` closes it,
as a new migration rather than an edit. `format trail` in the seed is the
regression test.

**Verified end to end on 2026-08-10**, against the live project, through the
anon client with no session — what a browser actually does. Ten assertions, all
passing: a wrong invite code is refused (403), the right one creates the account
(200) with the chosen username *and* display name on the profile, a repeat
username is refused (409), a trailing-dot username is refused by the function
rather than silently slugged (400), sign-in by username resolves and succeeds,
that session reads the workspace, a wrong password fails, and the pre-existing
magic-link-era account signs in with a newly set password. Probe accounts were
deleted afterwards.

**Known limits, accepted.**
- The invite code is short and human-shareable (Ethan's call: it exists to keep
  strangers out, not to protect anything by itself). That makes the
  no-rate-limiting note below matter more than it would for a random 32-char
  string. Rotating it is one `secrets set`, and the value never enters the repo.
- No rate limiting of our own on the register function beyond the platform's.
- The username format rule lives in three places — `slugify_username()` plus the
  CHECK constraint in the database, the client, and a re-check in the Edge
  Function. The database is the wall; the other two exist for instant errors. A
  single `.sql`-sourced rule is not worth the machinery at this size, but the
  bug above is exactly what divergence costs, so they must be changed together.
- Edge Functions are type-checked by neither `tsc -b` (the tsconfigs cover `src`
  and `scripts` only) nor eslint (which now ignores `supabase/functions`,
  because linting Deno globals and `jsr:` specifiers with the browser config
  reports the runtime as errors). Their correctness rests on review and on the
  live probes recorded above.
- A dashboard invite whose email local part collides with an existing username
  gets a numeric suffix; a username *chosen at registration* that collides
  raises instead. Different on purpose — see the migration's comment.

---

## #15 — 2026-08-10 — Mentions are plain `@username`, and the bell rows are written client-side

**Decision.** `@mentions` resolve on `profiles.username`. They are stored as
plain `@username` inside `messages.body` — no `<@uuid>` markup — and the
`notifications` rows they produce are inserted by the **sender's client**, not by
a database trigger.

**Why username and not display name.** Usernames are unique; display names are
not (SPEC §2.3). A mention of "Ethan" in a team with two of them has no correct
answer. This is the reason the account system (#14) had to land first: an earlier
draft of `mentions.ts` matched on `display_name` and was deleted rather than
shipped, because it could only ever have guessed.

**Why plain text and not markup.** The body stays readable everywhere our own
components are not doing the rendering — a notification snippet, a `ts_headline`
search result, a psql query. `search_tsv` indexes words instead of uuids
(SPEC §3). And P2 seeds a task title straight from a message body, which would
otherwise mean stripping markup first.

The cost: renaming a teammate breaks older mentions of them. The text still reads
`@ethan`, it just stops highlighting. At 5–30 people whose usernames come from
their email local part, renames are rare and the failure is cosmetic — a better
trade than uuids in the body.

**Why the client writes the rows.** A trigger would have to re-parse `@names` in
SQL against `profiles`: the same rule in a second language, kept in sync by hope.
`parseMentions` and `splitMentions` already share one matcher precisely so that
what is highlighted and who is notified cannot disagree; adding a third
implementation in plpgsql would undo that. The blanket policy already permits the
insert.

**The one genuinely unusual RLS property.** `notifications` is the only table
where a normal write targets **another user's** row — the sender inserts a row
addressed to the person they mentioned. Non-negotiable 2's blanket policy allows
this; a policy scoped `user_id = auth.uid()` would break mentions entirely while
every other check still passed. `notificationsCheck` in `scripts/seed.ts` asserts
it directly, signed in as user A and inserting for user B.

**A probe that proved nothing, and now does.** The signed-out `anon notifs` check
first read an empty table, so it returned `[]` and passed under *any* policy —
including none. Zero rows meant "empty", not "denied". It now plants a row with
the admin client, reads it back signed-out, and removes it. Caught by the
reviewer; it is the same hollow-verification failure #5 was written to close, and
it reappeared the moment a probe ran against a table the seed does not populate.
**Any future signed-out probe must guarantee the row it expects not to see.**

**Known limits, accepted.**
- A reply notification is skipped when the thread root is not in the loaded page.
  Unreachable from the composer — a root must be rendered to be repliable — but
  reachable if the channel is switched while the insert is in flight. One lost
  bell in that window beats a query on every reply.
- `splitMentions` bounds its longest-match scan at `USERNAME_MAX`. Without that
  cap a legal message — an `@` followed by ten thousand dots — costs ~10^8
  character operations on every render.
- Rendering shows `@display_name` while the body stores `@username`, so two
  teammates with the same display name render identically and P5's search
  snippets will show the stored form instead. A product call, revisit if it bites.
- No UPDATE probe on `notifications` yet; `read_at` is the bell's only write and
  it lands with the bell UI.

---

## #16 — 2026-08-10 — The bell is pulled forward to P1, and it fires OS notifications

**Two deviations from settled files, both Ethan's call, both recorded here because
the code was written before this entry was — which Non-negotiable 4 forbids and
the reviewer caught.**

### The bell moves from P5 to P1

`ROADMAP.md` P5 owned "In-app notification bell — mentions, assignments, replies
— with mark-read". It ships in P1 instead, alongside the mentions that write its
rows. `ROADMAP.md` and `SPEC.md` §2.3 are updated to match.

**Why.** Rows nobody can read are a feature that does nothing, and G1 cannot
check "a mention reaches the other person" without a surface that shows it. The
alternative was writing the mention path in P1 and revisiting the same function
in P5. Same argument as DECISIONS #8's pull-forward of the thread trigger.

`assignment` notifications still wait for P2's `tasks` table, so P5 keeps that
slice plus the search box.

### OS notifications, against an explicit non-goal

`BACKLOG.md` lists "Email digests, push notifications" as a hard v1 non-goal, and
SPEC §1.9 said "In-app bell only". A browser `Notification` now fires **when the
tab is hidden**, in place of the in-app toast.

**Ethan asked for it directly** when choosing how a mention should behave, having
been shown that it deviates from the non-goal. That is his call, and this entry
is what makes it a decision rather than drift. An earlier version of this feature
argued the point in a code comment instead — re-litigating a settled decision
from memory, exactly what Non-negotiable 4 exists to stop.

**What it is, precisely, so nobody mistakes it for push.** It is the
`Notification` API, fired by the running page. It requires the tab to be **open**;
backgrounded is fine, closed delivers nothing. There is no service worker and no
push service, so there is no server → device path. Real push — the thing the
non-goal names — would need both, and stays out.

**Consequences.**
- Permission is requested only from a real click, offered only while
  `Notification.permission === 'default'`. A browser rejects a request without a
  gesture, and `denied` cannot be re-prompted.
- Exactly one surface per arrival: hidden tab → OS notification, visible tab →
  in-app toast. Never both.
- The announcement waits for the target message to load, so the notification body
  is the message text and not an empty string.

**Reverting is small** if it proves annoying: delete the `document.hidden` branch
and `DesktopPermission` from `NotificationBell.tsx`. The toast is then the only
surface and nothing else changes.

---

## #17 — 2026-08-10 — Jump-to-message: two failures, and the invariant that ends them

**Written because Non-negotiable 6 fired** — the same bug shipped wrong twice —
and because the reasoning had been put in code comments instead. #16 criticised
exactly that, and then it happened again: comments in `ChannelView.tsx` did not
stop attempt two from re-breaking it, because a fresh session reads this file,
not an effect's docblock.

**The feature.** Clicking a notification navigates to
`/channels/:channelId?m=<messageId>`, and the channel view scrolls to that
message and flashes it.

**Attempt 1 — the reply case.** The effect looked the message up with
`getElementById` and bailed if it was missing. But a reply is only rendered
inside an **expanded thread**, so every `reply` notification — and every mention
written inside a reply — pointed at an element that did not exist. Worse, the
bail happened before the parameter was cleared, so `?m=` stayed in the URL and
the effect re-fired on every subsequent message.

**Attempt 2 — the cross-channel case, which was worse.** The fix cleared the
parameter unconditionally. But `/channels/:channelId` renders the same element
for every id, so navigating **between** channels re-renders without remounting:
for one commit `channelId` is already the new channel while `messages` still
holds the old channel's rows and `loading` is still `false`. The parameter was
therefore consumed before the target could possibly exist. The previous bug at
least retried; this one threw the jump away silently, and it broke the *common*
path — a notification almost always points at another channel.

**Why an effect could not get this right.** Both failures are the same mistake:
treating "not in `messages`" as "absent" when it can also mean "not here yet".
An effect cannot tell those apart, because nothing in its inputs says which
channel the rows in hand came from.

**The fix — say which page you are holding.** `useMessages` now exposes
**`loadedChannelId`**: the channel whose page is actually in `messages`. It is
cleared to `undefined` the instant the channel changes and set only inside the
load's `.then()`, after the rows land and behind the `active` guard. So it can
never label the previous channel's page as the current one.

`src/lib/jump.ts`'s `resolveJump()` then makes the decision as pure, tested code
returning `idle | wait | miss | hit`, and **the invariant is: only `hit` and
`miss` may clear `?m=`.** `wait` must preserve it. A third attempt that
reintroduces either bug has to violate that sentence to do it.

`hit` also carries `openThread`, the root to expand when the target is a reply —
attempt 1's failure, encoded in the return type rather than remembered.

**Known limits, accepted.**
- If the channel's page **fails to load**, `loadedChannelId` stays `undefined`,
  `resolveJump` answers `wait` forever and the parameter never clears. No loop,
  the error banner shows, and navigating away clears it. Degraded and visible,
  which is the right failure for a jump.
- Still bounded by the loaded page: a message older than the first page is a
  `miss`. Pagination is a later P1 item, and the durable answer is BACKLOG's
  deep-linkable thread pages — which P2's create-task-from-message jump needs
  anyway.
- **`loadedChannelId`'s own lifecycle is not covered by a test.** There is no
  React test harness in the project, so deleting the clear-on-switch line would
  reintroduce the regression with all of `jump.test.ts` still green. The pure
  decision is pinned; the wiring around it is not. Stated so it is a known gap
  rather than a false sense of coverage.

---

## #18 — 2026-08-10 — Unread counting moves into SQL

**Decision.** `public.unread_counts()` returns every channel's unread count for
the caller. `unreadCount()` and `hasUnread()` are **deleted** from
`src/lib/unread.ts`, along with their unit tests; the coverage moves to
`scripts/seed.ts`, which now asserts SPEC §1.4 clause by clause against the live
function. `nextLastReadMessageId()` and `unreadBadge()` stay — they are about
the pointer and the rendering, not the count.

**What was wrong, and why it could not be patched.** The first implementation
counted in the browser, reusing the tested `unreadCount()`. A client can only
count messages it has fetched, so it needs a window, and the window was anchored
at the **oldest read-pointer across all channels**. One channel you never open
holds that anchor near the start of the table forever — so the window fills with
ancient rows, and **every badge reads 0 while unread messages sit in plain
sight**. Reversing the anchor to newest-first fixes that case and breaks the
mirror image. There is no correct single anchor; the shape was wrong.

Counting where the rows are removes the anchor, the window, and the whole class
of bug. It is one indexed `group by` over `messages (channel_id, id)`, run once
per load and once per debounced burst of realtime traffic.

**A LEFT JOIN, deliberately.** A channel created after you joined has no
`channel_members` row at all. An INNER JOIN would omit it, so a brand-new
channel full of messages would show no badge. Missing row and null pointer both
mean "nothing read here".

**`security invoker`, deliberately.** It must run as the caller so `auth.uid()`
is *them*. A `security definer` here would report one person's unread counts to
everybody — a data leak dressed as a badge. The seed proves the difference by
asking as both seed users and requiring **different** answers for the same
channel; equal answers would pass under a function that ignored the caller.

**The cost: the rule is now stated twice.** Once in SQL, once in
`supabase-mock.ts` so offline mode has badges at all. That is the duplication
DECISIONS #15 refused for mentions, taken here because the alternative is no
badges offline, and because a silently-zero badge is precisely the failure being
fixed. Both copies are covered — the SQL by `npm run seed`, the mock by
`src/test/supabase-mock.test.ts` — and they must change together.

**A never-break path moved, not lost.** ROADMAP listed "Unread-count
calculation" as a P0 unit test. It is now a seed assertion against the real
function, which is strictly better evidence: it runs through the anon client,
under RLS, against the thing that actually computes the number.

**Caught in review**, before it reached production. Nothing in `tsc`, eslint,
220 unit tests or a 31/31 seed run would have found it, because every one of
those exercised either the pure helper or the write path — never the count as
the user sees it. A freshly seeded workspace is too small to show the bug, so
G1 would have passed too.

**Two follow-on bugs, both found by the same reviewer, both worth recording.**

*The debounces raced.* The refetch fired at 400ms and the pointer write at
800ms, so the count was computed from a pointer that had not moved yet and
overwrote the optimistic zero — permanently, because nothing re-runs a refresh
when `channel_members` changes. `refresh()` now `await flush()` first, making
the ordering explicit rather than emergent, and `reconcileUnread()` pins any
channel whose write is still queued during the round trip. That function is
pure and tested, which also gives this feature its first check that reaches the
provider at all.

*`revoke ... from public` did not revoke `anon`.* Supabase's default privileges
grant EXECUTE on new `public` functions to `anon` explicitly, and revoking from
`PUBLIC` leaves an explicit role grant untouched. `unread_counts` was therefore
callable by a signed-out client — harmless only because `security invoker` plus
RLS returned it nothing, which is obscurity rather than access control, and this
project has had `to anon` policies before (#10). Fixed by
`20260810170411_revoke_unread_counts_from_anon.sql`.

**The generalisable lesson, and the reason it got through:** the signed-out
probe judged the call on *rows returned*. RLS makes nearly everything look empty
to `anon`, so an empty result proves nothing about a grant — the probe printed
PASS against a function `anon` could execute happily. **A signed-out probe of a
function must assert refusal, never emptiness.** #5 and #15 each said a version
of this about tables; it is now said about functions too, having been learned a
third time.

---

## #19 — 2026-08-11 — Resync drains; and what verifies the parts no harness reaches

**Decision.** `resync()` walks forward page by page until it is caught up
(`RESYNC_LIMIT` 200, `MAX_RESYNC_PAGES` 10) rather than taking one capped page,
and it runs only once the channel's first page has landed. The stuck-bubble
sweep is split into a pure `sweepQuery()` and the existing
`reconcilePendingForChannel()`, and runs on **join** as well as on reconnect.

**Why draining, not one page.** A single capped query leaves a hole in the
middle that nothing can ever fill. `loadOlder` only walks *backwards* from the
oldest row held, and one live INSERT after a truncated resync moves the forward
cursor past the gap permanently — so the missed messages become unreachable for
the session. SPEC §1.5 says missing an event is never data loss; the capped
version quietly made it data loss above 200.

**Why the guard is `loadedChannelId`, not `cursor === 0`.** The first draft
bailed when the cursor was 0, which is true both while the first page is in
flight *and* for a channel that is legitimately empty. In an empty channel that
disabled reconnect entirely — and since an empty first page also sets
`hasMore = false`, there was no scrollback path either, so messages inserted
during a disconnect were unreachable until a reload. That is exactly G1's
"network killed 30s then restored". Caught in review.

**The sweep includes `failed` entries.** A send can error *after* its row
committed — `reconcilePending` has always handled that — so filtering to
`sending` meant Retry would send a duplicate.

### What is actually verified, and what is not

This matters more than usual here, because most of this feature lives in a hook
and **the project has no React test harness** (recorded in #17). Being precise
rather than implying more coverage than exists:

**Pure and unit-tested.** `pageQuery` / `resyncQuery` / `highestMessageId` /
`oldestMessageId` / `hasMorePages` / `mergeMessages` (P0), plus `sweepQuery` and
`reconcilePendingForChannel` — the sweep's decision and its reconciliation.

**Proved live against the database**, run from a throwaway channel and removed.
Recorded here because a probe that leaves no trace is not evidence:

```
120-message pagination        450-row hole, drained
  page sizes  50/50/20          drains fully   450 of 450
  no overlap  120 distinct      no duplicates  450 distinct
  newest first                  no gap         strictly ascending across pages
  end detected                  terminates     3 pages at 200/page
  resync window exact           never re-reads the cursor
  resync no-op                  beats one page 450 > 200
```

**Not covered by anything automated:** the `await` that joins `sweepQuery` to
`reconcilePendingForChannel`, the `SUBSCRIBED`-vs-reconnect branch, and the
scroll-anchor restore. Their manual check, for G1:

1. Two browsers in the same channel. In A, throttle to offline, have B send
   three messages, restore A. A shows all three without a reload.
2. Repeat with B sending **250+** messages while A is offline. A ends up with
   all of them and no gap in the middle — the case the single query failed.
3. In A, send a message and immediately click another channel. Have B send 60
   messages in the first channel. Return to it: the "sending" bubble is gone,
   not stuck, and the message appears exactly once.
4. Scroll to the top of a channel with 100+ messages. Older messages load and
   **the message under the cursor stays put** — no jump. Repeat while B is
   actively sending, which is the case that steals the anchor.

Item 4's second half is a known weakness: any arriving message consumes the
scroll anchor, so a page landing right after one still jumps. Narrow, cosmetic,
self-corrects on the next scroll — parked rather than fixed, because the fix is
a per-request anchor and this is the last item before the G1 gate.

---

## #20 — 2026-08-18 — G1 gate prep: the resync latch, a cold-start trap, and two things left alone

The P1 gate ran green on the machine side — build, lint, 233 tests, and a full
`npm run seed` (38/38 probes) against the live project — and the reviewer
subagent passed the whole phase diff. Three things came out of it worth
recording, because two of them are traps that will otherwise be rediscovered.

### The `resyncing` latch is now `try/finally`

`resync()` set its re-entrancy latch and cleared it on each of three exit
paths. All three were correct, so this was never a live bug. But the failure
mode if one were ever missed is the worst kind: a throw inside `absorb` or
`sweepPending` latches `resyncing.current` at `true` and that channel silently
stops resyncing on every later reconnect, `online` and tab focus — no error, no
UI, until the user happens to switch channels. `UnreadProvider` already guards
the identical latch with `finally` (`src/lib/unread-provider.tsx:130-161`), so
this is now consistent rather than novel.

Reviewed fresh and PASSed against the specific risk that a `break` had become a
`return`: that would skip `await sweepPending()` and reintroduce the stuck
"sending" bubble #19 exists to fix. Both `break`s survived.

The reviewer also noted a pre-existing race this diff neither creates nor
worsens: an abandoned drain for channel A clears a latch now owned by a resync
for channel B, permitting one redundant concurrent drain. `mergeMessages`
dedupes it. Left alone deliberately.

### A just-resumed Supabase project does not do realtime for a while

A paused project that has been resumed answers REST and auth almost at once,
but replication takes appreciably longer. The symptom is precisely the one that
reads as a broken build: the page loads, sign-in works, messages send and
persist — and nothing arrives in the second browser.

A probe replicating `useMessages`'s exact subscription (`messages:<id>` topic,
`event: '*'`, `channel_id=eq.<uuid>` filter, no explicit `setAuth`) timed out at
20 s and then passed comfortably at 45 s minutes later, delivering both INSERT
and UPDATE. Nothing in the app was wrong. **Before debugging silent realtime,
confirm the project has been warm for a few minutes.**

### `VITE_MOCK_BACKEND=true` makes every bundle measurement a lie

With the mock flag on, Vite statically folds `MOCK_BACKEND` to `true`,
`createClient` becomes unreachable and **supabase-js is tree-shaken out
entirely**: 411 kB. The same commit built with the flag `false` is 631 kB /
186 kB gzip. Production was never affected — Cloudflare builds from GitHub and
never sees `.env.local` — but a bundle figure from a mock build means nothing.

### Two things deliberately not fixed

**The 631 kB bundle stays over Vite's 500 kB warning line, and the warning stays
un-silenced.** The mock is only ~2–3% of it (and cannot tree-shake anyway — it
has a module-level `const db = load()`); the weight is React, supabase-js,
Radix and cmdk, which is ordinary. At 186 kB gzip for 5–30 internal users this
is not a real problem, and raising `chunkSizeWarningLimit` now would blind us
in P4 exactly when BlockNote lands and the number starts to matter. Parked in
BACKLOG.

**The leftover `guest` auth user is not deleted yet.** DECISIONS #13 dropped the
`anon` policies but left the account, which still has a password and can sign
in. It owns nothing — 0 messages, notifications, channels and memberships — so
removing it cascades nothing. Claude was blocked from running the delete by the
permission classifier, correctly: it is irreversible and touches production
auth. Ethan runs it.

---

## #21 — 2026-08-18 — Workflow rewrite: batch sessions, bulk verification, two human touchpoints

**Decision.** Ethan retired the one-item-one-verify loop. From now on:

- **A session takes a batch** — by default everything left in the current
  phase — instead of a single ROADMAP item with context clears between tasks.
- **Verification is bulked at batch end.** Items are committed mid-batch on a
  smoke check only (typecheck, or one cheap targeted test); the full battery —
  build, lint, full tests, `npm run seed`, scripted live probes, and **one**
  reviewer-subagent run over the whole batch diff — runs once, at the gate.
- **Human interaction compresses to two points per phase**: one plan approval
  at session start (only when the batch touches schema/auth/realtime — one
  plan covers every item in it), and one consolidated checklist at phase end.
  Mid-session asks are queued onto that checklist, never blocking; anything
  Claude can reach with existing access (MCP, CLI, service key locally),
  Claude does.
- **The user checklist no longer blocks the next phase.** Machine gate PASS
  starts the next phase immediately; whatever the checklist later surfaces is
  a priority-one bug, fixed before new features.

**Kept, deliberately.** Migrations are still reviewed *before* every
`db push` — an applied migration cannot be edited (Non-negotiable 6), so it is
the one artifact that never waits for the batch. Still blocking on the human:
TEAM BETA entry at G2 (inviting the team is inherently Ethan's) and the G6
ship checks. Commit-per-item, conventional messages, the two-failed-attempts
revert rule, and per-item ROADMAP ticks all survive unchanged.

**Why.** Thirteen days to ship. The old loop's costs had become the dominant
ones: per-item verification re-ran the same battery many times a phase;
per-diff reviewer runs re-read overlapping context; context clears threw away
a warm working set every task or two; and gates parked all machine work on a
human checklist the human ran days later — G1's checklist sat idle while P2
was forbidden to start. The failure the old loop guarded against (a bad item
buried under later work) is covered more cheaply by commit-per-item, which
keeps bisect and revert one command each.

**Accepted risks, named.** Bulk verification finds an early-batch bug late,
with more code on top — mitigated by commit-per-item and the revert rule. An
async human gate means a phase can build on something the checklist would
have caught — mitigated by preferring scripted probes over manual steps for
everything machine-checkable (realtime delivery, resync, RLS), and by
checklist findings outranking new features.

**Immediate effect.** G1's machine-side PASS (ROADMAP, 2026-08-18) unblocks
P2 by itself; Ethan's three G1 items stay open as async. Rewritten in this
commit: CLAUDE.md rules 5 and 7 and the workflow loop, ROADMAP's header and
G1 note, `.claude/commands/gate.md`, `.claude/commands/resume.md`.

---

## #22 — 2026-08-18 — FORGE audit: 4 skills vendored, 18 rejected

**Decision.** Ethan supplied `forge.zip` — three Claude Code skill packs
(webforge / appforge / ccforge, 36 skills) — with "build using this". A
six-agent audit read every SKILL.md and reference against CLAUDE.md before
anything was installed. Verdict: vendor **webforge-noslop, webforge-ui,
webforge-explain, webforge-perf** under the established pattern
(`.agents/skills/` committed, junctions into `.claude/skills/`, hashes pinned
in `skills-lock.json`); reject the other eighteen. The bundle's scripts
(install.sh, scan_skills.sh, canary-hook.sh, validate.py) were read line by
line first — all clean, none are run or registered.

**Why those four.** They are advisory craft, not machinery, and they pull in
the direction this project already faces: noslop's terse UI copy matches the
standing no-explanatory-UI-copy rule; ui's interaction-state and a11y
checklists (keyboard alternative for drag-only interactions, hover gating,
the three distinct empty states, disable-double-submit) are directly load-
bearing for P2's kanban; explain's not-done/not-verified reporting shape
matches rule 5; perf's no-work-without-a-before-number gate matches rule 10.

**Why the eighteen died.** Three failure classes, with receipts:
- **Wrong stack.** webforge-scaffold/-server/-ship/-verify and the
  orchestrator's stack defaults are Next.js-first (App Router scaffolds,
  `NEXT_PUBLIC_*` rules, Server Actions auth advice) and their gates mandate
  Playwright/axe/size-limit/Lighthouse — all forbidden additions under
  Non-negotiable 3. appforge is mobile/desktop (non-goals).
- **Competing machinery.** The orchestrator/loop/skillmap trio runs its own
  FRAME→DELIVER lifecycle, its own defect ledger and DECISIONS.md/TODO.md
  under `.claude/webforge-loop/`, and its own gate definitions — a second
  workflow sitting beside CLAUDE.md's loop and `/gate`, splitting the record.
  webforge-taste mandates the exact make-it-feel-better iteration
  Non-negotiable 10 bans, and brands our deliberate shadcn defaults a defect.
- **Behavior takeover.** The packs carry a standing rule to end every reply
  with a `[skills: …]` receipt line, an instruction to append their routing
  file to `~/.claude/CLAUDE.md` (self-propagating config), directives to hide
  process from the user ("ship the artifact, not the machinery" — the inverse
  of rule 5), a forced pre-work skill chain, and ccforge-wire's hook/settings
  wiring. None of that runs here. CLAUDE.md's skills section now carries the
  standing overrides (conflict entry 3), including: never emit the receipt
  line.

**What was kept from the rejects anyway.** Their genuinely good one-liners
were folded into the P2 build notes without installing anything: pre-register
test assertions before implementing; attack the data path before the visual
layer; never weaken a test in the change that turns its gate green; a
gate-defining file changing in the same diff that flips the gate is a
BLOCKER; eslint exit 2 means the gate is broken, not the code; idempotency
guard on create-task-from-message double-submit.

**Cost.** ~650k subagent tokens for the audit + code-map workflows. The four
vendored skills auto-trigger from their descriptions; if their advice ever
fights CLAUDE.md, CLAUDE.md wins (skills section, standing rule).

---

## #23 — 2026-08-18 — P2 build: jump paging pulled forward, and the plain-text rich column

**Jump paging left BACKLOG early.** The deep-link entry ("`?m=` should page
backwards hunting for its target") was parked in P1 because notifications
point at *recent* messages, which the newest-50 page almost always holds. A
task's "from #channel" chip inverts that: its source message is usually old,
so without paging the chip lands you in the channel with no scroll — and G2's
acceptance line literally reads "jumps to the exact message". `resolveJump`
gained a fourth outcome, `page` (target id below the loaded page while
`hasMore`), and ChannelView pulls scrollback pages until the target appears,
capped at `JUMP_HUNT_PAGES = 10` (~500 messages) per parameter so a deleted
ancient message cannot make a chip click download a whole channel. On
exhaustion it degrades to exactly the old behavior: land in the channel,
drop the parameter. Four new resolveJump tests pin all of it.

**`description_rich` holds BlockNote-shaped paragraphs today.** P2's form is
a plain textarea (the ui kit has no editor until P4), but it writes
`[{type:'paragraph',content:[{type:'text',text,styles:{}}]}]` blocks via
`richFromPlain`, not a bare string — so P4's BlockNote loads the same column
with zero migration and zero conversion pass. `plainFromRich` reads it back
and tolerates foreign values. Empty text stores SQL `null`, not `[]`.

**Two shapes deliberately not built.** No tasks realtime (SPEC §4 is explicit;
the board refetches) and no toast on task creation — the dialog closing is the
confirmation, and NotificationBell owns the only toast stack in the app;
a second fixed stack would overlap it. If a shared toast is ever wanted,
extract the bell's, don't add a library.

---

## #24 — 2026-08-18 — What the 25-agent adversarial review caught, and the fixes

Five lens finders over the whole P2 diff, every finding judged by two
independent refuters (refuted-by-default). Seven unique findings survived,
one was killed. All seven were real; all seven are fixed in the same commit
as this entry. The two worth remembering:

- **A dialog status change kept the card's old `position`.** Every column's
  first card sits at 1024, so the non-drag path minted same-column ties —
  order then differed *between refreshes* (Postgres tie order is
  unspecified), and a later drop onto a tied card computed
  `positionBetween(1024, 1024) = 1024`: a third tie, with the dropped card
  visibly not landing where it was dropped. `patchFromFields` now takes the
  destination-column append position and writes it with every status
  transition. The G2 drag script would have passed anyway — which is exactly
  why the property "order holds across refresh" needed a hostile reader, not
  a demo.
- **The jump hunt's page budget burned on no-ops.** The effect re-runs on
  every arriving realtime message; `loadOlder` answers mid-flight calls with
  'busy', and each one decremented the 10-page cap — so in an active channel
  a chip jump gave up early, and in the worst case consumed `?m=` while the
  page containing the target was still in flight. The budget now decrements
  only on non-'busy' results, and an exhausted hunt waits for the in-flight
  page before consuming the parameter.

The other five: task deletion left `links` edges dangling forever (SPEC §1.8
says integrity is app-enforced — now both directions are deleted first);
overdue styling compared the local due date against the *UTC* day (red at
5pm PDT on the due date itself); the hover bar's `display:none` reveal made
create-task-from-message unreachable by keyboard on plain messages (now an
opacity reveal, so the buttons stay tabbable); dnd-kit's spread
`attributes` made every card a second, dead tab stop whose screen-reader
text promised a space-bar drag no sensor implements (listeners only now);
and the seed's bad-status probe leaked its row on the exact failure path it
probes for, with no pre-clean sweep for interrupted runs (both added).

The one refuted finding — SourceChip's link nested in a button — was killed
on the ARIA spec itself: focusable descendants survive presentational-role
flattening, so the chip stays a working link everywhere it renders. The
nesting is an HTML-validity wart, not a behavior defect; noted here so a
future session doesn't re-litigate it.

---

## #25 — 2026-08-22 — P3 build: flat post URLs, the parent parameterization, and what the batch review caught

**Post URLs are flat — `/posts/:postId`, not nested under the forum.** The
two places that link to a post — the task SourceChip and the notification
bell — know only a post id; a nested URL would force each to resolve the
forum first (the bell from inside a click handler). The post row carries
`channel_id` for the breadcrumb back. `/forums/:channelId` remains the post
list, and kind guards redirect `/channels/<forum>` ↔ `/forums/<chat>` so the
URL spaces stay honest.

**Comments reuse chat wholesale via a `MessageParent` parameterization.**
`useMessages`, `pending.ts` and `resolveJump` now key on
`{column: 'channel_id' | 'post_id', id}` instead of a channel id — carrying
the *column name* keeps every query site to one `.eq(parent.column,
parent.id)` with no mapping step to get wrong. Two rules a future session
must not break:
- **The hook depends on the parent's primitives, never the object.** Callers
  build `channelParent(id)` inline per render; an object in a dependency
  array would tear down and resubscribe the realtime channel every render —
  precisely the budget Non-negotiable 8 protects. The reviewer verified all
  six dependency arrays.
- **DECISIONS #8's property survives**: every comment send path passes
  `threadRootFor(root)`, so the trigger never rewrites `thread_root_id` on a
  row the client is waiting to reconcile. `pending.test.ts` now pins both
  parent directions.

No P3 realtime additions: comments ride the messages publication, whose
column list has carried `post_id` since P0 (#4). A scripted live probe
(PostView's exact topic and `post_id=eq.` filter, anon client with a real
session) delivered both INSERT and UPDATE — after first timing out on a cold
project and passing on retry, which is #20's warm-up trap reconfirmed.

**Tags.** Workspace-global, matched case-insensitively via
`normalizeTagName` (lowercase, whitespace→hyphen, 24-char cap); created on
first use with a color picked deterministically from an 8-hex palette, so
two clients racing to create the same tag also agree on its color and the
loser adopts the winner's row on 23505 (`ensureTags`). Color renders only as
a dot — never text or background — so theme contrast needs no per-color
tuning. The form input is one comma-separated text field; a chip editor is
Non-negotiable 10 territory.

**No forum unread badges in v1.** `channel_members.last_read_message_id` is
per-channel and cannot express per-post unread. Provably harmless the other
way: `unread_counts()` joins `m.channel_id = c.id`, and a comment's
channel_id is NULL, so forum traffic can never pollute chat badges. If Ethan
wants forum unread it is schema work, not a patch.

**FK delete behaviors, including the compound one.** Post cascades (channel
→ posts, post → comments); `tasks.source_post_id` sets null. Deleting a
teammate's account therefore deletes their posts *and everyone's comments on
them* — flagged by the migration reviewer, kept deliberately: chat already
behaves this way (deleting an author cascades their messages, and
`thread_root_id`'s cascade takes other people's replies in their threads
with them). §1.1's removal procedure is rare and forums should not outlive
chat semantics.

**Deletion frees the bytes, and edges die with their endpoints.**
`deletePostRecord` extends #11's promise across the cascade: comment and
post attachments are swept storage-first, then rows, then `links` edges both
directions — for the post *and for its cascading comments*, the second of
which the batch reviewer caught missing (it is #24's dangling-edge defect,
reintroduced by the FK cascade). Channel deletion still leaks attachments —
pre-existing, now BACKLOG'd with a wider blast radius.

**The batch review (Non-negotiable 7), honestly recorded.** First verdict
FAIL with two confirmed findings: the dangling comment edges above, and a
worse one — a task created from a *forum comment* rendered no chip at all
(the source message has `channel_id` NULL, so the P2-era resolution dropped
it; the message→task→jump-back path §1.6 promises was a dead end). Fixed in
`cb533ab`: the source batch carries both parents, comment sources chain
through `posts` to their forum, and `TaskSource` gained a `comment` shape
linking `/posts/:id?m=`. Re-review: PASS, scoping verified exact. Carried
non-blocking: a comment mention's bell label reads "X mentioned you" with no
"in #forum" (navigation correct; the label would cost a post-title fetch).

**Two notes for P5's `posts.search_tsv`.** `body_rich` is nullable, so the
generated expression needs `coalesce` or a body-less post indexes NULL; and
`jsonb_to_tsvector(…, '["string"]')` walks every string value, which
includes BlockNote scaffolding tokens ("paragraph", "text") — decide
filter-or-accept *before* creating the column, since changing a generated
column later rewrites a populated table.

**A tooling trap, so it is not rediscovered.** A PowerShell
`-replace`-and-rewrite of `jump.test.ts` silently re-encoded it (BOM +
mojibake in comments); the reviewer caught it. Source rewrites go through
the editor tools, never `Get-Content | Set-Content`.

---

## #26 — 2026-08-22 — Beta feedback round 1: author-only affordances, and what they are not

Ethan ran the G1 and G2 checklists — **both clear** — and filed five items.
All five shipped the same day; checklist findings outrank features
(DECISIONS #21).

**Author-only edit/delete affordances — UI-level, deliberately.** Ethan:
*"i can edit other ppls messages"* and *"make only op allowed to edit tasks
and posts."* Now: a message's Edit and Delete buttons render only for its
author (Reply and Create task stay for everyone); a post's Edit and Delete
only for its author (commenting stays open); a task's detail fields
(title/assignee/due/description) and Delete lock for everyone but its
creator.

Three boundaries, stated so nobody mistakes the shape:
- **Task status stays open to the whole team**, by drag and by the dialog's
  status buttons alike. "Only OP edits" applied literally to status would
  make the board read-only for everyone else — and the buttons are the
  keyboard path a drag cannot cover (DECISIONS #24). Locking fields but not
  status is the deliberate line.
- **A task whose creator is gone (`created_by` null, the FK's `set null`)
  unlocks for everyone.** The alternative is a task nobody can ever touch.
- **This is affordance, not enforcement.** The database still carries one
  blanket policy per table — Non-negotiable 2 is untouched, and DECISIONS
  #14's "anyone can rename anyone" reasoning still applies. Anyone holding
  the anon key can still write anything via the API. Real per-row
  enforcement means deliberately reversing Non-negotiable 2 — a policy
  rewrite with carve-outs (mentions insert notifications into *other
  users'* rows, DECISIONS #15) — and is parked in BACKLOG for Ethan's
  planned security pass, not smuggled in as a patch.

**The jump flash scrolled away** (*"flash works but then it scrolls
away"*). Cause: images above the target finish loading after
`scrollIntoView` and push the layout, carrying the view off the flashed
message. Fix in both ChannelView and PostView: the center is re-asserted on
an interval for the flash's 1.6-second lifetime, cancelled instantly by the
user's own wheel/touch scroll — the jump must never fight them.

**Task descriptions render on the board cards** — `plainFromRich`, clamped
to two lines, muted. They previously existed only inside the edit dialog.

**Forum creation was undiscoverable** (*"i cant create my own forums"*).
Creation lived only on /channels behind the kind picker. /forums now has a
New forum button — same `createChannel`, kind fixed to `forum`, landing on
the new forum. Nothing was broken in the create path; this was an
affordance gap.

**Icons distinguish the three surfaces**: chat channels keep `#` (Hash),
forums get Newspaper (sidebar, /forums, the /channels groups), posts get
MessageSquareText in the forum list. Ethan's ask verbatim.

---

## #27 — 2026-08-22 — P4 build: the docs decisions SPEC did not make

**BlockNote is `@blocknote/shadcn`, not the recommended mantine flavor.** The
docs say "Mantine is recommended for new projects," but at 0.54 that flavor
*peer-depends on the entire Mantine component library* — a second UI system
beside Radix/shadcn, which Non-negotiable 3 forbids. The shadcn flavor's only
peer is `tailwindcss ^4.1.12` (bumped from 4.0.6, same major) and it vendors
its own components — `shadCNComponents` is deliberately not passed. Free core
only; nothing XL is installed, and BlockNote's yjs peers are optional and
absent.

**`/docs/*` is the app's first lazy route, and the boundary is a rule.**
BlockNote is ~315 kB gzip — bigger than every prior phase's growth combined —
so all of it rides a `React.lazy` DocsArea chunk. The entry chunk measured
723.35 kB / 212.85 kB gzip at the gate, unchanged within noise from G3.
**Nothing outside the DocsArea import graph may import `@blocknote/*`,
`components/docs/*`, or `routes/PageView`** — one stray static import puts the
editor in every session's bundle. `LinkedItems` lives outside `components/docs`
precisely because the task dialog (eager) renders it. This is the split
DECISIONS #20 left the bundle warning un-silenced for; the warning stays.

**The edit-lock polls; pages are not in the realtime publication.** SPEC §4
lists only `messages` under Postgres Changes, and #7 measured that publication
column lists do not trim payloads — publishing `pages` would ship the whole
`body_rich` document to every open tab on every autosave. Instead readers
re-fetch the two lock columns every 15s while a page is open; the heartbeat is
an UPDATE of those two columns every 15s while editing. Plain REST, trivially
inside Non-negotiable 8's budget.

**Edit-lock semantics, precisely.** Editing begins at the **first content
change** — viewing never claims. Release on leave is guarded
`.eq('editing_user_id', me)`, so a stale unmount loses quietly to a teammate's
newer claim (proved live at the gate: the wrong releaser touched 0 rows). A
claim older than 45s names nobody — that is what clears a closed tab, which
cannot release. One column pair means two simultaneous editors flap the
banner; accepted, SPEC §1.7 calls it a warning and not a lock.

**`updated_at` is client-stamped on content saves only — deliberately no
trigger.** A `BEFORE UPDATE` trigger would fire on heartbeats too, turning
"last edited" into "last looked at while typing". The autosave patch carries
`updated_at`; `heartbeatPatch`/`releasePatch` never do.

**Autosave is the latched-trailing 1s timer** (unread-provider's shape): it
fires 1s after the *first* unsaved change — a reset-on-keystroke debounce
never fires under continuous typing — with an in-flight re-save loop and an
unmount flush. Known gap, accepted: closing the *tab* (not in-app navigation)
can lose up to 1s of typing; a `pagehide` flush is parked in BACKLOG.

**`links` rows are derived from the document, not from the picker.** Every
successful autosave runs `linksFromDoc` over `body_rich` and diffs the result
against the page's stored edges (`source_type='page'`, scoped
`kind='references'` so `created_from` provenance can never be touched).
Deleting a link's text deletes its edge on the next save — self-healing, pure,
and unit-tested. The picker (tasks and pages by title) just inserts an
internal-href link inline; messages arrive by pasting the hover bar's new
**Copy link** URL, since messages have no titles to list. `/tasks?t=<id>`
opens that task's dialog, which is where a page→task link lands.

**Images store the storage path, never a URL.** BlockNote's `uploadFile`
return value lands verbatim in the block's `url` prop inside `body_rich`, so
it returns the path; `resolveFileUrl` signs it at render (1h TTL, cached).
A baked signed URL would expire an hour after being pasted — the gate probe
asserts the stored value stays a path. Upload follows the message discipline:
validate, storage first, attachments row (`owner_type='page'`), roll the
object back if the row fails.

**Page affordances follow #26's shape.** Editing is open to everyone — the
edit-lock banner exists *because* multiple people edit (SPEC §1.7) — but
Delete renders only for the creator, unlocking when `created_by` is null.
Affordance, not enforcement; the blanket policy stands.

**Carried from the batch review (PASS, five notes).** Fixed at the gate: a
staleness guard on the lock poll, and an uncaught clipboard write. Parked in
BACKLOG: the mock emulates no FK behavior on delete (an offline collection
delete strands its pages out of the tree — a state Postgres forbids), and a
page whose document still links a deleted task re-inserts a dangling
`references` edge on its next save (invisible today; `links` also lacks a
unique constraint, so racing tabs can double-insert an edge — backlinks
dedupe, so also invisible).

---

## #28 — 2026-08-22 — P5 build: the search decisions, and a grant lesson learned the hard way twice

**SPEC §3 was amended twice, both deviations measured before they shipped.**

*The flattening is `strict $.**."text"` + `silent`, not the sketch's bare
`jsonb_to_tsvector` — and not even plain lax jsonpath.* The bare form indexes
BlockNote scaffolding, so "paragraph" would match every document — #25 flagged
that; the finer trap the pre-push reviewer caught is that **lax mode's array
auto-unwrapping collects every text value TWICE** (once via the content array,
once via the inline node). Measured against the live database over a document
with nested children, link content, and both table-cell shapes: lax returned
every value duplicated, strict+silent returned each exactly once. Doubled
lexemes would have been baked into three generated columns that only a table
rewrite can change, and doubled sentences into every snippet. The known,
accepted residue: image *captions* live under non-"text" keys and are not
indexed.

*`search_all` returns `parent_type`/`parent_id`* beyond the sketch's columns,
because a message hit is un-navigable without its parent (`/channels/<id>?m=`
vs `/posts/<id>?m=`). And its snippets carry **⟦⟧ markers, not ts_headline's
default `<b>` tags** — the source text is user-authored, so HTML would force
`dangerouslySetInnerHTML`; markers parse into plain React segments
(`splitSnippet`). The messages branch re-weights its unweighted P0 vector at
query time (`setweight(m.search_tsv, 'B')` in the target list only, the `@@`
predicate still hits the GIN) — without it every chat hit ranked ~4–10× below
an equivalent doc hit and the global LIMIT could squeeze messages out
entirely, against G5's first clause.

**The #18 lesson, half-applied and caught at birth.** The search migration
revoked `search_all` `from anon` and cited unread_counts as precedent — but
the precedent was TWO revokes: its original migration had already stripped
the implicit PUBLIC grant, and the follow-up removed the explicit anon one.
Mine did only the anon half; the function ACL's `=X/postgres` PUBLIC entry
(confirmed by `pg_proc.proacl` inspection) still let a sessionless client
execute. The seed's `anon search` probe — written to assert **refusal, never
emptiness**, exactly as the #18 postmortem demanded — failed on its very
first run, and a second reviewed migration closed both functions. The rule,
now stated completely: **a new function needs `revoke all ... from public`
AND `revoke ... from anon`, and its birth commit carries a 42501 probe.**
`flatten_rich_text` gets the same treatment and its own probe, since RLS
cannot even pretend to cover a function that reads no tables.

**Assignment notifications are client-written like mentions (#15).**
`assignmentNoticeRow` is null on self-assign and on unassign; the insert
happens after the task write settles, at all four assignee write paths.
`updateTask` compares against the assignee captured from hook state before
the write, because `patchFromFields` always carries `assignee_id` — the patch
alone cannot say whether it changed. On plain create the notice failure is
surfaced on the board rather than thrown: a throw would keep the dialog open
over a task that WAS committed, and a retry would create a second one (batch
review finding). The create-from-message/post paths keep P2's thrown
"saved, but…" shape. The bell needed only a navigation branch —
`entity_type='task'` → `/tasks?t=` — its label had been waiting since P1.

**A confession for the P6 redeploy rehearsal.** The applied search migration
carries a UTF-8 BOM: a PowerShell regex-rewrite re-encoded it — **#25's exact
trap, hit again by the same tool a session after recording it**. The CLI
applied the file cleanly (it is the only applier), so per Non-negotiable 6 it
stays byte-for-byte as applied. If any other tool ever replays migrations,
this file is the one to watch. Source rewrites go through the editor tools;
this time it is written where the rule can bite.

**Carried from the batch review (PASS, six notes).** Fixed at the gate:
⌘K-toggle now resets through `close()`; the debounce timer clears on
unmount; the seed's tombstone probe keeps a findable body so the pre-clean
sweep can reclaim it after an interrupted run; title-only hits render no
empty snippet line, and the mock's snippet matches the real function's
(body-only) source. Accepted as-is: the create-from flows' post-commit
throws (P2 precedent).

---

## #29 — 2026-08-22 — Beta round 2: the docs feel, seen-clears-bell, the mock goes, search v2

Ethan's second feedback round, filed live while testing G4/G5. Everything
shipped same day; checklist findings outrank features (#21).

**The docs "embed" feel had three mechanical causes, now gone.** BlockNote
shipped its own 54px `padding-inline` gutter, its own Inter font files, and
its own background — and its default theme follows the *OS*, so on a dark
machine the editor went dark inside a light site. All four are overridden in
`editor.css` + `theme="light"`; the title is a 4xl heading in the document
flow (Enter drops into the body), and a sticky breadcrumb bar carries
Docs / collection / title where **the collection segment is the mover**. The
edit-lock banner is now a small named chip in that bar.

**Docs lists follow other clients by polling, not realtime** — the #27
posture holds (publishing `pages` ships whole documents per autosave); the
tree re-fetches on the edit-lock cadence and on window focus.

**Chat URLs are links now.** `splitUrls` (pure, tested) finds them at render
time the way mentions are found; our origin navigates in the SPA so a
Copy-link lands on the exact message, external opens a tab. Trailing
sentence punctuation stays out of the address.

**Right-click menus** on messages (Create task / Reply / Copy link, author's
Edit/Delete), collections (New page / Rename / Delete → arms the inline
confirm), and page rows (Open / Copy link) — a shadcn-style wrapper over the
`radix-ui` umbrella already in the tree, zero new dependencies. Tombstones
keep no menu.

**Seeing the message clears its bell** (*"make notif go away if they see the
message, not if they open notif"*). Being in the target's channel or post
with the tab visible marks the notification read and drops its toast; an
arrival in the room you are looking at makes no surface at all. Re-checked
when the tab becomes visible.

**The mock backend is gone — supersedes #12 entirely.** Ethan: *"delete mock
backend entirely."* #12's own exit clause ("remove it if it starts costing
more than it saves") fires: the team beta runs against the real project, and
the mock's cost had become drift (the G4 review's FK-fidelity finding, now
moot — BACKLOG updated). −1,719 lines, the `supabase.ts` cast gone, one data
layer again. What is lost with it: offline development. The **guest auth
user** #20 parked is also deleted (admin API, on Ethan's explicit
instruction) — the last #13 residue.

**Search v2** (*"search doesnt include file names, it also needs to be
perfect? it also doesnt have usernames"*), one migration, FAIL→fix→PASS:

- **File names match, surfacing as the thing that owns them** — a message/
  post/page/task hit with the filename as snippet — so every existing jump
  path works and no new entity plumbing exists. The reviewer caught the trap
  before it was baked into the stored column: the default parser reads
  `diagram.png` as ONE `host` token (the `postgresql.org` rule), so typing
  "diagram" would never have matched. Filenames are separator-normalized
  (`translate` to spaces, immutable) in the column AND the headline.
- **Titles match on substring** (ILIKE, escaped), boosted 0.4 — the reviewer
  also caught the first draft's "small boost" (0.05) sorting *below* every
  body-word hit (weight-B floor ≈0.24), the opposite of the claim. 0.4 sits
  between a body-word and a title-word FTS hit, with the arithmetic in the
  migration header. Messages stay FTS-only — no body ILIKE on the busiest
  table.
- **People**: a `person` entity over profiles (username/display-name
  substring). No profile surface exists, so selecting a person re-runs the
  search with their `@username`, which surfaces their mentions. The palette
  renders People first by group order; rank only guards the LIMIT-50 cut.
- The union now **dedupes on (entity_type, entity_id)** keeping the higher
  rank — a message matching by body and by filename is one row.
- SPEC §1.10 and §3 amended in the same commit; seed gains four v2 probes
  (file-as-owner, dedup-to-one, partial title, person) — 86 probes, all
  green against live after push.

## #30 — 2026-08-22 — graphify: a code knowledge graph for the assistant, on Ethan's ask

**What went in.** `graphifyy` 0.9.48 (PyPI, double-y; the command is
`graphify`) via `uv tool install "graphifyy[sql]"` — the `[sql]` extra so
the 18 migrations parse; without it they contributed nothing. It is a dev
tool outside the app: no app dependency, nothing in the locked stack moves.
Three pieces, each undone by its own `uninstall`:

- **Skill** — `graphify install` wrote `~/.claude/skills/graphify/` and a
  two-line `~/.claude/CLAUDE.md` (user-global, not this repo). `/graphify .`
  is the entry point in Claude Code; on Windows PowerShell it is `graphify .`.
- **Hook** — `graphify hook install` wrote `.git/hooks/post-commit` and
  `post-checkout` (local, not committed): a *detached* code-only rebuild
  after each commit, pinned to the uv-tool Python, logging to
  `~/.cache/graphify-rebuild.log`. It skips commits that touch only
  `graphify-out/`, skips mid-rebase/merge, and honours `GRAPHIFY_SKIP_HOOK=1`.
  It also registered `merge.graphify` (union-merge of `graph.json`) in local
  git config and wrote `.gitattributes`, which **is** committed. Teammates
  run `graphify hook install` once to get their own hook + driver.
- **Graph** — `graphify extract . --code-only` (tree-sitter AST, zero API
  calls): 759 nodes · 1825 edges · 63 communities, built from `ca9d3ec`.
  Committed: `graph.json`, `GRAPH_REPORT.md`, `manifest.json`,
  `.graphify_analysis.json` — none carries a machine path. Ignored:
  `graph.html` (700 KB viewer, regenerable), `cache/`, `cost.json`, and
  `.graphify_root` (absolute path; a teammate's hook would rebuild the
  wrong directory if it shipped).

**What was deliberately not run.** Both LLM passes — community naming and
the docs/markdown extraction — are token spend, so they wait on Ethan
(his call on spend): `/graphify .` in a fresh session does both with the
session model; `graphify label .` (one batched call) names communities
only. Until then `GRAPH_REPORT.md` lists "Community N" placeholders; the
query surface (`graphify query|path|explain|god-nodes`) is unaffected.
Also not run: `graphify claude install`, which would add a PreToolUse hook
and a CLAUDE.md section nudging every session to query the graph before
grepping — not asked for, and this file's workflow loop stays as written.

**How it behaves day to day.** The committed graph lags one commit: the
rebuild fires *after* a commit and lands in the next one (a commit that only
carries `graphify-out/` does not re-trigger). `git status` showing a
modified `graph.json` after a code commit is the hook working, not drift.
Known gap: `src/test/safe-next.test.ts` has a character at line 49 that
tree-sitter-typescript rejects, so that one file indexes without symbols —
the character is the test's point; the source is untouched.
