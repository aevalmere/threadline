-- P1 · enforce the one-level-deep thread rule in the database — SPEC.md §1.3
--
-- "Threads are one level deep — replies never nest further; a reply to a reply
-- attaches to the same root." Until now only the client enforced that, via
-- threadRootFor() in src/lib/threads.ts. thread_root_id is a plain FK to
-- messages(id), so anything reaching the API directly could write a nested
-- chain — and P3 reuses this table for forum comments, which is a second code
-- path that has to get it right.
--
-- Two branches, and they behave differently on purpose:
--
--   * Replying to a reply is REWRITTEN to the root. That is exactly what the
--     client already computes, so doing it silently keeps every caller working
--     instead of handing them an error to handle.
--   * Re-parenting a message that already HAS replies is REJECTED. There is no
--     right answer to rewrite it to — the operation would drag an existing
--     thread down a level — and no code path in the app or the seed issues it,
--     so an exception surfaces a bug rather than papering over one.
--
-- Verified by scripts/seed.ts (threadFlatteningCheck), which sends what a buggy
-- client would and asserts the row comes back attached to the root.
--
-- See DECISIONS #8.

create function public.flatten_thread_root()
returns trigger
language plpgsql
-- security definer and an empty search_path match handle_new_user()'s house
-- style, and keep the lookups independent of the caller's row visibility.
-- Under Non-negotiable 2 every authenticated user can already see every row,
-- so this is belt-and-braces rather than a requirement. Postgres refuses
-- direct calls to a `returns trigger` function, so it grants nobody anything.
security definer
set search_path = ''
as $$
declare
  target_root bigint;
  has_replies boolean;
begin
  if new.thread_root_id is null then
    return new;
  end if;

  -- A message cannot be its own thread. Unreachable on insert, since the
  -- client never knows the identity value in advance, but legal on update.
  if new.thread_root_id = new.id then
    new.thread_root_id := null;
    return new;
  end if;

  -- The other half of the invariant: a message that already has replies must
  -- stay a root. Letting it become a reply would nest its whole thread one
  -- level deeper without touching any of those rows.
  select exists (
    select 1 from public.messages m where m.thread_root_id = new.id
  ) into has_replies;

  if has_replies then
    raise exception
      'message % has replies and cannot become a reply itself (SPEC 1.3: threads are one level deep)',
      new.id;
  end if;

  -- The flattening itself: if the target is a reply, adopt its root.
  --
  -- `for share` closes an otherwise open race: a concurrent UPDATE re-parenting
  -- the target would be invisible here (we would read its pre-update NULL and
  -- skip flattening) while its own has_replies check saw no replies yet, and
  -- the pair would commit a two-level chain. The FK's own KEY SHARE lock does
  -- not conflict with that UPDATE, so nothing else serialises them.
  select m.thread_root_id into target_root
  from public.messages m
  where m.id = new.thread_root_id
  for share;

  if target_root is not null then
    new.thread_root_id := target_root;
  end if;

  return new;
end;
$$;

comment on function public.flatten_thread_root() is
  'Keeps threads one level deep (SPEC 1.3): a reply to a reply adopts the root.';

create trigger messages_flatten_thread_root
  before insert or update of thread_root_id on public.messages
  for each row
  execute function public.flatten_thread_root();
