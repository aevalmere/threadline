-- TEMPORARY · anonymous access for testing — DECISIONS #10
--
-- ============================================================================
-- THIS MIGRATION MAKES THE PRODUCTION WORKSPACE PUBLIC.
--
-- With these policies in place, anyone who loads https://threadline-cc0.pages.dev
-- can read AND write every channel, message and attachment without signing in.
-- No password, no invite, no link. The URL is the only thing standing between a
-- stranger and the team's chat.
--
-- Ethan asked for this explicitly, after being shown that consequence, to test
-- without logging in. It is meant to be short-lived.
--
-- TO REVERT: run the down-migration below as a NEW migration (never edit this
-- file once applied — Non-negotiable 6). The revert is four `drop policy`
-- statements plus the storage pair; nothing else has to change, because the
-- `to authenticated` policies are untouched and keep working throughout.
--
--   drop policy "channels_anon_all"        on public.channels;
--   drop policy "channel_members_anon_all" on public.channel_members;
--   drop policy "messages_anon_all"        on public.messages;
--   drop policy "profiles_anon_all"        on public.profiles;
--   drop policy "attachments_anon_all"     on public.attachments;
--   drop policy "attachments_objects_anon" on storage.objects;
-- ============================================================================
--
-- Shape note: these are *additional* policies, not edits to the existing ones.
-- Postgres ORs permissive policies together, so the `to authenticated` policies
-- from P0 keep doing exactly what Non-negotiable 2 says. Dropping the six below
-- restores the intended posture completely, which is what makes this safely
-- reversible.

create policy "profiles_anon_all" on public.profiles
  for all to anon using (true) with check (true);

create policy "channels_anon_all" on public.channels
  for all to anon using (true) with check (true);

create policy "channel_members_anon_all" on public.channel_members
  for all to anon using (true) with check (true);

create policy "messages_anon_all" on public.messages
  for all to anon using (true) with check (true);

create policy "attachments_anon_all" on public.attachments
  for all to anon using (true) with check (true);

-- Storage too, or a guest sees broken images: signed URLs are minted through
-- the same policy surface. Still bucket-scoped, so no other bucket is exposed.
create policy "attachments_objects_anon" on storage.objects
  for all to anon
  using (bucket_id = 'attachments')
  with check (bucket_id = 'attachments');
