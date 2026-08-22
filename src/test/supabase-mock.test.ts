/**
 * The mock backend is hand-written infrastructure, so it gets a test — not for
 * coverage, but because a mock that quietly misbehaves sends you hunting for a
 * bug in the app that is really a bug in the harness.
 *
 * Scoped to the behaviours the app actually depends on. It is not a
 * conformance suite for PostgREST.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Browser APIs the mock reaches for, stubbed before it is imported.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('location', { reload: () => {} })

const { mockSupabase } = await import('@/lib/supabase-mock')

const CHANNEL = '10000000-0000-4000-8000-000000000001'

async function messageCount() {
  const { data } = await mockSupabase.from('messages').select('*')
  return (data as unknown[]).length
}

describe('mock query builder', () => {
  beforeEach(async () => {
    const { data } = await mockSupabase.from('messages').select('*')
    for (const m of data as { id: number }[]) {
      await mockSupabase.from('messages').delete().eq('id', m.id)
    }
  })

  it('seeds the two chat channels and one forum the app expects', async () => {
    const { data } = await mockSupabase.from('channels').select('*')
    const rows = data as { name: string; kind: string }[]
    expect(rows.map((c) => `${c.name}:${c.kind}`).sort()).toEqual([
      'general:chat',
      'ideas:forum',
      'random:chat',
    ])
  })

  it('inserts and returns the created row', async () => {
    const { data, error } = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'hello' })
      .select('*')
      .single()
    expect(error).toBeNull()
    expect((data as { body: string }).body).toBe('hello')
    expect((data as { id: number }).id).toBeGreaterThan(0)
  })

  it('fills nullable columns with null, not undefined', async () => {
    // The bug this guards: an inserted row without `deleted_at` left it
    // undefined, `undefined !== null` read as deleted, and every message in
    // mock mode rendered as "message deleted" with no hover actions and no
    // reply composer.
    const { data } = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'hi' })
      .select('*')
      .single()

    const row = data as Record<string, unknown>
    for (const col of ['deleted_at', 'edited_at', 'thread_root_id', 'post_id']) {
      expect(row).toHaveProperty(col)
      expect(row[col]).toBeNull()
    }
  })

  it('defaults nullable columns on the other tables too', async () => {
    const ch = await mockSupabase
      .from('channels')
      .insert({ name: 'defaults-probe', kind: 'chat' })
      .select('*')
      .single()
    expect((ch.data as Record<string, unknown>).topic).toBeNull()

    const att = await mockSupabase
      .from('attachments')
      .insert({
        owner_type: 'message',
        owner_id: '1',
        storage_path: 'p',
        filename: 'f',
      })
      .select('*')
      .single()
    expect((att.data as Record<string, unknown>).mime).toBeNull()
    expect((att.data as Record<string, unknown>).size_bytes).toBeNull()
  })

  it('gives messages ascending bigint ids, like the real identity column', async () => {
    const a = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'one' })
      .select('*')
      .single()
    const b = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'two' })
      .select('*')
      .single()
    expect((b.data as { id: number }).id).toBeGreaterThan((a.data as { id: number }).id)
  })

  it('filters with eq, orders descending and limits — the first-page query', async () => {
    for (const body of ['a', 'b', 'c']) {
      await mockSupabase
        .from('messages')
        .insert({ channel_id: CHANNEL, author_id: 'u1', body })
    }
    await mockSupabase
      .from('messages')
      .insert({ channel_id: 'other', author_id: 'u1', body: 'elsewhere' })

    const { data } = await mockSupabase
      .from('messages')
      .select('*')
      .eq('channel_id', CHANNEL)
      .order('id', { ascending: false })
      .limit(2)

    const rows = data as { body: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.body)).toEqual(['c', 'b'])
  })

  it('supports in() for the attachment lookup', async () => {
    const one = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'x' })
      .select('*')
      .single()
    const id = (one.data as { id: number }).id
    const { data } = await mockSupabase
      .from('messages')
      .select('*')
      .in('id', [id, 999])
    expect(data as unknown[]).toHaveLength(1)
  })

  it('updates matching rows', async () => {
    const ins = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'before' })
      .select('*')
      .single()
    const id = (ins.data as { id: number }).id

    await mockSupabase.from('messages').update({ body: '', deleted_at: 'now' }).eq('id', id)

    const { data } = await mockSupabase.from('messages').select('*').eq('id', id).single()
    expect((data as { body: string }).body).toBe('')
    expect((data as { deleted_at: string }).deleted_at).toBe('now')
  })

  it('deletes matching rows', async () => {
    const ins = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'doomed' })
      .select('*')
      .single()
    await mockSupabase
      .from('messages')
      .delete()
      .eq('id', (ins.data as { id: number }).id)
    expect(await messageCount()).toBe(0)
  })

  it('maybeSingle returns null rather than erroring when nothing matches', async () => {
    const { data, error } = await mockSupabase
      .from('profiles')
      .select('*')
      .eq('display_name', 'Nobody')
      .maybeSingle()
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('rejects a duplicate channel with 23505, like the unique index', async () => {
    const { error } = await mockSupabase
      .from('channels')
      .insert({ name: 'general', kind: 'chat' })
      .select('*')
      .single()
    expect(error?.code).toBe('23505')
  })

  it('keeps threads one level deep, like the flatten_thread_root trigger', async () => {
    const root = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'root' })
      .select('*')
      .single()
    const rootId = (root.data as { id: number }).id

    const reply = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'reply', thread_root_id: rootId })
      .select('*')
      .single()
    const replyId = (reply.data as { id: number }).id

    // Reply to the reply — must attach to the root instead.
    const nested = await mockSupabase
      .from('messages')
      .insert({
        channel_id: CHANNEL,
        author_id: 'u1',
        body: 'nested',
        thread_root_id: replyId,
      })
      .select('*')
      .single()

    expect((nested.data as { thread_root_id: number }).thread_root_id).toBe(rootId)
  })
})

describe('mock realtime', () => {
  it('delivers an insert to a matching channel subscription', async () => {
    const seen: unknown[] = []
    const ch = mockSupabase
      .channel('t')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${CHANNEL}`,
        },
        (p) => seen.push(p),
      )
      .subscribe()

    await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'live' })

    expect(seen).toHaveLength(1)

    // …and not after removeChannel, which is what stops the leak the real
    // client would otherwise accumulate per channel visit.
    await mockSupabase.removeChannel(ch)
    await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, author_id: 'u1', body: 'after' })
    expect(seen).toHaveLength(1)
  })

  it('does not deliver another channel’s messages', async () => {
    const seen: unknown[] = []
    const ch = mockSupabase
      .channel('t2')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${CHANNEL}`,
        },
        (p) => seen.push(p),
      )
      .subscribe()

    await mockSupabase
      .from('messages')
      .insert({ channel_id: 'somewhere-else', author_id: 'u1', body: 'nope' })
    expect(seen).toHaveLength(0)
    await mockSupabase.removeChannel(ch)
  })
})

/**
 * The account surface (DECISIONS #14). These exist because the mock is the only
 * thing standing behind offline sign-in, and because it deliberately reproduces
 * one constraint — a taken username — so local mode cannot accept a state the
 * database would refuse.
 */
