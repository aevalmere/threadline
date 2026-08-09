-- P0 · channels and channel_members — SPEC.md §2.3
--
-- kind = 'chat'  → a realtime message stream
-- kind = 'forum' → holds posts (P3); its comments are still messages rows

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('chat', 'forum')),
  topic text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint channels_name_kind_key unique (name, kind)
);

alter table public.channels enable row level security;

create policy "channels_authenticated_all" on public.channels
  for all
  to authenticated
  using (true)
  with check (true);

-- Membership plus the unread pointer. last_read_message_id is a bigint
-- because messages.id is (DECISIONS #2); null means nothing read yet.
create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_message_id bigint,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

comment on column public.channel_members.last_read_message_id is
  'Highest messages.id this user has seen in this channel. Null = all unread.';

-- "Which channels am I in" is the sidebar's query on every page load.
create index channel_members_user_id_idx on public.channel_members (user_id);

alter table public.channel_members enable row level security;

create policy "channel_members_authenticated_all" on public.channel_members
  for all
  to authenticated
  using (true)
  with check (true);
