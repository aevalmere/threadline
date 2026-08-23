/**
 * /tasks — the kanban board and My Tasks — SPEC §1.6.
 *
 * Drag model: a card's **grip** is draggable; every card and every column body
 * is a drop target. Dropping on a card takes its place (positionBetween that
 * card and the one above it); dropping on a column appends. One card gets one
 * new position per drop — the column is never rewritten (SPEC §1.6).
 *
 * Clicking a card opens the read view, not the form (beta round 3): the drag
 * surface and the click target are different elements now, which is what
 * stopped the board feeling janky. The keyboard/touch path across columns is
 * that view's status buttons.
 *
 * No realtime (SPEC §4): the list loads on mount and converges by refetch
 * when a write fails. At 5–30 users, that is the design.
 */

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { GripVerticalIcon, PlusIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { SourceChip, TaskDialog, type TaskSource } from '@/components/tasks/TaskDialog'
import { TaskView } from '@/components/tasks/TaskView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'
import { useProfiles } from '@/lib/profiles-context'
import { plainFromRich, richFromPlain } from '@/lib/rich'
import { supabase } from '@/lib/supabase'
import {
  STATUS_LABELS,
  TASK_STATUSES,
  appendPosition,
  fieldsFromTask,
  groupByStatus,
  isOverdue,
  myTasks,
  patchFromFields,
  positionBetween,
  statusPatch,
  type Task,
  type TaskFields,
  type TaskStatus,
} from '@/lib/tasks'
import { useTasks } from '@/lib/useTasks'
import { cn } from '@/lib/utils'

type View = 'board' | 'mine'

type DialogState =
  | { mode: 'create' }
  /**
   * What a card click opens now: read first, edit on request. Held by id
   * rather than by value because the read view shows live status — it has to
   * re-resolve from `tasks` after a status button writes, not render the
   * snapshot taken when the card was clicked.
   */
  | { mode: 'view'; taskId: string }
  | { mode: 'edit'; task: Task }
  | null

export default function Tasks() {
  const { tasks, error, refresh, createTask, updateTask, deleteTask, moveTask } = useTasks()
  const { authorId } = useAuth()
  const { channels } = useChannels()
  const [view, setView] = useState<View>('board')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dragging, setDragging] = useState<Task | null>(null)

  /**
   * `?t=<taskId>` — where a doc page's task link lands (P4). Consumed once
   * the list is loaded: hit opens the dialog, miss (deleted task, stale link)
   * just clears the parameter and leaves the board.
   */
  const [params, setParams] = useSearchParams()
  const jumpToTask = params.get('t')
  useEffect(() => {
    if (jumpToTask === null || tasks === null) return
    const task = tasks.find((t) => t.id === jumpToTask)
    if (task !== undefined) setDialog({ mode: 'view', taskId: task.id })
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('t')
      return next
    }, { replace: true })
  }, [jumpToTask, tasks, setParams])

  const grouped = useMemo(() => groupByStatus(tasks ?? []), [tasks])
  /** Re-resolved every render so the read view's status is never a snapshot. */
  const viewTask =
    dialog?.mode === 'view' ? ((tasks ?? []).find((t) => t.id === dialog.taskId) ?? null) : null
  const mine = useMemo(() => myTasks(tasks ?? [], authorId), [tasks, authorId])
  // The LOCAL calendar date. due_date comes from a native date input, which
  // holds the user's local date — comparing it against the UTC day
  // (toISOString) would flag a task overdue at 5pm PDT on its own due date.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  /**
   * Source resolution for the "from #channel" chips, one batched read per
   * table per task-list change. A source *message* carries exactly one parent
   * (SPEC §1.3): a channel — the chat case — or a post, when the task was
   * created from a forum comment; the comment case chains through `posts` for
   * its forum, which is why the posts fetch is keyed on both the tasks' own
   * source_post_ids and whatever the messages fetch surfaced. Chip names
   * resolve through the channels context; a source whose message or post is
   * gone simply renders no chip.
   */
  const [sourceParentByMessage, setSourceParentByMessage] = useState<
    Map<number, { channelId: string | null; postId: string | null }>
  >(new Map())
  const [sourceChannelByPost, setSourceChannelByPost] = useState<Map<string, string>>(
    new Map(),
  )
  const sourceIdsKey = useMemo(
    () =>
      (tasks ?? [])
        .map((t) => t.source_message_id)
        .filter((id): id is number => id !== null)
        .sort((a, b) => a - b)
        .join(','),
    [tasks],
  )
  const sourcePostIdsKey = useMemo(() => {
    const ids = new Set<string>()
    for (const t of tasks ?? []) {
      if (t.source_post_id !== null) ids.add(t.source_post_id)
    }
    for (const src of sourceParentByMessage.values()) {
      if (src.postId !== null) ids.add(src.postId)
    }
    return [...ids].sort().join(',')
  }, [tasks, sourceParentByMessage])
  useEffect(() => {
    if (sourceIdsKey === '') {
      setSourceParentByMessage(new Map())
      return
    }
    let cancelled = false
    void supabase
      .from('messages')
      .select('id,channel_id,post_id')
      .in('id', sourceIdsKey.split(',').map(Number))
      .then(({ data }) => {
        if (cancelled || !data) return
        setSourceParentByMessage(
          new Map(
            (data as { id: number; channel_id: string | null; post_id: string | null }[]).map(
              (m) => [m.id, { channelId: m.channel_id, postId: m.post_id }],
            ),
          ),
        )
      })
    return () => {
      cancelled = true
    }
  }, [sourceIdsKey])
  useEffect(() => {
    if (sourcePostIdsKey === '') {
      setSourceChannelByPost(new Map())
      return
    }
    let cancelled = false
    void supabase
      .from('posts')
      .select('id,channel_id')
      .in('id', sourcePostIdsKey.split(','))
      .then(({ data }) => {
        if (cancelled || !data) return
        setSourceChannelByPost(
          new Map(
            (data as { id: string; channel_id: string }[]).map((p) => [p.id, p.channel_id]),
          ),
        )
      })
    return () => {
      cancelled = true
    }
  }, [sourcePostIdsKey])

  const forumNameFor = (postId: string): string | null => {
    const channelId = sourceChannelByPost.get(postId)
    if (!channelId) return null
    return channels?.find((c) => c.id === channelId)?.name ?? null
  }

  const sourceFor = (task: Task): TaskSource | null => {
    if (task.source_message_id !== null) {
      const src = sourceParentByMessage.get(task.source_message_id)
      if (!src) return null
      if (src.channelId !== null) {
        const name = channels?.find((c) => c.id === src.channelId)?.name
        if (!name) return null
        return {
          kind: 'message',
          channelId: src.channelId,
          channelName: name,
          messageId: task.source_message_id,
        }
      }
      if (src.postId !== null) {
        const name = forumNameFor(src.postId)
        if (!name) return null
        return {
          kind: 'comment',
          postId: src.postId,
          forumName: name,
          messageId: task.source_message_id,
        }
      }
      return null
    }
    if (task.source_post_id !== null) {
      const name = forumNameFor(task.source_post_id)
      if (!name) return null
      return { kind: 'post', postId: task.source_post_id, forumName: name }
    }
    return null
  }

  // A click opens the dialog; a drag starts only after 6px of travel, so the
  // two do not fight over the same pointer.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function onDragStart(e: DragStartEvent) {
    const task = (tasks ?? []).find((t) => t.id === e.active.id)
    setDragging(task ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    const active = dragging
    setDragging(null)
    if (!active || !e.over) return
    const over = String(e.over.id)

    let status: TaskStatus
    let position: number
    if (over.startsWith('col:')) {
      status = over.slice(4) as TaskStatus
      const column = grouped[status].filter((t) => t.id !== active.id)
      if (column.length === 0 && active.status === status) return
      position = appendPosition(column)
    } else {
      const target = (tasks ?? []).find((t) => t.id === over)
      if (!target || target.id === active.id) return
      status = target.status
      const column = grouped[status].filter((t) => t.id !== active.id)
      const index = column.findIndex((t) => t.id === target.id)
      const prev = index > 0 ? column[index - 1] : null
      position = positionBetween(prev?.position ?? null, target.position)
    }

    const patch =
      active.status === status
        ? { position }
        : { position, ...statusPatch(status, new Date().toISOString()) }
    void moveTask(active.id, patch)
  }

  async function create(fields: TaskFields) {
    if (authorId === null) throw new Error('Not signed in.')
    await createTask({
      title: fields.title,
      description_rich: richFromPlain(fields.description),
      status: fields.status,
      assignee_id: fields.assigneeId,
      due_date: fields.dueDate,
      position: appendPosition(grouped[fields.status]),
      source_message_id: null,
      source_post_id: null,
      created_by: authorId,
    })
  }

  /**
   * The read view's status buttons. Same write the edit form makes for a
   * status change — including the append position, because the task is
   * arriving in a column it is not currently in.
   */
  async function changeStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return
    await updateTask(task.id, {
      ...statusPatch(status, new Date().toISOString()),
      position: appendPosition(grouped[status]),
    })
  }

  async function edit(task: Task, fields: TaskFields) {
    // The append position is only written when the status actually changed
    // (patchFromFields) — the destination column never contains the task then.
    await updateTask(
      task.id,
      patchFromFields(
        fields,
        task.status,
        new Date().toISOString(),
        appendPosition(grouped[fields.status]),
      ),
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="ml-2 flex gap-1">
          {(['board', 'mine'] as const).map((v) => (
            <Button
              key={v}
              variant={view === v ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'board' ? 'Board' : 'My tasks'}
            </Button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon /> New task
        </Button>
      </header>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}{' '}
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </p>
      )}

      {tasks === null ? (
        <BoardSkeleton />
      ) : view === 'board' ? (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
            {TASK_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={grouped[status]}
                today={today}
                sourceFor={sourceFor}
                onOpen={(task) => setDialog({ mode: 'view', taskId: task.id })}
              />
            ))}
          </div>
          <DragOverlay>
            {dragging && (
              <TaskCard task={dragging} today={today} source={null} overlay />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <MyTasksList
          tasks={mine}
          today={today}
          sourceFor={sourceFor}
          onOpen={(task) => setDialog({ mode: 'view', taskId: task.id })}
        />
      )}

      <TaskView
        open={viewTask !== null}
        task={viewTask}
        source={viewTask ? sourceFor(viewTask) : null}
        today={today}
        canEdit={
          viewTask !== null &&
          (viewTask.created_by === null || viewTask.created_by === authorId)
        }
        onStatus={(status) => (viewTask ? changeStatus(viewTask, status) : Promise.resolve())}
        onEdit={() => viewTask && setDialog({ mode: 'edit', task: viewTask })}
        onDelete={async () => {
          if (!viewTask) return
          await deleteTask(viewTask.id)
          setDialog(null)
        }}
        onClose={() => setDialog(null)}
      />

      <TaskDialog
        open={dialog?.mode === 'create'}
        title="New task"
        submitLabel="Create task"
        initial={{}}
        onClose={() => setDialog(null)}
        onSubmit={create}
      />
      {/* Detail fields and Delete belong to the creator; status stays open to
          the whole team (the buttons are the keyboard path across columns).
          A task whose creator's account is gone (created_by null) is
          editable by everyone — the alternative is a task nobody can touch. */}
      <TaskDialog
        open={dialog?.mode === 'edit'}
        title={
          dialog?.mode === 'edit' &&
          dialog.task.created_by !== null &&
          dialog.task.created_by !== authorId
            ? 'Task'
            : 'Edit task'
        }
        submitLabel="Save"
        initial={dialog?.mode === 'edit' ? fieldsFromTask(dialog.task) : {}}
        source={dialog?.mode === 'edit' ? sourceFor(dialog.task) : null}
        taskId={dialog?.mode === 'edit' ? dialog.task.id : undefined}
        fieldsLocked={
          dialog?.mode === 'edit' &&
          dialog.task.created_by !== null &&
          dialog.task.created_by !== authorId
        }
        onClose={() => setDialog(null)}
        onSubmit={(fields) => (dialog?.mode === 'edit' ? edit(dialog.task, fields) : Promise.resolve())}
        onDelete={dialog?.mode === 'edit' ? () => deleteTask(dialog.task.id) : undefined}
      />
    </div>
  )
}

