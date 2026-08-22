import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { NewspaperIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CHANNEL_NAME_MAX, normalizeChannelName } from '@/lib/channel-name'
import { useChannels } from '@/lib/channels-context'

/**
 * All forums — the landing page for the sidebar's "All forums" link. A forum
 * is a forum-kind channel, so creation goes through the same createChannel
 * as /channels — this dialog just fixes the kind, because "go to the
 * Channels page and pick forum" turned out to be undiscoverable in practice.
 */
export default function Forums() {
  const { forum, loading, error, createChannel } = useChannels()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Forums</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> New forum
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not load forums: {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : forum.length === 0 ? (
        <p className="text-muted-foreground text-sm">No forums yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {forum.map((c) => (
            <li key={c.id}>
              <Link
                to={`/forums/${c.id}`}
                className="hover:bg-accent/40 flex items-center gap-3 px-3 py-2.5"
              >
                <NewspaperIcon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  {c.topic && (
                    <p className="text-muted-foreground truncate text-xs">{c.topic}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent>
          {creating && (
            <CreateForumForm
              onCreate={async (name, topic) => {
                const created = await createChannel({ name, kind: 'forum', topic })
                navigate(`/forums/${created.id}`)
              }}
              onDone={() => setCreating(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateForumForm({
  onCreate,
  onDone,
}: {
  onCreate: (name: string, topic: string) => Promise<void>
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = normalizeChannelName(name)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(parsed.name, topic)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the forum.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New forum</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="forum-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="forum-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="proposals"
          maxLength={CHANNEL_NAME_MAX + 8}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="forum-topic" className="text-sm font-medium">
          Topic <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="forum-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What this forum is for"
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create forum'}
        </Button>
      </div>
    </form>
  )
}
