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
  kind: 'chat' | 'forum' = 'chat',
): Promise<string> {
  const { data, error } = await admin
    .from('channels')
    .upsert(
      { name, kind, topic, created_by: createdBy },
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

  // 2. Channels + membership. The forum is structure like the chat channels:
  //    P3's post list, tag filter and comment surfaces are all unreachable
  //    without at least one forum-kind channel. No membership rows — unread
  //    pointers are chat-only (SPEC §1.4).
  const general = await ensureChannel('general', 'Everything and anything', userA)
  const random = await ensureChannel('random', 'Off-topic', userB)
  await ensureChannel('ideas', 'Pitches and proposals', userA, 'forum')

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
  console.log('✓ channels     #general, #random (both users in both), forum #ideas')

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

  // 4. Docs — one collection and one starter page, structure not content
  //    (same reasoning as channels). Neither table has a unique natural key,
  //    so idempotency is select-then-insert rather than upsert.
  const handbookId = await ensureCollection('Handbook')
  await ensurePage('Welcome', handbookId, userA)
  console.log('✓ docs         collection "Handbook" with page "Welcome"')

  await threadFlatteningCheck(general, userA)
  await rlsCheck(EMAIL_A)
}

async function ensureCollection(name: string): Promise<string> {
  const found = await admin
    .from('collections')
    .select('id')
    .eq('name', name)
    .limit(1)
  die(`look up collection ${name}`, found.error)
  const first = (found.data ?? [])[0] as { id: string } | undefined
  if (first) return first.id
  const { data, error } = await admin
    .from('collections')
    .insert({ name })
    .select('id')
    .single<{ id: string }>()
  die(`create collection ${name}`, error)
  return data!.id
}

async function ensurePage(
  title: string,
  collectionId: string,
  createdBy: string,
): Promise<void> {
  const found = await admin.from('pages').select('id').eq('title', title).limit(1)
  die(`look up page ${title}`, found.error)
  if ((found.data ?? []).length > 0) return
  const { error } = await admin.from('pages').insert({
    title,
    collection_id: collectionId,
    created_by: createdBy,
    // The same BlockNote paragraph shape the app writes (DECISIONS #23).
    body_rich: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Team docs live here.', styles: {} }],
      },
    ],
  })
  die(`create page ${title}`, error)
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
 * `tasks` + `links` — SPEC §1.6, §1.8, §2.3; the P2 tables.
 *
 * Beyond the four verbs, two shapes are worth asserting because client code
 * depends on them exactly: the `status` CHECK (a typo'd status must fail
 * loudly, not write a card no column renders), and the create-task-from-
 * message pair — a task holding the message's bigint id in
 * `source_message_id` while the `links` row holds the same id as *text*
 * (DECISIONS #2). The backlink read uses the `(target_type, target_id)`
 * index's exact query shape. Every verb is judged on rows, never on error
 * absence (DECISIONS #5).
 */
async function tasksLinksCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const me = await ensureUser(EMAIL_A)

  // Pre-clean debris from an interrupted earlier run — the discipline
  // `deniedWithoutSession` applies to its channel probe. A crash between the
  // inserts below and the cleanup at the end would otherwise strand probe
  // rows in production forever, since nothing else sweeps these titles.
  const stale = await admin
    .from('tasks')
    .select('id')
    .in('title', ['__probe task', '__probe bad'])
  if (stale.data?.length) {
    const ids = stale.data.map((r: { id: string }) => r.id)
    die('sweep stale probe links', (await admin.from('links').delete().in('source_id', ids)).error)
    die('sweep stale probe tasks', (await admin.from('tasks').delete().in('id', ids)).error)
  }
  die(
    'sweep stale probe messages',
    (await admin.from('messages').delete().eq('body', '__task_probe')).error,
  )

  const chan = await admin
    .from('channels')
    .select('id')
    .eq('name', 'general')
    .eq('kind', 'chat')
    .maybeSingle<{ id: string }>()
  if (chan.error || !chan.data) {
    return [{ verb: 'task insert', ok: false, detail: 'no #general to mint a probe message in' }]
  }

  // A real message for the FK — minted here, removed at the end, exactly like
  // threadFlatteningCheck. The seed never leaves content behind.
  const msg = await admin
    .from('messages')
    .insert({ channel_id: chan.data.id, author_id: me, body: '__task_probe' })
    .select('id')
    .single<{ id: number }>()
  if (msg.error || !msg.data) {
    return [
      {
        verb: 'task insert',
        ok: false,
        detail: `could not mint a probe message: ${msg.error?.message ?? 'no row'}`,
      },
    ]
  }

  const ins = await anon
    .from('tasks')
    .insert({
      title: '__probe task',
      status: 'todo',
      position: 1024,
      source_message_id: msg.data.id,
      created_by: me,
    })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'task insert',
    ok: !ins.error && !!ins.data,
    detail: ins.error?.message ?? 'created with source_message_id set',
  })

  if (!ins.data) {
    for (const verb of [
      'task read',
      'task status',
      'task update',
      'link insert',
      'link backlink',
      'link delete',
      'task delete',
    ]) {
      out.push({ verb, ok: false, detail: 'skipped — insert failed' })
    }
    die('remove the task probe message', (await admin.from('messages').delete().eq('id', msg.data.id)).error)
    return out
  }

  const sel = await anon.from('tasks').select('id').eq('id', ins.data.id)
  out.push({
    verb: 'task read',
    ok: !sel.error && (sel.data?.length ?? 0) === 1,
    detail: sel.error ? sel.error.message : `${sel.data?.length ?? 0} rows visible`,
  })

  // The CHECK constraint on `status` — the kanban only renders three columns.
  const bad = await anon
    .from('tasks')
    .insert({ title: '__probe bad', status: 'blocked', position: 1, created_by: me })
    .select('id')
  out.push({
    verb: 'task status',
    ok: bad.error?.code === '23514',
    detail:
      bad.error?.code === '23514'
        ? 'an unknown status was rejected (23514)'
        : `unknown status accepted — ${bad.error?.message ?? 'no error'}`,
  })
  // On the exact failure this probe exists to catch, the row was written —
  // remove it, or it sits invisibly in production (an unknown status renders
  // in no kanban column).
  if (bad.data?.length) {
    die(
      'remove the bad-status probe row',
      (
        await admin
          .from('tasks')
          .delete()
          .in('id', bad.data.map((r: { id: string }) => r.id))
      ).error,
    )
  }

  // The kanban drop write: status + position + completed_at in one update.
  const upd = await anon
    .from('tasks')
    .update({ status: 'done', position: 2048, completed_at: new Date().toISOString() })
    .eq('id', ins.data.id)
    .select('id')
  out.push({
    verb: 'task update',
    ok: !upd.error && (upd.data?.length ?? 0) === 1,
    detail: upd.error ? upd.error.message : `moved to done, ${upd.data?.length ?? 0} row updated`,
  })

  // The links row exactly as the client's linkForTask builds it: the bigint
  // message id crosses to text here and nowhere else.
  const link = await anon
    .from('links')
    .insert({
      source_type: 'task',
      source_id: ins.data.id,
      target_type: 'message',
      target_id: String(msg.data.id),
      kind: 'created_from',
    })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'link insert',
    ok: !link.error && !!link.data,
    detail: link.error?.message ?? 'created_from edge written with a text id',
  })

  if (link.data) {
    // The backlink panel's exact query — what the (target_type, target_id)
    // index exists for.
    const back = await anon
      .from('links')
      .select('id')
      .eq('target_type', 'message')
      .eq('target_id', String(msg.data.id))
    out.push({
      verb: 'link backlink',
      ok: !back.error && (back.data?.length ?? 0) === 1,
      detail: back.error ? back.error.message : `${back.data?.length ?? 0} edge found by target`,
    })

    const ldel = await anon.from('links').delete().eq('id', link.data.id).select('id')
    out.push({
      verb: 'link delete',
      ok: !ldel.error && (ldel.data?.length ?? 0) === 1,
      detail: ldel.error ? ldel.error.message : 'probe edge removed',
    })
  } else {
    for (const verb of ['link backlink', 'link delete']) {
      out.push({ verb, ok: false, detail: 'skipped — link insert failed' })
    }
  }

  const tdel = await anon.from('tasks').delete().eq('id', ins.data.id).select('id')
  out.push({
    verb: 'task delete',
    ok: !tdel.error && (tdel.data?.length ?? 0) === 1,
    detail: tdel.error ? tdel.error.message : 'probe task removed',
  })

  die('remove the task probe message', (await admin.from('messages').delete().eq('id', msg.data.id)).error)

  return out
}

