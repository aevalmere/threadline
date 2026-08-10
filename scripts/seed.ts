/**
 * Seed data + the four-verb anon RLS check.
 *
 *   npm run seed
 *
 * Runs locally only. Reads SUPABASE_SERVICE_ROLE_KEY from .env.local, which is
 * gitignored and never reaches the browser or Cloudflare (Non-negotiable 9).
 *
 * The second half is the verification for Non-negotiable 2: it signs in as a
 * real user through the *anon* client and proves select / insert / update /
 * delete all work under the blanket policy. A green seed run is the evidence
 * that RLS is configured correctly.
 *
 * It still mints that session with `generateLink({ type: 'magiclink' })`
 * (DECISIONS #3), even though the product no longer offers magic-link sign-in
 * (DECISIONS #14). That is deliberate and worth knowing: it is an *admin* API,
 * so it does not depend on any UI, and it avoids storing a seed password. It
 * does depend on the email provider staying enabled — which it is, because
 * password reset needs it. If that ever changes, switch to a password-based
 * seed user per #3's stated fallback.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON || !SERVICE) {
  console.error(
    'Missing env. .env.local needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and ' +
      'SUPABASE_SERVICE_ROLE_KEY. Copy .env.example.',
  )
  process.exit(1)
}

const EMAIL_A = process.env.SEED_USER_A_EMAIL ?? 'alice@example.com'
const EMAIL_B = process.env.SEED_USER_B_EMAIL ?? 'bob@example.com'

/** Throwaway channel the RLS check writes and then removes. */
const RLS_PROBE = '__rls_check'

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function die(step: string, error: { message: string } | null): void {
  if (error) {
    console.error(`✗ ${step}: ${error.message}`)
    process.exit(1)
  }
}

/** Create the user, or reuse them if a previous seed run already did. */
async function ensureUser(
  email: string,
  displayName?: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : undefined,
  })
  if (!error && data.user) return data.user.id

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  die(`look up existing user ${email}`, listErr)
  const found = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!found) {
    console.error(`✗ create user ${email}: ${error?.message ?? 'unknown error'}`)
    process.exit(1)
  }
  return found.id
}

async function ensureChannel(
  name: string,
  topic: string,
  createdBy: string,
): Promise<string> {
  const { data, error } = await admin
    .from('channels')
    .upsert(
      { name, kind: 'chat', topic, created_by: createdBy },
      { onConflict: 'name,kind' },
    )
    .select('id')
    .single<{ id: string }>()
  die(`upsert channel #${name}`, error)
  return data!.id
}

async function main() {
  console.log('Seeding…\n')

  // 1. Users — the trigger creates their profiles.
  const userA = await ensureUser(EMAIL_A)
  const userB = await ensureUser(EMAIL_B)
  console.log(`✓ users        ${EMAIL_A}, ${EMAIL_B}`)


  const { error: profileErr, count: profileCount } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('id', [userA, userB])
  die('read back profiles', profileErr)
  if (profileCount !== 2) {
    console.error(
      `✗ handle_new_user trigger: expected 2 profiles, found ${profileCount}`,
    )
    process.exit(1)
  }
  console.log('✓ profiles     created by the handle_new_user trigger')

  // 2. Channels + membership.
  const general = await ensureChannel('general', 'Everything and anything', userA)
  const random = await ensureChannel('random', 'Off-topic', userB)

  const { error: memberErr } = await admin.from('channel_members').upsert(
    [
      { channel_id: general, user_id: userA },
      { channel_id: general, user_id: userB },
      { channel_id: random, user_id: userA },
      { channel_id: random, user_id: userB },
    ],
    { onConflict: 'channel_id,user_id' },
  )
  die('add channel members', memberErr)
  console.log('✓ channels     #general, #random (both users in both)')

  // 3. No message seeding. The original 50 filler messages were deleted from
  //    production on 2026-08-10 at Ethan's request once the channel had real
  //    traffic, and the script no longer recreates them — a seed that writes
  //    chat into a channel people actually use is a liability, not a
  //    convenience. Users, channels and membership are still seeded, because
  //    those are structure rather than content.
  //
  //    G1's pagination check needs volume; generate it by hand when that item
  //    lands rather than by carrying permanent filler here.
  const { count: existing } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', general)
  console.log(`✓ messages     ${existing ?? 0} in #general, none seeded`)

  await threadFlatteningCheck(general, userA)
  await rlsCheck(EMAIL_A)
}

/**
 * Proves the flatten_thread_root trigger is live — SPEC.md §1.3, DECISIONS #8.
 *
 * Client code already collapses a reply target to its root, so a passing app is
 * no evidence the database rule exists. This deliberately sends what a buggy
 * client would: a reply pointing at another *reply*. The trigger must rewrite
 * it to the root.
 */
