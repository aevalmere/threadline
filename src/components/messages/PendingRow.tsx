import { PaperclipIcon } from 'lucide-react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import type { PendingMessage } from '@/lib/pending'
import { cn } from '@/lib/utils'

export function PendingRow({
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