/**
 * P3's tables and the two deferred FKs — SPEC §2.3, the posts_tags migration.
 *
 * Beyond the four verbs on `posts`/`tags`/`post_tags`, this asserts what only
 * the database can prove: the one-parent CHECK rejects a message wearing both
 * parents, both deferred FKs actually exist (a garbage post id must fail
 * 23503 — nothing else in the app ever exercises the failure side), the tags
 * unique index fires, and deleting a post cascades its comments.
 */
async function postsTagsCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const me = await ensureUser(EMAIL_A)

  // Pre-clean debris from an interrupted earlier run, same discipline as
  // tasksLinksCheck. Deleting stale posts cascades their post_tags and
  // comments, so those need no sweep of their own.
  die(
    'sweep stale probe posts',
    (await admin.from('posts').delete().eq('title', '__probe post')).error,
  )
  die(
    'sweep stale probe tags',
    (await admin.from('tags').delete().eq('name', '__probe-tag')).error,
  )

  const forum = await admin
    .from('channels')
    .select('id')
    .eq('name', 'ideas')
    .eq('kind', 'forum')
    .maybeSingle<{ id: string }>()
  if (forum.error || !forum.data) {
    return [{ verb: 'post insert', ok: false, detail: 'no #ideas forum to post into' }]
  }
  const general = await admin
    .from('channels')
    .select('id')
    .eq('name', 'general')
    .eq('kind', 'chat')
    .maybeSingle<{ id: string }>()

  const post = await anon
    .from('posts')
    .insert({
      channel_id: forum.data.id,
      author_id: me,
      title: '__probe post',
      // The BlockNote paragraph shape richFromPlain writes (DECISIONS #23).
      body_rich: [
        { type: 'paragraph', content: [{ type: 'text', text: 'probe body', styles: {} }] },
      ],
    })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'post insert',
    ok: !post.error && !!post.data,
    detail: post.error?.message ?? 'created in the forum with a rich body',
  })

  if (!post.data) {
    for (const verb of [
      'post read',
      'post update',
      'comment insert',
      'msg both',
      'msg bad post',
      'task bad post',
      'tag insert',
      'tag duplicate',
      'post_tag ins',
      'post delete',
      'comment gone',
      'post_tag gone',
      'tag delete',
    ]) {
      out.push({ verb, ok: false, detail: 'skipped — post insert failed' })
    }
    return out
  }
  const postId = post.data.id

  const sel = await anon.from('posts').select('id').eq('id', postId)
  out.push({
    verb: 'post read',
    ok: !sel.error && (sel.data?.length ?? 0) === 1,
    detail: sel.error ? sel.error.message : `${sel.data?.length ?? 0} rows visible`,
  })

  const upd = await anon
    .from('posts')
    .update({ title: '__probe post' })
    .eq('id', postId)
    .select('id')
  out.push({
    verb: 'post update',
    ok: !upd.error && (upd.data?.length ?? 0) === 1,
    detail: upd.error ? upd.error.message : `${upd.data?.length ?? 0} row updated`,
  })

  // A comment is a messages row keyed by post_id — the XOR CHECK's happy
  // path and the messages.post_id FK's happy path in one insert.
  const comment = await anon
    .from('messages')
    .insert({ post_id: postId, author_id: me, body: '__post_probe' })
    .select('id')
    .single<{ id: number }>()
  out.push({
    verb: 'comment insert',
    ok: !comment.error && !!comment.data,
    detail: comment.error?.message ?? 'message row written with post_id as its parent',
  })

  // Both parents set must be rejected — every consumer relies on the two
  // sets being disjoint (unread counts, channel filters, comment counts).
  const both = await anon
    .from('messages')
    .insert({
      channel_id: general.data?.id ?? forum.data.id,
      post_id: postId,
      author_id: me,
      body: '__post_probe',
    })
    .select('id')
  out.push({
    verb: 'msg both',
    ok: both.error?.code === '23514',
    detail:
      both.error?.code === '23514'
        ? 'a message wearing both parents was rejected (23514)'
        : `both parents accepted — ${both.error?.message ?? 'no error'}`,
  })
  if (both.data?.length) {
    die(
      'remove the both-parents probe row',
      (await admin.from('messages').delete().in('id', both.data.map((r: { id: number }) => r.id))).error,
    )
  }

  // The two deferred FKs. Only the failure side proves they exist — every
  // app write uses real ids, so a missing constraint would never surface.
  const ghost = crypto.randomUUID()
  const badMsg = await anon
    .from('messages')
    .insert({ post_id: ghost, author_id: me, body: '__post_probe' })
    .select('id')
  out.push({
    verb: 'msg bad post',
    ok: badMsg.error?.code === '23503',
    detail:
      badMsg.error?.code === '23503'
        ? 'a comment pointing at no post was rejected (23503)'
        : `accepted or wrong error — ${badMsg.error?.message ?? 'no error'}`,
  })
  if (badMsg.data?.length) {
    die(
      'remove the bad-post probe message',
      (await admin.from('messages').delete().in('id', badMsg.data.map((r: { id: number }) => r.id))).error,
    )
  }

  const badTask = await anon
    .from('tasks')
    .insert({
      title: '__probe bad',
      status: 'todo',
      position: 1,
      source_post_id: ghost,
      created_by: me,
    })
    .select('id')
  out.push({
    verb: 'task bad post',
    ok: badTask.error?.code === '23503',
    detail:
      badTask.error?.code === '23503'
        ? 'a task sourced from no post was rejected (23503)'
        : `accepted or wrong error — ${badTask.error?.message ?? 'no error'}`,
  })
  if (badTask.data?.length) {
    die(
      'remove the bad-source probe task',
      (await admin.from('tasks').delete().in('id', badTask.data.map((r: { id: string }) => r.id))).error,
    )
  }

  const tag = await anon
    .from('tags')
    .insert({ name: '__probe-tag', color: '#3b82f6' })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'tag insert',
    ok: !tag.error && !!tag.data,
    detail: tag.error?.message ?? 'workspace tag created',
  })

  if (tag.data) {
    // ensureTags leans on this 23505 to resolve creation races.
    const dup = await anon.from('tags').insert({ name: '__probe-tag' }).select('id')
    out.push({
      verb: 'tag duplicate',
      ok: dup.error?.code === '23505',
      detail:
        dup.error?.code === '23505'
          ? 'a duplicate name was rejected (23505)'
          : `duplicate accepted — ${dup.error?.message ?? 'no error'}`,
    })
    if (dup.data?.length) {
      die(
        'remove the duplicate probe tag',
        (await admin.from('tags').delete().in('id', dup.data.map((r: { id: string }) => r.id))).error,
      )
    }

    const pt = await anon
      .from('post_tags')
      .insert({ post_id: postId, tag_id: tag.data.id })
      .select('post_id')
    out.push({
      verb: 'post_tag ins',
      ok: !pt.error && (pt.data?.length ?? 0) === 1,
      detail: pt.error ? pt.error.message : 'join row written',
    })
  } else {
    for (const verb of ['tag duplicate', 'post_tag ins']) {
      out.push({ verb, ok: false, detail: 'skipped — tag insert failed' })
    }
  }

  // Delete the post through the anon client, then prove the cascades did
  // their work: FK cascade on comments, PK cascade on post_tags.
  const pdel = await anon.from('posts').delete().eq('id', postId).select('id')
  out.push({
    verb: 'post delete',
    ok: !pdel.error && (pdel.data?.length ?? 0) === 1,
    detail: pdel.error ? pdel.error.message : 'probe post removed',
  })

  const orphanComments = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId)
  out.push({
    verb: 'comment gone',
    ok: !orphanComments.error && (orphanComments.count ?? 0) === 0,
    detail:
      (orphanComments.count ?? 0) === 0
        ? 'comments cascaded with the post'
        : `${orphanComments.count} comment rows survived the post delete`,
  })

  const orphanJoins = await admin
    .from('post_tags')
    .select('post_id', { count: 'exact', head: true })
    .eq('post_id', postId)
  out.push({
    verb: 'post_tag gone',
    ok: !orphanJoins.error && (orphanJoins.count ?? 0) === 0,
    detail:
      (orphanJoins.count ?? 0) === 0
        ? 'join rows cascaded with the post'
        : `${orphanJoins.count} join rows survived the post delete`,
  })

  if (tag.data) {
    const tdel = await anon.from('tags').delete().eq('id', tag.data.id).select('id')
    out.push({
      verb: 'tag delete',
      ok: !tdel.error && (tdel.data?.length ?? 0) === 1,
      detail: tdel.error ? tdel.error.message : 'probe tag removed',
    })
  } else {
    out.push({ verb: 'tag delete', ok: false, detail: 'skipped — tag insert failed' })
  }

  // Belt and braces if the anon delete failed: the admin sweep keeps the
  // next run clean either way.
  die(
    'sweep the probe post',
    (await admin.from('posts').delete().eq('id', postId)).error,
  )

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
  results.push(...(await tasksLinksCheck(anon)))
  results.push(...(await postsTagsCheck(anon)))
  results.push(...(await pagesCheck(anon)))
  results.push(...(await searchCheck(anon)))
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
 * The P4 tables — SPEC.md §1.7, §2.3. What only the database can prove: the
 * blanket policies on `collections` and `pages` admit the four verbs for an
 * authenticated session; `pages.updated_at` defaults on insert; and the two
 * FK delete behaviors hold — deleting a collection CASCADES its child
 * collections but leaves its pages un-filed (`collection_id` set null), never
 * deleted. That last one is the migration's core promise: tree pruning must
 * not destroy documents.
 */
