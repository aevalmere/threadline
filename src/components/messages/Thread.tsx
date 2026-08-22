import { useState } from 'react'

import { Composer } from '@/components/messages/Composer'
import { MessageGroupRow } from '@/components/messages/MessageGroup'
import { PendingRow } from '@/components/messages/PendingRow'
import type { MessageActions, PreviewItem } from '@/components/messages/types'
import type { Attachment } from '@/lib/attachments'
import { groupMessages } from '@/lib/grouping'
import { useProfiles } from '@/lib/profiles-context'
import type { PendingMessage } from '@/lib/pending'
import { threadRootFor } from '@/lib/threads'
import type { Message } from '@/lib/useMessages'

/**
 * A message's replies, collapsed behind a count until opened. Inline rather
 * than a side panel: it costs no new route or layout, and it works on a phone.
 */
export function Thread({
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
  const { nameFor, avatarUrlFor } = useProfiles()

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
          avatarUrl={avatarUrlFor(group.authorId)}
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
          avatarUrl={avatarUrlFor(p.authorId)}
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
