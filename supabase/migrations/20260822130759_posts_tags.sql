-- P3 · posts, tags, post_tags — and the two FKs deferred until `posts` exists
-- (SPEC.md §1.2, §2.3).
--
-- Forum posts live in forum-kind channels. Comments on a post are ordinary
-- `messages` rows keyed by `post_id` instead of `channel_id` — that column,
-- its (post_id, id) index, the one-parent CHECK, and its place in the
-- realtime publication's column list have all existed since P0 precisely so
-- this migration would not have to touch the busiest table beyond adding the
-- FK it was promised.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  -- `cascade`: deleting a forum deletes its posts, the same way deleting a
  -- chat channel deletes its messages. The channel must be kind='forum' —
  -- app-enforced, not a constraint (SPEC §2.3), same as every other
  -- cross-table shape rule in this schema.
  channel_id uuid not null references public.channels(id) on delete cascade,
  -- `cascade`, mirroring messages.author_id: deleting an account removes
  -- what they wrote.
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  -- BlockNote JSON, nullable — same contract as tasks.description_rich: P3
  -- writes plain paragraphs in BlockNote's block shape, P4's real editor
  -- reads the same column with no migration (SPEC §2.3, DECISIONS #23).
  body_rich jsonb,
  created_at timestamptz not null default now()
);

comment on table public.posts is
  'Forum posts (title + rich body) in forum-kind channels. Comments are messages rows keyed by post_id.';

-- The forum's only list query: a channel's posts, newest first.
create index posts_channel_created_idx on public.posts (channel_id, created_at desc);

-- No search_tsv here. SPEC §3 lists posts among the FTS tables, but ROADMAP
-- sequences that column in P5 — posts is low-volume, so adding a generated
-- column to it later is cheap in a way it never was for messages.

-- RLS — SPEC.md §2.2. One blanket policy, exactly like every other table.
alter table public.posts enable row level security;

create policy "posts_authenticated_all" on public.posts
  for all
  to authenticated
  using (true)
  with check (true);


-- Tags are workspace-global, not per-channel: SPEC §2.3 gives them a bare
-- unique name plus an optional display color, chosen client-side at creation.

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text
);

comment on table public.tags is
  'Workspace-global post tags. Unique by name; color is a client-chosen display hint.';

alter table public.tags enable row level security;

create policy "tags_authenticated_all" on public.tags
  for all
  to authenticated
  using (true)
  with check (true);


create table public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

comment on table public.post_tags is
  'Post ↔ tag join. The PK answers "this post''s tags"; the tag_id index answers "posts with this tag".';

create index post_tags_tag_idx on public.post_tags (tag_id);

alter table public.post_tags enable row level security;

create policy "post_tags_authenticated_all" on public.post_tags
  for all
  to authenticated
  using (true)
  with check (true);


-- The two deferred FKs, promised in the P0 and P2 migrations ("added in P3
-- when `posts` exists"). Every existing row holds NULL in these columns, so
-- validation scans find nothing to reject.
--
-- `cascade` on comments: deleting a post deletes its comment rows outright —
-- unlike a single message delete, which tombstones (SPEC §1.3), a deleted
-- post leaves no surface where a tombstone could render, so the rows go the
-- way a deleted channel's do. `set null` on tasks: deleting the source post
-- orphans the provenance, not the task, same as source_message_id.

alter table public.messages
  add constraint messages_post_id_fkey
  foreign key (post_id) references public.posts(id) on delete cascade;

alter table public.tasks
  add constraint tasks_source_post_id_fkey
  foreign key (source_post_id) references public.posts(id) on delete set null;


-- No realtime changes. Posts/tags refetch on mount like tasks do (SPEC §4);
-- comments arrive through the existing `messages` Postgres Changes
-- publication, whose explicit column list has carried `post_id` since P0
-- (DECISIONS #4) — a `post_id=eq.<uuid>` filter needs nothing new here.
