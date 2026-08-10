-- P1 · attachments — SPEC.md §2.3
--
-- Files uploaded against a message (P1), and later a post, page or task. The
-- owner is polymorphic and integrity is enforced in app code, exactly like
-- `links` (SPEC.md §1.8), which is why owner_id is text: the database holds two
-- id types because messages.id is a bigint identity (DECISIONS #2).

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('message', 'post', 'page', 'task')),
  -- text, not uuid — a message owner is a bigint, everything else a uuid.
  owner_id text not null,
  storage_path text not null,
  filename text not null,
  mime text,
  size_bytes int,
  created_at timestamptz not null default now()
);

comment on table public.attachments is
  'Uploaded files, polymorphic by (owner_type, owner_id). Integrity is app-enforced.';

-- "Which files belong to this message" runs for every message on screen.
create index attachments_owner_idx on public.attachments (owner_type, owner_id);

-- RLS — SPEC.md §2.2. One blanket policy, same as every other table.
alter table public.attachments enable row level security;

create policy "attachments_authenticated_all" on public.attachments
  for all
  to authenticated
  using (true)
  with check (true);

-- The bucket. Private: a signed URL is required to read anything, so an
-- uploaded screenshot never becomes a permanent world-readable link. See
-- DECISIONS #9.
--
-- file_size_limit is the real 10 MB wall. The client checks too, but only so
-- the user gets an instant error instead of a wasted upload — a client check
-- alone would let anything bypassing the UI fill the free tier's 1 GB.
-- `do update`, not `do nothing`: the dashboard's "New bucket" button defaults
-- to *public*, so a pre-existing bucket of this name would silently keep every
-- uploaded file world-readable while this migration reported success. The one
-- security property here must not depend on a precondition nothing checks.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760;

-- Storage policies.
--
-- storage.objects cannot take the single blanket policy the app tables use: it
-- is one table holding every bucket, so an unscoped policy would also govern
-- every bucket added later. These are scoped to this bucket and otherwise say
-- exactly what Non-negotiable 2 says — any authenticated teammate, full access,
-- no per-row ownership.
create policy "attachments_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

create policy "attachments_objects_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments');

create policy "attachments_objects_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments')
  with check (bucket_id = 'attachments');

create policy "attachments_objects_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments');

-- Realtime.
--
-- An attachment row can only be written after its message exists, because
-- owner_id is the message id. So a message's INSERT event always arrives before
-- its attachment row does, and without this every other client would render a
-- message with a missing image until it reloaded. One event per upload, not per
-- message, so the cost is negligible (Non-negotiable 8).
--
-- Explicit column list for consistency with the messages publication
-- (DECISIONS #4) — though #7 measured that the list does not actually trim the
-- payload, so this documents intent rather than saving bytes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attachments (
      id,
      owner_type,
      owner_id,
      storage_path,
      filename,
      mime,
      size_bytes,
      created_at
    );
  end if;
end
$$;
