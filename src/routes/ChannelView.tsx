import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { XIcon } from 'lucide-react'

import { Composer, type ComposerHandle } from '@/components/messages/Composer'
import { MessageGroupRow } from '@/components/messages/MessageGroup'
import { PendingRow } from '@/components/messages/PendingRow'
import { Preview } from '@/components/messages/AttachmentView'
import { Thread } from '@/components/messages/Thread'
import type { MessageActions, PreviewItem } from '@/components/messages/types'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'
import { groupMessages } from '@/lib/grouping'
import { resolveJump } from '@/lib/jump'
import { useProfiles } from '@/lib/profiles-context'
import { titleFromBody } from '@/lib/tasks'
import { splitThreads, threadRootFor } from '@/lib/threads'
import { useUnread } from '@/lib/unread-context'
import { createTaskFromMessage } from '@/lib/useTasks'
import { useMessages, type Message } from '@/lib/useMessages'
import { useSignedUrls } from '@/lib/useSignedUrls'
import { cn } from '@/lib/utils'

/** How close to the bottom still counts as "following along", in pixels. */
const STICK_THRESHOLD = 80

/** How close to the top starts fetching older messages, in pixels. */
const LOAD_MORE_THRESHOLD = 200

/** Scrollback pages a `?m=` jump may pull hunting for an old message. */
const JUMP_HUNT_PAGES = 10

