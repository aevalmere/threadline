-- P5 · take EXECUTE on search_all() and flatten_rich_text() away from PUBLIC
--
-- A new migration rather than an edit: 20260822175241 has already run
-- (Non-negotiable 6).
--
-- **The bug — DECISIONS #18's lesson, half-applied.** That migration revoked
-- `from anon` and cited unread_counts() as precedent, but the precedent was
-- TWO revokes across two migrations: 20260810160428 stripped the implicit
-- PUBLIC grant (`revoke all ... from public`), and 20260810170411 then
-- removed the explicit `anon` grant Supabase's default privileges add. The
-- search migration did only the second half. A function's default ACL still
-- carries EXECUTE for the PUBLIC pseudo-role, and `anon` is a member of
-- PUBLIC like every role — so a signed-out client could still execute both
-- functions.
--
-- **Caught at birth, not retrofitted.** The seed's `anon search` probe
-- asserts refusal (42501), never emptiness — exactly what the #18 postmortem
-- demanded of every future function probe — and it failed on the first run
-- after the push. Nothing leaked meanwhile: security invoker + RLS returned
-- an empty result to anon, the same obscurity-not-access-control window #18
-- describes.

revoke all on function public.search_all(text) from public;
revoke all on function public.flatten_rich_text(jsonb) from public;

-- The explicit grants to `authenticated` from 20260822175241 are untouched
-- and sufficient. As with unread_counts: a later migration that DROPs and
-- re-CREATEs either function picks up the default grants again and must
-- repeat BOTH revokes; the `anon search` probe fails loudly if it does not.
