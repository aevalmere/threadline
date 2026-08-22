-- P6 · search_v2 — file names, people, forgiving titles (beta round 2)
--
-- Ethan's beta asks, verbatim: "search doesnt include file names, it also
-- needs to be perfect? it also doesnt have usernames." Three answers:
--
-- 1. FILE NAMES. `attachments` gains a search_tsv on `filename`, and a
--    matching file surfaces AS THE THING THAT OWNS IT — a message hit (titled
--    by its channel, filename as the snippet), or a post/page/task hit. No
--    new entity type for files means every jump path the client already has
--    keeps working, and clicking a file result lands where the file lives.
--    A row matching on both its own text and a filename would appear twice
--    with the same key, so the union dedupes on (entity_type, entity_id),
--    keeping the higher-ranked appearance.
--
-- 2. FORGIVING TITLES. FTS matches whole words; typing "road" found no
--    "Roadmap". Posts, pages, and tasks now also match on a case-insensitive
--    title substring (ILIKE, metacharacters escaped), boosted 0.4 — above a
--    single body-word hit (≈0.24 at weight B), below a full title-word FTS
--    match (≈0.61 at A): a substring in a title is more intentional than a
--    word in a body, and less than a real word in a title. Messages keep
--    FTS-only: they have no titles, and body ILIKE over the busiest table is
--    the one place this would eventually hurt.
--
-- 3. PEOPLE. A `person` entity type over profiles, matched on username and
--    display name (substring). The client does not navigate a person — it
--    re-runs the search with their @username, which finds their mentions.
--
-- search_all is CREATE OR REPLACE — same signature, so this replays cleanly;
-- both function revokes are repeated because a REPLACE keeps the existing
-- ACL only for the same signature, and the seed's 42501 probes stand watch
-- either way (DECISIONS #28's rule: revoke public AND anon at birth).

-- Filenames are normalized before indexing: the default parser reads
-- `diagram.png` as ONE `host` token (the postgresql.org rule), so the bare
-- filename would only match if the whole thing were typed. Separators become
-- spaces — `translate` is immutable, so the generated column stays legal —
-- and every word of the name is searchable.
alter table public.attachments
  add column search_tsv tsvector generated always as (
    to_tsvector('english', translate(filename, './\-_', '     '))
  ) stored;

create index attachments_search_tsv_idx on public.attachments using gin (search_tsv);


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
  ),
  pat as (
    -- The ILIKE pattern, with LIKE metacharacters in the query escaped so a
    -- typed "%" or "_" matches itself.
    select '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as v
  )
  select entity_type, entity_id, parent_type, parent_id, title, snippet, rank
  from (
    select distinct on (entity_type, entity_id) *
    from (
      -- Chat messages and forum comments, by body.
      select
        'message'::text as entity_type,
        m.id::text as entity_id,
        case when m.channel_id is not null then 'channel'::text else 'post'::text end as parent_type,
        coalesce(m.channel_id::text, m.post_id::text) as parent_id,
        coalesce('#' || c.name, po.title, '') as title,
        ts_headline('english', m.body, tsq.v, 'StartSel=⟦, StopSel=⟧') as snippet,
        -- Query-time re-weighting of the unweighted P0 vector — DECISIONS #28.
        ts_rank(setweight(m.search_tsv, 'B'), tsq.v) as rank
      from public.messages m
      cross join tsq
      left join public.channels c on c.id = m.channel_id
      left join public.posts po on po.id = m.post_id
      where m.deleted_at is null
        and m.search_tsv @@ tsq.v

      union all

      -- A file on a message surfaces as that message.
      select
        'message', m.id::text,
        case when m.channel_id is not null then 'channel' else 'post' end,
        coalesce(m.channel_id::text, m.post_id::text),
        coalesce('#' || c.name, po.title, ''),
        -- The same normalization as the column, or the headline could never
        -- bracket a word inside a one-token filename.
        ts_headline('english', translate(a.filename, './\-_', '     '), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(setweight(a.search_tsv, 'B'), tsq.v)
      from public.attachments a
      cross join tsq
      join public.messages m on a.owner_type = 'message' and m.id::text = a.owner_id
      left join public.channels c on c.id = m.channel_id
      left join public.posts po on po.id = m.post_id
      where m.deleted_at is null
        and a.search_tsv @@ tsq.v

      union all

      select
        'post', p.id::text, null, null, p.title,
        ts_headline('english', public.flatten_rich_text(p.body_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(p.search_tsv, tsq.v)
          + (case when p.title ilike pat.v escape '\' then 0.4 else 0 end)
      from public.posts p
      cross join tsq
      cross join pat
      where p.search_tsv @@ tsq.v
         or p.title ilike pat.v escape '\'

      union all

      -- A file on a post surfaces as that post.
      select
        'post', a.owner_id, null, null, p.title,
        -- The same normalization as the column, or the headline could never
        -- bracket a word inside a one-token filename.
        ts_headline('english', translate(a.filename, './\-_', '     '), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(setweight(a.search_tsv, 'B'), tsq.v)
      from public.attachments a
      cross join tsq
      join public.posts p on a.owner_type = 'post' and p.id::text = a.owner_id
      where a.search_tsv @@ tsq.v

      union all

      select
        'page', pg.id::text, null, null, pg.title,
        ts_headline('english', public.flatten_rich_text(pg.body_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(pg.search_tsv, tsq.v)
          + (case when pg.title ilike pat.v escape '\' then 0.4 else 0 end)
      from public.pages pg
      cross join tsq
      cross join pat
      where pg.search_tsv @@ tsq.v
         or pg.title ilike pat.v escape '\'

      union all

      -- A file on a page surfaces as that page.
      select
        'page', a.owner_id, null, null, pg.title,
        -- The same normalization as the column, or the headline could never
        -- bracket a word inside a one-token filename.
        ts_headline('english', translate(a.filename, './\-_', '     '), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(setweight(a.search_tsv, 'B'), tsq.v)
      from public.attachments a
      cross join tsq
      join public.pages pg on a.owner_type = 'page' and pg.id::text = a.owner_id
      where a.search_tsv @@ tsq.v

      union all

      select
        'task', t.id::text, null, null, t.title,
        ts_headline('english', public.flatten_rich_text(t.description_rich), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(t.search_tsv, tsq.v)
          + (case when t.title ilike pat.v escape '\' then 0.4 else 0 end)
      from public.tasks t
      cross join tsq
      cross join pat
      where t.search_tsv @@ tsq.v
         or t.title ilike pat.v escape '\'

      union all

      -- A file on a task surfaces as that task.
      select
        'task', a.owner_id, null, null, t.title,
        -- The same normalization as the column, or the headline could never
        -- bracket a word inside a one-token filename.
        ts_headline('english', translate(a.filename, './\-_', '     '), tsq.v, 'StartSel=⟦, StopSel=⟧'),
        ts_rank(setweight(a.search_tsv, 'B'), tsq.v)
      from public.attachments a
      cross join tsq
      join public.tasks t on a.owner_type = 'task' and t.id::text = a.owner_id
      where a.search_tsv @@ tsq.v

      union all

      -- People, by handle or display name. The modest rank only guards the
      -- LIMIT-50 cut — the palette's fixed group order renders People first
      -- regardless of rank.
      select
        'person', pr.id::text, null, null, pr.display_name,
        '@' || pr.username,
        0.06::real
      from public.profiles pr
      cross join pat
      where pr.username ilike pat.v escape '\'
         or pr.display_name ilike pat.v escape '\'
    ) hits
    -- One row per entity: a message matching on body AND filename, or a post
    -- on title AND attachment, keeps its higher-ranked appearance.
    order by entity_type, entity_id, rank desc
  ) deduped
  order by rank desc
  limit 50
$$;

comment on function public.search_all(text) is
  'The one search box (SPEC §1.10): FTS + title substring across messages/posts/pages/tasks, file names folded into their owners, people by name. Callable by authenticated only.';

-- REPLACE with the same signature keeps the existing ACL, but the revokes
-- cost nothing to repeat and the rule (DECISIONS #28) is: at every birth or
-- rebirth, revoke PUBLIC and anon by name.
revoke all on function public.search_all(text) from public;
revoke execute on function public.search_all(text) from anon;
grant execute on function public.search_all(text) to authenticated;


-- No realtime changes. attachments' publication column list (DECISIONS #4)
-- does not carry search_tsv, and #7 measured that the list is not what trims
-- payloads anyway — same posture as every other search column.
