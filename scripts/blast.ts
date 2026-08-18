/**
 * Sends N messages into a channel, as a chosen user. Gate helper.
 *
 *   npm run blast -- --channel general --count 250 --as ethan.zhang50
 *   npm run blast -- --count 3 --delay 1000       # slow trickle
 *   npm run blast -- --clean                      # remove every blast row
 *
 * Exists because G1 asks for a 250+ message backlog while the other browser is
 * offline, which is the case a single capped resync query fails (DECISIONS #19)
 * and which nobody can produce by typing. Runs locally only, reads
 * SUPABASE_SERVICE_ROLE_KEY from .env.local like `seed` does (Non-negotiable 9).
 *
 * Writes through the service key, so it bypasses RLS but not constraints — the
 * rows are ordinary messages and the realtime publication carries them exactly
 * as it would a real send. Every row is prefixed so `--clean` can find them all.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const URL = process.env.VITE_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !SERVICE) {
  console.error('Missing env. .env.local needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

/** Every row this script writes starts with this, so `--clean` is exact. */
const PREFIX = '[blast]'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}
const has = (name: string) => process.argv.includes(`--${name}`)

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

if (has('clean')) {
  const { data, error } = await admin
    .from('messages')
    .delete()
    .like('body', `${PREFIX}%`)
    .select('id')
  if (error) {
    console.error(`✗ clean failed: ${error.message}`)
    process.exit(1)
  }
  console.log(`✓ removed ${data?.length ?? 0} blast messages`)
  process.exit(0)
}

const channelName = arg('channel', 'general')!
const count = Number(arg('count', '250'))
const delay = Number(arg('delay', '0'))
const asUser = arg('as')

if (!Number.isFinite(count) || count < 1) {
  console.error(`✗ --count must be a positive number, got "${arg('count')}"`)
  process.exit(1)
}

const { data: channel, error: chanErr } = await admin
  .from('channels')
  .select('id,name')
  .eq('name', channelName)
  .maybeSingle()
if (chanErr || !channel) {
  console.error(`✗ no channel named "${channelName}"${chanErr ? `: ${chanErr.message}` : ''}`)
  process.exit(1)
}

// Pick the author. Defaults to whoever is NOT the most recent signer-in, so a
// blast is visible to the person running it rather than being their own.
const { data: profiles, error: profErr } = await admin
  .from('profiles')
  .select('id,username,display_name')
  .order('created_at')
if (profErr || !profiles?.length) {
  console.error(`✗ could not list profiles${profErr ? `: ${profErr.message}` : ''}`)
  process.exit(1)
}
const author = asUser
  ? profiles.find((p) => p.username.toLowerCase() === asUser.toLowerCase())
  : profiles[0]
if (!author) {
  console.error(
    `✗ no user @${asUser}. Known: ${profiles.map((p) => '@' + p.username).join(', ')}`,
  )
  process.exit(1)
}

console.log(
  `\nBlasting ${count} message${count === 1 ? '' : 's'} into #${channel.name} as @${author.username}` +
    `${delay ? `, ${delay}ms apart` : ''}…`,
)

const stamp = Date.now().toString(36)
let sent = 0

if (delay > 0) {
  // Trickle: one insert at a time, so each arrives as its own realtime event.
  for (let i = 1; i <= count; i++) {
    const { error } = await admin.from('messages').insert({
      channel_id: channel.id,
      author_id: author.id,
      body: `${PREFIX} ${stamp} ${i} of ${count}`,
    })
    if (error) {
      console.error(`✗ failed at ${i}: ${error.message}`)
      process.exit(1)
    }
    sent++
    if (i % 25 === 0 || i === count) process.stdout.write(`\r  ${i}/${count}`)
    if (i < count) await new Promise((r) => setTimeout(r, delay))
  }
} else {
  // Bulk: chunked inserts. Ordering still follows the identity sequence.
  const CHUNK = 100
  for (let start = 0; start < count; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, count - start) }, (_, k) => ({
      channel_id: channel.id,
      author_id: author.id,
      body: `${PREFIX} ${stamp} ${start + k + 1} of ${count}`,
    }))
    const { error } = await admin.from('messages').insert(rows)
    if (error) {
      console.error(`\n✗ failed near ${start + 1}: ${error.message}`)
      process.exit(1)
    }
    sent += rows.length
    process.stdout.write(`\r  ${sent}/${count}`)
  }
}

console.log(`\n✓ sent ${sent} as @${author.username} into #${channel.name}`)
console.log(`  remove them with:  npm run blast -- --clean\n`)