async function threadFlatteningCheck(channelId: string, authorId: string) {
  // Builds its own root and reply rather than hunting for a seeded one, so the
  // check works against an empty channel and leaves nothing behind either way.
  const probe = async (body: string, threadRootId: number | null) => {
    const { data, error } = await admin
      .from('messages')
      .insert({
        channel_id: channelId,
        author_id: authorId,
        thread_root_id: threadRootId,
        body,
      })
      .select('id, thread_root_id')
      .single()
    die(`insert ${body}`, error)
    return data as { id: number; thread_root_id: number | null }
  }

  const root = await probe('__probe_root', null)
  const reply = await probe('__probe_reply', root.id)
  // Deliberately wrong: target the reply, not the root. This is what a buggy
  // client would send, and what the trigger exists to correct.
  const nested = await probe('__probe_nested', reply.id)

  // Delete before asserting, so a failure still leaves the channel clean.
  // Replies first: removing the root cascades, but being explicit keeps this
  // honest if the FK ever changes.
  for (const id of [nested.id, reply.id, root.id]) {
    const { error } = await admin.from('messages').delete().eq('id', id)
    die(`remove probe message ${id}`, error)
  }

  if (reply.thread_root_id !== root.id) {
    console.error(
      `✗ thread check: a reply to root ${root.id} came back on ` +
        `${reply.thread_root_id}. The trigger is rewriting what it should leave alone.`,
    )
    process.exit(1)
  }

  if (nested.thread_root_id !== root.id) {
    console.error(
      `✗ thread flattening: replied to reply ${reply.id}, expected root ` +
        `${root.id}, got ${nested.thread_root_id}. Is the flatten_thread_root ` +
        'trigger applied? (npx supabase db push)',
    )
    process.exit(1)
  }

  console.log(
    `✓ threads      one level deep — a reply to reply ${reply.id} was ` +
      `rewritten to root ${root.id}`,
  )
}

interface ProbeResult {
  verb: string
  ok: boolean
  detail: string
}

/**
 * The blanket policy on `attachments` (DECISIONS #9), judged on rows affected
 * rather than error presence — same reasoning as DECISIONS #5. Until now the
 * probe covered `channels` only, and #5 flagged that gap as worth closing "when
 * the table count grows". Adding a table plus a whole new storage policy
 * surface is that moment.
 */
async function attachmentsCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []

  const ins = await anon
    .from('attachments')
    .insert({
      owner_type: 'message',
      owner_id: '__probe',
      storage_path: '__probe/none',
      filename: 'probe.txt',
      mime: 'text/plain',
      size_bytes: 1,
    })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'att insert',
    ok: !ins.error && !!ins.data,
    detail: ins.error?.message ?? '1 row created',
  })

  if (!ins.data) {
    out.push({ verb: 'att delete', ok: false, detail: 'skipped — insert failed' })
    return out
  }

  const sel = await anon.from('attachments').select('id').eq('id', ins.data.id)
  out.push({
    verb: 'att select',
    ok: !sel.error && (sel.data?.length ?? 0) === 1,
    detail: sel.error ? sel.error.message : `${sel.data?.length ?? 0} rows visible`,
  })

  const del = await anon.from('attachments').delete().eq('id', ins.data.id).select('id')
  out.push({
    verb: 'att delete',
    ok: !del.error && (del.data?.length ?? 0) === 1,
    detail: del.error
      ? del.error.message
      : `${del.data?.length ?? 0} rows deleted${
          (del.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
        }`,
  })

  return out
}

/**
 * The storage round trip (DECISIONS #9). This is the only thing that tells us
 * the four bucket-scoped `storage.objects` policies actually work — and it has
 * to be judged on *content*, because a denied storage read comes back as an
 * empty list rather than an error, exactly like a denied SELECT.
 *
 * It also proves the bucket is private, which is the whole reason for the
 * signed-URL machinery.
 */
async function storageCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const path = `__probe/${crypto.randomUUID()}.txt`
  const body = `probe ${crypto.randomUUID()}`

  const up = await anon.storage
    .from('attachments')
    .upload(path, new Blob([body], { type: 'text/plain' }))
  out.push({
    verb: 'file upload',
    ok: !up.error && !!up.data?.path,
    detail: up.error?.message ?? `stored at ${up.data?.path}`,
  })
  if (up.error) {
    for (const verb of ['signed read', 'private', 'file delete']) {
      out.push({ verb, ok: false, detail: 'skipped — upload failed' })
    }
    return out
  }

  // A signed URL must return exactly what went in.
  const signed = await anon.storage.from('attachments').createSignedUrl(path, 60)
  let readBack = ''
  if (signed.data?.signedUrl) {
    const r = await fetch(signed.data.signedUrl)
    readBack = r.ok ? await r.text() : `HTTP ${r.status}`
  }
  out.push({
    verb: 'signed read',
    ok: readBack === body,
    detail: readBack === body ? 'signed URL returned the file' : `got ${JSON.stringify(readBack)}`,
  })

  // …and the unsigned public path must not. This is the assertion that would
  // catch the bucket having been created (or reverted) as public.
  const publicRes = await fetch(`${URL}/storage/v1/object/public/attachments/${path}`)
  out.push({
    verb: 'private',
    ok: !publicRes.ok,
    detail: publicRes.ok
      ? 'PUBLIC URL SERVED THE FILE — the bucket is not private'
      : `unsigned URL refused (HTTP ${publicRes.status})`,
  })

  const rm = await anon.storage.from('attachments').remove([path])
  const removed = (rm.data?.length ?? 0) === 1
  out.push({
    verb: 'file delete',
    ok: !rm.error && removed,
    detail: rm.error
      ? rm.error.message
      : removed
        ? 'probe object gone'
        : '0 objects removed — silently blocked',
  })

  return out
}

