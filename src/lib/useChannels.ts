import { useEffect, useState } from 'react'

import { supabase, type Channel } from '@/lib/supabase'

/**
 * The sidebar's channel list. A plain fetch for now — P1 adds the realtime
 * subscription. Doubles as the G0 proof that an authenticated round-trip to
 * Postgres works through the blanket RLS policy.
 */
export function useChannels() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    supabase
      .from('channels')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) {
          setError(err.message)
          setChannels([])
          return
        }
        setChannels((data ?? []) as Channel[])
      })

    return () => {
      active = false
    }
  }, [])

  return {
    channels,
    error,
    loading: channels === null,
    chat: (channels ?? []).filter((c) => c.kind === 'chat'),
    forum: (channels ?? []).filter((c) => c.kind === 'forum'),
  }
}
