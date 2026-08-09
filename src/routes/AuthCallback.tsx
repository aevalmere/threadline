import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'

/**
 * Where the magic link lands. supabase-js has already exchanged the code by
 * the time this mounts (detectSessionInUrl + PKCE), so all this does is wait
 * for the session to appear and then get out of the way.
 */
export default function AuthCallback() {
  const { session, loading } = useAuth()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000)
    return () => clearTimeout(t)
  }, [])

  if (session) return <Navigate to="/" replace />
  if (timedOut && !loading) return <Navigate to="/login" replace />

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </main>
  )
}
