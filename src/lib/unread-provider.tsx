import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { UnreadContext, type UnreadContextValue } from '@/lib/unread-context'
import { nextLastReadMessageId, reconcileUnread, unreadBadge } from '@/lib/unread'

/** Batched pointer writes, and batched refetches — Non-negotiable 8. */
const WRITE_DEBOUNCE_MS = 800
const REFRESH_DEBOUNCE_MS = 400

interface CountRow {
  channel_id: string
  unread: number
}

/**
 * Unread badges — SPEC §1.4.
 *
 * A context rather than a hook, for the reason DECISIONS #6 gives for channels:
 * the sidebar and the open channel view must not disagree.
 *
 * **Counting happens in the database** (`unread_counts()`, DECISIONS #18). This
 * only decides *when* to ask, and keeps the read-pointer moving. An earlier
 * version counted client-side from a window of messages and was wrong in a way
 * no test caught — see the migration's header for what and why.
 *
 * **The subscription is unfiltered**, which is the whole point: a badge exists
 * for the channels you are *not* looking at, so a per-channel subscription
 * cannot serve it. One subscription for the app, not one per channel. Events
 * only trigger a debounced refetch, so a burst of traffic costs one query
 * rather than one per message (Non-negotiable 8).
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { authorId: userId } = useAuth()

  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)

  /**
   * The highest message id this session has marked read per channel.
   *
   * Deliberately *not* seeded from `channel_members`. The only thing it does is
   * skip redundant writes, and fetching the stored pointer to prime it created
   * a race: the fetch could land after `markRead` had already advanced past it
   * and overwrite the newer value in memory, leaving a badge on the channel
   * being read. Starting empty costs one redundant upsert per channel per
   * session and cannot be wrong.
   */
  const marked = useRef<Map<string, number>>(new Map())
  const queued = useRef<Map<string, number>>(new Map())
  /**
   * Highest pointer the database has **confirmed** per channel.
   *
   * The gap between this and `marked` is what "not yet persisted" means, and
   * it is the only definition that stays true while a write is in flight —
   * `queued` is emptied before the upsert is awaited, so it cannot answer on
   * its own.
   */
  const confirmed = useRef<Map<string, number>>(new Map())
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  /** Set when a refresh was requested while one was already running. */
  const refreshAgain = useRef(false)

  const flush = useCallback(async () => {
    // Cancel the pending timer as well as forgetting it: a refresh-driven
    // flush would otherwise leave the original one armed to fire on an empty
    // queue.
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = null
    if (!userId || queued.current.size === 0) return

    const batch = [...queued.current.entries()]
    queued.current.clear()

    // Upsert, not update: `channel_members` has no row for a channel created
    // after you joined the workspace, and an UPDATE there affects zero rows
    // without erroring — the badge would clear on screen and return on reload.
    const { error } = await supabase.from('channel_members').upsert(
      batch.map(([channel_id, last_read_message_id]) => ({
        channel_id,
        user_id: userId,
        last_read_message_id,
      })),
      { onConflict: 'channel_id,user_id' },
    )
    if (error) {
      // Put them back. `marked` has already advanced, so `markRead` will not
      // re-queue these on its own — dropping them here would strand the badge
      // non-zero for the rest of the session, which is the exact failure this
      // whole round was about.
      //
      // Compared against `confirmed`, not just `queued`: a slow write that
      // fails *after* a later one succeeded must not restore its older id, or
      // the next flush would move `last_read_message_id` backwards and
      // resurrect messages already read.
      for (const [channelId, id] of batch) {
        if (id <= (confirmed.current.get(channelId) ?? 0)) continue
        if ((queued.current.get(channelId) ?? 0) < id) queued.current.set(channelId, id)
      }
      // Quiet otherwise: a read pointer is cosmetic, and a banner would
      // interrupt reading for something the user cannot act on.
      console.warn('[unread] could not persist read pointers:', error.message)
      return
    }

    for (const [channelId, id] of batch) {
      if (id > (confirmed.current.get(channelId) ?? 0)) {
        confirmed.current.set(channelId, id)
      }
    }
  }, [userId])

  const refresh = useCallback(async () => {
    // Cancel as well as forget, so a directly-invoked refresh (mount, or the
    // re-entry below) does not leave a scheduled one armed to fire redundantly.
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = null
    if (!userId) return
    // Two overlapping refreshes can resolve out of order and apply the older
    // snapshot, so only one runs at a time. The request is *remembered* rather
    // than dropped: a message committing mid-flight would otherwise leave that
    // badge under-counted until something else happened in the workspace.
    if (inFlight.current) {
      refreshAgain.current = true
      return
    }
    inFlight.current = true

    try {
      // **Persist pending reads first.** `unread_counts()` answers from
      // `channel_members.last_read_message_id`, so asking before the write
      // lands returns a count computed from a stale pointer — and nothing
      // would ever correct it, because the subscription watches `messages`,
      // not `channel_members`. Flushing here makes the ordering explicit
      // rather than a race between two debounce timers.
      await flush()

      const { data, error } = await supabase.rpc('unread_counts')
      if (error) {
        console.warn('[unread] could not load counts:', error.message)
        return
      }
      // Any channel whose recorded read is ahead of what the database has
      // confirmed is newer than what the server just counted, so it stays at
      // zero — see `reconcileUnread`.
      const unconfirmed = new Set<string>()
      for (const [channelId, id] of marked.current) {
        if (id > (confirmed.current.get(channelId) ?? 0)) unconfirmed.add(channelId)
      }
      setCounts(reconcileUnread((data ?? []) as CountRow[], unconfirmed))
    } finally {
      inFlight.current = false
      setLoading(false)
      if (refreshAgain.current) {
        refreshAgain.current = false
        void refreshRef.current?.()
      }
    }
  }, [userId, flush])

  // `refresh` re-invokes itself through a ref, because a useCallback cannot
  // reference its own binding before it is initialised.
  const refreshRef = useRef<typeof refresh | null>(null)
  refreshRef.current = refresh

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS)
  }, [refresh])


  useEffect(() => {
    if (!userId) {
      setCounts(new Map())
      marked.current.clear()
      // Left alone deliberately, and it does not outlive the session: this
      // provider is mounted inside `RequireAuth`, so signing out unmounts it
      // and every ref here dies with it. Nothing bleeds into the next user for
      // that reason — not because `flush` cleans up, which it cannot: with
      // `userId` null it returns before touching the queue, and the token is
      // already gone by the time SIGNED_OUT fires, so the write would be
      // refused anyway. The cost is one stale badge until that channel is
      // next opened.
      setLoading(false)
      return
    }
    void refresh()
  }, [userId, refresh])

  // Live arrivals, workspace-wide. See the header for why this is unfiltered.
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('unread:all-messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => {
          // The payload is ignored on purpose. An INSERT raises a count, an
          // UPDATE can *lower* one (a soft delete stops counting, SPEC §1.3),
          // and a DELETE carries only the primary key under the default replica
          // identity. Re-asking the database is one cheap query and is right in
          // every case; reproducing the rule here would be the second
          // implementation DECISIONS #18 exists to avoid.
          scheduleRefresh()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, scheduleRefresh])

  // Never leave a queued pointer unwritten when the provider goes away.
  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current)
        writeTimer.current = null
        void flush()
      }
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = null
      }
    }
  }, [flush])

  const countFor = useCallback(
    (channelId: string) => counts.get(channelId) ?? 0,
    [counts],
  )

  /**
   * Side effects live here, *outside* the state updater.
   *
   * Putting them inside would repeat a bug this codebase already paid for:
   * StrictMode double-invokes updaters, and an impure one runs its effects
   * twice — see the reconcile note in `useMessages.ts`.
   */
  const markRead = useCallback<UnreadContextValue['markRead']>(
    (channelId, messages) => {
      if (!userId) return

      const from = marked.current.get(channelId) ?? null
      const next = nextLastReadMessageId(messages, from)
      // The helper never moves the pointer backwards, so an unchanged value
      // means nothing new was seen. Bail before touching state or the network,
      // or every arriving message would queue another write.
      if (next === null || next === from) return

      marked.current.set(channelId, next)
      queued.current.set(channelId, next)
      if (!writeTimer.current) {
        writeTimer.current = setTimeout(() => void flush(), WRITE_DEBOUNCE_MS)
      }

      // Clear the badge now rather than after the round trip. The database is
      // still the authority — the next refresh overwrites this either way.
      setCounts((current) => {
        if ((current.get(channelId) ?? 0) === 0) return current
        const updated = new Map(current)
        updated.set(channelId, 0)
        return updated
      })
    },
    [userId, flush],
  )

  const value = useMemo<UnreadContextValue>(
    () => ({
      countFor,
      badgeFor: (channelId: string) => unreadBadge(countFor(channelId)),
      markRead,
      loading,
    }),
    [countFor, markRead, loading],
  )

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
}