export default function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>()
  const [params, setParams] = useSearchParams()
  const { channels, loading: channelsLoading } = useChannels()
  const { nameFor, avatarUrlFor } = useProfiles()
  const { authorId } = useAuth()
  const { markRead } = useUnread()
  const {
    messages,
    loadedChannelId,
    hasMore,
    loadingMore,
    loadOlder,
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
  /**
   * Distance from the bottom of the content, captured just before a scrollback
   * page is requested and consumed by the layout effect that restores it.
   * Null when no restore is pending.
   */
  const pendingScrollAnchor = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null)
  // The message a task is being created from — the P2 modal (SPEC §1.6).
  const [taskFrom, setTaskFrom] = useState<Message | null>(null)
  // Which thread the hover Reply button opened, so the thread expands and its
  // composer takes focus.
  const [openThread, setOpenThread] = useState<number | null>(null)

  const actions: MessageActions = {
    onReply: (message) => setOpenThread(threadRootFor(message)),
    onRequestDelete: (message) => setConfirmDelete(message),
    onCreateTask: (message) => setTaskFrom(message),
    deleteAttachment,
    editMessage,
  }

  // Without an author id nothing can be written — messages.author_id is not
  // null. Say so, rather than letting someone type into a composer whose Send
  // button silently discards the message.
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

    // Near the top means older messages are wanted. `loadOlder` is idempotent
    // while a page is in flight, so firing on every scroll event is harmless.
    if (el.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !loading) {
      // Remember how far the content extends *above* the viewport. Prepending
      // rows grows scrollHeight, and the browser keeps scrollTop — so without
      // the correction below the view would jump backwards by exactly the
      // height of what was just added.
      pendingScrollAnchor.current = el.scrollHeight - el.scrollTop
      // Cleared only when nothing arrived. Not on `busy` — that call is one of
      // the many this handler fires per second while near the top, and the
      // anchor belongs to the request already in flight. Clearing it there
      // would leave the landing page with nothing to restore against.
      void loadOlder().then((result) => {
        if (result === 'empty') pendingScrollAnchor.current = null
      })
    }
  }, [hasMore, loading, loadOlder])

  // A fresh channel always opens pinned to the newest message, even if the
  // previous one was left scrolled up.
  useLayoutEffect(() => {
    stickToBottom.current = true
  }, [channelId])

  /**
   * Looking at a channel is what marks it read — SPEC §1.4.
   *
   * Guarded on `loadedChannelId === channelId` for the same reason `resolveJump`
   * is (DECISIONS #17): this component re-renders without remounting on a
   * channel switch, so for one commit `messages` still holds the *previous*
   * channel's rows. Advancing the new channel's pointer with those ids would
   * mark messages read that were never displayed — and the pointer never moves
   * backwards, so it would not be recoverable.
   *
   * The write itself is debounced inside the provider (Non-negotiable 8).
   */
  useEffect(() => {
    if (!channelId || loading || loadedChannelId !== channelId) return
    if (messages.length === 0) return
    markRead(channelId, messages)
  }, [channelId, loadedChannelId, loading, messages, markRead])

  /**
   * Keep the reader's place when older messages are prepended.
   *
   * Runs before the browser paints, and *before* the follow-the-bottom effect
   * below, so a scrollback load cannot flash at a wrong offset and cannot be
   * mistaken for new activity. Restoring by distance-from-the-end rather than
   * by a saved scrollTop is what makes it exact regardless of how tall the new
   * rows turn out to be.
   */
  useLayoutEffect(() => {
    const el = listRef.current
    const anchor = pendingScrollAnchor.current
    if (!el || anchor === null) return
    pendingScrollAnchor.current = null
    el.scrollTop = el.scrollHeight - anchor
  }, [messages])

  // Follow new messages only when already at the bottom — otherwise reading
  // scrollback would be yanked away every time someone types.
  useLayoutEffect(() => {
    const el = listRef.current
    // Never while restoring a scrollback position: `stickToBottom` is false
    // then anyway, but the ordering matters more than the flag.
    if (el && stickToBottom.current && pendingScrollAnchor.current === null) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, pending])

  /**
   * `?m=<id>` — where a notification lands you.
   *
   * Two effects, and they have to be separate. This one decides, via
   * `resolveJump`, whether to consume the parameter at all; the one below does
   * the scrolling, once the target row is actually in the DOM.
   *
   * The decision is pure and tested because two of its three outcomes were
   * shipped wrong. A reply is only rendered inside an expanded thread, so
   * `reply` notifications pointed at an element that did not exist — hence
   * `openThread`. And a notification for a *different* channel re-renders this
   * component with the new id while the previous channel's rows are still in
   * hand, so consuming the parameter there throws it away before the target
   * could exist. Both are cases an effect cannot distinguish from "genuinely
   * absent" without being told which page it is holding.
   */
  const jumpTo = params.get('m')
  const [flash, setFlash] = useState<number | null>(null)

  // How many scrollback pages a jump may pull hunting for its target before
  // giving up and landing in the channel — 10 pages ≈ 500 messages. Reset per
  // parameter, so a second chip click gets a fresh budget.
  const jumpHuntLeft = useRef(JUMP_HUNT_PAGES)
  useEffect(() => {
    jumpHuntLeft.current = JUMP_HUNT_PAGES
  }, [jumpTo])

  useEffect(() => {
    const decision = resolveJump({
      jumpTo,
      loading,
      loadedChannelId,
      channelId,
      messages,
      hasMore,
    })

    // `wait` is the case that matters and the one an effect cannot see from the
    // inside: clicking a notification for another channel re-renders this
    // component with the new id while the old channel's rows are still in hand.
    // Clearing the parameter there would consume it before the target could
    // possibly exist. `resolveJump` and its tests own that distinction.
    if (decision.status === 'idle' || decision.status === 'wait') return

    // The target is below the loaded page: pull older pages until it appears
    // or the budget runs out (DECISIONS #23). The parameter survives each
    // pull, so this effect re-asks when the page lands; on exhaustion it falls
    // through and is consumed exactly like a miss.
    if (decision.status === 'page') {
      if (jumpHuntLeft.current > 0) {
        // Decrement only when a page was genuinely requested. Realtime
        // traffic re-runs this effect while a page is in flight, and
        // `loadOlder` answers those calls with a no-op 'busy' — burning
        // budget on them would end the hunt far short of the cap in any
        // active channel.
        void loadOlder().then((result) => {
          if (result !== 'busy') jumpHuntLeft.current -= 1
        })
        return
      }
      // Exhausted — but the final page may still be in flight with the
      // target on it. Let it land before the parameter is consumed.
      if (loadingMore) return
    }

    if (decision.status === 'hit') {
      // A reply only exists in the DOM once its thread is expanded.
      if (decision.openThread !== null) setOpenThread(decision.openThread)
      setFlash(decision.id)
    }

    // Both `hit` and `miss` consume it, so a message outside the loaded page
    // fails quietly instead of retrying on every new message.
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('m')
        return next
      },
      { replace: true },
    )
  }, [jumpTo, loading, loadedChannelId, channelId, messages, hasMore, loadingMore, loadOlder, setParams])

  /**
   * Scroll to the flashed message and highlight it briefly.
   *
   * Keyed on `flash` and `openThread`, so it re-runs once an expanded thread
   * has rendered the row. The highlight is removed in the cleanup rather than
   * only in the timer: an earlier version cancelled its own timeout — clearing
   * `?m=` changed the dependency, React ran the cleanup, and the class stayed
   * on that message for the life of the list.
   */
  useEffect(() => {
    if (flash === null) return
    const el = document.getElementById(`message-${flash}`)
    if (!el) return

    // The user asked for a specific message, so an arriving one must not yank
    // them back to the bottom.
    stickToBottom.current = false
    el.scrollIntoView({ block: 'center' })
    el.classList.add('bg-primary/10')

    const t = setTimeout(() => setFlash(null), 1600)
    return () => {
      clearTimeout(t)
      el.classList.remove('bg-primary/10')
    }
  }, [flash, openThread])

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

        {!loading && hasMore && (
          <div className="flex justify-center pb-2">
            {loadingMore ? (
              <span className="text-muted-foreground text-xs">Loading older messages…</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const el = listRef.current
                  if (el) pendingScrollAnchor.current = el.scrollHeight - el.scrollTop
                  void loadOlder().then((result) => {
                    if (result === 'empty') pendingScrollAnchor.current = null
                  })
                }}
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              >
                Load older messages
              </button>
            )}
          </div>
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
                avatarUrl={avatarUrlFor(group.authorId)}
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
                avatarUrl={avatarUrlFor(p.authorId)}
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

      <TaskDialog
        open={taskFrom !== null}
        title="Create task from message"
        submitLabel="Create task"
        initial={taskFrom ? { title: titleFromBody(taskFrom.body) } : {}}
        onClose={() => setTaskFrom(null)}
        onSubmit={async (fields) => {
          // Captured at open-time: `taskFrom` is plain data, so it stays valid
          // even if the user switches channels with the dialog open.
          if (!taskFrom) return
          if (authorId === null) throw new Error('Not signed in.')
          await createTaskFromMessage(taskFrom, {
            title: fields.title,
            status: fields.status,
            assigneeId: fields.assigneeId,
            dueDate: fields.dueDate,
            description: fields.description,
            createdBy: authorId,
          })
        }}
      />
    </div>
  )
}