/**
 * `unread_counts()` — SPEC §1.4, clause by clause.
 *
 * **This is the never-break path for unread counting** (ROADMAP). It used to be
 * a unit test over a pure `unreadCount()`, but the rule moved into SQL when the
 * client-side version turned out to be unfixable (DECISIONS #18), so the
 * coverage moved with it. Asserting it here is strictly better evidence: it
 * runs against the real function, through the anon client, under RLS.
 *
 * Every clause gets its own probe, because each one is a different way to be
 * silently wrong — and a badge that reads 0 when you have unread messages is
 * exactly the failure that shipped before this existed.
 */
async function unreadCountsCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const me = await ensureUser(EMAIL_A)
  const them = await ensureUser(EMAIL_B)

  // A private stage, so real channel traffic cannot move these numbers.
  const stage = await ensureChannel('__unread_counts', 'temporary', them)
  await admin.from('messages').delete().eq('channel_id', stage)
  await admin
    .from('channel_members')
    .delete()
    .eq('channel_id', stage)
    .eq('user_id', me)

  const say = async (author: string, body: string) => {
    const { data } = await admin
      .from('messages')
      .insert({ channel_id: stage, author_id: author, body })
      .select('id')
      .single<{ id: number }>()
    return data!.id
  }

  const countHere = async (): Promise<number | null> => {
    const { data, error } = await anon.rpc('unread_counts')
    if (error) return null
    const row = ((data ?? []) as { channel_id: string; unread: number }[]).find(
      (r) => r.channel_id === stage,
    )
    return row ? Number(row.unread) : null
  }

  // No membership row at all — a channel created after you joined. It must
  // still be counted, which is why the function LEFT JOINs channel_members.
  await say(them, '__u1')
  await say(them, '__u2')
  const noRow = await countHere()
  out.push({
    verb: 'unread no-row',
    ok: noRow === 2,
    detail: noRow === 2 ? '2 unread with no membership row' : `got ${noRow}`,
  })

  // Your own messages are never unread to you.
  await say(me, '__mine')
  const mine = await countHere()
  out.push({
    verb: 'unread own',
    ok: mine === 2,
    detail: mine === 2 ? 'own message did not count' : `got ${mine}, wanted 2`,
  })

  // A tombstoned message stops counting (SPEC §1.3).
  const doomed = await say(them, '__doomed')
  const before = await countHere()
  await admin
    .from('messages')
    .update({ body: '', deleted_at: new Date().toISOString() })
    .eq('id', doomed)
  const after = await countHere()
  out.push({
    verb: 'unread deleted',
    ok: before === 3 && after === 2,
    detail:
      before === 3 && after === 2
        ? 'deleting a message decremented the count'
        : `${before} → ${after}, wanted 3 → 2`,
  })

  // The pointer: everything at or below it stops counting, everything above
  // still does.
  const middle = await say(them, '__middle')
  await admin
    .from('channel_members')
    .upsert(
      { channel_id: stage, user_id: me, last_read_message_id: middle },
      { onConflict: 'channel_id,user_id' },
    )
  const readUpTo = await countHere()
  await say(them, '__after')
  const afterPointer = await countHere()
  out.push({
    verb: 'unread pointer',
    ok: readUpTo === 0 && afterPointer === 1,
    detail:
      readUpTo === 0 && afterPointer === 1
        ? 'pointer cleared the backlog; a newer message counted again'
        : `${readUpTo} then ${afterPointer}, wanted 0 then 1`,
  })

  // It reports *the caller's* counts. `security invoker` is what makes that
  // true — a `security definer` here would hand everyone the same numbers.
  //
  // The two users must expect *different* numbers or the probe proves nothing.
  // At this point I have 1 unread (their `__after`); a second message from me
  // takes them to 2, since mine never count for me and theirs never count for
  // them. Equal counts would pass under a function that ignored the caller
  // entirely, which is the bug being ruled out.
  await say(me, '__mine2')
  const mineNow = await countHere()

  const asThem = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: link } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: EMAIL_B,
  })
  const hash = link?.properties?.hashed_token
  if (hash) {
    await asThem.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
    const { data } = await asThem.rpc('unread_counts')
    const theirs = ((data ?? []) as { channel_id: string; unread: number }[]).find(
      (r) => r.channel_id === stage,
    )
    const theirCount = Number(theirs?.unread ?? -1)
    const ok = mineNow === 1 && theirCount === 2
    out.push({
      verb: 'unread caller',
      ok,
      detail: ok
        ? 'same channel, different answers per caller (1 vs 2)'
        : `I see ${mineNow} and they see ${theirCount}, wanted 1 and 2`,
    })
    await asThem.auth.signOut()
  } else {
    out.push({ verb: 'unread caller', ok: false, detail: 'could not mint a session' })
  }

  await admin.from('channels').delete().eq('id', stage)
  return out
}

