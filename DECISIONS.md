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

**Known limits, accepted.**
- No rate limiting of our own on the register function beyond the platform's, so
  the invite code must be long and random. Rotating it is one `secrets set`.
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
