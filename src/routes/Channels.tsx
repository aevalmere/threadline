import { useState, type FormEvent } from 'react'
import { HashIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CHANNEL_NAME_MAX, normalizeChannelName } from '@/lib/channel-name'
import { useChannels } from '@/lib/channels-context'
import type { Channel } from '@/lib/supabase'

type DialogState =
  | { mode: 'create' }
  | { mode: 'rename'; channel: Channel }
  | { mode: 'delete'; channel: Channel }
  | null

export default function Channels() {
  const { chat, forum, loading, error, createChannel, renameChannel, deleteChannel } =
    useChannels()
  const [dialog, setDialog] = useState<DialogState>(null)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Channels</h1>
        <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New channel
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not load channels: {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          <ChannelGroup
            heading="Chat"
            channels={chat}
            empty="No chat channels yet."
            onRename={(channel) => setDialog({ mode: 'rename', channel })}
            onDelete={(channel) => setDialog({ mode: 'delete', channel })}
          />
          <ChannelGroup
            heading="Forums"
            channels={forum}
            empty="No forums yet."
            onRename={(channel) => setDialog({ mode: 'rename', channel })}
            onDelete={(channel) => setDialog({ mode: 'delete', channel })}
          />
        </>
      )}

      <ChannelDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onCreate={createChannel}
        onRename={renameChannel}
        onDelete={deleteChannel}
      />
    </div>
  )
}

function ChannelGroup({
  heading,
  channels,
  empty,
  onRename,
  onDelete,
}: {
  heading: string
  channels: Channel[]
  empty: string
  onRename: (c: Channel) => void
  onDelete: (c: Channel) => void
}) {
  return (
    <section className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {heading}
      </p>
      {channels.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
              <HashIcon className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                {c.topic && (
                  <p className="text-muted-foreground truncate text-xs">{c.topic}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => onRename(c)}>
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(c)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ChannelDialog({
  state,
  onClose,
  onCreate,
  onRename,
  onDelete,
}: {
  state: DialogState
  onClose: () => void
  onCreate: ReturnType<typeof useChannels>['createChannel']
  onRename: ReturnType<typeof useChannels>['renameChannel']
  onDelete: ReturnType<typeof useChannels>['deleteChannel']
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {state?.mode === 'create' && <CreateForm onCreate={onCreate} onDone={onClose} />}
        {state?.mode === 'rename' && (
          <RenameForm channel={state.channel} onRename={onRename} onDone={onClose} />
        )}
        {state?.mode === 'delete' && (
          <DeleteConfirm channel={state.channel} onDelete={onDelete} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({
  onCreate,
  onDone,
}: {
  onCreate: ReturnType<typeof useChannels>['createChannel']
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [kind, setKind] = useState<Channel['kind']>('chat')
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
      await onCreate({ name: parsed.name, kind, topic })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the channel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>New channel</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="channel-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="design-review"
          maxLength={CHANNEL_NAME_MAX + 8}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Kind</span>
        <div className="flex gap-2">
          {(['chat', 'forum'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              variant={kind === k ? 'default' : 'outline'}
              size="sm"
              className={cn('capitalize')}
              onClick={() => setKind(k)}
            >
              {k}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="channel-topic" className="text-sm font-medium">
          Topic <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="channel-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What this channel is for"
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
          {busy ? 'Creating…' : 'Create channel'}
        </Button>
      </div>
    </form>
  )
}

function RenameForm({
  channel,
  onRename,
  onDone,
}: {
  channel: Channel
  onRename: ReturnType<typeof useChannels>['renameChannel']
  onDone: () => void
}) {
  const [name, setName] = useState(channel.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = normalizeChannelName(name)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.name === channel.name) {
      onDone()
      return
    }

    setBusy(true)
    setError(null)
    try {
      await onRename(channel.id, parsed.name)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the channel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Rename #{channel.name}</DialogTitle>
      </DialogHeader>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={CHANNEL_NAME_MAX + 8}
        autoFocus
        aria-label="Channel name"
      />

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
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function DeleteConfirm({
  channel,
  onDelete,
  onDone,
}: {
  channel: Channel
  onDelete: ReturnType<typeof useChannels>['deleteChannel']
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onDelete(channel.id)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the channel.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Delete #{channel.name}?</DialogTitle>
        <DialogDescription>
          This also deletes every message in the channel. There is no undo.
        </DialogDescription>
      </DialogHeader>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Deleting…' : `Delete #${channel.name}`}
        </Button>
      </div>
    </div>
  )
}
