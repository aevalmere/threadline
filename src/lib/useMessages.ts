import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  attachmentsByOwner,
  storagePathFor,
  validateFile,
  type Attachment,
} from '@/lib/attachments'
import { highestMessageId, mergeMessages, pageQuery } from '@/lib/messages'
import {
  dropPending,
  markPending,
  reconcilePendingForChannel,
  type PendingMessage,
} from '@/lib/pending'
import { supabase } from '@/lib/supabase'

/**
 * Explicit column list rather than `*`, which would drag the generated
 * `search_tsv` across the wire on every channel open. Same reasoning as the
 * publication column list in DECISIONS #4 — and unlike that one, this one
 * demonstrably works, because PostgREST honours the projection.
 */
const MESSAGE_COLUMNS =
  'id, channel_id, post_id, author_id, thread_root_id, body, created_at, edited_at, deleted_at'

const ATTACHMENT_COLUMNS =
  'id, owner_type, owner_id, storage_path, filename, mime, size_bytes, created_at'

const BUCKET = 'attachments'

export interface Message {
  id: number
  channel_id: string | null
  post_id: string | null
  author_id: string
  thread_root_id: number | null
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

/**
 * One channel's messages: the first page, a live subscription, and the
 * optimistic send queue.
 *
 * A hook rather than a context — message state belongs to whichever channel is
 * open, and only ChannelView consumes it. Channel state is shared and so lives
 * in a context (DECISIONS #6); this does not.
 *
 * All realtime is supabase-js Postgres Changes (Non-negotiable 1). The
 * subscription is torn down whenever the channel changes, because a leaked
 * subscription per channel visit is exactly the free-tier realtime budget
 * Non-negotiable 8 protects.
 */
export function useMessages(channelId: string | undefined) {
  const { session } = useAuth()
  const userId = session?.user.id ?? null

  const [messages, setMessages] = useState<Message[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read inside send() without making it a dependency — re-creating send on
  // every arriving message would churn the composer's handlers.
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages

  /**
   * Bumped whenever the open channel changes. `/channels/:channelId` renders
   * the same element for every id, so a param change re-runs the effect
   * *without* remounting — this hook instance and its closures survive. Any
   * await that spans a channel switch checks this before touching state.
   */
  const epochRef = useRef(0)

  const absorb = useCallback((incoming: Message[]) => {
    setMessages((current) => mergeMessages(current, incoming))
  }, [])

  /** Dedupe by id — the load query and the subscription overlap by design. */
  const absorbAttachments = useCallback((incoming: Attachment[]) => {
    setAttachments((current) => {
      const byId = new Map(current.map((a) => [a.id, a]))
      let changed = false
      for (const a of incoming) {
        if (!byId.has(a.id)) changed = true
        byId.set(a.id, a)
      }
      return changed ? [...byId.values()] : current
    })
  }, [])

  /**
   * Reconciliation is its own effect, not a call inside the `setMessages`
   * updater. Nesting it there made that updater impure, and StrictMode's
   * double-invocation replayed it against the same merged list — which defeats
   * reconcilePending's one-to-one guarantee and silently swallowed the second
   * of two identical in-flight messages.
   *
   * Scoping is on both sides — see `reconcilePendingForChannel`. This effect
   * re-runs the instant `channelId` changes, while `messages` still holds the
   * *previous* channel's rows (the clear below cannot retroactively change the
   * value this closure captured), so filtering the rows is not belt-and-braces:
   * it is the only thing standing between a failed send and silent deletion.
   */
  useEffect(() => {
    if (!channelId) return
    setPending((current) => {
      const next = reconcilePendingForChannel(current, messages, channelId)
      return next.length === current.length ? current : next
    })
  }, [messages, channelId])

  // Load the first page, then subscribe. Re-runs on channel change.
  useEffect(() => {
    if (!channelId) return

    epochRef.current += 1
    let active = true
    setLoading(true)
    setError(null)
    setMessages([])
    setAttachments([])

    const q = pageQuery(channelId)
    let query = supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('channel_id', q.channelId)
      .order('id', { ascending: q.ascending })
      .limit(q.limit)
    if (q.beforeId !== null) query = query.lt('id', q.beforeId)

    void query.then(({ data, error: err }) => {
      if (!active) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      // Merge, never replace. The subscription below is already live by now and
      // may have committed a row newer than this snapshot; a wholesale
      // setMessages would drop it, and nothing would fetch it again until the
      // channel was reopened. No reversing needed either — mergeMessages sorts
      // by id, so the newest-first wire order lands correctly regardless.
      const rows = (data ?? []) as Message[]
      absorb(rows)
      setLoading(false)

      // Attachments for the page just loaded. A separate query rather than a
      // PostgREST embed, because owner_id is text and messages.id is bigint —
      // there is no FK for an embed to follow (SPEC §1.8, DECISIONS #2).
      if (rows.length > 0) {
        void supabase
          .from('attachments')
          .select(ATTACHMENT_COLUMNS)
          .eq('owner_type', 'message')
          .in(
            'owner_id',
            rows.map((m) => String(m.id)),
          )
          .then(({ data: att }) => {
            if (!active || !att) return
            absorbAttachments(att as Attachment[])
          })
      }
    })

    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (!active) return
          if (payload.eventType === 'DELETE') {
            // Belt and braces. The product's delete is soft (an UPDATE setting
            // deleted_at), and with the default replica identity a DELETE
            // payload carries only the primary key — which the channel_id
            // filter above cannot match — so this branch may never fire.
            const gone = (payload.old as { id?: number }).id
            if (typeof gone === 'number') {
              setMessages((current) => current.filter((m) => m.id !== gone))
            }
            return
          }
          absorb([payload.new as Message])
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attachments',
          filter: 'owner_type=eq.message',
        },
        (payload) => {
          if (!active) return
          // Not filterable by channel — attachments have no channel_id — so
          // every message attachment in the workspace arrives here and is
          // filtered on absorb. One event per upload, so the volume is trivial.
          absorbAttachments([payload.new as Attachment])
        },
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [channelId, absorb, absorbAttachments])

  /**
   * `threadRootId` is null for a top-level message. Callers must pass the value
   * `threadRootFor()` produced rather than the id of whatever was clicked —
   * that helper is what keeps threads one level deep (SPEC §1.3).
   */
  const send = useCallback(
    async (rawBody: string, threadRootId: number | null = null, file?: File | null) => {
      const body = rawBody.trim()
      // A file alone is a valid message; `body text not null` accepts ''.
      if ((!body && !file) || !channelId || !userId) return

      if (file) {
        const check = validateFile(file)
        if (!check.ok) {
          setError(check.error)
          return
        }
      }

      const epoch = epochRef.current
      const entry: PendingMessage = {
        key: crypto.randomUUID(),
        body,
        authorId: userId,
        channelId,
        threadRootId,
        sinceId: highestMessageId(messagesRef.current),
        status: 'sending',
        filename: file?.name ?? null,
      }
      setPending((p) => [...p, entry])
      setError(null)

      // Storage first. A failed upload must not leave a message behind claiming
      // an attachment that does not exist.
      let storagePath: string | null = null
      if (file) {
        const path = storagePathFor(channelId, file.name, crypto.randomUUID())
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || undefined })
        if (upErr) {
          setError(`Could not upload ${file.name}: ${upErr.message}`)
          setPending((p) => markPending(p, entry.key, 'failed'))
          return
        }
        storagePath = path
      }

      const { data, error: err } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          author_id: userId,
          body,
          thread_root_id: threadRootId,
        })
        .select(MESSAGE_COLUMNS)
        .single()

