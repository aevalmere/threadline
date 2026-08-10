-- Revert the TEMPORARY anonymous access from 20260810052810 — DECISIONS #13
--
-- Closes the workspace again. Ethan asked for guest access to test without
-- logging in; the in-memory mock backend (DECISIONS #12) turned out to serve
-- that need better, so the exposure has no reason to exist.
--
-- This is the down-migration written into the header of 20260810052810,
-- applied as a NEW migration rather than by editing that one, per
-- Non-negotiable 6.
--
-- After this runs, Non-negotiable 2 holds again with no exceptions: every table
-- carries exactly one blanket policy for `authenticated`, and `anon` gets
-- nothing. The `to authenticated` policies were never touched, so nothing else
-- changes and no data moves.

drop policy if exists "profiles_anon_all" on public.profiles;
drop policy if exists "channels_anon_all" on public.channels;
drop policy if exists "channel_members_anon_all" on public.channel_members;
drop policy if exists "messages_anon_all" on public.messages;
drop policy if exists "attachments_anon_all" on public.attachments;
drop policy if exists "attachments_objects_anon" on storage.objects;
