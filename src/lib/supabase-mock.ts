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
 *
 * Two things it deliberately does not check, because the answer lives on the
 * server: the **invite code** (the secret is in the Edge Function) and the
 * **password** (any password signs you in as whoever the username names). See
 * DECISIONS #14.
 *
 * That second gap is also how the bell is testable offline. Mentioning someone
 * never notifies *you* — so to see a notification, mention `@ethan` as `you`,
 * sign out, and sign back in as `ethan` with any password at all.
 */

/**
 * Bumped whenever the seeded shape changes, because a stale payload in
 * localStorage is loaded verbatim and would otherwise resurrect the old one.
 *
 * v2 dropped the leftover `Guest` profile from the reverted guest mode.
 * v3 added `username`, without which sign-in and mentions have nothing to
 * resolve and every profile renders as a teammate the app cannot name.
 * v4 added the `notifications` table for the bell.
 * v5 added the `tasks` and `links` tables for the P2 kanban.
 * v6 added `posts`/`tags`/`post_tags` and a forum-kind channel for P3.
 */
const STORAGE_KEY = 'threadline.mock.v6'

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
  const ideas = '10000000-0000-4000-8000-000000000003'
  const now = new Date().toISOString()
  return {
    profiles: [
      {
        id: MOCK_USER_ID,
        username: 'you',
        display_name: 'You',
        avatar_url: null,
        created_at: now,
      },
      {
        id: TEAMMATE_A_ID,
        username: 'ethan',
        display_name: 'Ethan',
        avatar_url: null,
        created_at: now,
      },
      {
        id: TEAMMATE_B_ID,
        username: 'ethan.zhang50',
        display_name: 'Ethan Zhang',
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
      // A forum so /forums has something to render offline — the post list,
      // tag filter, and comment surfaces are all unreachable without one.
      {
        id: ideas,
        name: 'ideas',
        kind: 'forum',
        topic: 'Pitches and proposals',
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
    notifications: [],
    tasks: [],
    links: [],
    posts: [],
    tags: [],
    post_tags: [],
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
  notifications: { actor_id: null, read_at: null },
  tasks: {
    description_rich: null,
    assignee_id: null,
    due_date: null,
    source_message_id: null,
    source_post_id: null,
    created_by: null,
    completed_at: null,
  },
  posts: { body_rich: null },
  tags: { color: null },
  // `links` and `post_tags` have no nullable payload columns (SPEC §2.3) —
  // nothing to default.
}

/**
 * Tables whose primary key is composite, so they have no surrogate `id` and
 * name their own timestamp. Stamping `id`/`created_at` onto one of these would
 * be the mock inventing a shape Postgres cannot produce — the same class of
 * problem as the missing nullable columns above.
 */
const COMPOSITE_PK: Record<string, { timestamp?: string }> = {
  channel_members: { timestamp: 'joined_at' },
  // post_tags has no timestamp at all (SPEC §2.3) — just the two-column PK.
  post_tags: {},
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

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert'

class Query implements PromiseLike<{ data: unknown; error: null | { message: string; code?: string } }> {
  private filters: ((r: Row) => boolean)[] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private limitTo: number | null = null
  private returning = false
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'

  /** Columns forming the conflict target, for an upsert. */
  private conflict: string[] = []

  constructor(
    private table: string,
    private op: Op,
    private payload?: Row | Row[],
    onConflict?: string,
  ) {
    if (onConflict) this.conflict = onConflict.split(',').map((c) => c.trim())
  }

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
  gt(col: string, val: unknown) {
    // Used by resync and the pending sweep, both keyset scans on messages.id.
    this.filters.push((r) => Number(r[col]) > Number(val))
    return this
  }
  is(col: string, val: unknown) {
    // Only `.is(col, null)` is used — by the bell's mark-read, which scopes its
    // update to unread rows so it cannot rewrite `read_at` on rows already
    // read. Without this the mock would mark everything read twice over.
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val))
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
        // Approximates the unique index on tags.name, same reasoning — the
        // tag-creation race path in ensureTags is only exercisable offline if
        // the duplicate actually errors.
        if (this.table === 'tags') {
          if (db.tags.some((t) => t.name === row.name)) {
            return { data: null, error: { message: 'duplicate key value', code: '23505' } }
          }
        }
        const composite = COMPOSITE_PK[this.table]
        const created: Row = {
          ...(composite
            ? composite.timestamp
              ? { [composite.timestamp]: new Date().toISOString() }
              : {}
            : { id: nextId(this.table), created_at: new Date().toISOString() }),
          ...(COLUMN_DEFAULTS[this.table] ?? {}),
          ...row,
        }
        // The messages_one_parent CHECK: exactly one of channel_id / post_id
        // (SPEC §1.3). Reproduced because a mock row wearing both parents —
        // or neither — is a state Postgres cannot produce, and every consumer
        // (unread counts, channel filters, comment counts) relies on the two
        // sets being disjoint.
        if (
          this.table === 'messages' &&
          (created.channel_id == null) === (created.post_id == null)
        ) {
          return {
            data: null,
            error: { message: 'messages_one_parent check violation', code: '23514' },
          }
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
    } else if (this.op === 'upsert') {
      // Matches an existing row on the conflict columns and updates it,
      // otherwise inserts. Reproduced because the unread pointer depends on
      // it: a channel you have never opened has no channel_members row, and a
      // mock that silently did nothing there would show a badge the real
      // backend clears.
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!]
      for (const row of incoming) {
        const existing = this.conflict.length
          ? db[this.table].find((r) =>
              this.conflict.every((c) => String(r[c]) === String(row[c])),
            )
          : undefined
        if (existing) {
          const before = { ...existing }
          Object.assign(existing, row)
          result.push(existing)
          emit('UPDATE', this.table, existing, before)
        } else {
          const composite = COMPOSITE_PK[this.table]
          const created: Row = {
            ...(composite
              ? composite.timestamp
                ? { [composite.timestamp]: new Date().toISOString() }
                : {}
              : { id: nextId(this.table), created_at: new Date().toISOString() }),
            ...(COLUMN_DEFAULTS[this.table] ?? {}),
            ...row,
          }
          db[this.table].push(created)
          result.push(created)
          emit('INSERT', this.table, created)
        }
      }
    } else if (this.op === 'update') {
      const patch = this.payload as Row
      const targets = this.rows()

      // Approximates profiles_username_lower_key so /settings cannot silently
      // accept a taken username offline and then fail against the real
      // database. Same reasoning as the channels index above: a mock that
      // permits a state Postgres forbids sends you hunting for an app bug.
      if (this.table === 'profiles' && typeof patch.username === 'string') {
        const wanted = patch.username.toLowerCase()
        const ids = new Set(targets.map((r) => String(r.id)))
        const clash = db.profiles.some(
          (p) =>
            !ids.has(String(p.id)) && String(p.username ?? '').toLowerCase() === wanted,
        )
        if (clash) {
          return { data: null, error: { message: 'duplicate key value', code: '23505' } }
        }
      }

      for (const row of targets) {
        const before = { ...row }
        Object.assign(row, patch)
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

function emitAuth() {
  for (const cb of authCallbacks) {
    cb(currentSession ? 'SIGNED_IN' : 'SIGNED_OUT', currentSession)
  }
}

export const mockSupabase = {
  from: (table: string) => ({
    select: (cols?: string) => new Query(table, 'select').select(cols),
    insert: (payload: Row | Row[]) => new Query(table, 'insert', payload),
    upsert: (payload: Row | Row[], opts?: { onConflict?: string }) =>
      new Query(table, 'upsert', payload, opts?.onConflict),
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

  /**
   * Postgres functions. Only `email_for_username` exists (DECISIONS #14), and
   * it is the one thing the real client calls before it has a session.
   */
  rpc: async (fn: string, args?: Record<string, unknown>) => {
    /**
     * `unread_counts()` — SPEC §1.4, reproduced from the SQL in
     * `20260810160428_unread_counts.sql`.
     *
     * A second implementation of a rule, which this file usually refuses to be.
     * It earns the exception because the alternative is worse: without it the
     * sidebar has no badges at all offline, and a badge silently reading 0 is
     * the exact bug that made the rule move into SQL (DECISIONS #18). Kept
     * clause-for-clause with the migration, and both are covered — the SQL by
     * `npm run seed`, this by `src/test/supabase-mock.test.ts`.
     */
    if (fn === 'unread_counts') {
      const me = currentSession?.user.id
      if (!me) return { data: [], error: null }

      const rows = (db.channels ?? []).map((c) => {
        const membership = (db.channel_members ?? []).find(
          (m) => String(m.channel_id) === String(c.id) && String(m.user_id) === me,
        )
        // A missing membership row and a null pointer both mean "nothing read
        // here" — the LEFT JOIN plus coalesce in the SQL.
        const floor = Number(membership?.last_read_message_id ?? 0) || 0
        const unread = (db.messages ?? []).filter(
          (m) =>
            String(m.channel_id) === String(c.id) &&
            Number(m.id) > floor &&
            String(m.author_id) !== me &&
            m.deleted_at == null,
        ).length
        return { channel_id: String(c.id), unread }
      })
      return { data: rows, error: null }
    }

    if (fn !== 'email_for_username') {
      return { data: null, error: { message: `mock: no such function ${fn}` } }
    }
    args ??= {}
    const wanted = String(args.u ?? '')
      .trim()
      .toLowerCase()
    const hit = (db.profiles ?? []).find(
      (p) => String(p.username ?? '').toLowerCase() === wanted,
    )
    // Mirrors the SQL: a miss is null data, never an error.
    return { data: hit ? `${String(hit.username)}@localhost` : null, error: null }
  },

  functions: {
    /**
     * The register Edge Function.
     *
     * **The invite code is not checked here, and cannot be** — the secret lives
     * on the server and this runs entirely in the browser. So offline
     * registration accepts any code. That is a hole in the mock, not in the
     * product, and it is exactly the class of thing DECISIONS #12 warns about:
     * a green mock run says the wiring works, never that the gate does.
     */
    invoke: async (name: string, opts?: { body?: Record<string, unknown> }) => {
      if (name !== 'register') {
        return { data: null, error: { message: `mock: no such function ${name}` } }
      }
      const body = opts?.body ?? {}
      const username = String(body.username ?? '').toLowerCase()
      const displayName = String(body.displayName ?? '') || username

      if (
        (db.profiles ?? []).some(
          (p) => String(p.username ?? '').toLowerCase() === username,
        )
      ) {
        return { data: { error: 'That username is taken.' }, error: null }
      }

      const id = crypto.randomUUID()
      db.profiles.push({
        id,
        username,
        display_name: displayName,
        avatar_url: null,
        created_at: new Date().toISOString(),
      })
      persist()
      return { data: { ok: true, username }, error: null }
    },
  },

  auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (cb: (event: string, s: typeof session | null) => void) => {
      authCallbacks.add(cb)
      return {
        data: { subscription: { unsubscribe: () => authCallbacks.delete(cb) } },
      }
    },
    /**
     * No password is stored or checked offline — any password signs you in as
     * whoever the username names. Same caveat as the invite code above.
     */
    signInWithPassword: async ({
      email,
      password,
    }: {
      email: string
      password: string
    }) => {
      // Accepted and ignored — there is nothing offline to compare it against.
      // Declared anyway so the mock's shape matches the real client's, which is
      // what lets every caller above the boundary stay unchanged.
      void password
      const username = email.split('@')[0]?.toLowerCase() ?? ''
      const who = (db.profiles ?? []).find(
        (p) => String(p.username ?? '').toLowerCase() === username,
      )
      if (!who) {
        return {
          data: { session: null, user: null },
          error: { message: 'Invalid login credentials' },
        }
      }
      currentSession = {
        ...session,
        user: { ...session.user, id: String(who.id), email },
      }
      emitAuth()
      return { data: { session: currentSession, user: currentSession.user }, error: null }
    },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: currentSession?.user ?? null }, error: null }),
    signOut: async () => {
      currentSession = null
      emitAuth()
      return { error: null }
    },
  },
}

/** Wipe local state — handy when the mock data gets into a silly shape. */
export function resetMockBackend() {
  localStorage.removeItem(STORAGE_KEY)
  location.reload()
}
