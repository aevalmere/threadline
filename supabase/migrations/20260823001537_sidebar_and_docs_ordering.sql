-- Beta round 3 · manual ordering for the sidebar and the docs tree — SPEC.md §1.2, §1.7
--
-- Three lists become drag-and-droppable: channels and forums in the sidebar,
-- and collections + pages in the docs tree. Each needs a stable, user-set
-- order that survives a refresh, so each gets the same fractional `position`
-- the kanban board has carried since P2 (`tasks.position`,
-- 20260818111228_tasks_and_links.sql).
--
-- Fractional, not integer: a row dropped between two neighbours takes
-- (prev + next) / 2 and writes exactly one row. Renumbering a whole list on
-- every drop would be N writes per drag against the free tier's budget
-- (Non-negotiable 8), and two clients renumbering at once would fight.
--
-- The step is 1024 to match POSITION_STEP in src/lib/ordering.ts. float8 has
-- ~52 bits of mantissa, so halving the gap between neighbours survives far
-- more consecutive drops between the same pair than a person will ever make;
-- the board has run on the same arithmetic since P2 without a rebalance.
--
-- ## Two things this migration is careful about
--
-- **The default is not decoration.** Every column here is `not null default
-- extract(epoch from clock_timestamp())`. `db push` hits the live project
-- while the deployed bundle is still the old one, so for the minutes between
-- the push and Cloudflare finishing a deploy, the running app inserts
-- channels, collections and pages with no `position` at all — and so does
-- `scripts/seed.ts`, at twelve separate call sites including the four-verb
-- anon RLS probe that Non-negotiable 2 requires to stay green. A defaultless
-- NOT NULL column turns all of that into 23502. The epoch default is also
-- always larger than any backfilled value below (~1.7e9 against a few
-- thousand), so a row created by code that does not know about ordering lands
-- at the bottom of its list, which is where a new row belongs.
--
-- **The backfill reproduces what each list looks like TODAY, not creation
-- order.** These lists are not currently rendered by `created_at`, and the
-- moment the client starts reading `position` the backfill becomes the
-- visible order. Getting this wrong would rearrange every sidebar and every
-- docs tree on deploy, and only a second migration could put it back. So each
-- window's `order by` copies the sort key that surface uses right now:
--   * channels   — alphabetical (src/lib/channels.tsx fetched .order('name'))
--   * collections — alphabetical (flattenTree, src/lib/pages.ts)
--   * pages      — most recently updated first (src/lib/useDocs.ts)
-- `id` is the tiebreak everywhere: it is the primary key, so each window is a
-- total order and the result is deterministic.

-- ---------------------------------------------------------------------------
-- channels — one sequence per kind, because the sidebar renders chat and forum
-- as two separate lists (SPEC §1.2). Ordering across kinds would be a number
-- nothing reads.
-- ---------------------------------------------------------------------------

alter table public.channels
  add column position float8 not null default extract(epoch from clock_timestamp());

update public.channels c
set position = ordered.rn * 1024.0
from (
  select id, row_number() over (partition by kind order by name, id) as rn
  from public.channels
) as ordered
where ordered.id = c.id;

comment on column public.channels.position is
  'Sidebar order within kind. Fractional: a channel dropped between neighbours takes (prev + next) / 2.';

-- The sidebar's ordering read. The client currently selects every channel and
-- splits by kind in memory (5-30 users, a handful of rows), so this index is
-- for the ordered-by-kind read the sidebar will grow into, not one it issues
-- today.
create index channels_kind_position_idx on public.channels (kind, position);

-- ---------------------------------------------------------------------------
-- collections — one sequence per parent. `parent_id` is null for a root
-- collection, and `partition by parent_id` groups all the nulls together
-- (partitioning uses not-distinct semantics), which is exactly the root list
-- the tree renders.
-- ---------------------------------------------------------------------------

alter table public.collections
  add column position float8 not null default extract(epoch from clock_timestamp());

update public.collections c
set position = ordered.rn * 1024.0
from (
  select id, row_number() over (partition by parent_id order by name, id) as rn
  from public.collections
) as ordered
where ordered.id = c.id;

comment on column public.collections.position is
  'Docs tree order among siblings sharing a parent_id (null parent = the root list).';

create index collections_parent_position_idx on public.collections (parent_id, position);

-- ---------------------------------------------------------------------------
-- pages — one sequence per collection. A page with a null collection_id is
-- un-filed (P4's collection-delete behaviour: the child collection cascades,
-- its pages survive un-filed), and those render as their own list, so they
-- order among themselves the same way.
--
-- Backfilled by `updated_at desc` to match today's tree. Note what changes
-- once this lands: a page stops bubbling to the top of its collection when
-- someone edits it. That is inherent to a manually ordered list — an order
-- you can drag cannot also rearrange itself underneath you — and it is the
-- point of the feature, not a side effect. Recorded in DECISIONS.
-- ---------------------------------------------------------------------------

alter table public.pages
  add column position float8 not null default extract(epoch from clock_timestamp());

update public.pages p
set position = ordered.rn * 1024.0
from (
  select id, row_number() over (partition by collection_id order by updated_at desc, id) as rn
  from public.pages
) as ordered
where ordered.id = p.id;

comment on column public.pages.position is
  'Docs tree order within a collection (null collection_id = the un-filed list).';

create index pages_collection_position_idx on public.pages (collection_id, position);

-- No RLS changes. All three tables already carry the single blanket
-- `for all to authenticated using (true) with check (true)` policy from their
-- creating migrations, and a policy covers every column of its table — a new
-- column needs no new grant (Non-negotiable 2, SPEC §2.2).
