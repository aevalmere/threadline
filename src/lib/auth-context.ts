import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

import type { Profile } from '@/lib/supabase'

export interface RegisterInput {
  inviteCode: string
  email: string
  username: string
  displayName: string
  password: string
}

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
  /**
   * Username + password. Resolves the username to an email through
   * `email_for_username` first — Supabase authenticates on email. See SPEC §5.
   */
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  /**
   * Creates an account through the `register` Edge Function, then signs in.
   * Never calls `supabase.auth.signUp` — project-level signups are disabled,
   * which is what makes the invite code a wall (DECISIONS #14).
   */
  register: (input: RegisterInput) => Promise<{ error: string | null }>
  /** Sends a password-reset link. The only thing email is still used for. */
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>
  /** Sets a new password for the session a recovery link established. */
  setPassword: (password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Re-reads the signed-in user's profile after they edit it. */
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
