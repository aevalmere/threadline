import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useChannels } from '@/lib/channels-context'
import { groupMessages } from '@/lib/grouping'
import { useProfiles } from '@/lib/profiles-context'
import { useMessages, type Message } from '@/lib/useMessages'
import type { PendingMessage } from '@/lib/pending'
import { cn } from '@/lib/utils'

/** How close to the bottom still counts as "following along", in pixels. */
const STICK_THRESHOLD = 80

export default function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>()
  const { channels, loading: channelsLoading } = useChannels()
  const { nameFor, byId } = useProfiles()
  const { messages, pending, loading, error, send, retry, discard } = useMessages(channelId)

  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
  }, [])

  // A fresh channel always opens pinned to the newest message, even if the
  // previous one was left scrolled up.
  useLayoutEffect(() => {
    stickToBottom.current = true
  }, [channelId])

  // Follow new messages only when already at the bottom — otherwise reading
  // scrollback would be yanked away every time someone types.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  const channel = channels?.find((c) => c.id === channelId)

  if (!channelsLoading && !channel) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Channel not found</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          It may have been deleted.
        </p>
      </div>
    )
  }

  const groups = groupMessages(messages)

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          {channel ? `#${channel.name}` : <Skeleton className="h-6 w-32" />}
        </h1>
        {channel?.topic && (
          <p className="text-muted-foreground text-sm">{channel.topic}</p>
        )}
      </div>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            Could not load messages: {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-10 w-3/5" />
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {groups.length === 0 && (
              <p className="text-muted-foreground text-sm">No messages yet.</p>
            )}

            {groups.map((group) => (
              <MessageGroupRow
                key={group.key}
                authorName={nameFor(group.authorId)}
                avatarUrl={byId.get(group.authorId)?.avatar_url ?? null}
                messages={group.messages}
              />
            ))}

            {pending.map((p) => (
              <PendingRow
                key={p.key}
                pending={p}
                authorName={nameFor(p.authorId)}
                avatarUrl={byId.get(p.authorId)?.avatar_url ?? null}
                onRetry={() => void retry(p.key)}
                onDiscard={() => discard(p.key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Keyed so a channel switch does not carry half-typed text into the
          next channel — ChannelView itself is not remounted on a param
          change. Disabled until the first page lands: a send before then
          captures sinceId 0, which lets an unrelated older message of the
          same body claim the entry. */}
      <Composer
        key={channelId}
        channelName={channel?.name}
        onSend={send}
        disabled={loading}
      />
    </div>
  )
}

function MessageGroupRow({
  authorName,
  avatarUrl,
  messages,
}: {
  authorName: string
  avatarUrl: string | null
  messages: Message[]
}) {
  const first = messages[0]
  return (
    <div className="flex gap-3">
      <AuthorAvatar name={authorName} url={avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <span className="text-muted-foreground text-xs">{shortTime(first.created_at)}</span>
        </p>
        {messages.map((m) => (
          <MessageBody key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}

function MessageBody({ message }: { message: Message }) {
  if (message.deleted_at) {
    return <p className="text-muted-foreground text-sm italic">message deleted</p>
  }
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {message.body}
      {message.edited_at && (
        <span className="text-muted-foreground ml-1.5 text-xs">(edited)</span>
      )}
    </p>
  )
}

function PendingRow({
  pending,
  authorName,
  avatarUrl,
  onRetry,
  onDiscard,
}: {
  pending: PendingMessage
  authorName: string
  avatarUrl: string | null
  onRetry: () => void
  onDiscard: () => void
}) {
  const failed = pending.status === 'failed'
  return (
    <div className="flex gap-3">
      <AuthorAvatar name={authorName} url={avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{authorName}</p>
        <p
          className={cn(
            'text-sm break-words whitespace-pre-wrap',
            failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {pending.body}
        </p>
        {failed && (
          <p className="mt-1 flex items-center gap-2">
            <span className="text-destructive text-xs">Not sent.</span>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onRetry}>
              Retry
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onDiscard}>
              Discard
            </Button>
          </p>
        )}
      </div>
    </div>
  )
}

function AuthorAvatar({ name, url }: { name: string; url: string | null }) {
  return (
    <Avatar className="size-8 shrink-0">
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

function Composer({
  channelName,
  onSend,
  disabled,
}: {
  channelName: string | undefined
  onSend: (body: string) => Promise<void>
  disabled: boolean
}) {
  const [value, setValue] = useState('')

  function submit() {
    if (disabled || !value.trim()) return
    void onSend(value)
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 pt-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        disabled={disabled}
        placeholder={channelName ? `Message #${channelName}` : 'Message'}
        className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 field-sizing-content max-h-40 min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-60"
      />
    </div>
  )
}

function initials(name: string): string {
  const parts = name.split(/[\s._+-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