async function pagesCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []

  // Pre-clean debris from an interrupted run. Pages first — their FK is set
  // null, so removing collections first would only orphan them.
  die(
    'sweep stale probe pages',
    (await admin.from('pages').delete().eq('title', '__probe_page')).error,
  )
  die(
    'sweep stale probe collections',
    (await admin.from('collections').delete().eq('name', '__probe_collection')).error,
  )

  const parent = await anon
    .from('collections')
    .insert({ name: '__probe_collection' })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'col insert',
    ok: !parent.error && !!parent.data,
    detail: parent.error?.message ?? '1 row created',
  })
  if (!parent.data) {
    for (const verb of [
      'col child',
      'page insert',
      'page select',
      'page update',
      'col delete',
      'col cascade',
      'page unfiled',
      'page delete',
    ]) {
      out.push({ verb, ok: false, detail: 'skipped — collection insert failed' })
    }
    return out
  }
  const parentId = parent.data.id

  const child = await anon
    .from('collections')
    .insert({ name: '__probe_collection', parent_id: parentId })
    .select('id')
    .single<{ id: string }>()
  out.push({
    verb: 'col child',
    ok: !child.error && !!child.data,
    detail: child.error?.message ?? 'nested under the parent',
  })

  const page = await anon
    .from('pages')
    .insert({ title: '__probe_page', collection_id: parentId })
    .select('id,updated_at')
    .single<{ id: string; updated_at: string | null }>()
  out.push({
    verb: 'page insert',
    ok: !page.error && !!page.data && page.data.updated_at !== null,
    detail:
      page.error?.message ??
      (page.data?.updated_at !== null
        ? '1 row created, updated_at defaulted'
        : 'created but updated_at is null'),
  })
  if (!page.data) {
    for (const verb of ['page select', 'page update', 'col delete', 'col cascade', 'page unfiled', 'page delete']) {
      out.push({ verb, ok: false, detail: 'skipped — page insert failed' })
    }
    await admin.from('collections').delete().eq('id', parentId)
    return out
  }
  const pageId = page.data.id

  const sel = await anon.from('pages').select('id').eq('id', pageId)
  out.push({
    verb: 'page select',
    ok: !sel.error && (sel.data?.length ?? 0) === 1,
    detail: sel.error ? sel.error.message : `${sel.data?.length ?? 0} rows visible`,
  })

  const upd = await anon
    .from('pages')
    .update({ title: '__probe_page', updated_at: new Date().toISOString() })
    .eq('id', pageId)
    .select('id')
  out.push({
    verb: 'page update',
    ok: !upd.error && (upd.data?.length ?? 0) === 1,
    detail: upd.error
      ? upd.error.message
      : `${upd.data?.length ?? 0} rows updated${
          (upd.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
        }`,
  })

  const delCol = await anon
    .from('collections')
    .delete()
    .eq('id', parentId)
    .select('id')
  out.push({
    verb: 'col delete',
    ok: !delCol.error && (delCol.data?.length ?? 0) === 1,
    detail: delCol.error
      ? delCol.error.message
      : `${delCol.data?.length ?? 0} rows deleted${
          (delCol.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
        }`,
  })

  // The two FK behaviors, read back with admin so RLS cannot color the answer.
  const { count: childLeft } = await admin
    .from('collections')
    .select('id', { count: 'exact', head: true })
    .eq('id', child.data?.id ?? '00000000-0000-4000-8000-000000000000')
  out.push({
    verb: 'col cascade',
    ok: (childLeft ?? 0) === 0,
    detail:
      (childLeft ?? 0) === 0
        ? 'child collection cascaded with its parent'
        : 'child collection SURVIVED its parent — cascade missing',
  })

  const unfiled = await admin
    .from('pages')
    .select('collection_id')
    .eq('id', pageId)
    .maybeSingle<{ collection_id: string | null }>()
  out.push({
    verb: 'page unfiled',
    ok: !unfiled.error && unfiled.data !== null && unfiled.data.collection_id === null,
    detail: unfiled.error
      ? unfiled.error.message
      : unfiled.data === null
        ? 'page was DELETED by the collection cascade — set null missing'
        : unfiled.data.collection_id === null
          ? 'page survived un-filed (collection_id null)'
          : 'page still points at the deleted collection',
  })

  const delPage = await anon.from('pages').delete().eq('id', pageId).select('id')
  out.push({
    verb: 'page delete',
    ok: !delPage.error && (delPage.data?.length ?? 0) === 1,
    detail: delPage.error
      ? delPage.error.message
      : `${delPage.data?.length ?? 0} rows deleted${
          (delPage.data?.length ?? 0) === 0 ? ' — silently blocked by RLS' : ''
        }`,
  })

  return out
}

