/**
 * An in-memory stand-in for the Supabase client — DECISIONS #12.
 *
 * **Only active when `VITE_MOCK_BACKEND=true`.** It exists so the UI can be
 * driven with no network, no Docker and no cloud project. It is a *test
 * harness*, not a second implementation of the product: it fakes the client
 * boundary, so every component, hook and query above it runs unmodified.
 *
 * What it cannot tell you, and what only the real backend can:
 *
 *  * **RLS.** There are no policies here. Everything is permitted.
 *  * **Realtime.** Events are emitted synchronously in one tab. It proves the
 *    subscribe/absorb wiring, not that Postgres replicates anything.
 *  * **Constraints.** The unique (name, kind) index, the exactly-one-parent
 *    CHECK and the flatten_thread_root trigger are approximated where cheap and
 *    absent otherwise.
 *
 * So: green here means the interface works. It never means the feature ships.
 *
 * Rows persist in localStorage; **uploaded files live in memory only** and are
 * gone on reload, because a 10 MB file base64'd into localStorage would blow
 * its ~5 MB quota on the first upload.
 */

/**
 * Bumped to v2 when the leftover `Guest` profile was removed. An older payload
 * would otherwise keep reseeding a teammate who does not exist, and the member
 * list is exactly where that shows up.
 */
const STORAGE_KEY = 'threadline.mock.v2'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

interface Payload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  schema: string
  table: string
  new: Row
  old: Row
}

interface Listener {
  table: string
  event: string
  filter?: string
  cb: (payload: Payload) => void
}

const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001'
/**
 * Two stand-in teammates. Not decoration: mentions need somebody to point at,
 * and the picker's longest-match rule (`@ethan` must not win over
 * `@ethan.zhang50`) is only exercisable offline if two names share a prefix.
 * They replace the `Guest` profile left behind by the reverted guest mode
 * (DECISIONS #13), which the member list would otherwise render.
 */
const TEAMMATE_A_ID = '00000000-0000-4000-8000-000000000002'
const TEAMMATE_B_ID = '00000000-0000-4000-8000-000000000003'

function seed(): Tables {
  const general = '10000000-0000-4000-8000-000000000001'
  const random = '10000000-0000-4000-8000-000000000002'
  const now = new Date().toISOString()
  return {
    profiles: [
      { id: MOCK_USER_ID, display_name: 'you', avatar_url: null, created_at: now },
      { id: TEAMMATE_A_ID, display_name: 'ethan', avatar_url: null, created_at: now },
      {
        id: TEAMMATE_B_ID,
        display_name: 'ethan.zhang50',
        avatar_url: null,
        created_at: now,
      },
    ],
    channels: [
      {
        id: general,
        name: 'general',
        kind: 'chat',
        topic: 'Everything and anything',
        created_by: MOCK_USER_ID,
        created_at: now,
      },
      {
        id: random,
        name: 'random',
        kind: 'chat',
        topic: null,
        created_by: MOCK_USER_ID,
        created_at: now,
      },
    ],
    channel_members: [
      { channel_id: general, user_id: MOCK_USER_ID, last_read_message_id: null, joined_at: now },
      { channel_id: random, user_id: MOCK_USER_ID, last_read_message_id: null, joined_at: now },
    ],
    messages: [],
    attachments: [],
  }
}

function load(): Tables {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Tables
  } catch {
    // Corrupt or unavailable storage just means a fresh seed.
  }
  return seed()
}

const db: Tables = load()
const listeners = new Set<Listener>()
/** Uploaded blobs. Deliberately not persisted — see the header. */
const files = new Map<string, Blob>()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Over quota — keep running in memory rather than losing the session.
  }
}

/**
 * Nullable columns each table actually has, defaulted to null on insert.
 *
 * Postgres fills these in; an object literal does not. Without this a mocked
 * row has `deleted_at === undefined`, and `undefined !== null` made every
 * message read as deleted — which hid the hover actions and the reply composer
 * on every message in mock mode. A mock that omits columns is a mock that
 * invents states the database cannot produce.
 */
