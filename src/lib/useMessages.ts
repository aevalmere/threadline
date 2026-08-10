import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  attachmentsByOwner,
  storagePathFor,
  validateFile,
  type Attachment,
} from '@/lib/attachments'
import { parseMentions } from '@/lib/mentions'
import { highestMessageId, mergeMessages, pageQuery } from '@/lib/messages'
import {
  dropPending,
  markPending,
  reconcilePendingForChannel,
  type PendingMessage,
} from '@/lib/pending'
import { useProfiles } from '@/lib/profiles-context'
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
  const { authorId: userId } = useAuth()
  const { byId: profilesById } = useProfiles()

  const [messages, setMessages] = useState<Message[]>([])
  /**
   * Which channel the rows in `messages` actually belong to.
   *
   * Not the same as `channelId`. `/channels/:channelId` renders the same
   * element for every id, so a channel switch re-renders without remounting and
   * there is a window where `channelId` is already the new channel while
   * `messages` still holds the old one's rows. Anything deciding "is the thing
   * I am looking for absent, or merely not here yet" has to ask this instead —
   * see `resolveJump`.
   */
  const [loadedChannelId, setLoadedChannelId] = useState<string | undefined>()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read inside send() without making it a dependency — re-creating send on
  // every arriving message would churn the composer's handlers.
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  // Same reason: deleteMessage needs the current attachments without being
  // re-created every time one arrives.
  const attachmentsRef = useRef<Attachment[]>([])
  attachmentsRef.current = attachments
  // And again: send() resolves @mentions against the profile list, but putting
  // it in the dependency array would re-create send the moment profiles load
  // and churn every composer handler.
  const profilesRef = useRef(profilesById)
  profilesRef.current = profilesById

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
    setLoadedChannelId(undefined)
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
      setLoadedChannelId(channelId)
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
   * Write the bell rows for a message that just landed — SPEC §1.9.
   *
   * Client-side rather than a trigger, because a trigger would have to re-parse
   * @names in SQL against `profiles`: the same rule in a second language, kept
   * in sync by hope. DECISIONS #15.
   *
   * Never notifies you about your own message, in either kind. Mentioning
   * yourself is a normal thing to do while writing, and replying in your own
   * thread should not ring your own bell.
   */
  const notify = useCallback(
    async (message: Message, threadRootId: number | null) => {
      if (!userId) return

      const profiles = [...profilesRef.current.values()]
      const rows: {
        user_id: string
        kind: 'mention' | 'reply'
        actor_id: string
        entity_type: string
        entity_id: string
      }[] = []
      const claimed = new Set<string>([userId])

      for (const id of parseMentions(message.body, profiles)) {
        if (claimed.has(id)) continue
        claimed.add(id)
        rows.push({
          user_id: id,
          kind: 'mention',
          actor_id: userId,
          entity_type: 'message',
          entity_id: String(message.id),
        })
      }

      // A reply notifies whoever started the thread — but only if they were not
      // already mentioned in the same message, or they would get two bells for
      // one event.
      //
      // The root is looked up in the loaded page. If it is not there the reply
      // notification is silently skipped: unreachable from the composer, since
      // a root must be rendered to be repliable, but reachable if the channel
      // is switched while the INSERT is in flight — the load effect has
      // already cleared `messages` by then. Losing one bell in that window is
      // better than a query on every reply; mentions are unaffected either way.
      if (threadRootId !== null) {
        const root = messagesRef.current.find((m) => m.id === threadRootId)
        if (root && !claimed.has(root.author_id)) {
          rows.push({
            user_id: root.author_id,
            kind: 'reply',
            actor_id: userId,
            entity_type: 'message',
            entity_id: String(message.id),
          })
        }
      }

      if (rows.length === 0) return

      const { error: err } = await supabase.from('notifications').insert(rows)
      // Surfaced rather than swallowed: the message is sent either way, and a
      // silently missing notification is the kind of thing nobody reports and
      // everybody works around. Same shape as the attachment partial failure.
      if (err) setError('Sent, but could not notify everyone mentioned.')
    },
    [userId],
  )

  /**
   * `threadRootId` is null for a top-level message. Callers must pass the value
   * `threadRootFor()` produced rather than the id of whatever was clicked —
   * that helper is what keeps threads one level deep (SPEC §1.3).
   */
  const send = useCallback(
    async (rawBody: string, threadRootId: number | null = null, files: File[] = []) => {
      const body = rawBody.trim()
      // Files alone are a valid message; `body text not null` accepts ''.
      if ((!body && files.length === 0) || !channelId || !userId) return

      for (const file of files) {
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
        filename: files.map((f) => f.name).join(', ') || null,
      }
      setPending((p) => [...p, entry])
      setError(null)

      // Storage first. A failed upload must not leave a message behind claiming
      // attachments that do not exist.
      const uploaded: { path: string; file: File }[] = []
      for (const file of files) {
        const path = storagePathFor(channelId, file.name, crypto.randomUUID())
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || undefined })
        if (upErr) {
          setError(`Could not upload ${file.name}: ${upErr.message}`)
          setPending((p) => markPending(p, entry.key, 'failed'))
          // Roll back whatever already landed, so a half-failed send does not
          // quietly consume the free tier's 1 GB.
          if (uploaded.length > 0) {
            void supabase.storage.from(BUCKET).remove(uploaded.map((u) => u.path))
          }
          return
        }
        uploaded.push({ path, file })
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
        if (uploaded.length > 0) {
          void supabase.storage.from(BUCKET).remove(uploaded.map((u) => u.path))
        }
        return
      }

      const message = data as Message

      if (uploaded.length > 0) {
        const { data: att, error: attErr } = await supabase
          .from('attachments')
          .insert(
            uploaded.map((u) => ({
              owner_type: 'message',
              owner_id: String(message.id),
              storage_path: u.path,
              filename: u.file.name,
              mime: u.file.type || null,
              size_bytes: u.file.size,
            })),
          )
          .select(ATTACHMENT_COLUMNS)

        if (attErr) {
          // The message is already sent and visible to everyone. Surface the
          // partial failure rather than pretending the files arrived.
          setError('Uploaded, but could not be attached to the message.')
        } else if (epochRef.current === epoch) {
          absorbAttachments((att ?? []) as Attachment[])
        }
      }

      // Notifications are written last, and deliberately not awaited into the
      // send path's success: the message is already delivered, and a failure
      // here must not make a sent message look unsent.
      void notify(message, threadRootId)

      // A *successful* row must not be merged into whatever channel is open
      // now — that would render a #general message inside #random.
      if (epochRef.current !== epoch) return
      absorb([message])
    },
    [channelId, userId, absorb, absorbAttachments, notify],
  )

  /**
   * Delete a message: scrub the content, keep a tombstone.
   *
   * Ethan's call, and it is the right shape. The row stays so replies keep
   * their root and the change reaches everyone as a normal UPDATE — a hard
   * delete would arrive as a DELETE payload carrying only the primary key,
   * which the channel filter cannot match, so other clients would keep showing
   * it until they reloaded. But the *content* genuinely goes: the body is
   * blanked and every attached file is removed from storage, so a deleted
   * message stops costing anything against the 1 GB.
   */
  const deleteMessage = useCallback(
    async (id: number) => {
      const owned = attachmentsRef.current.filter(
        (a) => a.owner_type === 'message' && a.owner_id === String(id),
      )

      if (owned.length > 0) {
        const { error: rmErr } = await supabase.storage
          .from(BUCKET)
          .remove(owned.map((a) => a.storage_path))
        if (rmErr) {
          setError(`Could not delete the attached file: ${rmErr.message}`)
          return
        }
        const { error: rowErr } = await supabase
          .from('attachments')
          .delete()
          .in(
            'id',
            owned.map((a) => a.id),
          )
        if (rowErr) {
          setError(`Could not delete the attachment: ${rowErr.message}`)
          return
        }
      }

      const { error: err } = await supabase
        .from('messages')
        .update({ body: '', deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (err) {
        setError(`Could not delete the message: ${err.message}`)
        return
      }

      setAttachments((current) =>
        current.filter((a) => !(a.owner_type === 'message' && a.owner_id === String(id))),
      )
      // The realtime UPDATE will also arrive; absorbing locally just avoids the
      // round-trip delay for the person who clicked.
      setMessages((current) =>
        current.map((m) =>
          m.id === id ? { ...m, body: '', deleted_at: new Date().toISOString() } : m,
        ),
      )
    },
    [],
  )

  /**
   * Edit a message's text — SPEC §1.3, which specifies `edited_at` and rules
   * out edit history as a non-goal, so the previous body is simply overwritten.
   *
   * Refuses an empty body: clearing the text is what *delete* does, and it
   * leaves a message that reads as deleted without being marked so.
   */
  const editMessage = useCallback(async (id: number, rawBody: string) => {
    const body = rawBody.trim()
    if (!body) return

    const editedAt = new Date().toISOString()
    const { error: err } = await supabase
      .from('messages')
      .update({ body, edited_at: editedAt })
      .eq('id', id)
    if (err) {
      setError(`Could not save the edit: ${err.message}`)
      return
    }

    // The realtime UPDATE arrives too; this just skips the round trip for the
    // person who typed it.
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, body, edited_at: editedAt } : m)),
    )
  }, [])

  /** Remove one file from a message that keeps its text. */
  const deleteAttachment = useCallback(async (attachment: Attachment) => {
    const { error: rmErr } = await supabase.storage
      .from(BUCKET)
      .remove([attachment.storage_path])
    if (rmErr) {
      setError(`Could not delete the file: ${rmErr.message}`)
      return
    }
    const { error: rowErr } = await supabase
      .from('attachments')
      .delete()
      .eq('id', attachment.id)
    if (rowErr) {
      setError(`Could not delete the attachment: ${rowErr.message}`)
      return
    }
    setAttachments((current) => current.filter((a) => a.id !== attachment.id))
  }, [])

  const retry = useCallback(
    async (key: string) => {
      const entry = pending.find((p) => p.key === key)
      if (!entry) return
      // The File objects were never retained, so a files-only send has nothing
      // to retry. Dropping the entry and calling send('') would hit its
      // empty-input guard and the bubble would vanish with nothing sent — keep
      // it, and say why.
      if (!entry.body) {
        setError(
          `${entry.filename ?? 'That file'} was not sent. Attach it again to retry.`,
        )
        return
      }
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
    loadedChannelId,
    attachmentsByMessage,
    pending: visiblePending,
    loading,
    error,
    send,
    retry,
    discard,
    deleteMessage,
    deleteAttachment,
    editMessage,
    dismissError: useCallback(() => setError(null), []),
  }
}
