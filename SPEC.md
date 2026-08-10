# SPEC.md — Threadline v1

**Source of truth for schema and product behavior.** `ROADMAP.md` owns sequencing. Any deviation from this file gets written into this file *in the same commit that deviates*. Never re-litigate a settled decision from memory — read this file.

---

## 1. Product behavior

### 1.1 Workspace model

One workspace, 5–30 trusted teammates. **No roles, no permissions, no ownership checks.** Authentication is the only wall: if you are signed in, you can read and write everything. This is a deliberate product decision, not an oversight — see Non-negotiable 2.

Membership is created by the user inviting teammates from the Supabase dashboard. Public signups are disabled at the project level *and* every client sign-in call passes `shouldCreateUser: false`.

### 1.2 Channels

A channel has a `kind`: `'chat'` or `'forum'`.

- **chat** — a realtime message stream. Messages may open threads.
- **forum** — holds `posts` (title + rich body + tags). Comments on a post are *the same `messages` rows* as chat, keyed by `post_id` instead of `channel_id`.

`channel_members` tracks who is in a channel and their `last_read_message_id`, which drives unread badges.

### 1.3 Messages — one table, three jobs

`messages` is chat messages, thread replies, **and** forum comments. Exactly one of `channel_id` / `post_id` is set, enforced by a CHECK constraint.

- A top-level message has `thread_root_id IS NULL`.
- A reply has `thread_root_id` pointing at the top-level message it belongs to. **Threads are one level deep** — replies never nest further; a reply to a reply attaches to the same root.
- Edits set `edited_at`. Deletes are soft: `deleted_at` is set and the body renders as "message deleted". No edit history (non-goal).

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

### 1.7 Docs

`collections` form a tree via `parent_id`. `pages` hold BlockNote JSON in `body_rich`, autosaved on a 1s debounce.

**Soft edit-lock, no CRDT.** A page being edited stamps `editing_user_id` and `editing_heartbeat_at` (heartbeat every ~15s). Another user opening that page within ~45s of the last heartbeat sees a banner naming the editor. It is a warning, not a lock — last write wins. Collaborative co-editing is an explicit non-goal.

### 1.8 Links

`links` is a polymorphic edge table. Integrity is enforced in app code, not by FKs. It powers the "Linked items" backlink panel on pages and tasks — indexed on `(target_type, target_id)` so backlinks are one query. No graph visualization (non-goal).

### 1.9 Notifications

In-app bell only. Rows are written for three kinds: `mention` (an @mention in a message), `assignment` (a task assigned to you), `reply` (a reply in a thread you started). `read_at` marks read. No email, no push (non-goals).

### 1.10 Search

One ⌘K box. Calls `search_all(q)` once, groups the results by `entity_type`, and jumps to the entity. Postgres FTS only.

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

One blanket policy per table. No per-row ownership policies. No policy mazes. `anon` gets nothing. The `service_role` key never appears in client code or the repo — it exists only in `.env.local` for `scripts/seed.ts`.

The seed script proves this end to end by signing in as a real user through the **anon** client and exercising all four verbs (select / insert / update / delete) against a live table.

### 2.3 Tables

Phase column = when the migration lands.

#### `profiles` — P0
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | → `auth.users(id)` on delete cascade |
| `display_name` | `text not null` | seeded from email local-part by trigger |
| `avatar_url` | `text` | |
| `created_at` | `timestamptz not null default now()` | |

Trigger `handle_new_user()` `after insert on auth.users` inserts the profile row. This is what makes a dashboard-invited teammate work with zero extra steps.

#### `channels` — P0
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `name` | `text not null` | |
| `kind` | `text not null` | `check (kind in ('chat','forum'))` |
| `topic` | `text` | |
| `created_by` | `uuid` | → `profiles(id)` on delete set null |
| `created_at` | `timestamptz not null default now()` | |

Unique `(name, kind)`.

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
| `post_id` | `uuid` | FK added in **P3** when `posts` exists |
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
| `channel_id` | `uuid not null` | → `channels(id)`; channel must be `kind='forum'` (app-enforced) |
| `author_id` | `uuid not null` | → `profiles(id)` |
| `title` | `text not null` | |
| `body_rich` | `jsonb` | BlockNote document |
| `created_at` | `timestamptz not null default now()` | |