describe('mock accounts', () => {
  it('seeds profiles with usernames', async () => {
    const { data } = await mockSupabase.from('profiles').select('*')
    const names = (data as { username: string }[]).map((p) => p.username).sort()
    expect(names).toEqual(['ethan', 'ethan.zhang50', 'you'])
  })

  it('resolves a username to an email, case-insensitively', async () => {
    const { data } = await mockSupabase.rpc('email_for_username', { u: 'ETHAN' })
    expect(data).toBe('ethan@localhost')
  })

  it('returns null for an unknown username, like the SQL', async () => {
    const { data, error } = await mockSupabase.rpc('email_for_username', {
      u: 'nobody',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('signs in the profile the email names, whatever the password', async () => {
    const { data, error } = await mockSupabase.auth.signInWithPassword({
      email: 'ethan@localhost',
      password: 'anything at all',
    })
    expect(error).toBeNull()
    expect(data.session?.user.email).toBe('ethan@localhost')
  })

  it('refuses a username that does not exist', async () => {
    const { error } = await mockSupabase.auth.signInWithPassword({
      email: 'ghost@localhost',
      password: 'x',
    })
    expect(error).not.toBeNull()
  })

  it('reproduces the unique username index on update — 23505', async () => {
    const { data } = await mockSupabase.from('profiles').select('*')
    const you = (data as { id: string; username: string }[]).find(
      (p) => p.username === 'you',
    )!
    // Different case, to prove the check is case-insensitive like lower(username).
    const { error } = await mockSupabase
      .from('profiles')
      .update({ username: 'ETHAN' })
      .eq('id', you.id)
    expect(error?.code).toBe('23505')
  })

  it('still allows a profile to keep its own username', async () => {
    const { data } = await mockSupabase.from('profiles').select('*')
    const you = (data as { id: string; username: string }[]).find(
      (p) => p.username === 'you',
    )!
    const { error } = await mockSupabase
      .from('profiles')
      .update({ username: 'you', display_name: 'You Again' })
      .eq('id', you.id)
    expect(error).toBeNull()
  })
})

/**
 * `.is(col, null)` — added for the bell's mark-read, which scopes its update to
 * unread rows so it cannot overwrite when you first saw something. Covered here
 * because DECISIONS #12 is explicit that the query builder is the part of the
 * mock worth testing.
 */
describe('mock .is()', () => {
  it('matches only rows whose column is null, and updates them once', async () => {
    const { data: made } = await mockSupabase
      .from('notifications')
      .insert({
        user_id: 'u1',
        kind: 'mention',
        actor_id: 'u2',
        entity_type: 'message',
        entity_id: '__is_probe',
      })
      .select('*')
      .single()
    const row = made as { id: string; read_at: string | null }
    // COLUMN_DEFAULTS must give it a real null, not undefined.
    expect(row.read_at).toBeNull()

    const first = await mockSupabase
      .from('notifications')
      .update({ read_at: '2026-08-10T00:00:00.000Z' })
      .eq('id', row.id)
      .is('read_at', null)
      .select('id')
    expect((first.data as unknown[]).length).toBe(1)

    // Already read — the scope must now match nothing.
    const second = await mockSupabase
      .from('notifications')
      .update({ read_at: '2026-08-11T00:00:00.000Z' })
      .eq('id', row.id)
      .is('read_at', null)
      .select('id')
    expect((second.data as unknown[]).length).toBe(0)

    const { data: after } = await mockSupabase
      .from('notifications')
      .select('read_at')
      .eq('id', row.id)
      .single()
    expect((after as { read_at: string }).read_at).toBe('2026-08-10T00:00:00.000Z')

    await mockSupabase.from('notifications').delete().eq('id', row.id)
  })
})

/**
 * `upsert` and `unread_counts` — the unread badge's two dependencies offline.
 *
 * Both are reproductions of behaviour that lives on the server, so they are
 * exactly the kind of thing DECISIONS #12 says to cover: a mock that quietly
 * disagrees with Postgres sends you hunting for an app bug that is not there.
 */
describe('mock upsert', () => {
  const CH = '10000000-0000-4000-8000-000000000002'
  const ME = '00000000-0000-4000-8000-000000000001'

  it('inserts when the conflict target does not match, then updates in place', async () => {
    // A pair with no existing row: the real channel_members has none for a
    // channel you have never opened.
    const other = '99999999-0000-4000-8000-00000000ffff'
    const first = await mockSupabase
      .from('channel_members')
      .upsert(
        { channel_id: other, user_id: ME, last_read_message_id: 3 },
        { onConflict: 'channel_id,user_id' },
      )
      .select('last_read_message_id')
    expect((first.data as { last_read_message_id: number }[])[0].last_read_message_id).toBe(3)

    const second = await mockSupabase
      .from('channel_members')
      .upsert(
        { channel_id: other, user_id: ME, last_read_message_id: 8 },
        { onConflict: 'channel_id,user_id' },
      )
      .select('last_read_message_id')
    expect((second.data as { last_read_message_id: number }[])[0].last_read_message_id).toBe(8)

    // Updated, not duplicated.
    const { data: all } = await mockSupabase
      .from('channel_members')
      .select('*')
      .eq('channel_id', other)
    expect((all as unknown[]).length).toBe(1)

    await mockSupabase.from('channel_members').delete().eq('channel_id', other)
  })

  it('leaves an existing seeded row addressable by its conflict target', async () => {
    await mockSupabase
      .from('channel_members')
      .upsert(
        { channel_id: CH, user_id: ME, last_read_message_id: 42 },
        { onConflict: 'channel_id,user_id' },
      )
    const { data } = await mockSupabase
      .from('channel_members')
      .select('*')
      .eq('channel_id', CH)
    expect((data as unknown[]).length).toBe(1)
  })
})

describe('mock unread_counts', () => {
  const CH = '10000000-0000-4000-8000-000000000001'
  const ME = '00000000-0000-4000-8000-000000000001'
  const THEM = '00000000-0000-4000-8000-000000000002'

  async function countFor(channelId: string) {
    const { data } = await mockSupabase.rpc('unread_counts')
    const row = (data as { channel_id: string; unread: number }[]).find(
      (r) => r.channel_id === channelId,
    )
    return row?.unread ?? null
  }

  beforeEach(async () => {
    // Sign in explicitly. `unread_counts` answers for the *current session*,
    // and an earlier describe in this file signs in as someone else — without
    // this, "their" messages would be counted as mine and every number here
    // would be wrong for a reason that has nothing to do with the mock.
    await mockSupabase.auth.signInWithPassword({
      email: 'you@localhost',
      password: 'ignored',
    })
    const { data } = await mockSupabase.from('messages').select('*')
    for (const m of data as { id: number }[]) {
      await mockSupabase.from('messages').delete().eq('id', m.id)
    }
    await mockSupabase
      .from('channel_members')
      .upsert(
        { channel_id: CH, user_id: ME, last_read_message_id: null },
        { onConflict: 'channel_id,user_id' },
      )
  })

  it('counts someone else’s messages but not your own', async () => {
    await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: THEM, body: 'theirs' })
    await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: ME, body: 'mine' })
    expect(await countFor(CH)).toBe(1)
  })

  it('stops counting a soft-deleted message', async () => {
    const { data } = await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: THEM, body: 'doomed' })
      .select('id')
      .single()
    expect(await countFor(CH)).toBe(1)
    await mockSupabase
      .from('messages')
      .update({ body: '', deleted_at: new Date().toISOString() })
      .eq('id', (data as { id: number }).id)
    expect(await countFor(CH)).toBe(0)
  })

  it('respects the read pointer', async () => {
    const { data } = await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: THEM, body: 'first' })
      .select('id')
      .single()
    await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: THEM, body: 'second' })
    expect(await countFor(CH)).toBe(2)

    await mockSupabase
      .from('channel_members')
      .upsert(
        {
          channel_id: CH,
          user_id: ME,
          last_read_message_id: (data as { id: number }).id,
        },
        { onConflict: 'channel_id,user_id' },
      )
    expect(await countFor(CH)).toBe(1)
  })

  it('reports a channel with nothing unread rather than omitting it', async () => {
    // The LEFT JOIN in the SQL exists for this: a channel with no unread must
    // still appear, or the sidebar cannot tell "read" from "unknown".
    const { data } = await mockSupabase.rpc('unread_counts')
    const rows = data as { channel_id: string; unread: number }[]
    const here = rows.find((r) => r.channel_id === CH)
    expect(here).toBeDefined()
    expect(here!.unread).toBe(0)
  })
})