function Column({
  status,
  tasks,
  today,
  sourceFor,
  onOpen,
}: {
  status: TaskStatus
  tasks: Task[]
  today: string
  sourceFor: (task: Task) => TaskSource | null
  onOpen: (task: Task) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  return (
    <section
      className={cn(
        'bg-muted/50 flex w-72 shrink-0 flex-col rounded-lg',
        isOver && 'ring-ring/50 ring-2',
      )}
      aria-label={STATUS_LABELS[status]}
    >
      <h2 className="text-muted-foreground flex items-baseline gap-2 px-3 pt-3 pb-1 text-sm font-medium">
        {STATUS_LABELS[status]}
        <span className="text-xs font-normal">{tasks.length}</span>
      </h2>
      <div ref={setNodeRef} className="min-h-16 flex-1 space-y-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            today={today}
            source={sourceFor(task)}
            onOpen={() => onOpen(task)}
          />
        ))}
        {tasks.length === 0 && (
          <p className="text-muted-foreground px-1 py-2 text-xs">No tasks</p>
        )}
      </div>
    </section>
  )
}

function DraggableCard({
  task,
  today,
  source,
  onOpen,
}: {
  task: Task
  today: string
  source: TaskSource | null
  onOpen: () => void
}) {
  const drag = useDraggable({ id: task.id })
  const drop = useDroppable({ id: task.id, disabled: drag.isDragging })
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      className={cn(
        'relative',
        drag.isDragging && 'opacity-40',
        drop.isOver && 'ring-ring/50 rounded-lg ring-2',
      )}
    >
      {/*
        The drag listeners live on this grip, not on the card (beta round 3).
        With the whole card as the drag surface, every click was a
        would-be-drag that had not travelled 6px yet, and a drop landing on
        another card could still fire that card's click — which is what made
        the board feel, in Ethan's words, janky and sloppy. Now the card is
        only a click target and the grip is only a drag handle.

        Not `drag.attributes`: those add role="button" and a screen-reader
        promise of a space-bar drag that no KeyboardSensor answers. Moving a
        task by keyboard is the read view's status buttons.

        `touch-none` is what PointerSensor needs for a finger to drag rather
        than scroll. The sidebar deliberately does NOT set it, because there
        the drag surface is the whole row and it would eat the scroll gesture
        (Sidebar.tsx). A grip this size costs the scroll nothing.
      */}
      <span
        {...drag.listeners}
        aria-hidden
        title="Drag to move"
        // Always visible, never hover-revealed. Tailwind compiles group-hover
        // inside `@media(hover:hover)`, so any variant that hides this by
        // default leaves a touch device with no rule that can bring it back —
        // and this grip is the only pointer path to move a card. A muted icon
        // that is always there costs less than a card nobody can drag.
        className="text-muted-foreground/50 hover:text-muted-foreground absolute top-2 right-1.5 cursor-grab touch-none px-1 transition-colors active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" />
      </span>
      <TaskCard task={task} today={today} source={source} onOpen={onOpen} />
    </div>
  )
}