/**
 * search_all() — SPEC §1.10, §3. What only the live database can prove: the
 * four search_tsv columns exist and match, the function unions and ranks,
 * message hits carry a navigable parent, tombstones stay out, and the
 * scaffolding-token decision holds — BlockNote's own vocabulary ("paragraph")
 * must not match a document whose human text never says it.
 */
async function searchCheck(anon: SupabaseClient): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  const TOKEN = 'zephyrquill' // nonsense, so live data can never collide

  // Pre-clean debris from an interrupted run.
  die('sweep stale search probe messages', (await admin.from('messages').delete().ilike('body', `%${TOKEN}%`)).error)
  die('sweep stale search probe posts', (await admin.from('posts').delete().eq('title', `__probe ${TOKEN}`)).error)
  die('sweep stale search probe pages', (await admin.from('pages').delete().eq('title', `__probe ${TOKEN}`)).error)
  die('sweep stale search probe tasks', (await admin.from('tasks').delete().eq('title', `__probe ${TOKEN}`)).error)

  const me = await anon.auth.getUser()
  const myId = me.data.user?.id
  if (!myId) return [{ verb: 'search setup', ok: false, detail: 'no session user' }]

  const general = await admin
    .from('channels')
    .select('id')
    .eq('name', 'general')
    .eq('kind', 'chat')
    .maybeSingle<{ id: string }>()
  const forum = await admin
    .from('channels')
    .select('id')
    .eq('name', 'ideas')
    .eq('kind', 'forum')
    .maybeSingle<{ id: string }>()
  if (!general.data || !forum.data) {
    return [{ verb: 'search setup', ok: false, detail: 'seed channels missing' }]
  }

  const rich = [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: `the ${TOKEN} appears in body text`, styles: {} }],
    },
  ]
  const msg = await anon
    .from('messages')
    .insert({ channel_id: general.data.id, author_id: myId, body: `chat about ${TOKEN} here` })
    .select('id')
    .single<{ id: number }>()
  const post = await anon
    .from('posts')
    .insert({ channel_id: forum.data.id, author_id: myId, title: `__probe ${TOKEN}`, body_rich: rich })
    .select('id')
    .single<{ id: string }>()
  const page = await anon
    .from('pages')
    .insert({ title: `__probe ${TOKEN}`, body_rich: rich, created_by: myId })
    .select('id')
    .single<{ id: string }>()
  const task = await anon
    .from('tasks')
    // Carries the rich body too, so the tasks column's flattening branch is
    // exercised with content — a null description would make the scaffold
    // assertion below hollow for tasks (review finding at G5 prep).
    .insert({
      title: `__probe ${TOKEN}`,
      description_rich: rich,
      status: 'todo',
      position: 999999,
      created_by: myId,
    })
    .select('id')
    .single<{ id: string }>()
  if (msg.error || post.error || page.error || task.error) {
    return [
      {
        verb: 'search setup',
        ok: false,
        detail: (msg.error ?? post.error ?? page.error ?? task.error)?.message ?? 'plant failed',
      },
    ]
  }

  interface Hit {
    entity_type: string
    entity_id: string
    parent_type: string | null
    parent_id: string | null
    title: string
    snippet: string
    rank: number
  }
  // A body-less page: with the coalesce missing, a null body would NULL the
  // whole generated vector and this row would silently never match — an
  // insert succeeds either way, so only a search can prove the difference.
  const bare = await anon
    .from('pages')
    .insert({ title: `__probe ${TOKEN}`, created_by: myId })
    .select('id')
    .single<{ id: string }>()
  if (bare.error || !bare.data) {
    return [{ verb: 'search setup', ok: false, detail: bare.error?.message ?? 'bare plant failed' }]
  }

  const found = await anon.rpc('search_all', { q: TOKEN })
  const hits = (found.data ?? []) as Hit[]
  const types = new Set(hits.map((h) => h.entity_type))
  out.push({
    verb: 'search union',
    ok: !found.error && ['message', 'post', 'page', 'task'].every((t) => types.has(t)),
    detail: found.error
      ? found.error.message
      : `${hits.length} hits across ${[...types].sort().join('/')}`,
  })
  out.push({
    verb: 'search null body',
    ok: hits.some((h) => h.entity_type === 'page' && h.entity_id === bare.data.id),
    detail: hits.some((h) => h.entity_id === bare.data.id)
      ? 'a body-less page still matches on its title — the coalesce holds'
      : 'a body-less page never matches — a null body is poisoning the vector',
  })

  const msgHit = hits.find((h) => h.entity_type === 'message' && h.entity_id === String(msg.data.id))
  out.push({
    verb: 'search parent',
    ok:
      msgHit !== undefined &&
      msgHit.parent_type === 'channel' &&
      msgHit.parent_id === general.data.id &&
      msgHit.title === '#general',
    detail: msgHit
      ? `message hit carries (${msgHit.parent_type}, #general)`
      : 'message hit missing',
  })
  out.push({
    verb: 'search snippet',
    ok: msgHit !== undefined && msgHit.snippet.includes('⟦') && msgHit.snippet.includes('⟧'),
    detail: msgHit?.snippet.includes('⟦')
      ? 'ts_headline marks with brackets, not HTML'
      : `snippet: ${msgHit?.snippet ?? 'n/a'}`,
  })

  // The scaffolding decision: every planted rich body contains type:'paragraph',
  // and none of them may match the word.
  const scaffold = await anon.rpc('search_all', { q: 'paragraph' })
  const scaffoldIds = new Set(((scaffold.data ?? []) as Hit[]).map((h) => h.entity_id))
  const leaked =
    scaffoldIds.has(page.data.id) || scaffoldIds.has(post.data.id) || scaffoldIds.has(task.data.id)
  out.push({
    verb: 'search scaffold',
    ok: !scaffold.error && !leaked,
    detail: scaffold.error
      ? scaffold.error.message
      : leaked
        ? 'BlockNote scaffolding tokens are indexed — the jsonpath filter is not working'
        : 'searching "paragraph" does not match documents that never say it',
  })

  // Tombstones stay out.
  const del = await anon
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), body: '' })
    .eq('id', msg.data.id)
    .select('id')
  const after = await anon.rpc('search_all', { q: TOKEN })
  const afterIds = new Set(((after.data ?? []) as Hit[]).map((h) => `${h.entity_type}:${h.entity_id}`))
  out.push({
    verb: 'search deleted',
    ok:
      !del.error &&
      (del.data?.length ?? 0) === 1 &&
      !afterIds.has(`message:${String(msg.data.id)}`) &&
      afterIds.has(`post:${post.data.id}`),
    detail: afterIds.has(`message:${String(msg.data.id)}`)
      ? 'a tombstoned message still surfaces'
      : 'tombstoned message dropped; live rows remain',
  })

  // Clean up — judged, not fire-and-forget.
  die('remove search probe message', (await admin.from('messages').delete().eq('id', msg.data.id)).error)
  die('remove search probe post', (await admin.from('posts').delete().eq('id', post.data.id)).error)
  die('remove search probe page', (await admin.from('pages').delete().eq('id', page.data.id)).error)
  die('remove search probe bare page', (await admin.from('pages').delete().eq('id', bare.data.id)).error)
  die('remove search probe task', (await admin.from('tasks').delete().eq('id', task.data.id)).error)

  return out
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
  // Pre-clean first: a run killed between plant and delete would otherwise
  // strand the row forever, since the id-scoped delete below is the only
  // thing that removes it.
  die(
    'sweep stale anon probe notifications',
    (await admin.from('notifications').delete().eq('entity_id', '__anon_probe')).error,
  )
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

  // Tasks carry team plans; same planted-row discipline as notifications —
  // an empty table returns [] under any policy, so plant first, then judge.
  die(
    'sweep stale anon probe tasks',
    (await admin.from('tasks').delete().eq('title', '__anon_probe')).error,
  )
  const plantedTaskId = crypto.randomUUID()
  const plantedTask = await admin.from('tasks').insert({
    id: plantedTaskId,
    title: '__anon_probe',
    status: 'todo',
    position: 1,
  })
  if (plantedTask.error) {
    out.push({
      verb: 'anon tasks',
      ok: false,
      detail: `could not plant a probe task: ${plantedTask.error.message}`,
    })
  } else {
    const t = await anon.from('tasks').select('id').limit(1)
    const tVisible = t.data?.length ?? 0
    const canReadTasks = !t.error && tVisible > 0
    out.push({
      verb: 'anon tasks',
      ok: !canReadTasks,
      detail: canReadTasks
        ? `${tVisible} task rows readable without a session`
        : 'denied (with a row present, so this means denied and not empty)',
    })
    die('remove the planted anon probe task', (await admin
      .from('tasks')
      .delete()
      .eq('id', plantedTaskId)).error)
  }

  // Posts and tags — same planted-row discipline: an empty table returns []
  // under any policy, so plant with admin first, then judge the read.
  die(
    'sweep stale anon probe posts',
    (await admin.from('posts').delete().eq('title', '__anon_probe')).error,
  )
  const forum = await admin
    .from('channels')
    .select('id')
    .eq('name', 'ideas')
    .eq('kind', 'forum')
    .maybeSingle<{ id: string }>()
  if (forum.error || !forum.data) {
    out.push({ verb: 'anon posts', ok: false, detail: 'no #ideas forum to plant a probe post in' })
  } else {
    const plantedPostId = crypto.randomUUID()
    const plantedPost = await admin.from('posts').insert({
      id: plantedPostId,
      channel_id: forum.data.id,
      author_id: await ensureUser(EMAIL_A),
      title: '__anon_probe',
    })
    if (plantedPost.error) {
      out.push({
        verb: 'anon posts',
        ok: false,
        detail: `could not plant a probe post: ${plantedPost.error.message}`,
      })
    } else {
      const p = await anon.from('posts').select('id').limit(1)
      const pVisible = p.data?.length ?? 0
      const canReadPosts = !p.error && pVisible > 0
      out.push({
        verb: 'anon posts',
        ok: !canReadPosts,
        detail: canReadPosts
          ? `${pVisible} post rows readable without a session`
          : 'denied (with a row present, so this means denied and not empty)',
      })
      die('remove the planted anon probe post', (await admin
        .from('posts')
        .delete()
        .eq('id', plantedPostId)).error)
    }
  }

  die(
    'sweep stale anon probe tags',
    (await admin.from('tags').delete().eq('name', '__anon_probe')).error,
  )
  const plantedTagId = crypto.randomUUID()
  const plantedTag = await admin
    .from('tags')
    .insert({ id: plantedTagId, name: '__anon_probe' })
  if (plantedTag.error) {
    out.push({
      verb: 'anon tags',
      ok: false,
      detail: `could not plant a probe tag: ${plantedTag.error.message}`,
    })
  } else {
    const t = await anon.from('tags').select('id').limit(1)
    const tVisible = t.data?.length ?? 0
    const canReadTags = !t.error && tVisible > 0
    out.push({
      verb: 'anon tags',
      ok: !canReadTags,
      detail: canReadTags
        ? `${tVisible} tag rows readable without a session`
        : 'denied (with a row present, so this means denied and not empty)',
    })
    die('remove the planted anon probe tag', (await admin
      .from('tags')
      .delete()
      .eq('id', plantedTagId)).error)
  }

  // Collections and pages — the P4 tables, same planted-row discipline.
  die(
    'sweep stale anon probe collections',
    (await admin.from('collections').delete().eq('name', '__anon_probe')).error,
  )
  const plantedColId = crypto.randomUUID()
  const plantedCol = await admin
    .from('collections')
    .insert({ id: plantedColId, name: '__anon_probe' })
  if (plantedCol.error) {
    out.push({
      verb: 'anon cols',
      ok: false,
      detail: `could not plant a probe collection: ${plantedCol.error.message}`,
    })
  } else {
    const c = await anon.from('collections').select('id').limit(1)
    const cVisible = c.data?.length ?? 0
    const canReadCols = !c.error && cVisible > 0
    out.push({
      verb: 'anon cols',
      ok: !canReadCols,
      detail: canReadCols
        ? `${cVisible} collection rows readable without a session`
        : 'denied (with a row present, so this means denied and not empty)',
    })
    die('remove the planted anon probe collection', (await admin
      .from('collections')
      .delete()
      .eq('id', plantedColId)).error)
  }

  die(
    'sweep stale anon probe pages',
    (await admin.from('pages').delete().eq('title', '__anon_probe')).error,
  )
  const plantedPageId = crypto.randomUUID()
  const plantedPage = await admin
    .from('pages')
    .insert({ id: plantedPageId, title: '__anon_probe' })
  if (plantedPage.error) {
    out.push({
      verb: 'anon pages',
      ok: false,
      detail: `could not plant a probe page: ${plantedPage.error.message}`,
    })
  } else {
    const pg = await anon.from('pages').select('id').limit(1)
    const pgVisible = pg.data?.length ?? 0
    const canReadPages = !pg.error && pgVisible > 0
    out.push({
      verb: 'anon pages',
      ok: !canReadPages,
      detail: canReadPages
        ? `${pgVisible} page rows readable without a session`
        : 'denied (with a row present, so this means denied and not empty)',
    })
    die('remove the planted anon probe page', (await admin
      .from('pages')
      .delete()
      .eq('id', plantedPageId)).error)
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

  // search_all() gets the identical treatment — the same #18 lesson, asserted
  // at birth instead of retrofitted: judged on refusal, never emptiness
  // (security invoker + RLS would hand anon [] under any grant).
  const search = await anon.rpc('search_all', { q: 'anything' })
  const searchRefused = search.error?.code === '42501'
  out.push({
    verb: 'anon search',
    ok: searchRefused,
    detail: searchRefused
      ? `refused (${search.error?.message})`
      : search.error
        ? `refused for the wrong reason: ${search.error.code} — ${search.error.message}`
        : `EXECUTABLE without a session — returned ${
            Array.isArray(search.data) ? search.data.length : 0
          } rows; the grant is wrong even though RLS is hiding it`,
  })

  // flatten_rich_text reads no tables, so RLS cannot even pretend to cover
  // it — the grant is the only wall, which makes this probe the whole story.
  const flatten = await anon.rpc('flatten_rich_text', { doc: [] })
  const flattenRefused = flatten.error?.code === '42501'
  out.push({
    verb: 'anon flatten',
    ok: flattenRefused,
    detail: flattenRefused
      ? `refused (${flatten.error?.message})`
      : flatten.error
        ? `refused for the wrong reason: ${flatten.error.code} — ${flatten.error.message}`
        : 'EXECUTABLE without a session — the helper grant is wrong',
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