/**
 * `gt` — the keyset operator behind resync and the pending sweep (SPEC §1.5).
 * Without it, switching tabs in mock mode throws.
 */
describe('mock gt', () => {
  const CH = '10000000-0000-4000-8000-000000000001'

  it('returns only rows strictly above the cursor', async () => {
    const ids: number[] = []
    for (const body of ['a', 'b', 'c']) {
      const { data } = await mockSupabase
        .from('messages')
        .insert({ channel_id: CH, author_id: 'u1', body })
        .select('id')
        .single()
      ids.push((data as { id: number }).id)
    }

    const { data } = await mockSupabase
      .from('messages')
      .select('*')
      .eq('channel_id', CH)
      .gt('id', ids[0])
      .order('id', { ascending: true })
    const got = (data as { id: number }[]).map((m) => m.id)
    expect(got).toEqual([ids[1], ids[2]])

    // Strictly greater — the cursor row itself is never re-fetched.
    expect(got).not.toContain(ids[0])

    for (const id of ids) await mockSupabase.from('messages').delete().eq('id', id)
  })

  it('returns nothing when nothing is newer, which is the common case', async () => {
    const { data: made } = await mockSupabase
      .from('messages')
      .insert({ channel_id: CH, author_id: 'u1', body: 'only' })
      .select('id')
      .single()
    const id = (made as { id: number }).id
    const { data } = await mockSupabase.from('messages').select('*').gt('id', id)
    expect((data as unknown[]).length).toBe(0)
    await mockSupabase.from('messages').delete().eq('id', id)
  })
})

