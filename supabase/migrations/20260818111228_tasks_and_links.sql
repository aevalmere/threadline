-- P2 · tasks and links — SPEC.md §1.6, §1.8, §2.3
--
-- The two tables land together because in P2 `links` exists for exactly one
-- edge: task → message, `kind='created_from'`, written by create-task-from-
-- message in the same client transaction as the task row. P3/P4 reuse the
-- table for post → task and page → task edges without touching this schema.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- BlockNote JSON, nullable. P2's modal writes a single plain paragraph in
  -- BlockNote's block shape; the real editor arrives in P4 and reads the same
  -- column with no migration (SPEC §2.3).
  description_rich jsonb,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  -- `set null`, not `cascade`: a teammate leaving the workspace un-assigns
  -- their tasks; it must not delete them.
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  -- Fractional ordering within a kanban column (SPEC §1.6): a card dropped
  -- between neighbours gets (prev + next) / 2. Never rewrite a whole column's
  -- positions on drop.
  position float8 not null,
  -- Where the task came from. Typed FKs, not polymorphic text — these two are
  -- the only sources and each keeps its native id type (SPEC §2.1). `set
  -- null`: deleting the source message orphans the provenance, not the task.
  source_message_id bigint references public.messages(id) on delete set null,
  -- FK to posts(id) is added in P3 when `posts` exists (SPEC §2.3).
  source_post_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.tasks is
  'Kanban tasks. Column = status; order within a column = position (fractional). Provenance via typed source FKs.';

-- The board's only query: every task, grouped by column, ordered within it.
create index tasks_status_position_idx on public.tasks (status, position);

-- RLS — SPEC.md §2.2. One blanket policy, exactly like every other table.
alter table public.tasks enable row level security;

create policy "tasks_authenticated_all" on public.tasks
  for all
  to authenticated
  using (true)
  with check (true);


-- `links` — the polymorphic edge table (SPEC §1.8). Integrity is enforced in
-- app code, not by FKs: the database holds two id types, so the id columns are
-- text (SPEC §2.1, DECISIONS #2). All five payload columns are `not null` —
-- SPEC's table is terse about it, but an edge missing either endpoint or its
-- kind is garbage, and `notifications` set the same precedent for its
-- polymorphic columns.

create table public.links (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  target_type text not null,
  target_id text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

comment on table public.links is
  'Polymorphic edges between entities. App-enforced integrity; text ids because the db holds two id types.';

-- What makes the "Linked items" backlink panel one query (SPEC §1.8).
create index links_target_idx on public.links (target_type, target_id);

-- RLS — SPEC.md §2.2. Same blanket policy.
alter table public.links enable row level security;

create policy "links_authenticated_all" on public.links
  for all
  to authenticated
  using (true)
  with check (true);


-- No realtime. SPEC §4 lists messages (Postgres Changes), typing/presence
-- (Broadcast/Presence), and notifications — tasks and links are deliberately
-- absent: the board refetches on mount, which is fine at 5–30 users. Adding
-- either table to `supabase_realtime` is scope, not a fix.