      if (err) {
        // Marked regardless of epoch: the entry is tagged with its channel, so
        // the failed bubble and its Retry are waiting when the user returns.
        setPending((p) => markPending(p, entry.key, 'failed'))
        // Don't let a failed send quietly consume the free tier's 1 GB.
        if (storagePath) void supabase.storage.from(BUCKET).remove([storagePath])
        return
      }

      const message = data as Message

      if (file && storagePath) {
        const { data: att, error: attErr } = await supabase
          .from('attachments')
          .insert({
            owner_type: 'message',
            owner_id: String(message.id),
            storage_path: storagePath,
            filename: file.name,
            mime: file.type || null,
            size_bytes: file.size,
          })
          .select(ATTACHMENT_COLUMNS)
          .single()

        if (attErr) {
          // The message is already sent and visible to everyone. Surface the
          // partial failure rather than pretending the file arrived.
          setError(`${file.name} was uploaded but could not be attached.`)
        } else if (epochRef.current === epoch) {
          absorbAttachments([att as Attachment])
        }
      }

      // A *successful* row must not be merged into whatever channel is open
      // now — that would render a #general message inside #random.
      if (epochRef.current !== epoch) return
      absorb([message])
    },
    [channelId, userId, absorb, absorbAttachments],
  )

  const retry = useCallback(
    async (key: string) => {
      const entry = pending.find((p) => p.key === key)
      if (!entry) return
      setPending((p) => dropPending(p, key))
      await send(entry.body, entry.threadRootId)
    },
    [pending, send],
  )

  const discard = useCallback((key: string) => {
    setPending((p) => dropPending(p, key))
  }, [])

  const visiblePending = useMemo(
    () => pending.filter((p) => p.channelId === channelId),
    [pending, channelId],
  )

  // Keyed by message id as text, because attachments.owner_id is text (§2.1).
  const attachmentsByMessage = useMemo(
    () => attachmentsByOwner(attachments, 'message'),
    [attachments],
  )

  return {
    messages,
    attachmentsByMessage,
    pending: visiblePending,
    loading,
    error,
    send,
    retry,
    discard,
  }
}