const COLUMN_DEFAULTS: Record<string, Row> = {
  messages: {
    channel_id: null,
    post_id: null,
    thread_root_id: null,
    edited_at: null,
    deleted_at: null,
  },
  channels: { topic: null, created_by: null },
  profiles: { avatar_url: null },
  channel_members: { last_read_message_id: null },
  attachments: { mime: null, size_bytes: null },
}

/** messages.id is a bigint identity; everything else is a uuid. */
function nextId(table: string): unknown {
  if (table === 'messages') {
    const rows = db.messages ?? []
    return rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
  }
  return crypto.randomUUID()
}

function matchesFilter(row: Row, filter?: string): boolean {
  if (!filter) return true
  // Only `col=eq.value` is used by the app's subscriptions.
  const m = /^([\w]+)=eq\.(.*)$/.exec(filter)
  if (!m) return true
  return String(row[m[1]]) === m[2]
}

function emit(eventType: Payload['eventType'], table: string, row: Row, old: Row = {}) {
  const payload: Payload = { eventType, schema: 'public', table, new: row, old }
  for (const l of listeners) {
    if (l.table !== table) continue
    if (l.event !== '*' && l.event !== eventType) continue
    // A DELETE payload carries only the primary key in production, so the
    // filter cannot match — mirror that rather than flattering ourselves.
    if (eventType !== 'DELETE' && !matchesFilter(row, l.filter)) continue
    l.cb(payload)
  }
}

type Op = 'select' | 'insert' | 'update' | 'delete'

class Query implements PromiseLike<{ data: unknown; error: null | { message: string; code?: string } }> {
  private filters: ((r: Row) => boolean)[] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private limitTo: number | null = null
  private returning = false
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'

  constructor(
    private table: string,
    private op: Op,
    private payload?: Row | Row[],
  ) {}

