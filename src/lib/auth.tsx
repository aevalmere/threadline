import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase, type Profile } from '@/lib/supabase'
import { AuthContext, type AuthContextValue } from '@/lib/auth-context'

/**
 * Auth. Invite code to register, username + password to sign in — SPEC §5,
 * DECISIONS #14, which replaced magic links.
 *
 * Nothing here calls `supabase.auth.signUp`. Project-level signups are
 * disabled, and that is deliberately the only thing making the invite code a
 * wall: every account is created by the `register` Edge Function, which holds
 * the code as a secret the bundle never sees.
 */
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

  const userId = session?.user.id

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single<Profile>()
    setProfile(data ?? null)
  }, [userId])

  // The profile row is created by the handle_new_user trigger, so it always
  // exists by the time a session does.
  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const signIn = useCallback<AuthContextValue['signIn']>(async (username, password) => {
    const handle = username.trim().replace(/^@+/, '')
    if (!handle || !password) {
      return { error: 'Enter your username and password.' }
    }

    // Supabase authenticates on email; the user typed a username. This RPC is
    // the one thing `anon` may call — see DECISIONS #14 for what that costs.
    const { data: email, error: lookupErr } = await supabase.rpc('email_for_username', {
      u: handle,
    })

    if (lookupErr) return { error: lookupErr.message }

    // Same message for "no such username" as for a wrong password. The lookup
    // above already tells a determined caller whether a username exists, but
    // there is no reason for the *form* to volunteer it.
    const WRONG = 'That username and password do not match.'
    if (typeof email !== 'string' || !email) return { error: WRONG }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // A real fault should not masquerade as a typo, or the user retypes a
      // correct password for ten minutes — and under a 429 each retry extends
      // the lockout. `status` is 0 for a failed fetch (AuthRetryableFetchError
      // carries no HTTP status), 429 for a rate limit, 5xx for a provider
      // fault. Everything else — 400, 401 — is a genuine credential mismatch
      // and collapses to the flat message.
      const status = error.status ?? 0
      if (status === 0 || status >= 429) return { error: error.message }
      return { error: WRONG }
    }
    return { error: null }
  }, [])

  const register = useCallback<AuthContextValue['register']>(async (input) => {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('register', {
      body: {
        inviteCode: input.inviteCode,
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        password: input.password,
      },
    })

    if (error) {
      // A non-2xx from a function surfaces as FunctionsHttpError, whose body
      // holds the message this function deliberately wrote. Without reading it
      // back, every refusal — wrong code, taken username, weak password —
      // would render as a flat "Edge Function returned a non-2xx status code".
      const body = await readFunctionError(error)
      return { error: body ?? error.message }
    }
    if (data?.error) return { error: data.error }

    // The account exists but no session came back — the function deliberately
    // mints no tokens. Sign in with the password we already have.
    return await signIn(input.username, input.password)
  }, [signIn])

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(
    async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
      })
      // Never says whether the address has an account. Unlike the username
      // lookup, nothing forces this one to leak.
      if (error) console.warn('[auth] password reset refused:', error)
      return { error: null }
    },
    [],
  )

  const setPassword = useCallback<AuthContextValue['setPassword']>(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
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
      register,
      requestPasswordReset,
      setPassword,
      signOut,
      refreshProfile: loadProfile,
    }),
    [
      session,
      profile,
      loading,
      signIn,
      register,
      requestPasswordReset,
      setPassword,
      signOut,
      loadProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Pull the message out of a FunctionsHttpError.
 *
 * supabase-js hands back the raw, *unconsumed* `Response` on `context` — it
 * throws before reading the body — so the JSON the function wrote is readable
 * here. Without this, every refusal (wrong code, taken username, weak
 * password) would render as "Edge Function returned a non-2xx status code".
 *
 * `message` is checked as well as `error` because a platform-level failure —
 * gateway 401, worker boot error, resource limit — is shaped
 * `{ code, message }` and never carries our `error` key.
 *
 * Everything here is best-effort: a null return means "use the generic
 * message", never a thrown error on top of the one being reported.
 */
async function readFunctionError(error: unknown): Promise<string | null> {
  const res = (error as { context?: Response })?.context
  if (!res || typeof res.json !== 'function') return null
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown }
    if (typeof body?.error === 'string') return body.error
    if (typeof body?.message === 'string') return body.message
    return null
  } catch {
    return null
  }
}
