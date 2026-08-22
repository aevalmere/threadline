-- P4 · collections, pages — the docs surface (SPEC.md §1.7, §2.3).
--
-- Notion-lite pages in a collections tree. Pages hold BlockNote JSON in
-- `body_rich` — the same contract tasks.description_rich and posts.body_rich
-- have carried since P2/P3 — and the soft edit-lock is two columns stamped by
-- the editing client, not a lock: a fresh `editing_heartbeat_at` (heartbeat
-- ~15s, stale after ~45s) makes other clients show a banner naming the
-- editor. Last write wins; no CRDT (explicit non-goal).

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- `cascade`: a collection's subtree goes with it. Pages are NOT in the
  -- subtree — pages reference collections with `set null` below, so deleting
  -- a collection re-files its pages as loose rather than destroying content.
  parent_id uuid references public.collections(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.collections is
  'Doc collections, a tree via parent_id. Deleting one cascades child collections but only un-files its pages.';

-- Covers the parent_id self-FK, so a cascade delete of a subtree never scans
-- the table per level. (The tree itself renders from one unfiltered select,
-- folded client-side — this index is for the FK, not the render.)
create index collections_parent_idx on public.collections (parent_id);

-- RLS — SPEC.md §2.2. One blanket policy, exactly like every other table.
alter table public.collections enable row level security;

create policy "collections_authenticated_all" on public.collections
  for all
  to authenticated
  using (true)
  with check (true);


create table public.pages (
  id uuid primary key default gen_random_uuid(),
  -- `set null`: deleting a collection must not destroy documents — the page
  -- survives un-filed and stays reachable from /docs and its backlinks.
  collection_id uuid references public.collections(id) on delete set null,
  title text not null,
  -- BlockNote JSON, nullable — an empty document stores SQL null, never [].
  body_rich jsonb,
  -- `set null`, matching tasks.created_by: the document outlives its author's
  -- account; only the creator-only delete affordance unlocks (DECISIONS #26's
  -- shape).
  created_by uuid references public.profiles(id) on delete set null,
  -- Set by the CLIENT on content saves only — deliberately no BEFORE UPDATE
  -- trigger, because the edit-lock heartbeat below is also an UPDATE and a
  -- trigger would turn "last edited" into "last looked at while typing".
  updated_at timestamptz not null default now(),
  -- The soft edit-lock (SPEC §1.7). Stamped on the first content change,
  -- refreshed ~15s while editing, released on leave; a reader treats a stamp
  -- older than ~45s as stale. One column pair, so two simultaneous editors
  -- flap it — accepted, it is a warning and not a lock.
  editing_user_id uuid references public.profiles(id) on delete set null,
  editing_heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.pages is
  'BlockNote doc pages. editing_user_id/editing_heartbeat_at are the soft edit-lock: a banner, not a lock.';

-- Covers the collection_id FK, so a collection delete's `set null` sweep
-- never scans the table. (The docs list fetches all pages in one unfiltered
-- select and groups client-side — this index is for the FK, not the render.)
create index pages_collection_idx on public.pages (collection_id);

-- No search_tsv here. SPEC §3 lists pages among the FTS tables, but ROADMAP
-- sequences that column in P5 — same call as posts, and DECISIONS #25 records
-- the coalesce/scaffolding-token decisions that must happen before it exists.

alter table public.pages enable row level security;

create policy "pages_authenticated_all" on public.pages
  for all
  to authenticated
  using (true)
  with check (true);


-- No realtime changes. Pages and collections refetch on mount like tasks and
-- posts do (SPEC §4), and the edit-lock banner POLLS the page row while it is
-- open — body_rich is a whole document per UPDATE, and DECISIONS #7 measured
-- that publication column lists do not trim payloads, so publishing `pages`
-- would ship every keystroke's autosave to every open tab for nothing.