/**
 * `channel_members.last_read_message_id` — SPEC §1.4, the unread pointer.
 *
 * The interesting part is that the client **upserts**. A channel created after
 * you joined the workspace has no `channel_members` row for you, and a plain
 * UPDATE there affects zero rows without erroring — the badge would clear on
 * screen and reappear on reload, which is exactly the sort of silent nothing
 * DECISIONS #5 exists to catch. So this asserts both halves: the insert path
 * for a brand-new pair, and the conflict path for an existing one.
 */
async function unreadPointerCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const me = await ensureUser(EMAIL_A)

  // A channel this user is deliberately not a member of yet.
  const probeChannel = await ensureChannel(
    '__unread_probe',
    'temporary',
    await ensureUser(EMAIL_B),
  )
  await admin
    .from('channel_members')
    .delete()
    .eq('channel_id', probeChannel)
    .eq('user_id', me)

  const insert = await anon
    .from('channel_members')
    .upsert(
      { channel_id: probeChannel, user_id: me, last_read_message_id: 7 },
      { onConflict: 'channel_id,user_id' },
    )
    .select('last_read_message_id')
  out.push({
    verb: 'read ptr new',
    ok: !insert.error && (insert.data?.length ?? 0) === 1,
    detail: insert.error
      ? insert.error.message
      : `${insert.data?.length ?? 0} rows — a membership row was created on demand`,
  })

  const update = await anon
    .from('channel_members')
    .upsert(
      { channel_id: probeChannel, user_id: me, last_read_message_id: 9 },
      { onConflict: 'channel_id,user_id' },
    )
    .select('last_read_message_id')
  const moved =
    (update.data?.[0] as { last_read_message_id?: number } | undefined)
      ?.last_read_message_id === 9
  out.push({
    verb: 'read ptr move',
    ok: !update.error && moved,
    detail: update.error
      ? update.error.message
      : moved
        ? 'the existing row advanced rather than duplicating'
        : `pointer did not advance: ${JSON.stringify(update.data)}`,
  })

  // The probe channel and its membership go away together.
  await admin.from('channels').delete().eq('id', probeChannel)

  return out
}

/**
 * `notifications` — SPEC §1.9, DECISIONS #15.
 *
 * The bell's rows are written by the *sender's* client rather than a trigger,
 * so the blanket policy has to permit an authenticated teammate to insert a row
 * addressed to **someone else**. That is the unusual bit worth asserting: it is
 * the one table where a normal write targets another user's data, and a policy
 * accidentally scoped to `user_id = auth.uid()` would break mentions while
 * every other check in this script still passed.
 */
