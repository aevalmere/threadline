import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

import type { Profile } from '@/lib/supabase'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  /**
   * Whose id to stamp on rows the user creates. Null when signed out, and
   * writing is then impossible — `messages.author_id` is `not null`.
   */
  authorId: string | null
  /** False once the initial session lookup has settled. */
  loading: boolean
  /** Sends a magic link. Never creates an account — see SPEC.md §5. */
  signIn: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
