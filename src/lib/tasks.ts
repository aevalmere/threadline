/**
 * Pure task helpers — SPEC.md §1.6 (kanban, fractional ordering, create task
 * from message) and §2.3 (`tasks`, `links`).
 *
 * Decision/IO split, same as `pending.ts`: everything that decides a payload,
 * a position, or an ordering lives here as a pure function with tests; the
 * components only await the insert/update that carries the result. The id
 * seam matters: `messages.id` is a bigint number, tasks are uuid strings, and
 * `links` ids are polymorphic *text* (DECISIONS #2) — the String() coercions
 * here are the one place that conversion is allowed to happen.
 */

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Column labels for board headers and the status picker. */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
}

/** Explicit column list — never select('*') (keeps mock and wire payloads honest). */
export const TASK_COLUMNS =
  'id,title,description_rich,status,assignee_id,due_date,position,source_message_id,source_post_id,created_by,created_at,completed_at'

export interface Task {
  id: string
  title: string
  description_rich: unknown
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  position: number
  source_message_id: number | null
  source_post_id: string | null
  created_by: string | null
  created_at: string
  completed_at: string | null
}

/** What a task insert carries. `id`/`created_at` come from the database. */
export interface TaskInsert {
  title: string
  description_rich: unknown
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  position: number
  source_message_id: number | null
  created_by: string
}

/** The minimal message shape create-task-from-message needs. */
export interface TaskSourceMessage {
  id: number
  body: string
}

/**
 * Gap left between consecutive positions so most drops midpoint cleanly.
 * float8 has 52 mantissa bits; halving the same gap needs ~50 consecutive
 * drops into one spot before precision runs out — acceptable at 5–30 users,
 * and a reorder writes a fresh position anyway.
 */
export const POSITION_STEP = 1024

/**
 * Position for a card dropped between `prev` and `next` (either side null at
 * a column edge, both null into an empty column). SPEC §1.6: never rewrite a
 * whole column on drop — one card, one new position.
 */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return POSITION_STEP
  if (prev === null) return (next as number) - POSITION_STEP
  if (next === null) return prev + POSITION_STEP
  return (prev + next) / 2
}

/** Append position for a new card at the bottom of a column. */
export function appendPosition(column: readonly Pick<Task, 'position'>[]): number {
  if (column.length === 0) return POSITION_STEP
  return Math.max(...column.map((t) => t.position)) + POSITION_STEP
}

/**
 * Board shape: every status key always present (an empty column is a rendered
 * column, not a missing one), each sorted by position ascending. Fresh arrays;
 * never mutates input.
 */
export function groupByStatus<T extends Pick<Task, 'status' | 'position'>>(
  tasks: readonly T[],
): Record<TaskStatus, T[]> {
  const grouped: Record<TaskStatus, T[]> = { todo: [], doing: [], done: [] }
  for (const t of tasks) grouped[t.status]?.push(t)
  for (const status of TASK_STATUSES) grouped[status].sort((a, b) => a.position - b.position)
  return grouped
}

/**
 * My Tasks ordering: due date ascending with undated last, then created_at.
 * Date-only ISO strings compare correctly as strings.
 */
export function myTasks<T extends Pick<Task, 'assignee_id' | 'due_date' | 'created_at'>>(
  tasks: readonly T[],
  userId: string | null,
): T[] {
  if (userId === null) return []
  return tasks
    .filter((t) => t.assignee_id === userId)
    .sort((a, b) => {
      if (a.due_date !== b.due_date) {
        if (a.due_date === null) return 1
        if (b.due_date === null) return -1
        return a.due_date < b.due_date ? -1 : 1
      }
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
    })
}

/** Overdue = dated before today and not done. `today` is a YYYY-MM-DD string. */
export function isOverdue(
  task: Pick<Task, 'due_date' | 'status'>,
  today: string,
): boolean {
  return task.due_date !== null && task.due_date < today && task.status !== 'done'
}

export const TITLE_MAX = 80

/**
 * Seed a task title from a message body (SPEC §1.6): first non-empty line,
 * inner whitespace collapsed, hard-capped with an ellipsis. @mention tokens
 * stay — they read fine as text and the modal is editable before save.
 */
export function titleFromBody(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  if (line.length <= TITLE_MAX) return line
  return line.slice(0, TITLE_MAX).trimEnd() + '…'
}

/**
 * The create-task-from-message insert payload (SPEC §1.6 step 1). The links
 * row is built separately by `linkForTask` because it needs the task's uuid,
 * which only exists after this insert returns.
 */
export function taskFromMessagePayload(
  message: TaskSourceMessage,
  opts: { title?: string; position: number; createdBy: string },
): TaskInsert {
  return {
    title: opts.title ?? titleFromBody(message.body),
    description_rich: null,
    status: 'todo',
    assignee_id: null,
    due_date: null,
    position: opts.position,
    source_message_id: message.id,
    created_by: opts.createdBy,
  }
}

/**
 * The links row for a task created from a message (SPEC §1.6 step 2).
 * Polymorphic text ids: the bigint message id is stringified HERE and nowhere
 * else.
 */
export function linkForTask(taskId: string, messageId: number) {
  return {
    source_type: 'task',
    source_id: taskId,
    target_type: 'message',
    target_id: String(messageId),
    kind: 'created_from',
  } as const
}

/**
 * Patch for a status change. `completed_at` is stamped on entering `done` and
 * cleared on leaving it, so "done last Tuesday" survives a refresh but a
 * reopened task does not claim a completion date.
 */
export function statusPatch(
  next: TaskStatus,
  nowIso: string,
): { status: TaskStatus; completed_at: string | null } {
  return { status: next, completed_at: next === 'done' ? nowIso : null }
}

/**
 * Minimal BlockNote-shaped paragraphs from plain text, and back. P2's modal
 * is a plain textarea; P4's BlockNote editor loads this same column without a
 * migration (SPEC §2.3). One block per line, empty lines preserved as empty
 * paragraphs.
 */
export interface RichParagraph {
  type: 'paragraph'
  content: { type: 'text'; text: string; styles: Record<string, never> }[]
}

export function richFromPlain(text: string): RichParagraph[] | null {
  if (text.trim() === '') return null
  return text.split('\n').map((line) => ({
    type: 'paragraph',
    content: line === '' ? [] : [{ type: 'text', text: line, styles: {} }],
  }))
}

export function plainFromRich(rich: unknown): string {
  if (!Array.isArray(rich)) return ''
  return rich
    .map((block: { content?: { text?: string }[] }) =>
      Array.isArray(block?.content) ? block.content.map((c) => c?.text ?? '').join('') : '',
    )
    .join('\n')
}
