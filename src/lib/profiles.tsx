import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ProfilesContext, type ProfilesContextValue } from '@/lib/profiles-context'
import { supabase, type Profile } from '@/lib/supabase'
import { useSignedUrls } from '@/lib/useSignedUrls'

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

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*')
    setById(new Map((data ?? []).map((p) => [p.id, p as Profile])))
  }, [])

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

  /**
   * Avatars live in the private bucket, so `avatar_url` is a path that has to
   * be signed. Signing them here rather than at each render site means one
   * batched request for the whole workspace — 5–30 paths — instead of one per
   * message row, and the message list gets faces without knowing about storage.
   */
  const avatarPaths = useMemo(
    () =>
      [...(byId?.values() ?? [])]
        .map((p) => p.avatar_url)
        .filter((p): p is string => !!p),
    [byId],
  )
  const signedUrlFor = useSignedUrls(avatarPaths)

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

  const avatarUrlFor = useCallback(
    (userId: string | null) => {
      if (!userId) return null
      const path = byId?.get(userId)?.avatar_url
      return path ? signedUrlFor(path) : null
    },
    [byId, signedUrlFor],
  )

  const value = useMemo<ProfilesContextValue>(
    () => ({
      byId: byId ?? new Map(),
      loading: byId === null,
      nameFor,
      avatarUrlFor,
      refresh,
    }),
    [byId, nameFor, avatarUrlFor, refresh],
  )

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>
}
