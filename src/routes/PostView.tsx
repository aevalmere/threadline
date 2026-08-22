import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { ListTodoIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'

import { PostDialog } from '@/components/forums/PostDialog'
import { TagChip } from '@/components/forums/TagChip'
import { TaskDialog } from '@/components/tasks/TaskDialog'
import { Composer, type ComposerHandle } from '@/components/messages/Composer'
import { MessageGroupRow } from '@/components/messages/MessageGroup'
import { PendingRow } from '@/components/messages/PendingRow'
import { Preview } from '@/components/messages/AttachmentView'
import { Thread } from '@/components/messages/Thread'
import type { MessageActions, PreviewItem } from '@/components/messages/types'
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
import { postParent } from '@/lib/messages'
import { useProfiles } from '@/lib/profiles-context'
import { plainFromRich } from '@/lib/rich'
import { titleFromBody } from '@/lib/tasks'
import { splitThreads, threadRootFor } from '@/lib/threads'
import { deletePostRecord, updatePostRecord, usePost } from '@/lib/usePosts'
import { createTaskFromMessage, createTaskFromPost } from '@/lib/useTasks'
import { useMessages, type Message } from '@/lib/useMessages'
import { useSignedUrls } from '@/lib/useSignedUrls'
import { cn } from '@/lib/utils'

/** Scrollback pages a `?m=` jump may pull hunting for an old comment. */
const JUMP_HUNT_PAGES = 10

/**
 * One forum post and its comments — SPEC §1.2. The comment surface is the
 * same machinery as chat: `useMessages` keyed by `post_id` instead of
 * `channel_id`, rendering the same extracted components, so threads, uploads,
 * mentions, optimistic sends, resync and realtime all behave identically.
 *
 * Differences from ChannelView, all deliberate: the page scrolls as a
 * document (no pin-to-bottom — a post is read top-down), there is no read
 * pointer (`last_read_message_id` is per-channel; SPEC has no forum unread),
 * and the post's own title/body render above the comments.
 */
export default function PostView() {
  const { postId } = useParams<{ postId: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { channels } = useChannels()
  const { nameFor, avatarUrlFor } = useProfiles()
  const { authorId } = useAuth()
  const { post, postTags, missing, error: postError, refresh } = usePost(postId)

  const {
    messages,
    loadedParentId,
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
  } = useMessages(postId ? postParent(postId) : undefined, {
    // Uploads land under the post's forum channel, keeping "one prefix per
    // channel" true for forum files too. Sends are blocked until the post
    // row (and with it this prefix) has loaded.
    storagePrefixId: post?.channel_id,
  })

  const composerRef = useRef<ComposerHandle>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [openThread, setOpenThread] = useState<number | null>(null)
  // The two create-task entry points: the post header, and a comment's hover
  // bar — a comment is an ordinary message, so it uses the message flow.
  const [taskFromPost, setTaskFromPost] = useState(false)
  const [taskFromComment, setTaskFromComment] = useState<Message | null>(null)

  const actions: MessageActions = {
    onReply: (message) => setOpenThread(threadRootFor(message)),
    onRequestDelete: (message) => setConfirmDelete(message),
    onCreateTask: (message) => setTaskFromComment(message),
    linkFor: (message) => `/posts/${postId}?m=${message.id}`,
    deleteAttachment,
    editMessage,
  }

  const canWrite = authorId !== null && post !== null
  // Editing and deleting the post are the author's; commenting and
  // create-task are everyone's. UI-level, not a wall (DECISIONS #26).
  const isPostAuthor = post !== null && post.author_id === authorId

  const signedUrlFor = useSignedUrls(
    [...attachmentsByMessage.values()].flat().map((a) => a.storage_path),
  )

  /**
   * `?m=<id>` — where a bell click on a comment notification lands. Same
   * decision machinery as ChannelView (DECISIONS #17/#23), minus the scroll
   * anchor: this page scrolls as a document, so prepended older comments may
   * shift the view — acceptable for the far-rarer forum hunt.
   */
  const jumpTo = params.get('m')
  const [flash, setFlash] = useState<number | null>(null)
  const jumpHuntLeft = useRef(JUMP_HUNT_PAGES)
  useEffect(() => {
    jumpHuntLeft.current = JUMP_HUNT_PAGES
  }, [jumpTo])

  useEffect(() => {
    const decision = resolveJump({
      jumpTo,
      loading,
      loadedParentId,
      parentId: postId,
      messages,
      hasMore,
    })

    if (decision.status === 'idle' || decision.status === 'wait') return

    if (decision.status === 'page') {
      if (jumpHuntLeft.current > 0) {
        void loadOlder().then((result) => {
          if (result !== 'busy') jumpHuntLeft.current -= 1
        })
        return
      }
      if (loadingMore) return
    }

    if (decision.status === 'hit') {
      if (decision.openThread !== null) setOpenThread(decision.openThread)
      setFlash(decision.id)
    }

    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('m')
        return next
      },
      { replace: true },
    )
  }, [jumpTo, loading, loadedParentId, postId, messages, hasMore, loadingMore, loadOlder, setParams])

  useEffect(() => {
    if (flash === null) return
    const el = document.getElementById(`message-${flash}`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.classList.add('bg-primary/10')
    // Images above the target finish loading after the first scroll and push
    // the layout, carrying the view away from the flashed message — so the
    // center is re-asserted for the flash's lifetime. A scroll gesture of the
    // user's own cancels it immediately; the jump must never fight them.
    const reassert = setInterval(() => el.scrollIntoView({ block: 'center' }), 300)
    const cancel = () => clearInterval(reassert)
    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchmove', cancel, { passive: true })
    const t = setTimeout(() => setFlash(null), 1600)
    return () => {
      clearTimeout(t)
      clearInterval(reassert)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
      el.classList.remove('bg-primary/10')
    }
  }, [flash, openThread])

  if (missing) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold tracking-tight">Post not found</h1>
        <p className="text-muted-foreground mt-1 text-sm">It may have been deleted.</p>
        <Link to="/forums" className="text-primary mt-2 inline-block text-sm hover:underline">
          Back to forums
        </Link>
      </div>
    )
  }

  const forum = channels?.find((c) => c.id === post?.channel_id)
  const body = plainFromRich(post?.body_rich)
  const split = splitThreads(messages)
  const groups = groupMessages(split.roots)
  const rootPending = pending.filter((p) => p.threadRootId === null)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = [...(e.dataTransfer.files ?? [])]
        if (files.length > 0) composerRef.current?.stage(files)
      }}
      className={cn(
        'mx-auto max-w-3xl space-y-4 p-6',
        dragging && 'ring-primary bg-primary/5 rounded-md ring-2',
      )}
    >
      {post === null ? (
        <div className="space-y-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <header className="space-y-2">
          {forum && (
            <Link
              to={`/forums/${forum.id}`}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ← #{forum.name}
            </Link>
          )}
          <div className="flex items-start justify-between gap-3">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words">
              {post.title}
            </h1>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setTaskFromPost(true)}
              >
                <ListTodoIcon className="size-4" />
                <span className="sr-only">Create task from post</span>
              </Button>
              {isPostAuthor && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon className="size-4" />
                  <span className="sr-only">Edit post</span>
                </Button>
              )}
              {isPostAuthor && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive size-8"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2Icon className="size-4" />
                  <span className="sr-only">Delete post</span>
                </Button>
              )}
            </div>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>{nameFor(post.author_id)}</span>
            <span>{fullDate(post.created_at)}</span>
            {postTags.map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
          </div>
          {body && (
            <p className="text-sm break-words whitespace-pre-wrap">{body}</p>
          )}
        </header>
      )}

      <section className="space-y-4 border-t pt-4">
        {error && (
          <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
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
        {postError && (
          <p role="alert" className="text-destructive text-sm">
            {postError}
          </p>
        )}

        {!loading && hasMore && (
          <div className="flex justify-center">
            {loadingMore ? (
              <span className="text-muted-foreground text-xs">Loading older comments…</span>
            ) : (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              >
                Load older comments
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-10 w-1/2" />
          </div>
        ) : (
          <div className="space-y-4">
            {groups.length === 0 && rootPending.length === 0 && (
              <p className="text-muted-foreground text-sm">No comments yet.</p>
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

        {!canWrite && !loading && authorId === null && (
          <p role="alert" className="text-destructive text-sm">
            You are signed out.
          </p>
        )}

        <Composer
          ref={composerRef}
          key={postId}
          inset
          channelName={undefined}
          placeholder="Comment…"
          onSend={(body, files) => send(body, null, files)}
          disabled={loading || !canWrite}
        />
      </section>

      <Preview item={preview} onClose={() => setPreview(null)} />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this comment?</DialogTitle>
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

      {post && (
        <TaskDialog
          open={taskFromPost}
          title="Create task from post"
          submitLabel="Create task"
          initial={{ title: post.title }}
          onClose={() => setTaskFromPost(false)}
          onSubmit={async (fields) => {
            if (authorId === null) throw new Error('Not signed in.')
            await createTaskFromPost(post, {
              title: fields.title,
              status: fields.status,
              assigneeId: fields.assigneeId,
              dueDate: fields.dueDate,
              description: fields.description,
              createdBy: authorId,
            })
          }}
        />
      )}

      <TaskDialog
        open={taskFromComment !== null}
        title="Create task from message"
        submitLabel="Create task"
        initial={taskFromComment ? { title: titleFromBody(taskFromComment.body) } : {}}
        onClose={() => setTaskFromComment(null)}
        onSubmit={async (fields) => {
          // Captured at open-time: plain data, valid even if the page moves on.
          if (!taskFromComment) return
          if (authorId === null) throw new Error('Not signed in.')
          await createTaskFromMessage(taskFromComment, {
            title: fields.title,
            status: fields.status,
            assigneeId: fields.assigneeId,
            dueDate: fields.dueDate,
            description: fields.description,
            createdBy: authorId,
          })
        }}
      />

      {post && (
        <PostDialog
          open={editing}
          title="Edit post"
          submitLabel="Save"
          initial={{
            title: post.title,
            body,
            tagNames: postTags.map((t) => t.name),
          }}
          onClose={() => setEditing(false)}
          onSubmit={async (fields) => {
            await updatePostRecord(post.id, fields, postTags)
            await refresh()
          }}
        />
      )}

      {post && (
        <Dialog open={deleting} onOpenChange={(open) => !open && setDeleting(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{post.title}”?</DialogTitle>
              <DialogDescription>
                This also deletes every comment and attached file. There is no undo.
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <p role="alert" className="text-destructive text-sm">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteError(null)
                  deletePostRecord(post.id)
                    .then(() => navigate(`/forums/${post.channel_id}`))
                    .catch((err: unknown) =>
                      setDeleteError(
                        err instanceof Error ? err.message : 'Could not delete the post.',
                      ),
                    )
                }}
              >
                Delete post
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function fullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}
