import { PaperclipIcon, XIcon } from 'lucide-react'

import type { PreviewItem } from '@/components/messages/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatBytes,
  isImage,
  isPlayable,
  isVideo,
  type Attachment,
} from '@/lib/attachments'
import { cn } from '@/lib/utils'

/** Images inline, everything else a chip. The URL is null until it is signed. */
export function AttachmentView({
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
export function Preview({
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
