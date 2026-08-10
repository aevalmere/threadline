import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'

import {
  MessageSquareIcon,
  PaperclipIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatBytes,
  isImage,
  isPlayable,
  isVideo,
  validateFile,
  type Attachment,
} from '@/lib/attachments'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'
import { groupMessages } from '@/lib/grouping'
import { useProfiles } from '@/lib/profiles-context'
import { splitThreads, threadRootFor } from '@/lib/threads'
import { useMessages, type Message } from '@/lib/useMessages'
import { useSignedUrls } from '@/lib/useSignedUrls'
import type { PendingMessage } from '@/lib/pending'
import { cn } from '@/lib/utils'

/** How close to the bottom still counts as "following along", in pixels. */
const STICK_THRESHOLD = 80

export interface PreviewItem {
  attachment: Attachment
  url: string
}

/**
 * What the hover bar can do to a message. Grouped so adding the P2
 * "create task from message" action means extending this, not re-threading
 * props through four components.
 */
export interface MessageActions {
  onReply: (message: Message) => void
  onRequestDelete: (message: Message) => void
  deleteAttachment: (attachment: Attachment) => Promise<void>
  editMessage: (id: number, body: string) => Promise<void>
}

export default function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>()
  const { channels, loading: channelsLoading } = useChannels()
  const { nameFor, byId } = useProfiles()
  const { authorId } = useAuth()
  const {
    messages,
    attachmentsByMessage,
    pending,
    loading,
    error,
    send,
    retry,
    discard,
    deleteMessage,
    deleteAttachment,
    editMessage,
    dismissError,
  } = useMessages(channelId)

  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const stickToBottom = useRef(true)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null)
  // Which thread the hover Reply button opened, so the thread expands and its
  // composer takes focus.
  const [openThread, setOpenThread] = useState<number | null>(null)

  const actions: MessageActions = {
    onReply: (message) => setOpenThread(threadRootFor(message)),
    onRequestDelete: (message) => setConfirmDelete(message),
    deleteAttachment,
    editMessage,
  }

  // Without an author id nothing can be written — messages.author_id is not
  // null. In guest mode that means the shared Guest profile did not resolve.
  // Say so, rather than letting someone type into a composer whose Send button
  // silently discards the message.
  const canWrite = authorId !== null

  // Every attachment path on screen, signed in one batched request.
  const signedUrlFor = useSignedUrls(
    [...attachmentsByMessage.values()].flat().map((a) => a.storage_path),
  )

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

  const split = splitThreads(messages)
  const groups = groupMessages(split.roots)
  const rootPending = pending.filter((p) => p.threadRootId === null)

  return (
    /* The channel name and topic live in the app header
       (CurrentChannelTitle), so this surface is just the conversation. */
    <div className="flex h-full flex-col">

      <div
        ref={listRef}
        onScroll={onScroll}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          // Only when the pointer actually leaves the list, not on every child.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragging(false)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          // Stage, never send. Dropping a file is not the gesture that says
          // "post this" — Enter or Send is.
          const files = [...(e.dataTransfer.files ?? [])]
          if (files.length > 0) composerRef.current?.stage(files)
        }}
        className={cn(
          // Full-bleed so the scrollbar sits at the window edge; the inset is
          // padding inside the scroll container, not around it.
          'min-h-0 flex-1 overflow-y-auto px-6 py-4',
          dragging && 'ring-primary bg-primary/5 ring-2 -ring-offset-2',
        )}
      >
        {error && (
          <p
            role="alert"
            className="text-destructive mb-2 flex items-start gap-2 text-sm"
          >
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={dismissError}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <XIcon className="size-4" />
              <span className="sr-only">Dismiss</span>
            </button>
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
                attachmentsFor={(id) => attachmentsByMessage.get(String(id)) ?? []}
                signedUrlFor={signedUrlFor}
                actions={actions}
                onPreview={setPreview}
                renderThread={(message) => (
                  <Thread
                    root={message}
                    replies={split.repliesByRoot.get(message.id) ?? []}
                    pending={pending.filter((p) => p.threadRootId === message.id)}
                    attachmentsFor={(id) => attachmentsByMessage.get(String(id)) ?? []}
                    signedUrlFor={signedUrlFor}
                    actions={actions}
                    onPreview={setPreview}
                    forceOpen={openThread === message.id}
                    canWrite={canWrite}
                    onCollapse={() => setOpenThread(null)}
                    onSend={send}
                    onRetry={retry}
                    onDiscard={discard}
                  />
                )}
              />
            ))}

            {rootPending.map((p) => (
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
      {!canWrite && !loading && (
        <p role="alert" className="text-destructive shrink-0 px-6 text-sm">
          You are signed out.
        </p>
      )}

      <Composer
        ref={composerRef}
        key={channelId}
        channelName={channel?.name}
        onSend={(body, files) => send(body, null, files)}
        disabled={loading || !canWrite}
      />

      <Preview item={preview} onClose={() => setPreview(null)} />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this message?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) void deleteMessage(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MessageGroupRow({
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

  return (
    <div className="group hover:bg-accent/40 relative -mx-2 rounded-md px-2 py-0.5 transition-colors focus-within:bg-accent/40">
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

      {!deleted && !editing && (
        <div className="bg-background absolute -top-3 right-1 hidden items-center gap-0.5 rounded-md border p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => actions.onReply(message)}
          >
            <MessageSquareIcon className="size-3.5" />
            <span className="sr-only">Reply</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setEditing(true)}
          >
            <PencilIcon className="size-3.5" />
            <span className="sr-only">Edit message</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-7"
            onClick={() => actions.onRequestDelete(message)}
          >
            <Trash2Icon className="size-3.5" />
            <span className="sr-only">Delete message</span>
          </Button>
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

/** Images inline, everything else a chip. The URL is null until it is signed. */
function AttachmentView({
  attachment,
  url,
  onPreview,
  onDelete,
}: {
  attachment: Attachment
  url: string | null
  onPreview: (item: PreviewItem) => void
  onDelete: () => void
}) {
  if (!url) {
    return <Skeleton className="my-1 h-32 w-48 rounded-md" />
  }

  const open = () => onPreview({ attachment, url })

  return (
    <div className="group/att relative my-1 w-fit">
      {isImage(attachment.mime) ? (
        <button type="button" onClick={open} className="block cursor-zoom-in">
          <img
            src={url}
            alt={attachment.filename}
            loading="lazy"
            className="max-h-64 rounded-md border object-contain"
          />
        </button>
      ) : isVideo(attachment.mime) ? (
        // Native controls, not a library: they already give play/pause,
        // scrubbing, volume, fullscreen, picture-in-picture and playback rate,
        // and a player library would be a locked-stack addition (Non-negotiable
        // 3) for no gain. preload="metadata" keeps the poster frame and
        // duration without pulling the whole file down the free tier's egress.
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          className="max-h-64 rounded-md border"
        />
      ) : (
        <button
          type="button"
          onClick={open}
          className="hover:bg-accent flex items-center gap-2 rounded-md border px-2.5 py-1.5"
        >
          <PaperclipIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="text-sm">{attachment.filename}</span>
          {attachment.size_bytes !== null && (
            <span className="text-muted-foreground text-xs">
              {formatBytes(attachment.size_bytes)}
            </span>
          )}
        </button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="bg-background text-destructive hover:text-destructive absolute -top-2 -right-2 hidden size-6 rounded-full border shadow-sm group-hover/att:flex"
      >
        <XIcon className="size-3" />
        <span className="sr-only">Delete {attachment.filename}</span>
      </Button>
    </div>
  )
}

/**
 * Full-size viewer. Images render directly; PDFs get an iframe, which every
 * target browser renders natively. Anything else falls back to a download,
 * because guessing at a viewer for arbitrary binaries is not worth the code.
 */
function Preview({
  item,
  onClose,
}: {
  item: PreviewItem | null
  onClose: () => void
}) {
  const mime = item?.attachment.mime
  const isPdf = mime === 'application/pdf'
  // Media sizes the dialog; a PDF has no natural size worth honouring, so it
  // gets a large fixed frame instead.
  const fitsMedia = isPlayable(mime)

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          // w-full and sm:max-w-lg are baked into DialogContent, so both have
          // to be beaten for the box to shrink to its contents.
          'flex max-h-[92vh] flex-col gap-3 overflow-hidden',
          fitsMedia
            ? 'w-auto max-w-[95vw] p-3 sm:max-w-[95vw]'
            : 'w-full max-w-[95vw] sm:max-w-4xl',
        )}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-8 text-sm font-medium">
            {item?.attachment.filename}
          </DialogTitle>
        </DialogHeader>

        {item && (
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto">
            {isImage(mime) ? (
              <img
                src={item.url}
                alt={item.attachment.filename}
                // Bounded by the viewport but never upscaled past its own
                // pixels, so a small screenshot stays small instead of being
                // blown up and blurry.
                className="max-h-[80vh] max-w-full rounded-md object-contain"
                style={{ width: 'auto', height: 'auto' }}
              />
            ) : isVideo(mime) ? (
              <video
                src={item.url}
                controls
                autoPlay
                playsInline
                className="max-h-[80vh] max-w-full rounded-md"
              />
            ) : isPdf ? (
              <iframe
                src={item.url}
                title={item.attachment.filename}
                className="h-[80vh] w-full rounded-md border"
              />
            ) : (
              <div className="py-8 text-center">
                <PaperclipIcon className="text-muted-foreground mx-auto size-8" />
                <p className="mt-2 text-sm">
                  {item.attachment.size_bytes !== null &&
                    formatBytes(item.attachment.size_bytes)}
                </p>
              </div>
            )}
          </div>
        )}

        {item && (
          <a
            href={item.url}
            download={item.attachment.filename}
            target="_blank"
            rel="noreferrer"
            className="text-primary shrink-0 text-sm hover:underline"
          >
            Download
          </a>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A message's replies, collapsed behind a count until opened. Inline rather
 * than a side panel: it costs no new route or layout, and it works on a phone.
 */
function Thread({
  root,
  replies,
  pending,
  attachmentsFor,
  signedUrlFor,
  actions,
  onPreview,
  forceOpen,
  canWrite,
  onCollapse,
  onSend,
  onRetry,
  onDiscard,
}: {
  root: Message
  replies: Message[]
  pending: PendingMessage[]
  attachmentsFor: (messageId: number) => Attachment[]
  signedUrlFor: (path: string) => string | null
  actions: MessageActions
  onPreview: (item: PreviewItem) => void
  forceOpen: boolean
  canWrite: boolean
  onCollapse: () => void
  onSend: (body: string, threadRootId: number | null, files: File[]) => Promise<void>
  onRetry: (key: string) => Promise<void>
  onDiscard: (key: string) => void
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const { nameFor, byId } = useProfiles()

  // The hover Reply button opens the thread from outside this component, so
  // collapsing has to clear that too — otherwise `forceOpen` holds it open and
  // the Collapse button does nothing.
  const open = selfOpen || forceOpen
  function collapse() {
    setSelfOpen(false)
    onCollapse()
  }

  const count = replies.length

  // A deleted root still holds a conversation — the tombstone exists precisely
  // so its replies keep a place to hang — so the thread stays open, readable
  // and repliable. Only the root's own text is gone.
  if (count === 0 && pending.length === 0 && !open) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setSelfOpen(true)}
        className="text-primary mt-0.5 text-xs font-medium hover:underline"
      >
        {count} {count === 1 ? 'reply' : 'replies'}
      </button>
    )
  }


  return (
    <div className="border-border mt-1.5 space-y-2 border-l-2 pl-3">
      {groupMessages(replies).map((group) => (
        <MessageGroupRow
          key={group.key}
          authorName={nameFor(group.authorId)}
          avatarUrl={byId.get(group.authorId)?.avatar_url ?? null}
          messages={group.messages}
          attachmentsFor={attachmentsFor}
          signedUrlFor={signedUrlFor}
          actions={actions}
          onPreview={onPreview}
          // One level deep (SPEC §1.3) — a reply has no thread of its own.
          renderThread={() => null}
        />
      ))}

      {pending.map((p) => (
        <PendingRow
          key={p.key}
          pending={p}
          authorName={nameFor(p.authorId)}
          avatarUrl={byId.get(p.authorId)?.avatar_url ?? null}
          onRetry={() => void onRetry(p.key)}
          onDiscard={() => onDiscard(p.key)}
        />
      ))}

      <Composer
        inset
        channelName={undefined}
        placeholder="Reply…"
        disabled={!canWrite}
        autoFocus={forceOpen}
        onSend={(body, files) => onSend(body, threadRootFor(root), files)}
      />

      <button
        type="button"
        onClick={collapse}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        Collapse
      </button>
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
        {pending.filename && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <PaperclipIcon className="size-3.5 shrink-0" />
            {pending.filename}
            {!failed && ' — uploading…'}
          </p>
        )}
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

/**
 * The composer. Files are *staged*, never sent on pick — attaching something is
 * not the same gesture as sending it, and the old behaviour fired a message the
 * moment a file was chosen, with no chance to add a caption or change your
 * mind. Nothing leaves until Enter or Send.
 *
 * Staged files come from three places that all funnel into `stage()`: the
 * paperclip, a paste, and a drop on the message list.
 */
export interface ComposerHandle {
  stage: (files: File[]) => void
}

const Composer = forwardRef<
  ComposerHandle,
  {
    channelName: string | undefined
    onSend: (body: string, files: File[]) => Promise<void>
    disabled: boolean
    placeholder?: string
    autoFocus?: boolean
    /** Nested inside a thread, so it skips the full-width composer chrome. */
    inset?: boolean
  }
>(function Composer(
  { channelName, onSend, disabled, placeholder, autoFocus, inset },
  ref,
) {
  const [value, setValue] = useState('')
  const [staged, setStaged] = useState<File[]>([])
  const [rejected, setRejected] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const stage = useCallback((files: File[]) => {
    const ok: File[] = []
    const errors: string[] = []
    for (const f of files) {
      const check = validateFile(f)
      if (check.ok) ok.push(f)
      else errors.push(check.error)
    }
    // Set from this batch alone, so a mixed drop reports the rejected file
    // instead of the accepted one silently clearing its error.
    setRejected(errors.length > 0 ? errors.join(' ') : null)
    if (ok.length > 0) setStaged((current) => [...current, ...ok])
  }, [])

  useImperativeHandle(ref, () => ({ stage }), [stage])

  function submit() {
    if (disabled) return
    if (!value.trim() && staged.length === 0) return
    void onSend(value, staged)
    setValue('')
    setStaged([])
    setRejected(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files]
    if (files.length === 0) return
    // Let the text half of a mixed paste land in the textarea as usual; only
    // claim the event when there is nothing but files.
    if (!e.clipboardData.getData('text')) e.preventDefault()
    stage(files)
  }

  const canSend = !disabled && (value.trim().length > 0 || staged.length > 0)

  return (
    <div className={cn('shrink-0', inset ? 'pt-2' : 'border-t px-6 py-3')}>
      {staged.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {staged.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="bg-muted flex items-center gap-2 rounded-md px-2 py-1"
            >
              <PaperclipIcon className="text-muted-foreground size-3.5 shrink-0" />
              <span className="max-w-48 truncate text-xs">{f.name}</span>
              <span className="text-muted-foreground text-xs">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => setStaged((c) => c.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
                <span className="sr-only">Remove {f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rejected && (
        <p role="alert" className="text-destructive mb-2 text-xs">
          {rejected}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={2}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder ?? (channelName ? `Message #${channelName}` : 'Message')}
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 field-sizing-content max-h-40 min-h-16 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-60"
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => stage([...(e.target.files ?? [])])}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
          <span className="sr-only">Attach a file</span>
        </Button>
        <Button type="button" size="icon" disabled={!canSend} onClick={submit}>
          <SendIcon />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  )
})

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