async function notificationsCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []

  const me = await ensureUser(EMAIL_A)
  const other = await ensureUser(EMAIL_B)

  const ins = await anon
    .from('notifications')
    .insert({
      user_id: other,
      kind: 'mention',
      actor_id: me,
      entity_type: 'message',
      entity_id: '__probe',
    })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'notif insert',
    ok: !ins.error && !!ins.data,
    detail: ins.error?.message ?? 'notified another user, as mentions require',
  })

  if (!ins.data) {
    for (const verb of ['notif read', 'notif kind', 'notif read_at', 'notif delete']) {
      out.push({ verb, ok: false, detail: 'skipped — insert failed' })
    }
    return out
  }

  const sel = await anon.from('notifications').select('id').eq('id', ins.data.id)
  out.push({
    verb: 'notif read',
    ok: !sel.error && (sel.data?.length ?? 0) === 1,
    detail: sel.error ? sel.error.message : `${sel.data?.length ?? 0} rows visible`,
  })

  // The CHECK constraint on `kind`, so a typo in client code fails loudly
  // rather than writing a row the bell will never render.
  const bad = await anon
    .from('notifications')
    .insert({
      user_id: other,
      kind: 'nonsense',
      actor_id: me,
      entity_type: 'message',
      entity_id: '__probe',
    })
    .select('id')
  out.push({
    verb: 'notif kind',
    ok: bad.error?.code === '23514',
    detail:
      bad.error?.code === '23514'
        ? 'an unknown kind was rejected (23514)'
        : `unknown kind accepted — ${bad.error?.message ?? 'no error'}`,
  })

  // Mark-read: the bell's only write, and the reason `read_at` exists.
  // Scoped `.is('read_at', null)` exactly as the client does, then repeated —
  // the second call must affect zero rows, proving the scope really does stop
  // a re-read from overwriting when you first saw something.
  const readAt = new Date().toISOString()
  const upd = await anon
    .from('notifications')
    .update({ read_at: readAt })
    .eq('id', ins.data.id)
    .is('read_at', null)
    .select('id')
  const again = await anon
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', ins.data.id)
    .is('read_at', null)
    .select('id')
  const markedOnce = (upd.data?.length ?? 0) === 1 && (again.data?.length ?? 0) === 0
  out.push({
    verb: 'notif read_at',
    ok: !upd.error && !again.error && markedOnce,
    detail:
      upd.error?.message ??
      again.error?.message ??
      (markedOnce
        ? 'marked read once; a second mark-read touched 0 rows'
        : `expected 1 then 0 rows, got ${upd.data?.length ?? 0} then ${again.data?.length ?? 0}`),
  })

  const del = await anon
    .from('notifications')
    .delete()
    .eq('entity_id', '__probe')
    .select('id')
  out.push({
    verb: 'notif delete',
    ok: !del.error && (del.data?.length ?? 0) >= 1,
    detail: del.error ? del.error.message : `${del.data?.length ?? 0} probe rows removed`,
  })

  return out
}

/**
 * The account system — DECISIONS #14, and the evidence for the usernames
 * migration.
 *
 * That migration asserts three database behaviours the app depends on and the
 * client cannot demonstrate: a case-insensitively unique username, a signup
 * trigger that honours the username chosen at registration, and a resolver
 * anon can call. A passing UI proves none of them, exactly as DECISIONS #8
 * argued for the thread trigger.
 *
 * The last probe is the load-bearing one: if project-level signups are ever
 * switched back on, the invite code becomes decoration, because anyone with
 * the anon key can call GoTrue's signup endpoint and skip the Edge Function
 * entirely.
 */
