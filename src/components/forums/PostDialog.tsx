import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parseTagInput } from '@/lib/posts'

export interface PostFields {
  title: string
  body: string
  tagNames: string[]
}

/**
 * Create/edit form for a forum post. The body is a plain textarea writing
 * BlockNote-shaped paragraphs at the submit boundary (DECISIONS #23) — the
 * real editor arrives in P4 against the same column. Tags are one
 * comma-separated input rather than a chip editor: `parseTagInput` normalizes
 * and dedupes on submit, and Non-negotiable 10 timeboxes anything fancier.
 */
export function PostDialog({
  open,
  title,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  submitLabel: string
  initial: Partial<PostFields>
  onClose: () => void
  onSubmit: (fields: PostFields) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {/* Mounted only while open, so a reopened dialog starts from
            `initial` instead of whatever the last edit left in state. */}
        {open && (
          <PostForm
            title={title}
            submitLabel={submitLabel}
            initial={initial}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PostForm({
  title,
  submitLabel,
  initial,
  onClose,
  onSubmit,
}: {
  title: string
  submitLabel: string
  initial: Partial<PostFields>
  onClose: () => void
  onSubmit: (fields: PostFields) => Promise<void>
}) {
  const [postTitle, setPostTitle] = useState(initial.title ?? '')
  const [body, setBody] = useState(initial.body ?? '')
  const [tags, setTags] = useState((initial.tagNames ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const trimmed = postTitle.trim()
    if (!trimmed) {
      setError('A post needs a title.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ title: trimmed, body, tagNames: parseTagInput(tags) })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the post.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="post-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="post-title"
          value={postTitle}
          onChange={(e) => setPostTitle(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="post-body" className="text-sm font-medium">
          Body <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="post-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring/50 field-sizing-content max-h-80 min-h-24 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="post-tags" className="text-sm font-medium">
          Tags <span className="text-muted-foreground font-normal">(comma-separated)</span>
        </label>
        <Input
          id="post-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="bug, design"
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
