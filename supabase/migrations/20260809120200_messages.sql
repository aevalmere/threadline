-- P0 · messages — SPEC.md §1.3, §2.3
--
-- One table doing three jobs: chat messages, thread replies, and (from P3)
-- forum comments. Exactly one of channel_id / post_id is set.
--
-- id is bigint identity, not uuid (DECISIONS #2): unread counts and reconnect
-- resync are both `id > last_seen`, which needs a monotonic, orderable key.

create table public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid references public.channels (id) on delete cascade,
  -- The FK to posts lands in P3, when that table exists. Not an oversight.
  post_id uuid,
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- Threads are one level deep: a reply points at the top-level message.
  thread_root_id bigint references public.messages (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete. The row stays; the UI renders "message deleted".
  deleted_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector('english', body)
  ) stored,
  constraint messages_one_parent check ((channel_id is null) <> (post_id is null))
);

comment on table public.messages is
  'Chat messages, thread replies, and forum comments. Exactly one of channel_id / post_id.';

-- Keyset pagination and resync both scan (parent, id).
create index messages_channel_id_id_idx on public.messages (channel_id, id);
create index messages_post_id_id_idx on public.messages (post_id, id);
create index messages_thread_root_id_idx on public.messages (thread_root_id);

-- Full-text search index built now, while the table is empty. P5 wires up
-- search_all() and needs no schema change on the busiest table in the app.
create index messages_search_tsv_idx on public.messages using gin (search_tsv);

alter table public.messages enable row level security;

create policy "messages_authenticated_all" on public.messages
  for all
  to authenticated
  using (true)
  with check (true);

-- Realtime (Postgres Changes) for P1. Added here so P1 ships no migration.
--
-- Two budget choices, both per Non-negotiable 8:
--
--  * Explicit column list, which omits search_tsv. Without it every realtime
--    payload would carry the tsvector alongside body — roughly doubling the
--    websocket bytes per message for data no client reads.
--  * Default replica identity (primary key), not `replica identity full`.
--    Soft deletes and edits are UPDATEs, which carry the full new row anyway,
--    and `full` would multiply WAL volume.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages (
      id,
      channel_id,
      post_id,
      author_id,
      thread_root_id,
      body,
      created_at,
      edited_at,
      deleted_at
    );
  end if;
end
$$;
