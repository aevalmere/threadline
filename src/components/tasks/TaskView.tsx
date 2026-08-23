/**
 * The task read view — what a click on a card opens (beta round 3).
 *
 * Until this existed, clicking a card dropped you straight into the edit
 * form: every field a text input, before you had said you wanted to change
 * anything. Ethan's report was that the board felt "janky and sloppy", and
 * this is the half of the fix that is not about drag mechanics — a card opens
 * something you read, and editing is a button you press.
 *
 * Status stays live here for everyone, exactly as it is in the form: moving
 * work across the board is the team's, and these buttons are the keyboard
 * path a drag cannot cover. The detail fields and Delete stay the creator's
 * (UI-level only — the database is one trusted workspace, Non-negotiable 2).
 */

import { useState } from 'react'

import { LinkedItems } from '@/components/LinkedItems'
import { SourceChip, type TaskSource } from '@/components/tasks/TaskDialog'
import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useProfiles } from '@/lib/profiles-context'
import { plainFromRich } from '@/lib/rich'
import { STATUS_LABELS, TASK_STATUSES, isOverdue, type Task, type TaskStatus } from '@/lib/tasks'
import { cn } from '@/lib/utils'

export function TaskView({
  open,
  task,
  source,
  today,
  canEdit,
  onStatus,
  onEdit,
  onDelete,
  onClose,
}: {
  open: boolean
  task: Task | null
  source: TaskSource | null
  today: string
  /** False for a task someone else created — see the file header. */
  canEdit: boolean
  onStatus: (status: TaskStatus) => Promise<void>
  onEdit: () => void
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {/* Mounted only while open, so the confirm latch below never survives
            into the next task you open. */}
        {open && task && (
          <TaskBody
            task={task}
            source={source}
            today={today}
            canEdit={canEdit}
            onStatus={onStatus}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TaskBody({
  task,
  source,
  today,
  canEdit,
  onStatus,
  onEdit,
  onDelete,
}: {
  task: Task
  source: TaskSource | null
  today: string
  canEdit: boolean
  onStatus: (status: TaskStatus) => Promise<void>
  onEdit: () => void
  onDelete: () => Promise<void>
}) {
  const { nameFor, avatarUrlFor } = useProfiles()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const description = plainFromRich(task.description_rich)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="text-base leading-snug break-words">{task.title}</DialogTitle>
      </DialogHeader>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span>{STATUS_LABELS[task.status]}</span>
        {task.assignee_id && (
          <span className="inline-flex items-center gap-1.5">
            <AuthorAvatar
              name={nameFor(task.assignee_id)}
              url={avatarUrlFor(task.assignee_id)}
              className="size-5"
            />
            {nameFor(task.assignee_id)}
          </span>
        )}
        {task.due_date && (
          <span className={cn(isOverdue(task, today) && 'text-destructive font-medium')}>
            due {task.due_date}
          </span>
        )}
        {source && <SourceChip source={source} />}
      </div>

      {description === '' ? (
        <p className="text-muted-foreground text-sm italic">No description.</p>
      ) : (
        <p className="text-sm break-words whitespace-pre-wrap">{description}</p>
      )}

      <LinkedItems targetType="task" targetId={task.id} />

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Status
        </p>
        <div className="flex flex-wrap gap-1">
          {TASK_STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={task.status === s ? 'secondary' : 'ghost'}
              aria-pressed={task.status === s}
              disabled={busy || task.status === s}
              onClick={() => void run(() => onStatus(s))}
            >
              {STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void run(onDelete)}
              >
                Confirm delete
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
              <Button size="sm" onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