async function accountsCheck(): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []

  // Signed OUT on purpose — resolving a username is the one thing that has to
  // work before anybody has a session.
  const anon: SupabaseClient = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: known } = await admin
    .from('profiles')
    .select('id, username')
    .eq('id', await ensureUser(EMAIL_A))
    .single<{ id: string; username: string }>()

  if (!known?.username) {
    out.push({ verb: 'username', ok: false, detail: 'seed user has no username' })
    return out
  }
  out.push({ verb: 'username', ok: true, detail: `${EMAIL_A} is @${known.username}` })

  // Resolve, in a case the caller did not type, to prove lower() on both sides.
  const hit = await anon.rpc('email_for_username', {
    u: known.username.toUpperCase(),
  })
  const resolved = typeof hit.data === 'string' ? hit.data.toLowerCase() : null
  out.push({
    verb: 'resolve',
    ok: !hit.error && resolved === EMAIL_A.toLowerCase(),
    detail: hit.error
      ? hit.error.message
      : resolved === EMAIL_A.toLowerCase()
        ? 'anon resolved @USERNAME → email, case-insensitively'
        : `expected ${EMAIL_A}, got ${JSON.stringify(hit.data)}`,
  })

  // …and an unknown handle must come back empty rather than erroring or
  // leaking a neighbouring row.
  const miss = await anon.rpc('email_for_username', { u: '__nobody_by_that_name' })
  out.push({
    verb: 'resolve miss',
    ok: !miss.error && (miss.data ?? null) === null,
    detail: miss.error
      ? miss.error.message
      : (miss.data ?? null) === null
        ? 'unknown username → null'
        : `leaked ${JSON.stringify(miss.data)}`,
  })

  // The unique index. Collides on the exact stored value, not an upper-cased
  // one: the format CHECK below only permits [a-z0-9._-], so an upper-cased
  // username is refused by the CHECK (23514) before the index is ever
  // consulted — which would test the wrong constraint and never report 23505.
  //
  // Admin client, which bypasses RLS but not constraints, so a rejection here
  // is the index rather than a policy.
  const userB = await ensureUser(EMAIL_B)
  const clash = await admin
    .from('profiles')
    .update({ username: known.username })
    .eq('id', userB)
    .select('id')
  const rejected = clash.error?.code === '23505'
  out.push({
    verb: 'unique',
    ok: rejected,
    detail: rejected
      ? `a second @${known.username} was rejected (23505)`
      : `duplicate username accepted — ${clash.error?.message ?? 'no error'}`,
  })

  // The format CHECK. Without this the constraint is asserted by nothing — and
  // it is the reason the probe above has to collide in lower case, so the two
  // belong together.
  //
  // `nope.` is the regression case: the first version of the constraint
  // permitted a trailing dot, while slugify_username() strips it, so
  // registering `nope.` created an account named `nope` that its owner could
  // not sign into. Both ends are checked so a future relaxation of either
  // fails here.
  for (const [label, bad] of [
    ['format lead', '.nope'],
    ['format trail', 'nope.'],
  ] as const) {
    const malformed = await admin
      .from('profiles')
      .update({ username: bad })
      .eq('id', userB)
      .select('id')
    const refused = malformed.error?.code === '23514'
    out.push({
      verb: label,
      ok: refused,
      detail: refused
        ? `"${bad}" was rejected (23514)`
        : `"${bad}" accepted — ${malformed.error?.message ?? 'no error'}`,
    })
  }

  // The trigger honours a username chosen at registration. Throwaway account,
  // removed either way.
  const wanted = `probe${Date.now().toString().slice(-8)}`
  const probeEmail = `${wanted}@probe.invalid`
  const made = await admin.auth.admin.createUser({
    email: probeEmail,
    email_confirm: true,
    user_metadata: { username: wanted, display_name: 'Probe Person' },
  })
  if (made.error || !made.data.user) {
    out.push({
      verb: 'trigger',
      ok: false,
      detail: made.error?.message ?? 'no user created',
    })
  } else {
    const { data: made_ } = await admin
      .from('profiles')
      .select('username, display_name')
      .eq('id', made.data.user.id)
      .single<{ username: string; display_name: string }>()
    const ok = made_?.username === wanted && made_?.display_name === 'Probe Person'
    out.push({
      verb: 'trigger',
      ok,
      detail: ok
        ? 'handle_new_user carried the chosen username and display name'
        : `got ${JSON.stringify(made_)}, wanted @${wanted}`,
    })
    await admin.auth.admin.deleteUser(made.data.user.id)
  }

  // The email-derived path: two teammates created from the dashboard whose
  // addresses share a local part. Nobody chose these usernames, so the trigger
  // disambiguates rather than failing — SPEC §2.3's "zero extra steps" promise.
  const stem = `dupe${Date.now().toString().slice(-8)}`
  const twins: string[] = []
  for (const domain of ['a.invalid', 'b.invalid']) {
    const made = await admin.auth.admin.createUser({
      email: `${stem}@${domain}`,
      email_confirm: true,
    })
    if (made.data.user) twins.push(made.data.user.id)
  }
  if (twins.length !== 2) {
    out.push({ verb: 'derived', ok: false, detail: 'could not create both probe users' })
  } else {
    const { data: pair } = await admin
      .from('profiles')
      .select('id, username')
      .in('id', twins)
    const names = (pair ?? []).map((p) => (p as { username: string }).username).sort()
    const ok = names.length === 2 && names[0] === stem && names[1] === `${stem}-2`
    out.push({
      verb: 'derived',
      ok,
      detail: ok
        ? `colliding emails became @${stem} and @${stem}-2`
        : `expected @${stem} and @${stem}-2, got ${JSON.stringify(names)}`,
    })
  }
  for (const id of twins) await admin.auth.admin.deleteUser(id)

  // Signups must stay disabled at the project level. This is what makes the
  // invite code a wall instead of a suggestion.
  //
  // Judged on the error *code*, not merely on "no user came back": a rate
  // limit, a rejected address or a password-policy refusal would all look like
  // a refusal on a project with signups wide open.
  const openSignup = await anon.auth.signUp({
    email: `__probe_${crypto.randomUUID()}@probe.invalid`,
    password: `${crypto.randomUUID()}Aa1!`,
  })
  const gotUser = !!openSignup.data.user || !!openSignup.data.session
  const disabled = openSignup.error?.code === 'signup_disabled'
  out.push({
    verb: 'signup shut',
    ok: !gotUser && disabled,
    detail: gotUser
      ? 'PUBLIC SIGNUP IS ENABLED — anyone can create an account without the invite code'
      : disabled
        ? 'refused (signup_disabled)'
        : `refused, but for the wrong reason: ${
            openSignup.error?.code ?? 'no code'
          } — ${openSignup.error?.message ?? 'no error'}. Signups may still be on.`,
  })

  return out
}

/**
 * Non-negotiable 2's verification. Mints a real session for `email` without a
 * password (DECISIONS #3), then runs all four verbs through the anon client.
 */
