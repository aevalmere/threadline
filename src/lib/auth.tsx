import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthError, Session } from '@supabase/supabase-js'

import { supabase, type Profile } from '@/lib/supabase'
import { AuthContext, type AuthContextValue } from '@/lib/auth-context'

/** GoTrue's way of saying "that address has no account here". */
function isAccountAbsent(error: AuthError): boolean {
  const code = error.code ?? ''
  if (code === 'otp_disabled' || code === 'signup_disabled') return true
  return /signups?\s+not\s+allowed/i.test(error.message)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // The profile row is created by the handle_new_user trigger on signup, so it
  // always exists by the time a session does.
  useEffect(() => {
    const userId = session?.user.id
    if (!userId) {
      setProfile(null)
      return
    }

    let active = true
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single<Profile>()
      .then(({ data }) => {
        if (active) setProfile(data ?? null)
      })

    return () => {
      active = false
    }
  }, [session?.user.id])

  const signIn = useCallback<AuthContextValue['signIn']>(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Public signups are disabled in the dashboard; this is the client-side
        // half of the same rule.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    // With shouldCreateUser: false, an address with no account comes back as
    // otp_disabled / "signups not allowed". Surfacing that would tell a
    // stranger which emails are on the team — the exact leak SPEC.md §5
    // forbids — so it is swallowed and the UI shows the same "link sent"
    // screen either way. Logged, because the same code also fires if the
    // Email provider itself is misconfigured, and that must stay debuggable.
    if (error && isAccountAbsent(error)) {
      console.warn('[auth] sign-in refused (unknown address, or OTP disabled):', error)
      return { error: null }
    }

    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      authorId: session?.user.id ?? null,
      loading,
      signIn,
      signOut,
    }),
    [session, profile, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
