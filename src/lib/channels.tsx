import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  ChannelsContext,
  type ChannelsContextValue,
  type CreateChannelInput,
} from '@/lib/channels-context'
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
      .order('name', { ascending: true })

    if (err) {
      setError(err.message)
      setChannels((current) => current ?? [])
      return
    }
    setError(null)
    setChannels((data ?? []) as Channel[])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createChannel = useCallback(
    async ({ name, kind, topic }: CreateChannelInput): Promise<Channel> => {
      const { data, error: err } = await supabase
        .from('channels')
        .insert({
          name,
          kind,
          topic: topic?.trim() || null,
          created_by: authorId,
        })
        .select('*')
        .single()

      if (err) throw friendly(err, name)

      const created = data as Channel
      // Insert locally so the sidebar updates in the same tick as the dialog
      // closing, then reconcile with the server ordering.
      setChannels((current) =>
        [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
      )
      return created
    },
    [authorId],
  )

  const renameChannel = useCallback(async (id: string, name: string) => {
    const { error: err } = await supabase.from('channels').update({ name }).eq('id', id)
    if (err) throw friendly(err, name)

    setChannels((current) =>
      (current ?? [])
        .map((c) => (c.id === id ? { ...c, name } : c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
  }, [])

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
      renameChannel,
      deleteChannel,
    }),
    [channels, error, refresh, createChannel, renameChannel, deleteChannel],
  )

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>
}
