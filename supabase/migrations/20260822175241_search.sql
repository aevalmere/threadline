-- P5 · search — search_tsv on posts, pages, tasks, and search_all()
-- (SPEC.md §1.10, §3). `messages` has carried its column and GIN since P0,
-- which is why the busiest table needs nothing here.
--
-- Two deliberate deviations from §3's original sketch, amended there in this
-- commit:
--
-- 1. Rich bodies are flattened through
--    jsonb_path_query_array('strict $.**."text"', silent) BEFORE
--    jsonb_to_tsvector. The sketch's bare jsonb_to_tsvector over the whole
--    document walks every string value — BlockNote scaffolding included — so
--    searching "paragraph" would have matched every document (DECISIONS #25
--    said decide before the column exists; this is the decision). BlockNote
--    keeps human-readable text under "text" keys at every nesting level
--    (image captions are the known, accepted exception); types, style names,
--    block ids, and storage paths live under other keys and stay out.
--    STRICT mode + silent, measured against the live database: lax mode's
--    array auto-unwrapping collects every value TWICE (once via the content
--    array, once via the inline node), which would bake doubled lexemes into
--    the stored vectors and doubled sentences into every snippet; strict
--    collects each exactly once, and silent swallows the structural errors
--    strict would otherwise raise on non-object nodes.
--
-- 2. search_all() returns parent_type/parent_id beyond the sketch's columns,
--    because a message hit is un-navigable without its parent: a chat
--    message jumps to /channels/<parent>?m=<id>, a forum comment to
--    /posts/<parent>?m=<id>. Returning the parent beats a per-click resolve.
--
-- Every expression below is immutable — the requirement for a generated
-- column: to_tsvector/jsonb_to_tsvector with an explicit config, and
-- jsonb_path_query_array.

alter table public.posts
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(
      jsonb_to_tsvector(
        'english',
        jsonb_path_query_array(coalesce(body_rich, '[]'::jsonb), 'strict $.**."text"', '{}'::jsonb, true),
        '["string"]'
      ),
      'B'
    )
  ) stored;

create index posts_search_tsv_idx on public.posts using gin (search_tsv);

alter table public.pages
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(
      jsonb_to_tsvector(
        'english',
        jsonb_path_query_array(coalesce(body_rich, '[]'::jsonb), 'strict $.**."text"', '{}'::jsonb, true),
        '["string"]'
      ),
      'B'
    )
  ) stored;

create index pages_search_tsv_idx on public.pages using gin (search_tsv);

alter table public.tasks
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(
      jsonb_to_tsvector(
        'english',
        jsonb_path_query_array(coalesce(description_rich, '[]'::jsonb), 'strict $.**."text"', '{}'::jsonb, true),
        '["string"]'
      ),
      'B'
    )
  ) stored;

create index tasks_search_tsv_idx on public.tasks using gin (search_tsv);


-- The same "text"-keys flattening as plain text, for ts_headline — a snippet
-- needs the source text, not the stored tsvector. Used only inside
-- search_all(); the generated columns above deliberately inline the
-- expression instead, so their stored values can never drift behind a
-- function redefinition.
create or replace function public.flatten_rich_text(doc jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select string_agg(t, ' ')
      from jsonb_array_elements_text(
        jsonb_path_query_array(coalesce(doc, '[]'::jsonb), 'strict $.**."text"', '{}'::jsonb, true)
      ) as t
    ),
    ''
  )
$$;

comment on function public.flatten_rich_text(jsonb) is
  'Human text of a BlockNote document (every "text" key, space-joined). Snippet source for search_all().';


-- One box, four tables (SPEC §1.10). security invoker: results pass through
-- each table's RLS as the caller. Tombstoned messages are excluded — their
-- body is blanked anyway (SPEC §1.3), but the guard keeps the contract
-- explicit rather than incidental.
create or replace function public.search_all(q text)
returns table (
  entity_type text,
  entity_id text,
  parent_type text,
  parent_id text,
  title text,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tsq as (
    select websearch_to_tsquery('english', q) as v
  )
  select * from (
    select
      'message'::text as entity_type,
      m.id::text as entity_id,
      case when m.channel_id is not null then 'channel'::text else 'post'::text end as parent_type,
      coalesce(m.channel_id::text, m.post_id::text) as parent_id,
      coalesce('#' || c.name, po.title, '') as title,
      -- ⟦⟧ markers instead of the default <b> tags: the source text is
      -- user-authored, so HTML markup would force the client to inject it.
      -- Markers parse into plain segments (splitSnippet in src/lib/search.ts).
      ts_headline('english', m.body, tsq.v, 'StartSel=⟦, StopSel=⟧') as snippet,
      -- The P0 messages vector is unweighted (all lexemes weight D, rank
      -- multiplier 0.1), while the other branches carry A/B — unweighted, an
      -- exact chat hit would rank ~4-10× below an equivalent doc hit and the
      -- global LIMIT could squeeze messages out entirely, against G5's "finds
      -- a phrase from a week-old chat message". Re-weighting at query time
      -- costs the matched rows only; the messages COLUMN stays untouched.
      ts_rank(setweight(m.search_tsv, 'B'), tsq.v) as rank
    from public.messages m
    cross join tsq
    left join public.channels c on c.id = m.channel_id
    left join public.posts po on po.id = m.post_id
    where m.deleted_at is null
      and m.search_tsv @@ tsq.v

    union all

    select
      'post', p.id::text, null, null, p.title,
      ts_headline('english', public.flatten_rich_text(p.body_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
      ts_rank(p.search_tsv, tsq.v)
    from public.posts p
    cross join tsq
    where p.search_tsv @@ tsq.v

    union all

    select
      'page', pg.id::text, null, null, pg.title,
      ts_headline('english', public.flatten_rich_text(pg.body_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
      ts_rank(pg.search_tsv, tsq.v)
    from public.pages pg
    cross join tsq
    where pg.search_tsv @@ tsq.v

    union all

    select
      'task', t.id::text, null, null, t.title,
      ts_headline('english', public.flatten_rich_text(t.description_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
      ts_rank(t.search_tsv, tsq.v)
    from public.tasks t
    cross join tsq
    where t.search_tsv @@ tsq.v
  ) hits
  order by rank desc
  limit 50
$$;

comment on function public.search_all(text) is
  'The one search box (SPEC §1.10): FTS across messages/posts/pages/tasks, ranked, 50 max. Callable by authenticated only.';

-- The unread_counts() lesson (DECISIONS #18): Supabase's default privileges
-- grant EXECUTE on new public functions to anon EXPLICITLY, and a revoke
-- from PUBLIC does not touch an explicit role grant. Revoke anon by name.
-- SPEC §2.2: anything reachable by anon beyond email_for_username is a bug —
-- so the pure helper is closed too, not just the one that reads tables.
revoke execute on function public.search_all(text) from anon;
revoke execute on function public.flatten_rich_text(jsonb) from anon;
grant execute on function public.search_all(text) to authenticated;
grant execute on function public.flatten_rich_text(jsonb) to authenticated;


-- No realtime changes: search is request/response, and no publication lists
-- these columns. The messages publication column list (DECISIONS #4) omits
-- search_tsv and is untouched — and #7 measured the list is not load-bearing
-- anyway.
