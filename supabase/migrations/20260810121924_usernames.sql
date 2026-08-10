-- P1 · usernames — SPEC.md §2.3 and §5
--
-- Accounts change shape: registration is gated by a shared invite code checked
-- in an Edge Function, and sign-in is username + password rather than a magic
-- link. See DECISIONS #14.
--
-- This migration owns the database half of that:
--   * profiles.username, unique case-insensitively, format-constrained
--   * handle_new_user() reading the username chosen at registration
--   * email_for_username(), so a typed username can reach signInWithPassword
--
-- The client mirrors the username rule for instant errors; this file is the
-- wall. They must be changed together.
--
-- Project-level signups stay DISABLED. That is what makes the invite code a
-- gate rather than decoration: without it, anyone holding the anon key could
-- call GoTrue's public signup endpoint directly and skip the Edge Function.
-- `scripts/seed.ts` asserts that setting is still off on every run.

-- 0. One definition of "what a username looks like", used by the backfill
-- below, by the signup trigger, and mirrored in src/lib/username.ts.
--
-- It exists because the rule was about to be written twice in this same file,
-- and two copies of a normalisation rule drift the moment one grows a case the
-- other does not. Returns null when nothing legal survives, so callers decide
-- what to do about it rather than being handed an empty string.
--
-- Its output always satisfies the CHECK added in step 5, or is null: the inner
-- trim guarantees an alphanumeric first character, `left()` caps the length
-- without touching it, and the outer trim can only shorten. Callers reject
-- anything under 3 characters.
--
-- `immutable`: same input, same output, no reads.
create function public.slugify_username(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    -- Trimmed twice on purpose. The first trim strips leading/trailing
    -- punctuation; `left()` can then reintroduce a trailing one by cutting
    -- mid-string, so the second trim cleans up after it.
    trim(both '-._' from
      left(
        trim(both '-._' from
          lower(regexp_replace(coalesce(raw, ''), '[^a-zA-Z0-9._-]+', '-', 'g'))
        ),
        24
      )
    ),
    ''
  );
$$;

comment on function public.slugify_username(text) is
  'Canonical username shape. The client mirrors this rule for instant errors; the database is the wall.';

-- 1. The column. Nullable to begin with — rows already exist.
alter table public.profiles add column username text;

comment on column public.profiles.username is
  'Unique handle. Sign-in identifier and the @mention key. Case-insensitively unique.';

-- 2. Backfill. Existing display names came from the email local part, which is
-- already username-shaped, but it is not guaranteed unique or legal — two
-- teammates can be `ethan` at different domains. Slugify, then disambiguate
-- with a numeric suffix so step 4's unique index can actually be created.
--
-- Deterministic order (created_at, then id) so the *first* account keeps the
-- bare name and a re-run over the same data would produce the same answer.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in
    select id, display_name
    from public.profiles
    order by created_at, id
  loop
    base := public.slugify_username(r.display_name);
    -- Anything that slugged away to nothing, or is too short to be legal,
    -- falls back to something stable and obviously generated.
    if base is null or length(base) < 3 then
      base := 'member-' || substr(replace(r.id::text, '-', ''), 1, 6);
    end if;

    candidate := base;
    n := 1;
    while exists (
      select 1 from public.profiles
      where username is not null
        and lower(username) = lower(candidate)
    ) loop
      n := n + 1;
      -- Trim the base, not the suffix — a truncated suffix would collide again.
      candidate := left(base, 24 - length(n::text) - 1) || '-' || n::text;
    end loop;

    update public.profiles set username = candidate where id = r.id;
  end loop;
end
$$;

-- 3. Now that every row has one.
alter table public.profiles alter column username set not null;

-- 4. Unique, case-insensitively. `Ethan` and `ethan` being two different people
-- is nobody's expectation, and sign-in looks up with lower() to match.
create unique index profiles_username_lower_key
  on public.profiles (lower(username));

-- 5. Format, enforced in the database rather than only in the client.
--
-- Without this the invariant holds for backfilled rows and for anything the
-- register function writes, and nowhere else — a dashboard invite for `j@x.com`
-- would happily store a one-character username, and the client's rules would be
-- advice. 3–24 characters, starting alphanumeric.
alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{2,23}$');

-- 6. The signup trigger now carries the chosen username through.
--
-- `admin.createUser({ user_metadata: { username, display_name } })` in the
-- register function lands in raw_user_meta_data, so the profile is created
-- correctly in one insert — no follow-up update, and no window where a profile
-- exists under a generated name.
--
-- The two paths differ deliberately on collision:
--
--   chosen at registration  → raise, aborting the signup. The register function
--                             already pre-checks and reports "that username is
--                             taken", so reaching here means a genuine race.
--                             Quietly handing someone `ethan-2` when they asked
--                             for `ethan` is worse than an error they can retry.
--   derived from the email  → disambiguate. This is the dashboard-invite path;
--                             nobody chose the name, and refusing to create the
--                             account is a baffling way to learn a username was
--                             taken.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text;
  base text;
  candidate text;
  n int := 1;
begin
  requested := public.slugify_username(new.raw_user_meta_data ->> 'username');

  if requested is not null and length(requested) >= 3 then
    candidate := requested;
  else
    base := public.slugify_username(split_part(new.email, '@', 1));
    if base is null or length(base) < 3 then
      base := 'member-' || substr(replace(new.id::text, '-', ''), 1, 6);
    end if;

    candidate := base;
    while exists (
      select 1 from public.profiles where lower(username) = lower(candidate)
    ) loop
      n := n + 1;
      candidate := left(base, 24 - length(n::text) - 1) || '-' || n::text;
    end loop;
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 7. Username → email, for sign-in.
--
-- Supabase authenticates on email + password; the user types a username. So
-- something reachable *without a session* has to map one to the other, and
-- this is it: one function, one scalar column, no table access. `anon` cannot
-- read profiles or auth.users, and this cannot be coaxed into returning
-- anything else — the return type is a scalar text and `u` is a bound
-- parameter, not interpolated SQL.
--
-- Accepted cost, recorded in DECISIONS #14: this is an account-existence
-- oracle. A caller with no session can confirm a username is real and learn its
-- email — which also undoes GoTrue's deliberate refusal to distinguish
-- unknown-email from wrong-password. That is inherent to "type a username to
-- sign in" rather than a flaw in this implementation, and it is a deliberate,
-- scoped exception to Non-negotiable 2's "anon gets nothing". The alternative —
-- a synthetic auth email — would break password-reset delivery for everyone,
-- which is the worse trade for a 5–30 person internal tool.
--
-- `stable`, not `volatile`: it reads and never writes.
create function public.email_for_username(u text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select au.email::text
  from public.profiles p
  join auth.users au on au.id = p.id
  where lower(p.username) = lower(trim(u));
$$;

comment on function public.email_for_username(text) is
  'Sign-in helper: resolves a username to its account email. Deliberately callable by anon — see DECISIONS #14.';

-- Explicit, so the grant is a decision visible in the diff rather than a
-- default inherited from PUBLIC.
revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;
