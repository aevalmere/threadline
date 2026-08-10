import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

import type { Profile } from '@/lib/supabase'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  /**
   * True when the app was entered without signing in — TEMPORARY, see
   * DECISIONS #10. Always false unless VITE_GUEST_MODE is set.
   */
  isGuest: boolean
  /**
   * Whose id to stamp on rows the user creates. The signed-in user normally;
   * the shared Guest profile in guest mode. Null when neither is available, and
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
