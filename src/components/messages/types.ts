import type { Attachment } from '@/lib/attachments'
import type { Message } from '@/lib/useMessages'

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
  onCreateTask: (message: Message) => void
  /**
   * App path for this exact message (`/channels/<id>?m=` or `/posts/<id>?m=`)
   * — the hover bar's Copy link, and the URL shape a doc page's link
   * extraction recognizes (P4).
   */
  linkFor: (message: Message) => string
  deleteAttachment: (attachment: Attachment) => Promise<void>
  editMessage: (id: number, body: string) => Promise<void>
}
