# SPEC.md — Threadline v1

**Source of truth for schema and product behavior.** `ROADMAP.md` owns sequencing. Any deviation from this file gets written into this file *in the same commit that deviates*. Never re-litigate a settled decision from memory — read this file.

---

## 1. Product behavior

### 1.1 Workspace model

One workspace, 5–30 trusted teammates. **No roles, no permissions, no ownership checks.** Authentication is the only wall: if you are signed in, you can read and write everything. This is a deliberate product decision, not an oversight — see Non-negotiable 2.

Membership is created by **registering with the workspace's shared invite code** (§5). Public signups stay disabled at the project level, so the invite code — checked server-side in an Edge Function — is the only way in. Inviting someone means giving them the code; removing someone means deleting their account and rotating it. The user can still create an account straight from the Supabase dashboard, which works unchanged.

### 1.2 Channels

A channel has a `kind`: `'chat'` or `'forum'`.

- **chat** — a realtime message stream. Messages may open threads.
- **forum** — holds `posts` (title + rich body + tags). Comments on a post are *the same `messages` rows* as chat, keyed by `post_id` instead of `channel_id`.

`channel_members` tracks who is in a channel and their `last_read_message_id`, which drives unread badges.

**Sidebar order is manual and shared** (beta round 3). Chat and forum are two independently drag-reorderable lists, ordered by `channels.position` within each `kind`; a drop writes one row. There is exactly one order for the workspace, not one per person — per-user ordering would need its own table and this is one trusted team (§1.1). A newly created channel appends to the bottom of its list.

### 1.3 Messages — one table, three jobs

`messages` is chat messages, thread replies, **and** forum comments. Exactly one of `channel_id` / `post_id` is set, enforced by a CHECK constraint.

- A top-level message has `thread_root_id IS NULL`.
- A reply has `thread_root_id` pointing at the top-level message it belongs to. **Threads are one level deep** — replies never nest further; a reply to a reply attaches to the same root.
- Edits set `edited_at`. No edit history (non-goal).
- **Deleting a message tombstones the row and destroys its content.** `deleted_at` is set, `body` is blanked to `''`, and every `attachments` row owned by the message is deleted along with its object in storage. The row itself survives so replies keep their root and the change reaches other clients as an ordinary UPDATE — a hard `DELETE` would arrive carrying only the primary key, which the channel filter cannot match, so other clients would keep showing it until they reloaded. The tombstone renders as "message deleted". **The text and files are unrecoverable.** See DECISIONS #11.

### 1.4 Unread badges

For a channel, unread = count of messages with `id > channel_members.last_read_message_id`, excluding the viewer's own messages and soft-deleted rows. `last_read_message_id` advances when the channel is viewed, **batched** client-side (Non-negotiable 8). A `NULL` last-read means everything is unread.

### 1.5 Reconnect and resync

Realtime is best-effort. On every channel join or reconnect the client refetches `WHERE channel_id = ? AND id > <highest id already held>` and merges. This is why `messages.id` is monotonic (§2.1). Missing a websocket event is never data loss.

### 1.6 Tasks

Status is `todo` / `doing` / `done`. Kanban columns are the statuses; ordering within a column is `position float8` using **fractional ordering** — a card dropped between neighbours gets `(prev + next) / 2`. Never rewrite a whole column's positions on drop.

**Create task from message** — the feature that justifies the app. Hover a message → "Create task" → prefilled modal (title seeded from the message body) → on save writes:
1. a `tasks` row with `source_message_id` set, and
2. one `links` row (`source_type='task'`, `target_type='message'`, `kind='created_from'`).

The task then renders a "from #channel" chip that jumps to the exact message. Same flow from a post via `source_post_id`. **This is one day of work, not a subsystem.**