async function rlsCheck(email: string) {
  console.log('\nFour-verb anon RLS check')
  console.log('─'.repeat(46))

  // Clear debris from any earlier interrupted run so the insert below is
  // testing the policy, not the unique (name, kind) constraint. If this fails
  // silently the probe insert reports a duplicate key, which is exactly the
  // confusion this line exists to prevent.
  const { error: preCleanErr } = await admin
    .from('channels')
    .delete()
    .eq('name', RLS_PROBE)
  die('clear leftover RLS probe row', preCleanErr)

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  die('generate magic link for RLS check', linkErr)

  const tokenHash = link?.properties?.hashed_token
  if (!tokenHash) {
    console.error('✗ generateLink returned no hashed_token — see DECISIONS #3 fallback')
    process.exit(1)
  }

  const anon: SupabaseClient = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  die('redeem magic link on the anon client', verifyErr)
  if (!session.session) {
    console.error('✗ no session after verifyOtp')
    process.exit(1)
  }

  const results: { verb: string; ok: boolean; detail: string }[] = []

  // A blocked verb under RLS is NOT an error. A denied UPDATE or DELETE simply
  // matches zero rows and returns 204 with an empty body; a denied SELECT
  // returns 200 and []. So every verb below is judged on rows affected, never
  // on the absence of an error — otherwise this check would print PASS against
  // a table carrying only a select policy.

  const sel = await anon.from('channels').select('id, name').limit(5)
  results.push({
    verb: 'select',
    ok: !sel.error && (sel.data?.length ?? 0) > 0,
    detail: sel.error
      ? sel.error.message
      : `${sel.data?.length ?? 0} rows visible${
          (sel.data?.length ?? 0) === 0 ? ' — RLS is filtering everything out' : ''
        }`,
  })

  const ins = await anon
    .from('channels')
    .insert({ name: RLS_PROBE, kind: 'chat', topic: 'temporary' })
    .select('id')
    .single<{ id: string }>()
  results.push({
    verb: 'insert',
    ok: !ins.error && !!ins.data,
    detail: ins.error?.message ?? '1 row created',
  })

  if (ins.data) {
    const probeId = ins.data.id

    const upd = await anon
      .from('channels')
      .update({ topic: 'temporary, updated' })
      .eq('id', probeId)
      .select('id')
    results.push({
      verb: 'update',
      ok: !upd.error && (upd.data?.length ?? 0) === 1,
      detail: upd.error
        ? upd.error.message
        : `${upd.data?.length ?? 0} rows updated${
            (upd.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
          }`,
    })

    const del = await anon.from('channels').delete().eq('id', probeId).select('id')
    results.push({
      verb: 'delete',
      ok: !del.error && (del.data?.length ?? 0) === 1,
      detail: del.error
        ? del.error.message
        : `${del.data?.length ?? 0} rows deleted${
            (del.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
          }`,
    })

    // Confirm the probe row is actually gone, so a silently-blocked delete
    // cannot leave debris that makes the *next* run fail on the unique
    // (name, kind) constraint and look like an insert-policy problem.
    const { count: leftover } = await admin
      .from('channels')
      .select('id', { count: 'exact', head: true })
      .eq('id', probeId)
    results.push({
      verb: 'cleanup',
      ok: (leftover ?? 0) === 0,
      detail:
        (leftover ?? 0) === 0
          ? 'probe row gone'
          : `probe row still present — delete did not take effect`,
    })
  } else {
    for (const verb of ['update', 'delete', 'cleanup']) {
      results.push({ verb, ok: false, detail: 'skipped — insert failed' })
    }
  }

  results.push(...(await attachmentsCheck(anon)))
  results.push(...(await storageCheck(anon)))
  results.push(...(await unreadCountsCheck(anon)))
  results.push(...(await unreadPointerCheck(anon)))
  results.push(...(await notificationsCheck(anon)))
  results.push(...(await accountsCheck()))
  results.push(...(await deniedWithoutSession()))

  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.verb.padEnd(14)} ${r.detail}`)
  }
  console.log('─'.repeat(60))

  await anon.auth.signOut()

  if (results.some((r) => !r.ok)) {
    console.error('\n✗ RLS check FAILED — the blanket policy is not correct.')
    process.exit(1)
  }
  console.log(
    '✓ RLS check PASSED — authenticated has full access; anon has no table ' +
      'access (only email_for_username, by design — DECISIONS #14).\n',
  )
}

/**
 * The other half of Non-negotiable 2, and the half that catches drift.
 *
 * Every assertion above runs with a signed-in session, so it cannot tell a
 * correct policy from an over-permissive one: a policy written `to public` or
 * `to anon`, or a table where someone forgot `enable row level security`,
 * passes all five identically. A signed-out client separates them — under the
 * intended `to authenticated` policy it must be able to do nothing at all.
 *
 * Under RLS a denied read is not an error, it is an empty result, so reads and
 * writes are judged on rows, not on error presence.
 */
async function deniedWithoutSession() {
  const out: { verb: string; ok: boolean; detail: string }[] = []
  const anon: SupabaseClient = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const sel = await anon.from('channels').select('id').limit(1)
  const visible = sel.data?.length ?? 0
  const canRead = !sel.error && visible > 0
  out.push({
    verb: 'anon select',
    ok: !canRead,
    detail: canRead
      ? `${visible} rows readable without a session — RLS is off or the policy is not scoped to authenticated`
      : 'denied',
  })

  const ins = await anon
    .from('channels')
    .insert({ name: `${RLS_PROBE}_anon`, kind: 'chat' })
    .select('id')
  const created = ins.data?.length ?? 0
  const canWrite = !ins.error && created > 0
  out.push({
    verb: 'anon insert',
    ok: !canWrite,
    detail: canWrite ? 'row created without a session' : 'denied',
  })

  // Clean up in case the insert was wrongly allowed, so the failure is
  // reported without also poisoning the next run.

  // Notifications carry who-mentioned-whom, so a policy slip there leaks the
  // shape of private conversations to anyone holding the anon key.
  //
  // A row has to be planted first. Every other signed-out probe here reads a
  // table `main()` guarantees is populated; `notifications` is not, and an
  // empty table returns `[]` to a signed-out client under *any* policy — even
  // none at all. Without this the probe would print PASS having proven
  // nothing, which is exactly the hollow verification DECISIONS #5 exists to
  // prevent. Planted with `admin`, so it exists regardless of policy.
  const plantedId = crypto.randomUUID()
  const planted = await admin.from('notifications').insert({
    id: plantedId,
    user_id: await ensureUser(EMAIL_A),
    kind: 'mention',
    actor_id: await ensureUser(EMAIL_B),
    entity_type: 'message',
    entity_id: '__anon_probe',
  })

  if (planted.error) {
    out.push({
      verb: 'anon notifs',
      ok: false,
      detail: `could not plant a probe row: ${planted.error.message}`,
    })
  } else {
    const notif = await anon.from('notifications').select('id').limit(1)
    const notifVisible = notif.data?.length ?? 0
    const canRead = !notif.error && notifVisible > 0
    out.push({
      verb: 'anon notifs',
      ok: !canRead,
      detail: canRead
        ? `${notifVisible} notification rows readable without a session — a mention leaks who mentioned whom`
        : 'denied (with a row present, so this means denied and not empty)',
    })
    // Judged, not fired and forgotten: `notificationsCheck` deletes on
    // `entity_id = '__probe'` and would never sweep up this row, so a silent
    // failure here accumulates debris nothing else removes.
    die('remove the planted anon probe row', (await admin
      .from('notifications')
      .delete()
      .eq('id', plantedId)).error)
  }

  // `unread_counts()` is granted to `authenticated` only (DECISIONS #18) and
  // reports whatever `auth.uid()` resolves to. Without a session that is null,
  // so a leaked grant would hand a stranger the shape of every channel's
  // traffic. Nothing else asserts the grant.
  //
  // Judged on being **refused**, not on returning nothing. The function is
  // `security invoker`, so without a session `auth.uid()` is null and RLS
  // hands back `[]` under every possible grant — `to anon`, `to public` or
  // none. An earlier version of this probe checked the row count and printed
  // PASS against a function `anon` could execute perfectly well, which is what
  // let the missing revoke through (see 20260810170411). RLS makes almost
  // everything look empty; only an error proves the grant.
  const counts = await anon.rpc('unread_counts')
  // `42501` specifically — insufficient_privilege. Any-error would also pass
  // if the function were dropped or the schema cache were stale, which is not
  // what this is asserting.
  const refused = counts.error?.code === '42501'
  out.push({
    verb: 'anon counts',
    ok: refused,
    detail: refused
      ? `refused (${counts.error?.message})`
      : counts.error
        ? `refused for the wrong reason: ${counts.error.code} — ${counts.error.message}`
        : `EXECUTABLE without a session — returned ${
            Array.isArray(counts.data) ? counts.data.length : 0
          } rows; the grant is wrong even though RLS is hiding it`,
  })

  // Storage has its own policy surface (DECISIONS #9), so it needs its own
  // signed-out probe: the four bucket-scoped policies are `to authenticated`,
  // and nothing else would notice if one were written `to public`.
  const path = `__probe/anon-${crypto.randomUUID()}.txt`
  const up = await anon.storage
    .from('attachments')
    .upload(path, new Blob(['nope'], { type: 'text/plain' }))
  const uploaded = !up.error && !!up.data?.path
  out.push({
    verb: 'anon upload',
    ok: !uploaded,
    detail: uploaded ? 'file stored without a session' : 'denied',
  })
  if (uploaded) {
    const admin_ = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    await admin_.storage.from('attachments').remove([path])
  }
  // Same for the channel row, whether it was created by mistake or by design.
  if (canWrite) await admin.from('channels').delete().eq('name', `${RLS_PROBE}_anon`)

  return out
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
