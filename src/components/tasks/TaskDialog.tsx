/**
 * The one task form — create, create-from-message, and edit share it so the
 * fields cannot drift (SPEC §1.6). Controlled from the parent like every
 * dialog in this app; the parent owns what "save" means and this component
 * owns the fields, the busy latch, and the error line.
 *
 * Due date is a native `<input type="date">` and assignee a native `<select>`
 * — the ui/ kit has no calendar or select on purpose, and inventing one is
 * exactly the polish Non-negotiable 10 timeboxes away.
 */

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useProfiles } from '@/lib/profiles-context'
import { STATUS_LABELS, TASK_STATUSES, type TaskFields } from '@/lib/tasks'
import { cn } from '@/lib/utils'

/**
 * Where a task came from, resolved by the parent for the jump chip. Three
 * shapes because a source message lives in exactly one of two places (SPEC
 * §1.3): a chat channel, or — as a comment — under a forum post.
 */
export type TaskSource =
  | { kind: 'message'; channelId: string; channelName: string; messageId: number }
  | { kind: 'comment'; postId: string; forumName: string; messageId: number }
  | { kind: 'post'; postId: string; forumName: string }

export function TaskDialog({
  open,
  title,
  submitLabel,
  initial,
  source,
  fieldsLocked = false,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean
  title: string
  submitLabel: string
  initial: Partial<TaskFields>
  /** Rendered as the "from #channel" chip when the task has a source. */
  source?: TaskSource | null
  /**
   * True when the viewer is not the task's creator: the detail fields and
   * Delete are the creator's, but status stays live for everyone — moving
   * work across the board is the team's, and these buttons are the keyboard
   * path a drag cannot cover. UI-level only, deliberately: the database
   * stays one trusted workspace (Non-negotiable 2).
   */
  fieldsLocked?: boolean
  onClose: () => void
  onSubmit: (fields: TaskFields) => Promise<void>
  /** Present only in edit mode. */
  onDelete?: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {/* Mounted only while open, so a reopened dialog starts from
            `initial` instead of whatever the last edit left in state. */}
        {open && (
          <TaskForm
            title={title}
            submitLabel={submitLabel}
            initial={initial}
            source={source}
            fieldsLocked={fieldsLocked}
            onClose={onClose}
            onSubmit={onSubmit}
            onDelete={fieldsLocked ? undefined : onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The "from #channel" chip that jumps to a task's source message or post. */
export function SourceChip({ source }: { source: TaskSource }) {
  return (
    <Link
      to={
        source.kind === 'message'
          ? `/channels/${source.channelId}?m=${source.messageId}`
          : source.kind === 'comment'
            ? `/posts/${source.postId}?m=${source.messageId}`
            : `/posts/${source.postId}`
      }
      className="bg-muted text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      from #{source.kind === 'message' ? source.channelName : source.forumName}
    </Link>
  )
}

function TaskForm({
  title,
  submitLabel,
  initial,
  source,
  fieldsLocked = false,
  onClose,
  onSubmit,
  onDelete,
}: {
  title: string
  submitLabel: string
  initial: Partial<TaskFields>
  source?: TaskSource | null
  fieldsLocked?: boolean
  onClose: () => void
  onSubmit: (fields: TaskFields) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { byId, loading: profilesLoading } = useProfiles()
  const [fields, setFields] = useState<TaskFields>({
    title: initial.title ?? '',
    status: initial.status ?? 'todo',
    assigneeId: initial.assigneeId ?? null,
    dueDate: initial.dueDate ?? null,
    description: initial.description ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const set = <K extends keyof TaskFields>(key: K, value: TaskFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (fields.title.trim() === '') {
      setError('Title is required.')
      return
    }
    // The busy latch is also the double-submit guard: a second click while
    // the insert is in flight must not write a second task.
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ ...fields, title: fields.title.trim() })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the task.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!onDelete) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the task.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {source && (
        <div>
          <SourceChip source={source} />
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="task-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="task-title"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          disabled={fieldsLocked}
          autoFocus={!fieldsLocked}
        />
      </div>

      <div className="space-y-2">
        <span id="task-status-label" className="text-sm font-medium">
          Status
        </span>
        {/* This is the non-drag path across columns, so the selection must be
            programmatic state, not just a variant swap. */}
        <div role="group" aria-labelledby="task-status-label" className="flex gap-2">
          {TASK_STATUSES.map((s) => (
            <Button
              key={s}
              type="button"
              variant={fields.status === s ? 'default' : 'outline'}
              size="sm"
              aria-pressed={fields.status === s}
              onClick={() => set('status', s)}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label htmlFor="task-assignee" className="text-sm font-medium">
            Assignee
          </label>
          <select
            id="task-assignee"
            value={fields.assigneeId ?? ''}
            onChange={(e) => set('assigneeId', e.target.value === '' ? null : e.target.value)}
            disabled={profilesLoading || fieldsLocked}
            className={cn(
              'border-input bg-transparent h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs',
              'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
            )}
          >
            <option value="">Unassigned</option>
            {[...byId.values()].map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="task-due" className="text-sm font-medium">
            Due <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <Input
            id="task-due"
            type="date"
            value={fields.dueDate ?? ''}
            onChange={(e) => set('dueDate', e.target.value === '' ? null : e.target.value)}
            disabled={fieldsLocked}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="task-description" className="text-sm font-medium">
          Description <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="task-description"
          value={fields.description}
          onChange={(e) => set('description', e.target.value)}
          disabled={fieldsLocked}
          rows={3}
          className={cn(
            'border-input placeholder:text-muted-foreground w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs',
            'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
          )}
        />
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onDelete && (
          <Button
            type="button"
            variant={confirmingDelete ? 'destructive' : 'ghost'}
            className={cn(!confirmingDelete && 'text-destructive')}
            disabled={busy}
            onClick={() => void remove()}
          >
            {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </Button>
        )}
        <div className="flex-1" />
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