**A card opens a read view, and dragging is a separate gesture** (beta round 3, DECISIONS #31). Clicking the card body opens the task as text — title, description, meta, provenance chip, linked items — with status buttons that anyone can press, and Edit and Delete only for its creator, matching the form's existing rule. Dragging is a grip in the card's corner, never the whole card: with the card as the drag surface every click was a would-be-drag, and a drop could fire the click of the card it landed on.

### 1.7 Docs

`collections` form a tree via `parent_id`. `pages` hold BlockNote JSON in `body_rich`, autosaved on a 1s debounce.

**The tree is manually ordered** (beta round 3), on the same shared fractional `position` as the sidebar: collections reorder among their siblings, pages within their collection. Moving a page *between* collections is not a drag — it stays out of scope for v1. One consequence is deliberate: a page no longer rises to the top of its collection when it is edited. A list you can drag cannot also rearrange itself underneath you.

**Soft edit-lock, no CRDT.** A page being edited stamps `editing_user_id` and `editing_heartbeat_at` (heartbeat every ~15s). Another user opening that page within ~45s of the last heartbeat sees a banner naming the editor. It is a warning, not a lock — last write wins. Collaborative co-editing is an explicit non-goal.

### 1.8 Links

`links` is a polymorphic edge table. Integrity is enforced in app code, not by FKs. It powers the "Linked items" backlink panel on pages and tasks — indexed on `(target_type, target_id)` so backlinks are one query. No graph visualization (non-goal).

### 1.9 Notifications

Rows are written for three kinds: `mention` (an @mention in a message), `assignment` (a task assigned to you), `reply` (a reply in a thread you started). `read_at` marks read. **No email** (non-goal).

Rows are written by the **sender's client**, not a trigger — see DECISIONS #15. Mentions resolve on `username`, which is unique; display names are not and never resolve a mention.

The bell shipped in **P1**, not P5 (DECISIONS #16). One arrival produces exactly one surface: an in-app toast when the tab is visible, a **browser notification when it is hidden**. That second one deviates from the "push notifications" non-goal and was Ethan's explicit call. It is the `Notification` API fired by the running page — the tab must be open, backgrounded is fine, closed delivers nothing. There is no service worker and no push service, so no server→device path exists. Real push remains out.

### 1.10 Search

One ⌘K box. Calls `search_all(q)` once, groups the results by `entity_type`, and jumps to the entity — except a `person` result, which re-runs the search with that user's `@username` (there is no profile surface to jump to). Postgres FTS, plus a title/username substring fallback inside the same function (§3 v2) — still no external search service.

---

## 2. Schema v1

### 2.1 Two locked id decisions

**`messages.id` is `bigint generated always as identity`.** Every other table uses `uuid default gen_random_uuid()`. Rationale: unread counts (§1.4) and resync (§1.5) are both `id > last_seen`. Random uuids are not orderable, so they would force a join against `created_at`, which ties and is not a stable cursor. See DECISIONS #2.

**Polymorphic id columns are `text`.** Because the database holds two id types, `links.source_id`, `links.target_id`, `attachments.owner_id`, and `notifications.entity_id` are `text`. These are already app-enforced (§1.8), so this costs nothing. Typed FKs stay typed: `tasks.source_message_id bigint`, `tasks.source_post_id uuid`.

### 2.2 RLS — the pattern, applied to every table without exception

Every table gets exactly this, in the *same migration that creates the table*:

```sql
alter table public.<t> enable row level security;

create policy "<t>_authenticated_all" on public.<t>
  for all to authenticated
  using (true) with check (true);
```

One blanket policy per table. No per-row ownership policies. No policy mazes. `anon` gets nothing. The `service_role` key never appears in client code or the repo. It exists in exactly two places: `.env.local` for `scripts/seed.ts`, and injected by the platform into the `register` Edge Function (§5), which is server-side and whose source contains only the variable's name.

**One deliberate exception, and only one.** `email_for_username(text)` is a `security definer` function granted to `anon`, because sign-in resolves a typed username to an email before any session exists (§5). It returns one scalar column and grants no table access. DECISIONS #14 records what that costs — it is an account-existence oracle — and why it was still the better trade. Anything else reachable by `anon` is a bug.

The seed script proves this end to end by signing in as a real user through the **anon** client and exercising all four verbs (select / insert / update / delete) against a live table.

### 2.3 Tables

Phase column = when the migration lands.

#### `profiles` — P0, `username` added in P1
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | → `auth.users(id)` on delete cascade |
| `username` | `text not null` | unique on `lower(username)`; `check (username ~ '^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$')` |
| `display_name` | `text not null` | chosen at registration; falls back to the username |
| `avatar_url` | `text` | **storage path** in the `attachments` bucket under `avatars/`, not a URL — the bucket is private, so it is signed on read |
| `created_at` | `timestamptz not null default now()` | |

`username` is both the sign-in identifier (§5) and the @mention key. It is unique so a mention is unambiguous; display names are not unique and never resolve mentions.

**3–24 characters, first *and* last alphanumeric.** That set is exactly the fixed points of `slugify_username()` — the values it returns unchanged — and it has to be, because registration stores the *slug* of what was requested while `/settings` stores the value verbatim. When the two disagreed, asking for `bob.` created an account named `bob` that its owner could not sign into. See DECISIONS #14.

Trigger `handle_new_user()` `after insert on auth.users` inserts the profile row, reading `username` and `display_name` from `raw_user_meta_data`. This is what makes a dashboard-created teammate work with zero extra steps: with no metadata it derives a username from the email local part, disambiguating with a numeric suffix. A username *chosen at registration* that collides raises instead — see DECISIONS #14.

Any authenticated teammate can rename any other, because §2.2's blanket policy applies here too. Deliberate; do not "fix" it with an ownership policy.

#### `channels` — P0
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `name` | `text not null` | |
| `kind` | `text not null` | `check (kind in ('chat','forum'))` |
| `topic` | `text` | |
| `created_by` | `uuid` | → `profiles(id)` on delete set null |
| `created_at` | `timestamptz not null default now()` | |
| `position` | `float8 not null default extract(epoch from clock_timestamp())` | **beta round 3.** Sidebar order within `kind`, fractional (§1.2). The epoch default puts a row created by code that does not set it at the bottom of its list |

Unique `(name, kind)`. Index `(kind, position)`.

#### `channel_members` — P0
| Column | Type | Notes |
|---|---|---|
| `channel_id` | `uuid not null` | → `channels(id)` on delete cascade |
| `user_id` | `uuid not null` | → `profiles(id)` on delete cascade |
| `last_read_message_id` | `bigint` | null = everything unread |
| `joined_at` | `timestamptz not null default now()` | |

PK `(channel_id, user_id)`. Index on `(user_id)`.

#### `messages` — P0
| Column | Type | Notes |
|---|---|---|
| `id` | `bigint generated always as identity` PK | monotonic — see §2.1 |
| `channel_id` | `uuid` | → `channels(id)` on delete cascade |
| `post_id` | `uuid` | → `posts(id)` on delete cascade (FK added in **P3**) |
| `author_id` | `uuid not null` | → `profiles(id)` on delete cascade |
| `thread_root_id` | `bigint` | → `messages(id)` on delete cascade |
| `body` | `text not null` | |
| `created_at` | `timestamptz not null default now()` | |
| `edited_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` | soft delete |

- `check ((channel_id is null) <> (post_id is null))` — exactly one set.
- Indexes: `(channel_id, id)`, `(post_id, id)`, `(thread_root_id)`.
- Trigger `flatten_thread_root()` `before insert or update of thread_root_id` enforces §1.3's one-level rule in the database: a reply pointing at another reply is **rewritten** to that reply's root. Re-parenting a message that already has replies **raises** — no code path does it, and there is no correct root to rewrite it to. Added in P1; see DECISIONS #8.
- `search_tsv` generated + GIN — created in P0 while the table is empty so P5 needs no schema change on the busiest table.
- Added to the `supabase_realtime` publication in P0 so P1 needs no migration.

#### `posts` — P3
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `channel_id` | `uuid not null` | → `channels(id)` on delete cascade; channel must be `kind='forum'` (app-enforced) |
| `author_id` | `uuid not null` | → `profiles(id)` on delete cascade |
| `title` | `text not null` | |
| `body_rich` | `jsonb` | BlockNote document |
| `created_at` | `timestamptz not null default now()` | |

Index on `(channel_id, created_at desc)` — the forum's list query.

P3 also adds the two deferred FKs: `messages.post_id` → `posts(id)` **on delete cascade** (deleting a post deletes its comment rows outright — no surface remains where a tombstone could render, so they go the way a deleted channel's messages do), and `tasks.source_post_id` → `posts(id)` **on delete set null** (orphans the provenance, not the task).

#### `tags` / `post_tags` — P3
`tags(id uuid pk, name text unique not null, color text)`
`post_tags(post_id uuid → posts on delete cascade, tag_id uuid → tags on delete cascade, primary key (post_id, tag_id))` — index on `(tag_id)` for "posts with this tag".

#### `collections` / `pages` — P4
`collections(id uuid pk, name text not null, parent_id uuid null → collections(id) on delete cascade, created_at timestamptz not null default now(), position float8 not null default extract(epoch from clock_timestamp()))`

Deleting a collection cascades its child collections but only **un-files** its pages — their FK is `set null`, so no document is ever destroyed by tree pruning.

`position` (**beta round 3**) orders siblings sharing a `parent_id`; a null parent is the root list. Index `(parent_id, position)`.

| `pages` column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `collection_id` | `uuid` | → `collections(id)` on delete set null |
| `title` | `text not null` | |
| `body_rich` | `jsonb` | BlockNote document |
| `created_by` | `uuid` | → `profiles(id)` on delete set null — the document outlives its author; a null creator unlocks the delete affordance for everyone (DECISIONS #26's shape) |
| `updated_at` | `timestamptz not null default now()` | set by the client on **content saves only** — heartbeats never touch it |
| `editing_user_id` | `uuid` | → `profiles(id)` on delete set null; soft lock (§1.7) |
| `editing_heartbeat_at` | `timestamptz` | stale after ~45s |
| `position` | `float8 not null default extract(epoch from clock_timestamp())` | **beta round 3.** Order within `collection_id` (a null collection is the un-filed list). Index `(collection_id, position)` |
| `created_at` | `timestamptz not null default now()` | |

#### `tasks` — P2
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `title` | `text not null` | |
| `description_rich` | `jsonb` | BlockNote, nullable |
| `status` | `text not null default 'todo'` | `check (status in ('todo','doing','done'))` |
| `assignee_id` | `uuid` | → `profiles(id)` on delete set null |
| `due_date` | `date` | |
| `position` | `float8 not null` | fractional ordering (§1.6) |
| `source_message_id` | `bigint` | → `messages(id)` on delete set null |
| `source_post_id` | `uuid` | → `posts(id)` on delete set null; FK added in P3 |
| `created_by` | `uuid` | → `profiles(id)` on delete set null |
| `created_at` | `timestamptz not null default now()` | |
| `completed_at` | `timestamptz` | |

Index on `(status, position)`.

#### `attachments` — P1
`id uuid pk`, `owner_type text check in ('message','post','page','task')`, `owner_id text` (§2.1), `storage_path text not null`, `filename text not null`, `mime text`, `size_bytes int`, `created_at timestamptz not null default now()`. Index on `(owner_type, owner_id)`.

Storage bucket `attachments`, **10 MB cap**, images render as inline thumbnails. Files do not outlive their owner: deleting a message deletes its attachment rows and storage objects (§1.3), and a single attachment can be deleted on its own.

The bucket is **private**. Reads go through short-lived signed URLs, so an uploaded file is unreadable without a session — "auth is the only wall" (§1.1) covers files too. The 10 MB cap is set on the bucket *and* checked client-side: the bucket is the real wall, the client check just avoids a wasted upload. `storage.objects` carries four bucket-scoped policies rather than §2.2's single blanket policy, because it is one table holding every bucket. See DECISIONS #9.

#### `links` — P2
`id uuid pk`, `source_type text not null`, `source_id text not null`, `target_type text not null`, `target_id text not null`, `kind text not null`, `created_at timestamptz not null default now()`. An edge missing either endpoint or its kind is garbage; `notifications` set the same not-null precedent for its polymorphic columns.
**Index on `(target_type, target_id)`** — this is what makes the backlink panel one query.

#### `notifications` — P1 (rows **and** bell UI — pulled forward, DECISIONS #16)
`id uuid pk`, `user_id uuid → profiles on delete cascade`, `kind text check in ('mention','assignment','reply')`, `actor_id uuid → profiles`, `entity_type text`, `entity_id text`, `read_at timestamptz`, `created_at timestamptz default now()`. Index on `(user_id, read_at)`.

---

## 3. Full-text search design

Four content tables carry a generated `tsvector` column plus a GIN index (v2 adds a fifth on `attachments.filename`, separator-normalized so every word of a filename matches — see below):

| Table | tsvector source |
|---|---|
| `messages` | `body` |
| `posts` | `title` (weight A) + `body_rich` flattened to text (weight B) |
| `pages` | `title` (weight A) + `body_rich` flattened to text (weight B) |
| `tasks` | `title` (weight A) + `description_rich` flattened to text (weight B) |

BlockNote stores `jsonb`; the flattening extracts **only human text** first — `jsonb_to_tsvector('english', jsonb_path_query_array(coalesce(body_rich, '[]'), 'strict $.**."text"', '{}', true), '["string"]')` — because BlockNote keeps readable text under `"text"` keys while scaffolding (`"paragraph"`, style names, block ids, image paths) lives under other keys (image *captions* are the known, accepted exception — they are not indexed). A bare `jsonb_to_tsvector` over the whole document would index the scaffolding, making tokens like "paragraph" match every document. **`strict` mode + the `silent` flag, measured live**: lax mode's array auto-unwrapping collects every text value twice — doubled lexemes in the stored vector, doubled sentences in every snippet — while strict collects each exactly once and silent swallows the structural errors strict raises on non-object nodes. All functions used are immutable and therefore legal in a generated column. The `coalesce` matters: `body_rich` is nullable, and a null would poison the whole concatenated vector. *(Amended at P5 — the original sketch flattened the whole document; DECISIONS #25 flagged the choice, DECISIONS #28 records it.)*

One function, `search_all(q text)`, UNION ALLs across the four:

```sql
create or replace function public.search_all(q text)
returns table (entity_type text, entity_id text, parent_type text, parent_id text,
               title text, snippet text, rank real)
language sql stable security invoker
as $$ … union all … order by rank desc limit 50 $$;
```

`entity_id` is `text` because `messages.id` is bigint and the rest are uuid (§2.1). `parent_type`/`parent_id` exist for message hits — `('channel', channel_id)` or `('post', post_id)`, null for the other entity types — because jump-to-entity needs the parent to build `/channels/<id>?m=` vs `/posts/<id>?m=` without a per-click resolve. A message hit's `title` is its channel name or post title; tombstoned messages are excluded. Query parsing uses `websearch_to_tsquery('english', q)`. Snippets come from `ts_headline` (rich bodies re-flatten through `flatten_rich_text()` for the snippet source). Granted to `authenticated` only, `anon` **and PUBLIC** revoked explicitly — the DECISIONS #18 lesson, completed by #28.

**v2 (beta round 2, Ethan's asks).** Three additions, all inside `search_all` plus one `attachments.search_tsv` on `filename`: **file names** match, surfacing as the message/post/page/task that owns the file (no new jump paths; the union dedupes on `(entity_type, entity_id)` keeping the higher rank); **titles also match on case-insensitive substring** (ILIKE, metacharacters escaped, boosted between a body-word and a title-word FTS hit — the migration header carries the numbers) so partial words find posts/pages/tasks — messages stay FTS-only; and a **`person` entity type** over profiles (username/display-name substring, `snippet = '@username'`) — the client re-runs the search with the @username instead of navigating, since no profile surface exists.

**No external search service.** If FTS slips, the fallback is `ILIKE` now and FTS in September — not Meilisearch.

---

## 4. Realtime design

All realtime is supabase-js Realtime channels. No other websocket library will ever be installed (Non-negotiable 1).

| Need | Mechanism |
|---|---|
| New / edited / deleted messages | **Postgres Changes** on `messages`, filtered by `channel_id` |
| Typing indicators, presence | **Broadcast** / **Presence** — never persisted |
| Missed events | Refetch on join/reconnect (§1.5) — the source of truth is always the table |

Client-side debounce on typing and presence broadcasts is **≥300ms**, and unread-pointer updates are batched, to protect the free tier's realtime budget.

---

## 5. Auth flow

**Invite code to register, username + password to sign in.** Magic-link sign-in was removed in P1; see DECISIONS #14 for why, and for the costs accepted.

**Register** — `/register` takes the invite code, an email, a username, a display name and a password. It calls the `register` **Edge Function**, which:
1. compares the code against its `INVITE_CODE` secret in constant time,
2. re-validates the username shape and availability,
3. calls `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, display_name } })`.

The client then signs in normally. **Project-level signups stay disabled**, so the function is the only door — a code checked in the browser would stop nobody, because the anon key is in the bundle and `signUp` is public.

**Sign in** — `/login` takes username + password. The client calls `email_for_username(u)`, a `security definer` function granted to `anon`, then `signInWithPassword`. A wrong username and a wrong password give the same message.

**Forgot password** — `/reset` sends `resetPasswordForEmail`; the link lands on `/auth/callback`, which exchanges the code and routes to the set-a-new-password form. Email exists only for this.

`AuthProvider` holds session state via `onAuthStateChange`; `RequireAuth` guards every app route.

**Profile editing** — `/settings` changes display name, username and avatar. A taken username surfaces the unique-index `23505` as a readable error.

Avatars live in the existing private `attachments` bucket under an `avatars/` prefix, capped at **2 MB** — well under the bucket's 10 MB, because an avatar is the one upload whose egress multiplies by the size of the team. `profiles.avatar_url` stores the storage path, and `ProfilesProvider` signs every avatar on screen in one batched request, so no render site touches storage. Replacing or removing an avatar deletes the old object, on the same reasoning as SPEC §1.3's message delete.
