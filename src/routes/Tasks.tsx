/**
 * /tasks — the kanban board and My Tasks — SPEC §1.6.
 *
 * Drag model: cards are draggable; every card and every column body is a drop
 * target. Dropping on a card takes its place (positionBetween that card and
 * the one above it); dropping on a column appends. One card gets one new
 * position per drop — the column is never rewritten (SPEC §1.6). The
 * keyboard/touch path is the card's edit dialog, whose status buttons move a
 * card across columns without dragging.
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
import { PlusIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { SourceChip, TaskDialog, type TaskSource } from '@/components/tasks/TaskDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'
import { useProfiles } from '@/lib/profiles-context'
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
  richFromPlain,
  statusPatch,
  type Task,
  type TaskFields,
  type TaskStatus,
} from '@/lib/tasks'
import { useTasks } from '@/lib/useTasks'
import { cn } from '@/lib/utils'

type View = 'board' | 'mine'

type DialogState = { mode: 'create' } | { mode: 'edit'; task: Task } | null

export default function Tasks() {
  const { tasks, error, refresh, createTask, updateTask, deleteTask, moveTask } = useTasks()
  const { authorId } = useAuth()
  const { channels } = useChannels()
  const [view, setView] = useState<View>('board')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dragging, setDragging] = useState<Task | null>(null)

  const grouped = useMemo(() => groupByStatus(tasks ?? []), [tasks])
  const mine = useMemo(() => myTasks(tasks ?? [], authorId), [tasks, authorId])
  const today = new Date().toISOString().slice(0, 10)

  /**
   * source_message_id → channel_id for the "from #channel" chips, one batched
   * read per task-list change. Chip names resolve through the channels
   * context; a source whose message is gone simply renders no chip.
   */
  const [sourceChannelByMessage, setSourceChannelByMessage] = useState<Map<number, string>>(
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
  useEffect(() => {
    if (sourceIdsKey === '') {
      setSourceChannelByMessage(new Map())
      return
    }
    let cancelled = false
    void supabase
      .from('messages')
      .select('id,channel_id')
      .in('id', sourceIdsKey.split(',').map(Number))
      .then(({ data }) => {
        if (cancelled || !data) return
        setSourceChannelByMessage(
          new Map(
            (data as { id: number; channel_id: string | null }[])
              .filter((m) => m.channel_id !== null)
              .map((m) => [m.id, m.channel_id as string]),
          ),
        )
      })
    return () => {
      cancelled = true
    }
  }, [sourceIdsKey])

  const sourceFor = (task: Task): TaskSource | null => {
    if (task.source_message_id === null) return null
    const channelId = sourceChannelByMessage.get(task.source_message_id)
    if (!channelId) return null
    const name = channels?.find((c) => c.id === channelId)?.name
    if (!name) return null
    return { channelId, channelName: name, messageId: task.source_message_id }
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
      created_by: authorId,
    })
  }

  async function edit(task: Task, fields: TaskFields) {
    await updateTask(task.id, patchFromFields(fields, task.status, new Date().toISOString()))
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
                onOpen={(task) => setDialog({ mode: 'edit', task })}
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
          onOpen={(task) => setDialog({ mode: 'edit', task })}
        />
      )}

      <TaskDialog
        open={dialog?.mode === 'create'}
        title="New task"
        submitLabel="Create task"
        initial={{}}
        onClose={() => setDialog(null)}
        onSubmit={create}
      />
      <TaskDialog
        open={dialog?.mode === 'edit'}
        title="Edit task"
        submitLabel="Save"
        initial={dialog?.mode === 'edit' ? fieldsFromTask(dialog.task) : {}}
        source={dialog?.mode === 'edit' ? sourceFor(dialog.task) : null}
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
      {...drag.listeners}
      {...drag.attributes}
      className={cn(drag.isDragging && 'opacity-40', drop.isOver && 'ring-ring/50 ring-2 rounded-lg')}
    >
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
        'bg-card text-card-foreground w-full rounded-lg border p-3 text-left text-sm shadow-sm',
        onOpen &&
          'focus-visible:ring-ring/50 cursor-pointer outline-none focus-visible:ring-[3px]',
        overlay && 'shadow-md',
      )}
    >
      <p className="break-words">{task.title}</p>
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
