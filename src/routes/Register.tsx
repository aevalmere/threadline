import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import {
  normalizeDisplayName,
  normalizeUsername,
  slugifyUsername,
} from '@/lib/username'

const MIN_PASSWORD = 8

/**
 * Account creation — SPEC §5.
 *
 * The invite code is checked server-side in the `register` Edge Function, not
 * here: a code the browser validates stops nobody. This form's job is to catch
 * the shape errors before a round trip, and to hand the rest to the function.
 */
export default function Register() {
  const { session, loading, register } = useAuth()
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  // Set once the user edits the field, so the suggestion below stops
  // overwriting a name they chose deliberately.
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  /**
   * Seed the username from the email's local part while it is untouched. A
   * suggestion, never a silent rewrite of what someone typed — the whole reason
   * the accepted set is slugify's fixed points is so the name you see is the
   * name you get.
   */
  function onEmailChange(next: string) {
    setEmail(next)
    if (usernameTouched) return
    const local = next.split('@')[0] ?? ''
    const slug = slugifyUsername(local)
    setUsername(slug.length >= 3 ? slug : '')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()

    const name = normalizeUsername(username)
    if (!name.ok) {
      setError(name.error)
      return
    }
    const display = normalizeDisplayName(displayName || name.username)
    if (!display.ok) {
      setError(display.error)
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
      return
    }

    setBusy(true)
    setError(null)
    const { error: err } = await register({
      inviteCode: inviteCode.trim(),
      email: email.trim(),
      username: name.username,
      displayName: display.username,
      password,
    })
    setBusy(false)
    // On success the provider signs in, the session lands, and the redirect at
    // the top of this component takes over.
    if (err) setError(err)
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Field
            id="invite-code"
            label="Invite code"
            value={inviteCode}
            onChange={setInviteCode}
            autoComplete="off"
            required
          />
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={onEmailChange}
            autoComplete="email"
            required
          />
          <Field
            id="username"
            label="Username"
            value={username}
            onChange={(v) => {
              setUsernameTouched(true)
              setUsername(v)
            }}
            autoComplete="username"
            required
          />
          <Field
            id="display-name"
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            autoComplete="name"
            placeholder={username || undefined}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
          />

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>

        <p className="text-muted-foreground text-sm">
          <Link to="/login" className="hover:text-foreground underline-offset-4 hover:underline">
            Sign in instead
          </Link>
        </p>
      </div>
    </main>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  type,
  autoComplete,
  required,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize={type === 'password' ? undefined : 'none'}
        spellCheck={false}
        required={required}
        placeholder={placeholder}
      />
    </div>
  )
}
