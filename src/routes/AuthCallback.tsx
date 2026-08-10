import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'
import { safeNext } from '@/lib/safe-next'

/**
 * Where a password-reset link lands. supabase-js has already exchanged the code
 * by the time this mounts (detectSessionInUrl + PKCE), so all this does is wait
 * for the session to appear and then get out of the way.
 *
 * Magic-link sign-in is gone (DECISIONS #14); recovery uses the same code
 * exchange, which is why this route stayed.
 *
 * `?next=` decides where to land — `/reset` for a recovery link, `/` for
 * anything else. It comes from the URL, so it goes through `safeNext` rather
 * than being trusted.
 */
export default function AuthCallback() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000)
    return () => clearTimeout(t)
  }, [])

  if (session) return <Navigate to={safeNext(params.get('next'))} replace />
  if (timedOut && !loading) return <Navigate to="/login" replace />

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </main>
  )
}
