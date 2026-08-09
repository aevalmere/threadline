import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError(null)
    const { error: err } = await signIn(email.trim())
    setSending(false)
    // Supabase does not leak whether an address exists, and neither do we.
    if (err) setError(err)
    else setSent(true)
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Threadline</h1>
          <p className="text-muted-foreground text-sm">
            Sign in with a magic link. Ask a teammate for an invite if you don&apos;t
            have access yet.
          </p>
        </div>

        {sent ? (
          <div className="rounded-md border p-4 text-sm">
            If that address is on the team, a link is on its way. Open it on this
            device.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? 'Sending…' : 'Send magic link'}
            </Button>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  )
}
