import { useRef, useState, type FormEvent } from 'react'

import { DownloadIcon } from 'lucide-react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { extensionOf, formatBytes } from '@/lib/attachments'
import { useAuth } from '@/lib/auth-context'
import { exportFilename, exportWorkspace } from '@/lib/export'
import { useProfiles } from '@/lib/profiles-context'
import { supabase } from '@/lib/supabase'
import { normalizeDisplayName, normalizeUsername } from '@/lib/username'

const BUCKET = 'attachments'

/**
 * Avatars are capped well below the bucket's 10 MB. Nothing needs a 10 MB
 * face, and every avatar is fetched by everyone — it is the one upload whose
 * egress multiplies by the size of the team (Non-negotiable 8's concern,
 * applied to the 5 GB rather than the realtime budget).
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

/** Postgres unique_violation — the case-insensitive username index. */
const UNIQUE_VIOLATION = '23505'

export default function Settings() {
  const { profile, authorId, refreshProfile } = useAuth()
  const { refresh: refreshProfiles, avatarUrlFor } = useProfiles()

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [username, setUsername] = useState(profile?.username ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!profile || !authorId) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  /** Both providers hold profiles: the signed-in one, and the whole list. */
  async function reloadEverywhere() {
    await Promise.all([refreshProfile(), refreshProfiles()])
  }

  async function save(e: FormEvent) {
    e.preventDefault()

    const name = normalizeUsername(username)
    if (!name.ok) {
      setError(name.error)
      return
    }
    const display = normalizeDisplayName(displayName)
    if (!display.ok) {
      setError(display.error)
      return
    }

    setBusy(true)
    setError(null)
    setSaved(false)

    const { error: err } = await supabase
      .from('profiles')
      .update({ username: name.username, display_name: display.username })
      .eq('id', authorId)

    setBusy(false)
    if (err) {
      setError(
        (err as { code?: string }).code === UNIQUE_VIOLATION
          ? 'That username is taken.'
          : err.message,
      )
      return
    }

    // The username is the sign-in identifier, so a stale copy on screen is
    // worse than usual — it is what they will type next time.
    setUsername(name.username)
    setDisplayName(display.username)
    await reloadEverywhere()
    setSaved(true)
  }

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Pick an image.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(
        `That image is ${formatBytes(file.size)}. Keep an avatar under ${formatBytes(MAX_AVATAR_BYTES)}.`,
      )
      return
    }

    setBusy(true)
    setError(null)
    setSaved(false)

    const ext = extensionOf(file.name)
    const path = `avatars/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined })
    if (upErr) {
      setBusy(false)
      setError(`Could not upload: ${upErr.message}`)
      return
    }

    const previous = profile?.avatar_url ?? null
    const { error: rowErr } = await supabase
      .from('profiles')
      .update({ avatar_url: path })
      .eq('id', authorId)

    if (rowErr) {
      // Do not leave the orphan behind consuming the 1 GB — the same reasoning
      // as the send rollback in useMessages.
      void supabase.storage.from(BUCKET).remove([path])
      setBusy(false)
      setError(`Could not save: ${rowErr.message}`)
      return
    }

    // Only once the row points at the new object: deleting first would leave a
    // profile referencing a file that no longer exists if the update failed.
    if (previous) void supabase.storage.from(BUCKET).remove([previous])

    await reloadEverywhere()
    setBusy(false)
    setSaved(true)
  }

  async function removeAvatar() {
    const previous = profile?.avatar_url ?? null
    if (!previous) return

    setBusy(true)
    setError(null)
    const { error: rowErr } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', authorId)
    if (rowErr) {
      setBusy(false)
      setError(rowErr.message)
      return
    }
    void supabase.storage.from(BUCKET).remove([previous])
    await reloadEverywhere()
    setBusy(false)
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Your profile</h1>

      <section className="flex items-center gap-4">
        <AuthorAvatar
          name={profile.display_name}
          url={avatarUrlFor(authorId)}
          className="size-16"
        />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadAvatar(file)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Change photo
          </Button>
          {profile.avatar_url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void removeAvatar()}
            >
              Remove
            </Button>
          )}
        </div>
      </section>

      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="display-name" className="text-sm font-medium">
            Display name
          </label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value)
              setSaved(false)
            }}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="username" className="text-sm font-medium">
            Username
          </label>
          <Input
            id="username"
            value={username}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setUsername(e.target.value)
              setSaved(false)
            }}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {saved && <span className="text-muted-foreground text-sm">Saved</span>}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </form>

      <ExportSection />
    </div>
  )
}

/**
 * The P6 data-export button — "day-one insurance". Everything except storage
 * objects, as one downloaded JSON file, straight from the browser: the anon
 * client with a session can already read every row, so no server piece.
 */
function ExportSection() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function runExport() {
    setExporting(true)
    setExportError(null)
    try {
      const dump = await exportWorkspace()
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = exportFilename(dump.exported_at)
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-2 border-t pt-6">
      <h2 className="text-sm font-medium">Export</h2>
      <Button variant="outline" disabled={exporting} onClick={() => void runExport()}>
        <DownloadIcon /> {exporting ? 'Exporting…' : 'Download workspace data'}
      </Button>
      {exportError && (
        <p role="alert" className="text-destructive text-sm">
          {exportError}
        </p>
      )}
    </div>
  )
}
