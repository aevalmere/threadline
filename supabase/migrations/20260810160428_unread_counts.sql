-- P1 · unread_counts() — SPEC.md §1.4
--
-- Every channel's unread count for the calling user, in one round trip.
--
-- **Why this is SQL and not the client.** The first implementation counted in
-- the browser from a bounded window of messages, because `src/lib/unread.ts`
-- already had a tested `unreadCount()`. That cannot be made correct: the client
-- only holds messages it has fetched, so the window has to be anchored
-- somewhere, and any single anchor is wrong for some channel. Anchoring at the
-- oldest read-pointer across all channels — which is what shipped to review —
-- meant one never-opened channel pinned the window near the start of the table
-- forever, and *every* badge read 0 while unread messages sat in plain sight.
--
-- Counting where the rows are removes the anchor, the window, and the whole
-- class of bug. It is one indexed `group by` over `messages (channel_id, id)`.
--
-- **This moves SPEC §1.4's rule into SQL**, so it is now stated in one place
-- rather than two. `scripts/seed.ts` asserts every clause of it against the
-- live database; ROADMAP's never-break entry points there instead of at a unit
-- test. See DECISIONS #18.

create function public.unread_counts()
returns table (channel_id uuid, unread bigint)
language sql
-- `security invoker` (the default, stated for emphasis): this must run as the
-- caller so `auth.uid()` is *them*. A `security definer` here would report one
-- user's unread counts to everybody.
security invoker
stable
set search_path = ''
as $$
  select
    c.id as channel_id,
    count(m.id)::bigint as unread
  from public.channels c
  -- LEFT, not INNER: a channel you have never opened has no channel_members
  -- row at all, and it still needs a badge. A missing row and a null pointer
  -- both mean "nothing read here", which `coalesce` below turns into 0.
  left join public.channel_members cm
    on cm.channel_id = c.id
   and cm.user_id = auth.uid()
  -- The join carries the filters rather than a WHERE clause, so a channel with
  -- nothing unread still produces a row — with count 0 — instead of vanishing.
  left join public.messages m
    on m.channel_id = c.id
   and m.id > coalesce(cm.last_read_message_id, 0)
   -- SPEC §1.4: your own messages are never unread to you, and a tombstoned
   -- message stops counting the moment it is deleted.
   and m.author_id <> auth.uid()
   and m.deleted_at is null
  group by c.id;
$$;

comment on function public.unread_counts() is
  'Per-channel unread counts for the caller. SPEC §1.4 lives here — see DECISIONS #18.';

revoke all on function public.unread_counts() from public;
grant execute on function public.unread_counts() to authenticated;
