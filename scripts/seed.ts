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
 * that RLS is configured correctly — see DECISIONS #3 for why it authenticates
 * with a generated magic link instead of a password.
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
async function ensureUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
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

const CHATTER = [
  'morning all',
  'pushed the migration, take a look when you get a sec',
  'the staging deploy is green',
  'anyone else seeing the flaky test on CI?',
  'nope, passed for me twice in a row',
  'ok merging then',
  'quick one: are we still doing the sync at 3?',
  'yep, calendar invite went out yesterday',
  'nice, thanks',
  'that reminds me — we should write this down somewhere',
]

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

  // 3. Fifty messages, alternating authors, plus one real thread so P1 has
  //    something with depth to render.
  //
  //    Idempotent via a count guard: exactly 50 means a previous run finished,
  //    so skip. Any other non-zero count means a run died between the bulk
  //    insert and the thread insert, so wipe and redo rather than stacking
  //    another 47 on top.
  //
  //    Note the consequence: a complete seed is never re-authored. Changing
  //    SEED_USER_A/B_EMAIL and rerunning leaves the existing 50 owned by the
  //    old users. To re-author, delete the messages (or the old users, which
  //    cascades) first.
  const { count: existing } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', general)

  if ((existing ?? 0) === 50) {
    console.log('✓ messages     50 already present, skipping')
  } else {
    if ((existing ?? 0) > 0) {
      const { error: wipeErr } = await admin
        .from('messages')
        .delete()
        .eq('channel_id', general)
      die('clear partial message seed', wipeErr)
      console.log(`  cleared ${existing} messages from an earlier partial run`)
    }

    const rows = Array.from({ length: 47 }, (_, i) => ({
      channel_id: general,
      author_id: i % 2 === 0 ? userA : userB,
      body: `${CHATTER[i % CHATTER.length]} (${i + 1})`,
    }))
    const { data: inserted, error: msgErr } = await admin
      .from('messages')
      .insert(rows)
      .select('id')
    die('insert messages', msgErr)

    const rootId = (inserted as { id: number }[])[10].id
    const { error: threadErr } = await admin.from('messages').insert([
      {
        channel_id: general,
        author_id: userB,
        thread_root_id: rootId,
        body: 'replying in a thread so P1 has one to render',
      },
      {
        channel_id: general,
        author_id: userA,
        thread_root_id: rootId,
        body: 'and a second reply',
      },
      {
        channel_id: general,
        author_id: userB,
        thread_root_id: rootId,
        body: 'third — threads are one level deep by design',
      },
    ])
    die('insert thread replies', threadErr)
    console.log('✓ messages     50 in #general, including a 3-reply thread')
  }

  await rlsCheck(EMAIL_A)
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
  console.log('✓ RLS check PASSED — authenticated has full access, anon has none.\n')
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
  out.push({
    verb: 'anon select',
    ok: !!sel.error || visible === 0,
    detail:
      !!sel.error || visible === 0
        ? 'denied'
        : `${visible} rows readable without a session — RLS is off or the policy is not scoped to authenticated`,
  })

  const ins = await anon
    .from('channels')
    .insert({ name: `${RLS_PROBE}_anon`, kind: 'chat' })
    .select('id')
  const created = ins.data?.length ?? 0
  out.push({
    verb: 'anon insert',
    ok: !!ins.error || created === 0,
    detail: !!ins.error || created === 0 ? 'denied' : 'row created without a session',
  })

  // Clean up in case the insert was wrongly allowed, so the failure is
  // reported without also poisoning the next run.
  if (created > 0) await admin.from('channels').delete().eq('name', `${RLS_PROBE}_anon`)

  return out
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
