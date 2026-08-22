import { useState, type ReactNode } from 'react'

import {
  ListTodoIcon,
  MessageSquareIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { AttachmentView } from '@/components/messages/AttachmentView'
import type { MessageActions, PreviewItem } from '@/components/messages/types'
import { Button } from '@/components/ui/button'
import type { Attachment } from '@/lib/attachments'
import { useAuth } from '@/lib/auth-context'
import { splitMentions } from '@/lib/mentions'
import { useProfiles } from '@/lib/profiles-context'
import type { Message } from '@/lib/useMessages'
import { cn } from '@/lib/utils'

export function MessageGroupRow({
  authorName,
  avatarUrl,
  messages,
  attachmentsFor,
  signedUrlFor,
  actions,
  onPreview,
  renderThread,
}: {
  authorName: string
  avatarUrl: string | null
  messages: Message[]
  attachmentsFor: (messageId: number) => Attachment[]
  signedUrlFor: (path: string) => string | null
  actions: MessageActions
  onPreview: (item: PreviewItem) => void
  renderThread: (message: Message) => ReactNode
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
          <MessageRow
            key={m.id}
            message={m}
            attachments={attachmentsFor(m.id)}
            signedUrlFor={signedUrlFor}
            actions={actions}
            onPreview={onPreview}
          >
            {renderThread(m)}
          </MessageRow>
        ))}
      </div>
    </div>
  )
}

/**
 * One message, with its hover affordances.
 *
 * The action bar is absolutely positioned at the right edge and revealed on
 * hover or keyboard focus. It is a list on purpose: reactions, edit, pin and
 * "create task from message" (the P2 item the whole app exists for) all want
 * this same slot, so adding one later is adding a button, not restructuring.
 */
function MessageRow({
  message,
  attachments,
  signedUrlFor,
  actions,
  onPreview,
  children,
}: {
  message: Message
  attachments: Attachment[]
  signedUrlFor: (path: string) => string | null
  actions: MessageActions
  onPreview: (item: PreviewItem) => void
  children?: ReactNode
}) {
  const deleted = message.deleted_at != null
  const [editing, setEditing] = useState(false)
  // Edit and Delete are the author's; Reply and Create task are everyone's.
  // A UI affordance, not a wall — the database deliberately stays one
  // trusted workspace (Non-negotiable 2, DECISIONS #26).
  const { authorId } = useAuth()
  const mine = message.author_id === authorId

  return (
    <div
      // The anchor a notification's `?m=` jumps to and flashes.
      id={`message-${message.id}`}
      className="group hover:bg-accent/40 relative -mx-2 rounded-md px-2 py-0.5 transition-colors focus-within:bg-accent/40"
    >
      {editing ? (
        <EditBox
          initial={message.body}
          onCancel={() => setEditing(false)}
          onSave={async (body) => {
            await actions.editMessage(message.id, body)
            setEditing(false)
          }}
        />
      ) : (
        <MessageBody message={message} />
      )}

      {!deleted &&
        attachments.map((a) => (
          <AttachmentView
            key={a.id}
            attachment={a}
            url={signedUrlFor(a.storage_path)}
            onPreview={onPreview}
            onDelete={() => void actions.deleteAttachment(a)}
          />
        ))}

      {children}

      {/* Revealed by opacity, not display — a display:none button is not
          tabbable, which would leave keyboard users no path to any of these
          actions on a plain message. pointer-events gates clicks while
          invisible. */}
      {!deleted && !editing && (
        <div className="bg-background pointer-events-none absolute -top-3 right-1 flex items-center gap-0.5 rounded-md border p-0.5 opacity-0 shadow-sm group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => actions.onCreateTask(message)}
          >
            <ListTodoIcon className="size-3.5" />
            <span className="sr-only">Create task</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => actions.onReply(message)}
          >
            <MessageSquareIcon className="size-3.5" />
            <span className="sr-only">Reply</span>
          </Button>
          {mine && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditing(true)}
            >
              <PencilIcon className="size-3.5" />
              <span className="sr-only">Edit message</span>
            </Button>
          )}
          {mine && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive size-7"
              onClick={() => actions.onRequestDelete(message)}
            >
              <Trash2Icon className="size-3.5" />
              <span className="sr-only">Delete message</span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Inline editor. Enter saves, Escape cancels, Shift+Enter is a newline. */
function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)

  const unchanged = value.trim() === initial.trim()
  const empty = value.trim().length === 0

  async function save() {
    if (saving || empty) return
    if (unchanged) return onCancel()
    setSaving(true)
    await onSave(value)
    setSaving(false)
  }

  return (
    <div className="py-1">
      <textarea
        value={value}
        autoFocus
        rows={2}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        className="border-input focus-visible:ring-ring/50 field-sizing-content max-h-40 w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px]"
      />
      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" className="h-7" disabled={saving || empty} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
        {empty && (
          <span className="text-muted-foreground text-xs">
            Delete the message instead.
          </span>
        )}
      </div>
    </div>
  )
}

function MessageBody({ message }: { message: Message }) {
  const { byId } = useProfiles()
  const { authorId } = useAuth()

  if (message.deleted_at) {
    return <p className="text-muted-foreground text-sm italic">message deleted</p>
  }

  const segments = splitMentions(message.body, [...byId.values()])

  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.kind === 'mention' ? (
          <span
            key={i}
            // A mention of *you* is louder than a mention of someone else —
            // scanning a busy channel for your own name is the whole point.
            className={cn(
              'rounded px-0.5 font-medium',
              seg.userId === authorId
                ? 'bg-primary/20 text-primary'
                : 'text-primary/80',
            )}
          >
            @{byId.get(seg.userId)?.display_name ?? seg.username}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
      {message.edited_at && (
        <span className="text-muted-foreground ml-1.5 text-xs">(edited)</span>
      )}
    </p>
  )
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