function TaskCard({
  task,
  today,
  source,
  overlay = false,
  onOpen,
}: {
  task: Task
  today: string
  source: TaskSource | null
  overlay?: boolean
  onOpen?: () => void
}) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'bg-card text-card-foreground w-full rounded-lg border p-3 pr-7 text-left text-sm shadow-sm',
        onOpen &&
          'focus-visible:ring-ring/50 cursor-pointer outline-none focus-visible:ring-[3px]',
        overlay && 'shadow-md',
      )}
    >
      <p className="break-words">{task.title}</p>
      {plainFromRich(task.description_rich) !== '' && (
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs break-words whitespace-pre-wrap">
          {plainFromRich(task.description_rich)}
        </p>
      )}
      {(task.due_date || task.assignee_id || source) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {task.due_date && (
            <span
              className={cn(
                'text-xs',
                isOverdue(task, today) ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {task.due_date}
            </span>
          )}
          {source && <SourceChip source={source} />}
          <span className="flex-1" />
          {task.assignee_id && <AssigneeAvatar userId={task.assignee_id} />}
        </div>
      )}
    </div>
  )
}

function AssigneeAvatar({ userId }: { userId: string }) {
  const { nameFor, avatarUrlFor } = useProfiles()
  return <AuthorAvatar name={nameFor(userId)} url={avatarUrlFor(userId)} className="size-5" />
}

function MyTasksList({
  tasks,
  today,
  sourceFor,
  onOpen,
}: {
  tasks: Task[]
  today: string
  sourceFor: (task: Task) => TaskSource | null
  onOpen: (task: Task) => void
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing assigned to you.</p>
  }
  return (
    <ul className="divide-y overflow-y-auto">
      {tasks.map((task) => {
        const source = sourceFor(task)
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpen(task)}
              className="hover:bg-accent/40 focus-visible:ring-ring/50 flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-sm outline-none focus-visible:ring-[3px]"
            >
              <span className="text-muted-foreground w-14 shrink-0 text-xs">
                {STATUS_LABELS[task.status]}
              </span>
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              {source && <SourceChip source={source} />}
              {task.due_date && (
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    isOverdue(task, today) ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {task.due_date}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-x-hidden">
      {TASK_STATUSES.map((s) => (
        <div key={s} className="bg-muted/50 flex w-72 shrink-0 flex-col gap-2 rounded-lg p-2 pt-3">
          <Skeleton className="mx-1 h-4 w-16" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