/**
 * `lt` — the operator behind scrollback (`loadOlder`). Its counterpart `gt` has
 * a test above; without one here, deleting `lt` would break paging in mock mode
 * with the suite still green.
 */
describe('mock lt', () => {
  const CH = '10000000-0000-4000-8000-000000000001'

  it('returns only rows strictly below the cursor, newest first', async () => {
    const ids: number[] = []
    for (const body of ['a', 'b', 'c']) {
      const { data } = await mockSupabase
        .from('messages')
        .insert({ channel_id: CH, author_id: 'u1', body })
        .select('id')
        .single()
      ids.push((data as { id: number }).id)
    }

    const { data } = await mockSupabase
      .from('messages')
      .select('*')
      .eq('channel_id', CH)
      .lt('id', ids[2])
      .order('id', { ascending: false })
    const got = (data as { id: number }[]).map((m) => m.id)
    expect(got).toEqual([ids[1], ids[0]])
    // Strictly less — the cursor row is never returned twice.
    expect(got).not.toContain(ids[2])

    for (const id of ids) await mockSupabase.from('messages').delete().eq('id', id)
  })
})

/**
 * P3 forum tables. Same reasoning as the channels 23505 check: each of these
 * reproduces a database rule whose absence would let the mock fake a state
 * Postgres forbids.
 */
