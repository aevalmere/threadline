import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'
import { GUEST_MODE } from '@/lib/auth'

/**
 * The only wall in the app. There are no roles — if you are signed in you can
 * see everything (SPEC.md §1.1).
 *
 * TEMPORARY: with VITE_GUEST_MODE set, the wall is open and anyone can walk in.
 * See DECISIONS #10 for what that exposes and how to revert it.
 */
export default function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (!session && !GUEST_MODE) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