P3 also adds the deferred `messages.post_id` FK.

#### `tags` / `post_tags` — P3
`tags(id uuid pk, name text unique not null, color text)`
`post_tags(post_id uuid → posts on delete cascade, tag_id uuid → tags on delete cascade, primary key (post_id, tag_id))`

#### `collections` / `pages` — P4
`collections(id uuid pk, name text not null, parent_id uuid null → collections(id) on delete cascade)`

| `pages` column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `collection_id` | `uuid` | → `collections(id)` on delete set null |
| `title` | `text not null` | |
| `body_rich` | `jsonb` | BlockNote document |
| `created_by` | `uuid` | → `profiles(id)` |
| `updated_at` | `timestamptz not null default now()` | |
| `editing_user_id` | `uuid` | → `profiles(id)`; soft lock (§1.7) |
| `editing_heartbeat_at` | `timestamptz` | stale after ~45s |

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
| `created_by` | `uuid` | → `profiles(id)` |
| `created_at` | `timestamptz not null default now()` | |
| `completed_at` | `timestamptz` | |

Index on `(status, position)`.

#### `attachments` — P1
`id uuid pk`, `owner_type text check in ('message','post','page','task')`, `owner_id text` (§2.1), `storage_path text not null`, `filename text not null`, `mime text`, `size_bytes int`, `created_at timestamptz not null default now()`. Index on `(owner_type, owner_id)`.

Storage bucket `attachments`, **10 MB cap**, images render as inline thumbnails.

The bucket is **private**. Reads go through short-lived signed URLs, so an uploaded file is unreadable without a session — "auth is the only wall" (§1.1) covers files too. The 10 MB cap is set on the bucket *and* checked client-side: the bucket is the real wall, the client check just avoids a wasted upload. `storage.objects` carries four bucket-scoped policies rather than §2.2's single blanket policy, because it is one table holding every bucket. See DECISIONS #9.

#### `links` — P2
`id uuid pk`, `source_type text`, `source_id text`, `target_type text`, `target_id text`, `kind text`, `created_at timestamptz default now()`.
**Index on `(target_type, target_id)`** — this is what makes the backlink panel one query.

#### `notifications` — P1 (rows) / P5 (bell UI)
`id uuid pk`, `user_id uuid → profiles on delete cascade`, `kind text check in ('mention','assignment','reply')`, `actor_id uuid → profiles`, `entity_type text`, `entity_id text`, `read_at timestamptz`, `created_at timestamptz default now()`. Index on `(user_id, read_at)`.

---

## 3. Full-text search design

Four content tables carry a generated `tsvector` column plus a GIN index:

| Table | tsvector source |
|---|---|
| `messages` | `body` |
| `posts` | `title` (weight A) + `body_rich` flattened to text (weight B) |
| `pages` | `title` (weight A) + `body_rich` flattened to text (weight B) |
| `tasks` | `title` (weight A) + `description_rich` flattened to text (weight B) |

BlockNote stores `jsonb`; the flattening uses `jsonb_to_tsvector('english', body_rich, '["string"]')`, which is immutable and therefore legal in a generated column.

One function, `search_all(q text)`, UNION ALLs across the four:

```sql
create or replace function public.search_all(q text)
returns table (entity_type text, entity_id text, title text, snippet text, rank real)
language sql stable
as $$ … union all … order by rank desc limit 50 $$;
```

`entity_id` is `text` because `messages.id` is bigint and the rest are uuid (§2.1). Query parsing uses `websearch_to_tsquery('english', q)`. Snippets come from `ts_headline`.

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

1. `/login` → email → `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: <origin>/auth/callback } })`.
2. Supabase sends the magic link (built-in email; Resend SMTP only if rate limits bite).
3. `/auth/callback` — supabase-js PKCE + `detectSessionInUrl` exchanges the code, then redirects to `/`.
4. `AuthProvider` holds session state via `onAuthStateChange`; `RequireAuth` guards every app route.

An unknown email is a silent no-op — Supabase does not leak account existence, and the UI says "If that address is on the team, a link is on its way."