describe('mock posts, tags, post_tags', () => {
  const FORUM = '10000000-0000-4000-8000-000000000003'

  it('rejects a duplicate tag name with 23505, like the unique index', async () => {
    const first = await mockSupabase
      .from('tags')
      .insert({ name: 'dup-probe', color: '#3b82f6' })
      .select('*')
      .single()
    expect(first.error).toBeNull()

    const second = await mockSupabase.from('tags').insert({ name: 'dup-probe' }).select('*')
    expect(second.error?.code).toBe('23505')

    await mockSupabase.from('tags').delete().eq('name', 'dup-probe')
  })

  it('stamps no surrogate id or created_at onto post_tags, which has neither', async () => {
    const post = await mockSupabase
      .from('posts')
      .insert({ channel_id: FORUM, author_id: 'u1', title: 'pk probe' })
      .select('*')
      .single()
    const tag = await mockSupabase
      .from('tags')
      .insert({ name: 'pk-probe' })
      .select('*')
      .single()
    const postId = (post.data as { id: string }).id
    const tagId = (tag.data as { id: string }).id

    const { data, error } = await mockSupabase
      .from('post_tags')
      .insert({ post_id: postId, tag_id: tagId })
      .select('*')
      .single()
    expect(error).toBeNull()
    // The real table's shape is exactly two columns; a mock-invented `id` or
    // `created_at` here is the composite-PK bug COMPOSITE_PK exists to stop.
    expect(Object.keys(data as Record<string, unknown>).sort()).toEqual([
      'post_id',
      'tag_id',
    ])

    await mockSupabase.from('post_tags').delete().eq('post_id', postId)
    await mockSupabase.from('posts').delete().eq('id', postId)
    await mockSupabase.from('tags').delete().eq('id', tagId)
  })

  it('defaults posts.body_rich to null, not undefined', async () => {
    const { data } = await mockSupabase
      .from('posts')
      .insert({ channel_id: FORUM, author_id: 'u1', title: 'defaults probe' })
      .select('*')
      .single()
    const row = data as Record<string, unknown>
    expect(row).toHaveProperty('body_rich')
    expect(row.body_rich).toBeNull()
    await mockSupabase.from('posts').delete().eq('id', row.id as string)
  })

  it('enforces the one-parent CHECK: both parents or neither is 23514', async () => {
    const both = await mockSupabase
      .from('messages')
      .insert({ channel_id: CHANNEL, post_id: 'p1', author_id: 'u1', body: 'x' })
      .select('*')
    expect(both.error?.code).toBe('23514')

    const neither = await mockSupabase
      .from('messages')
      .insert({ author_id: 'u1', body: 'x' })
      .select('*')
    expect(neither.error?.code).toBe('23514')
  })

  it('accepts a post-keyed message and finds it via the post_id=eq filter shape', async () => {
    const post = await mockSupabase
      .from('posts')
      .insert({ channel_id: FORUM, author_id: 'u1', title: 'comment probe' })
      .select('*')
      .single()
    const postId = (post.data as { id: string }).id

    const { data: made, error } = await mockSupabase
      .from('messages')
      .insert({ post_id: postId, author_id: 'u1', body: 'a comment' })
      .select('*')
      .single()
    expect(error).toBeNull()
    expect((made as { channel_id: unknown }).channel_id).toBeNull()

    const { data } = await mockSupabase
      .from('messages')
      .select('*')
      .eq('post_id', postId)
    expect((data as unknown[]).length).toBe(1)

    await mockSupabase.from('messages').delete().eq('post_id', postId)
    await mockSupabase.from('posts').delete().eq('id', postId)
  })
})

