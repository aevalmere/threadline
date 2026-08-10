import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

const NOTIFICATION_COLUMNS =
  'id, user_id, kind, actor_id, entity_type, entity_id, read_at, created_at'

/** One page. The bell is a recent-activity list, not an archive. */
const PAGE = 50

export interface Notification {
  id: string
  user_id: string
  kind: 'mention' | 'assignment' | 'reply'
  actor_id: string | null
  entity_type: string
  entity_id: string
  read_at: string | null
  created_at: string
}

/** What the panel needs about the message a notification points at. */
export interface NotificationTarget {
  id: number
  body: string
  channel_id: string | null
  deleted_at: string | null
}

/**
 * The bell — SPEC §1.9.
 *
 * A hook rather than a context, for the reason `useMessages` gives: one
 * consumer. If a second surface ever needs unread counts, promote it then.
 *
 * Rows are written by whoever mentioned you (DECISIONS #15), so this side only
 * ever reads and marks read.
 */
export function useNotifications() {
  const { authorId: userId } = useAuth()

  const [items, setItems] = useState<Notification[]>([])
  const [targets, setTargets] = useState<Map<string, NotificationTarget>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** The most recent arrival, for the toast and the OS notification. */
  const [latest, setLatest] = useState<Notification | null>(null)

  const absorb = useCallback((incoming: Notification[]) => {
    setItems((current) => {
      const byId = new Map(current.map((n) => [n.id, n]))
      let changed = false
      for (const n of incoming) {
        if (!byId.has(n.id)) changed = true
        byId.set(n.id, n)
      }
      if (!changed) return current
      return [...byId.values()].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      )
    })
  }, [])

  /**
   * Fetch the messages a batch of notifications points at.
   *
   * A separate query rather than a PostgREST embed: `entity_id` is text and
   * `messages.id` is bigint, so there is no FK for an embed to follow — the
   * same reason `useMessages` fetches attachments separately (DECISIONS #2).
   */
  const loadTargets = useCallback(async (rows: Notification[]) => {
    const wanted = rows
      .filter((n) => n.entity_type === 'message')
      .map((n) => Number(n.entity_id))
      .filter((id) => Number.isFinite(id))
    if (wanted.length === 0) return

    const { data } = await supabase
      .from('messages')
      .select('id, body, channel_id, deleted_at')
      .in('id', wanted)
    if (!data) return

    setTargets((current) => {
      const next = new Map(current)
      for (const m of data as NotificationTarget[]) next.set(String(m.id), m)
      return next
    })
  }, [])

  useEffect(() => {
    if (!userId) {
      setItems([])
      setTargets(new Map())
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    void supabase
      .from('notifications')
      .select(NOTIFICATION_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
      .then(({ data, error: err }) => {
        if (!active) return
        // Distinguished from an empty bell: "Nothing yet." and "we could not
        // ask" look identical otherwise, and one of them is a bug.
        setError(err?.message ?? null)
        const rows = (data ?? []) as Notification[]
        absorb(rows)
        setLoading(false)
        void loadTargets(rows)
      })

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          // Server-side filter, so nobody else's rows ever reach this client —
          // the blanket policy would permit reading them, and there is no
          // reason to spend the bytes.
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!active) return
          const row = payload.new as Notification
          absorb([row])
          // Announced only *after* its message has loaded, so the toast and the
          // desktop notification carry the text and the channel name rather
          // than an empty body — `loadTargets` resolves well after `absorb`.
          //
          // Only a live arrival announces itself: the initial fetch above never
          // touches `latest`, so opening the app does not fire a toast for
          // every unread row from last week.
          void loadTargets([row]).then(() => {
            if (active) setLatest(row)
          })
        },
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, absorb, loadTargets])

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString()
    setItems((current) =>
      current.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? readAt } : n)),
    )
    await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .is('read_at', null)
  }, [])

  const markAllRead = useCallback(async () => {
    if (!userId) return
    const readAt = new Date().toISOString()
    setItems((current) => current.map((n) => ({ ...n, read_at: n.read_at ?? readAt })))
    // Scoped to unread rows so this cannot rewrite the timestamp on rows that
    // were already read — `read_at` is when you saw it, not when you last
    // clicked the button.
    await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', userId)
      .is('read_at', null)
  }, [userId])

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items])

  return {
    items,
    targets,
    unread,
    loading,
    error,
    latest,
    clearLatest: useCallback(() => setLatest(null), []),
    markRead,
    markAllRead,
  }
}
