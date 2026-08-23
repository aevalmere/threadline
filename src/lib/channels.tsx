import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  ChannelsContext,
  type ChannelsContextValue,
  type CreateChannelInput,
} from '@/lib/channels-context'
import { appendPosition, byPosition, positionForMove } from '@/lib/ordering'
import { supabase, type Channel } from '@/lib/supabase'

/** Postgres unique_violation — the (name, kind) constraint from P0. */
const UNIQUE_VIOLATION = '23505'

function friendly(error: { code?: string; message: string }, name: string): Error {
  if (error.code === UNIQUE_VIOLATION) {
    return new Error(`#${name} already exists.`)
  }
  return new Error(error.message)
}

/**
 * Holds the channel list for the whole shell so the sidebar and the channel
 * list page cannot disagree. A plain context, not a state library — adding one
 * needs a DECISIONS.md entry (Non-negotiable 3), and this does not warrant it.
 *
 * P1 later swaps the manual refresh() calls for a realtime subscription.
 */
export function ChannelsProvider({ children }: { children: ReactNode }) {
  const { authorId } = useAuth()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('channels')
      .select('*')
      .order('position', { ascending: true })

    if (err) {
      setError(err.message)
      setChannels((current) => current ?? [])
      return
    }
    setError(null)
    setChannels(((data ?? []) as Channel[]).sort(byPosition))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createChannel = useCallback(
    async ({ name, kind, topic }: CreateChannelInput): Promise<Channel> => {
      // Append to the bottom of its own kind's list: one max-position read,
      // shaped so `appendPosition` owns the arithmetic. Read from the server
      // rather than local state so two people creating at once cannot both
      // compute the same position from the same stale list.
      const top = await supabase
        .from('channels')
        .select('position')
        .eq('kind', kind)
        .order('position', { ascending: false })
        .limit(1)
      if (top.error) throw friendly(top.error, name)

      const { data, error: err } = await supabase
        .from('channels')
        .insert({
          name,
          kind,
          topic: topic?.trim() || null,
          created_by: authorId,
          position: appendPosition((top.data ?? []) as { position: number }[]),
        })
        .select('*')
        .single()

      if (err) throw friendly(err, name)

      const created = data as Channel
      // Insert locally so the sidebar updates in the same tick as the dialog
      // closing, then reconcile with the server ordering.
      setChannels((current) => [...(current ?? []), created].sort(byPosition))
      return created
    },
    [authorId],
  )

  const updateChannel = useCallback(
    async (id: string, patch: { name: string; topic: string }) => {
      const topic = patch.topic.trim() || null
      const { error: err } = await supabase
        .from('channels')
        .update({ name: patch.name, topic })
        .eq('id', id)
      if (err) throw friendly(err, patch.name)

      // No re-sort: the list is ordered by position now, and a rename must not
      // move a channel out from under the cursor that just renamed it.
      setChannels((current) =>
        (current ?? []).map((c) => (c.id === id ? { ...c, name: patch.name, topic } : c)),
      )
    },
    [],
  )

  /**
   * Reorder within one kind's list. `from`/`to` are indices into that kind's
   * visible list; `to` is the destination index in the final array, which is
   * what dnd-kit reports. One row is written per drop (SPEC §1.2) — never the
   * whole list.
   *
   * Optimistic: the sidebar reorders in the same frame as the drop, and a
   * failed write refreshes back to the server's truth rather than leaving the
   * list lying about where things are.
   */
  const moveChannel = useCallback(
    async (kind: Channel['kind'], from: number, to: number) => {
      const ordered = (channels ?? []).filter((c) => c.kind === kind).sort(byPosition)
      const moved = ordered[from]
      const position = positionForMove(ordered, from, to)
      if (!moved || position === null) return

      setChannels((current) =>
        (current ?? [])
          .map((c) => (c.id === moved.id ? { ...c, position } : c))
          .sort(byPosition),
      )

      const { error: err } = await supabase
        .from('channels')
        .update({ position })
        .eq('id', moved.id)
      if (err) {
        await refresh()
        throw new Error(err.message)
      }
    },
    [channels, refresh],
  )

  const deleteChannel = useCallback(async (id: string) => {
    const { error: err } = await supabase.from('channels').delete().eq('id', id)
    if (err) throw new Error(err.message)

    setChannels((current) => (current ?? []).filter((c) => c.id !== id))
  }, [])

  const value = useMemo<ChannelsContextValue>(
    () => ({
      channels,
      error,
      loading: channels === null,
      chat: (channels ?? []).filter((c) => c.kind === 'chat'),
      forum: (channels ?? []).filter((c) => c.kind === 'forum'),
      refresh,
      createChannel,
      updateChannel,
      deleteChannel,
      moveChannel,
    }),
    [channels, error, refresh, createChannel, updateChannel, deleteChannel, moveChannel],
  )

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>
}