describe('mock collections, pages', () => {
  it('defaults the nullable page columns, including the edit-lock pair', async () => {
    const { data } = await mockSupabase
      .from('pages')
      .insert({ title: 'defaults probe' })
      .select('*')
      .single()
    const row = data as Record<string, unknown>
    for (const col of [
      'collection_id',
      'body_rich',
      'created_by',
      'editing_user_id',
      'editing_heartbeat_at',
    ]) {
      expect(row).toHaveProperty(col)
      expect(row[col]).toBeNull()
    }
    await mockSupabase.from('pages').delete().eq('id', row.id as string)
  })

  it('stamps updated_at on insert — not null default now(), like Postgres', async () => {
    const { data } = await mockSupabase
      .from('pages')
      .insert({ title: 'stamp probe' })
      .select('*')
      .single()
    const row = data as Record<string, unknown>
    expect(row.updated_at).toBe(row.created_at)
    await mockSupabase.from('pages').delete().eq('id', row.id as string)
  })

  it('defaults collections.parent_id to null — a root collection', async () => {
    const { data } = await mockSupabase
      .from('collections')
      .insert({ name: 'roots probe' })
      .select('*')
      .single()
    const row = data as Record<string, unknown>
    expect(row.parent_id).toBeNull()
    await mockSupabase.from('collections').delete().eq('id', row.id as string)
  })
})
