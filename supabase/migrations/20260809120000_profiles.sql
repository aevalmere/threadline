-- P0 · profiles — SPEC.md §2.3
--
-- One row per teammate, mirroring auth.users. Created automatically by a
-- trigger so that a person invited from the Supabase dashboard just works
-- with no extra step.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per teammate, mirroring auth.users. Populated by handle_new_user().';

-- RLS — SPEC.md §2.2. Exactly one blanket policy: any authenticated user has
-- full access. No roles, no per-row ownership. anon gets nothing.
alter table public.profiles enable row level security;

create policy "profiles_authenticated_all" on public.profiles
  for all
  to authenticated
  using (true)
  with check (true);

-- Auto-create the profile on signup. security definer because the inserting
-- role is the auth system, not the new user; empty search_path is the
-- Supabase-recommended hardening, so every identifier below is qualified.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
