import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { HashIcon, NewspaperIcon, PlusIcon } from 'lucide-react'

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
  | { mode: 'edit'; channel: Channel }
  | { mode: 'delete'; channel: Channel }
  | null

export default function Channels() {
  const { chat, forum, loading, error, createChannel, updateChannel, deleteChannel } =
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
            onEdit={(channel) => setDialog({ mode: 'edit', channel })}
            onDelete={(channel) => setDialog({ mode: 'delete', channel })}
          />
          <ChannelGroup
            heading="Forums"
            channels={forum}
            empty="No forums yet."
            onEdit={(channel) => setDialog({ mode: 'edit', channel })}
            onDelete={(channel) => setDialog({ mode: 'delete', channel })}
          />
        </>
      )}

      <ChannelDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onCreate={createChannel}
        onUpdate={updateChannel}
        onDelete={deleteChannel}
      />
    </div>
  )
}

function ChannelGroup({
  heading,
  channels,
  empty,
  onEdit,
  onDelete,
}: {
  heading: string
  channels: Channel[]
  empty: string
  onEdit: (c: Channel) => void
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
            <li
              key={c.id}
              // The whole row opens the channel, the way the forums list has
              // always worked. Same stretched-link pattern as the post list,
              // so Edit and Delete stay real buttons above the overlay rather
              // than being nested inside an anchor.
              className="hover:bg-accent/40 focus-within:bg-accent/40 relative flex items-center gap-3 px-3 py-2.5"
            >
              {c.kind === 'forum' ? (
                <NewspaperIcon className="text-muted-foreground size-4 shrink-0" />
              ) : (
                <HashIcon className="text-muted-foreground size-4 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  to={c.kind === 'forum' ? `/forums/${c.id}` : `/channels/${c.id}`}
                  className="truncate text-sm font-medium after:absolute after:inset-0 after:content-['']"
                >
                  {c.name}
                </Link>
                {c.topic && (
                  <p className="text-muted-foreground truncate text-xs">{c.topic}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="relative z-10"
                onClick={() => onEdit(c)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive relative z-10"
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
  onUpdate,
  onDelete,
}: {
  state: DialogState
  onClose: () => void
  onCreate: ReturnType<typeof useChannels>['createChannel']
  onUpdate: ReturnType<typeof useChannels>['updateChannel']
  onDelete: ReturnType<typeof useChannels>['deleteChannel']
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {state?.mode === 'create' && <CreateForm onCreate={onCreate} onDone={onClose} />}
        {state?.mode === 'edit' && (
          <EditForm channel={state.channel} onUpdate={onUpdate} onDone={onClose} />
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

function EditForm({
  channel,
  onUpdate,
  onDone,
}: {
  channel: Channel
  onUpdate: ReturnType<typeof useChannels>['updateChannel']
  onDone: () => void
}) {
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = normalizeChannelName(name)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.name === channel.name && topic.trim() === (channel.topic ?? '')) {
      onDone()
      return
    }

    setBusy(true)
    setError(null)
    try {
      await onUpdate(channel.id, { name: parsed.name, topic })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the channel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Edit #{channel.name}</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="edit-channel-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="edit-channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CHANNEL_NAME_MAX + 8}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-channel-topic" className="text-sm font-medium">
          Topic
        </label>
        <Input
          id="edit-channel-topic"
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
          {channel.kind === 'forum'
            ? 'This also deletes every post and comment in the forum. There is no undo.'
            : 'This also deletes every message in the channel. There is no undo.'}
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
