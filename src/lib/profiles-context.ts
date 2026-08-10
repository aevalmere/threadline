import { createContext, useContext } from 'react'

import type { Profile } from '@/lib/supabase'

export interface ProfilesContextValue {
  byId: Map<string, Profile>
  loading: boolean
  /** Display name for an author id, or a readable placeholder. */
  nameFor: (userId: string | null) => string
  /**
   * A renderable avatar URL, or null.
   *
   * `profiles.avatar_url` holds a **storage path** in the private bucket, not a
   * URL — passing it to an `<img>` gives a 400. This signs it. Every avatar on
   * screen is signed in one batched request, the same argument `useSignedUrls`
   * makes for message attachments.
   */
  avatarUrlFor: (userId: string | null) => string | null
  /** Re-read every profile — after someone edits theirs. */
  refresh: () => Promise<void>
}

export const ProfilesContext = createContext<ProfilesContextValue | null>(null)

export function useProfiles(): ProfilesContextValue {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used inside <ProfilesProvider>')
  return ctx
}
