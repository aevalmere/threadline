-- P1 · usernames must end alphanumeric, not just start that way
--
-- Follows 20260810121924_usernames.sql as a new migration rather than an edit,
-- because that one has run (Non-negotiable 6).
--
-- **The bug this closes.** `profiles_username_format` allowed a trailing `.`,
-- `-` or `_`; `slugify_username()` strips them. Those two disagreeing matters
-- because the two write paths do different things with the value:
--
--   registration → handle_new_user() stores slugify_username(requested), so
--                  asking for `bob.` created an account named `bob`. The person
--                  then cannot sign in — email_for_username() resolves the
--                  stored name, not the typed one — and `@bob.` never resolves
--                  as a mention. If the slug fell under three characters
--                  (`a._`), the trigger discarded it entirely and derived a
--                  username from the email instead.
--   /settings    → updates profiles.username directly, where only this CHECK
--                  applies, so `bob.` would have been stored verbatim.
--
-- So the same typed name produced two different stored names depending on which
-- screen you were on. Tightening the CHECK to `slugify_username()`'s fixed
-- points — values it returns unchanged — removes the disagreement instead of
-- papering over it: requested and stored are now always identical, which is
-- also what makes the register function's availability pre-check honest.
--
-- Found by the reviewer subagent on the register function (Non-negotiable 7).

-- Every existing row already conforms: the backfill wrote slugify_username()
-- output, whose outer trim guarantees an alphanumeric last character, and the
-- `-2` disambiguation suffix ends in a digit. Postgres validates the constraint
-- against existing rows as it is added, so a non-conforming row would fail this
-- migration loudly rather than leaving the constraint unenforced.
alter table public.profiles drop constraint profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$');

comment on constraint profiles_username_format on public.profiles is
  'The fixed points of slugify_username(): 3-24 chars, first and last alphanumeric.';
