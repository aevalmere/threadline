import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ProfilesContext, type ProfilesContextValue } from '@/lib/profiles-context'
import { supabase, type Profile } from '@/lib/supabase'

/**
 * Every teammate's profile, fetched once and held for lookup.
 *
 * Messages carry `author_id` and nothing else, and a Postgres Changes payload
 * is the *raw row* — PostgREST embedding does not apply to it. So a realtime
 * message cannot bring its author's name with it, and a
 * `select('*, author:profiles(...)')` join would render names on load and
 * blanks on anything live.
 *
 * A whole-table fetch is the cheap answer at 5–30 teammates: the profiles table
 * is smaller than a single page of messages.
 */
export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [byId, setById] = useState<Map<string, Profile> | null>(null)

  useEffect(() => {
    let active = true

    void supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => {
        if (!active) return
        setById(new Map((data ?? []).map((p) => [p.id, p as Profile])))
      })

    return () => {
      active = false
    }
  }, [])

  const nameFor = useCallback(
    (userId: string | null) => {
      if (!userId) return 'Unknown'
      // A teammate removed from auth.users cascades their profile away, but
      // their messages survive with author_id set to null only on delete —
      // until then an unresolved id is simply a profile we have not loaded.
      return byId?.get(userId)?.display_name ?? 'Unknown'
    },
    [byId],
  )

  const value = useMemo<ProfilesContextValue>(
    () => ({ byId: byId ?? new Map(), loading: byId === null, nameFor }),
    [byId, nameFor],
  )

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>
}
