import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'

/**
 * The only wall in the app. There are no roles — if you are signed in you can
 * see everything (SPEC.md §1.1).
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

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />

  return <Outlet />
}
