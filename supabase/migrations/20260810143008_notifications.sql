-- P1 · notifications — SPEC.md §1.9 and §2.3
--
-- In-app bell. Three kinds: `mention` (an @mention in a message), `reply` (a
-- reply in a thread you started), `assignment` (a task assigned to you). P1
-- writes the first two; `assignment` waits for P2's `tasks` table.
--
-- Rows are written by the *sender's* client, not by a trigger. A trigger would
-- have to re-parse @names in SQL against `profiles` — the same logic in a
-- second language, kept in sync by hope — and the blanket policy below already
-- permits an authenticated teammate to insert them. See DECISIONS #15.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who is being notified.
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mention', 'assignment', 'reply')),
  -- Who caused it. `set null`, not `cascade`: a teammate leaving the workspace
  -- should not delete your notification history along with them.
  actor_id uuid references public.profiles(id) on delete set null,
  -- Polymorphic, like `links` and `attachments` — text because the database
  -- holds two id types (DECISIONS #2). P1 only ever writes 'message'.
  entity_type text not null,
  entity_id text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app bell rows. Written client-side by the actor; entity is polymorphic and app-enforced.';

-- The bell's only query: my rows, newest first, and my unread count.
create index notifications_user_read_idx on public.notifications (user_id, read_at);

-- RLS — SPEC.md §2.2. One blanket policy, exactly like every other table.
--
-- This does mean any authenticated teammate can read anyone's notifications.
-- That is Non-negotiable 2 working as specified, not an oversight: one trusted
-- workspace, no roles, auth is the only wall (SPEC §1.1). CLAUDE.md explicitly
-- warns against "fixing" this toward `user_id = auth.uid()`. The client filters
-- by user_id for correctness, not for secrecy.
alter table public.notifications enable row level security;

create policy "notifications_authenticated_all" on public.notifications
  for all
  to authenticated
  using (true)
  with check (true);

-- Realtime. The bell has to light up without a refresh, which is the whole
-- point; the client subscribes filtered `user_id=eq.<me>` so it only ever
-- receives its own rows.
--
-- No column list here, unlike `messages` and `attachments`. There is no
-- generated tsvector to trim, so DECISIONS #4's constraint — a later column not
-- replicating until a migration re-declares the list — never applies. #7
-- measured that the list does not trim the payload anyway.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