  select(cols?: string) {
    // Column projection is ignored — returning extra fields is harmless here,
    // and the app never relies on a column being absent.
    void cols
    this.returning = true
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => String(r[col]) === String(val))
    return this
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals.map(String))
    this.filters.push((r) => set.has(String(r[col])))
    return this
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => Number(r[col]) < Number(val))
    return this
  }
  not(col: string, op: string, val: unknown) {
    // Only `.not(col, 'is', null)` is used; anything else would need real
    // operator parsing and is deliberately not faked.
    void op
    void val
    this.filters.push((r) => r[col] !== null && r[col] !== undefined)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false }
    return this
  }
  limit(n: number) {
    this.limitTo = n
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  private rows(): Row[] {
    return (db[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)))
  }

  private run(): { data: unknown; error: null | { message: string; code?: string } } {
    db[this.table] ??= []
    let result: Row[] = []

    if (this.op === 'select') {
      result = this.rows()
      if (this.orderBy) {
        const { col, asc } = this.orderBy
        result = [...result].sort((a, b) => {
          const x = a[col] as string | number
          const y = b[col] as string | number
          const cmp = x < y ? -1 : x > y ? 1 : 0
          return asc ? cmp : -cmp
        })
      }
      if (this.limitTo !== null) result = result.slice(0, this.limitTo)
    } else if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!]
      for (const row of incoming) {
        // Approximates the unique (name, kind) index so the duplicate-channel
        // path can be exercised. The real constraint is in Postgres.
        if (this.table === 'channels') {
          const clash = db.channels.some(
            (c) => c.name === row.name && c.kind === row.kind,
          )
          if (clash) {
            return { data: null, error: { message: 'duplicate key value', code: '23505' } }
          }
        }
        const created: Row = {
          id: nextId(this.table),
          created_at: new Date().toISOString(),
          ...(COLUMN_DEFAULTS[this.table] ?? {}),
          ...row,
        }
        // Threads are one level deep — the flatten_thread_root trigger's job
        // (SPEC §1.3), reproduced so the mock cannot fake a nested thread.
        if (this.table === 'messages' && created.thread_root_id != null) {
          const target = db.messages.find(
            (m) => String(m.id) === String(created.thread_root_id),
          )
          if (target?.thread_root_id != null) created.thread_root_id = target.thread_root_id
        }
        db[this.table].push(created)
        result.push(created)
        emit('INSERT', this.table, created)
      }
    } else if (this.op === 'update') {
      for (const row of this.rows()) {
        const before = { ...row }
        Object.assign(row, this.payload as Row)
        result.push(row)
        emit('UPDATE', this.table, row, before)
      }
    } else {
      for (const row of this.rows()) {
        const i = db[this.table].indexOf(row)
        if (i >= 0) db[this.table].splice(i, 1)
        result.push(row)
        emit('DELETE', this.table, { id: row.id }, { id: row.id })
      }
    }

    if (this.op !== 'select') persist()

    if (this.mode === 'single' || this.mode === 'maybeSingle') {
      if (result.length === 0) {
        return this.mode === 'single'
          ? { data: null, error: { message: 'no rows returned', code: 'PGRST116' } }
          : { data: null, error: null }
      }
      return { data: result[0], error: null }
    }
    return { data: this.op === 'select' || this.returning ? result : null, error: null }
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((v: { data: unknown; error: null | { message: string; code?: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

class MockChannel {
  private subs: Listener[] = []
  constructor(public topic: string) {}

  on(
    _type: string,
    opts: { event: string; schema: string; table: string; filter?: string },
    cb: (payload: Payload) => void,
  ) {
    const l: Listener = { table: opts.table, event: opts.event, filter: opts.filter, cb }
    this.subs.push(l)
    listeners.add(l)
    return this
  }

  subscribe(cb?: (status: string) => void) {
    cb?.('SUBSCRIBED')
    return this
  }

  teardown() {
    for (const l of this.subs) listeners.delete(l)
    this.subs = []
  }
}

const session = {
  access_token: 'mock',
  refresh_token: 'mock',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: MOCK_USER_ID, email: 'you@localhost', app_metadata: {}, user_metadata: {} },
}

let currentSession: typeof session | null = session
const authCallbacks = new Set<(event: string, s: typeof session | null) => void>()

export const mockSupabase = {
  from: (table: string) => ({
    select: (cols?: string) => new Query(table, 'select').select(cols),
    insert: (payload: Row | Row[]) => new Query(table, 'insert', payload),
    update: (payload: Row) => new Query(table, 'update', payload),
    delete: () => new Query(table, 'delete'),
  }),

  channel: (topic: string) => new MockChannel(topic),
  removeChannel: (ch: MockChannel) => {
    ch.teardown()
    return Promise.resolve('ok')
  },

  storage: {
    // One bucket only; the app never uses a second.
    from: (bucket: string) => ({
      __bucket: bucket,
      upload: async (path: string, file: Blob) => {
        files.set(path, file)
        return { data: { path }, error: null }
      },
      createSignedUrls: async (paths: string[], ttlSeconds: number) => {
        // Object URLs do not expire, so there is nothing for the TTL to do.
        void ttlSeconds
        return {
          data: paths.map((p) => {
            const blob = files.get(p)
            return {
              path: p,
              // Object URLs die with the tab, which is exactly the lifetime of
              // the blobs behind them here.
              signedUrl: blob ? URL.createObjectURL(blob) : null,
              error: blob ? null : 'not found',
            }
          }),
          error: null,
        }
      },
      remove: async (paths: string[]) => {
        const removed = paths.filter((p) => files.delete(p))
        return { data: removed.map((p) => ({ name: p })), error: null }
      },
    }),
  },

  auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (cb: (event: string, s: typeof session | null) => void) => {
      authCallbacks.add(cb)
      return {
        data: { subscription: { unsubscribe: () => authCallbacks.delete(cb) } },
      }
    },
    signInWithOtp: async () => {
      // No email round trip offline; signing in is immediate.
      currentSession = session
      for (const cb of authCallbacks) cb('SIGNED_IN', currentSession)
      return { data: {}, error: null }
    },
    signOut: async () => {
      currentSession = null
      for (const cb of authCallbacks) cb('SIGNED_OUT', null)
      return { error: null }
    },
  },
}

/** Wipe local state — handy when the mock data gets into a silly shape. */
export function resetMockBackend() {
  localStorage.removeItem(STORAGE_KEY)
  location.reload()
}
