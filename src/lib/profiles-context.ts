import { createContext, useContext } from 'react'

import type { Profile } from '@/lib/supabase'

export interface ProfilesContextValue {
  byId: Map<string, Profile>
  loading: boolean
  /** Display name for an author id, or a readable placeholder. */
  nameFor: (userId: string | null) => string
}

export const ProfilesContext = createContext<ProfilesContextValue | null>(null)

export function useProfiles(): ProfilesContextValue {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used inside <ProfilesProvider>')
  return ctx
}
