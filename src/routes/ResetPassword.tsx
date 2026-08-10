import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'

const MIN_PASSWORD = 8

/**
 * Password reset, both halves — SPEC §5.
 *
 * Which half you get depends on whether you have a session. Arriving from the
 * emailed link means the code exchange already ran and you are authenticated,
 * so the job is to set a new password. Arriving from the Sign in page means you
 * are not, so the job is to request the link.
 *
 * One route rather than two because the states are mutually exclusive and the
 * distinction is invisible to the person: they clicked "forgot password" and
 * they expect to end up with a working password.
 */
export default function ResetPassword() {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <SetNewPassword /> : <RequestLink />
}

function RequestLink() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await requestPasswordReset(email)
    setBusy(false)
    setSent(true)
  }

  return (
    <Shell title="Reset your password">
      {sent ? (
        <p className="rounded-md border p-4 text-sm">
          If that address has an account, a link is on its way. Open it on this
          device.
        </p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <p className="text-muted-foreground text-sm">
        <Link to="/login" className="hover:text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </Shell>
  )
}

function SetNewPassword() {
  const { setPassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Those two do not match.')
      return
    }

    setBusy(true)
    setError(null)
    const { error: err } = await setPassword(password)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <Shell title="Choose a new password">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="text-sm font-medium">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            Confirm
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </form>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  )
}
