import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

import type { Profile } from '@/lib/supabase'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
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
