/**
 * Task state for the board and My Tasks — SPEC §1.6.
 *
 * A hook, not a context: only the /tasks route consumes the list, the same
 * test DECISIONS #6 applied to messages. No realtime — SPEC §4 names what
 * replicates and tasks are deliberately absent; the board refetches after
 * mutations and that is the design, not a gap.
 *
 * Error convention matches the channels context: the load error is state,
 * mutation errors are thrown for the calling form to catch. The one
 * exception is `moveTask` — a drag has no form to report into, so a failed
 * move sets the hook error and refetches to converge on the database.
 */

import { useCallback, useEffect, useState } from 'react'

import { richFromPlain } from '@/lib/rich'
import { supabase } from '@/lib/supabase'
import {
  TASK_COLUMNS,
  appendPosition,
  linkForTask,
  taskFromMessagePayload,
  type Task,
  type TaskInsert,
  type TaskSourceMessage,
  type TaskStatus,
} from '@/lib/tasks'

export function useTasks() {
  /** Null until the first fetch settles — the loading state. */
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .order('position', { ascending: true })
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setTasks((data ?? []) as Task[])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createTask = useCallback(async (payload: TaskInsert): Promise<Task> => {
    const { data, error: err } = await supabase
      .from('tasks')
      .insert(payload)
      .select(TASK_COLUMNS)
      .single()
    if (err || !data) throw new Error(err?.message ?? 'Could not create the task.')
    const task = data as Task
    setTasks((cur) => (cur ? [...cur, task] : cur))
    return task
  }, [])

  const updateTask = useCallback(async (id: string, patch: Partial<Task>): Promise<void> => {
    const { data, error: err } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select('id')
    // Judged on rows, not error absence (DECISIONS #5): a write RLS silently
    // swallowed returns success with zero rows.
    if (err || (data?.length ?? 0) !== 1) {
      throw new Error(err?.message ?? 'The update did not take effect.')
    }
    setTasks((cur) => cur?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? cur)
  }, [])

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    // Links integrity is app-enforced (SPEC §1.8) — the database has no FK to
    // cascade, so a hard-deleted task must take its edges with it, both
    // directions, or the backlink panel resolves ghosts forever. Edges go
    // first: a failure part-way leaves a deletable task, never a dangling
    // edge.
    for (const [typeCol, idCol] of [
      ['source_type', 'source_id'],
      ['target_type', 'target_id'],
    ] as const) {
      const { error: linkErr } = await supabase
        .from('links')
        .delete()
        .eq(typeCol, 'task')
        .eq(idCol, id)
      if (linkErr) throw new Error(linkErr.message)
    }
    const { data, error: err } = await supabase.from('tasks').delete().eq('id', id).select('id')
    if (err || (data?.length ?? 0) !== 1) {
      throw new Error(err?.message ?? 'The delete did not take effect.')
    }
    setTasks((cur) => cur?.filter((t) => t.id !== id) ?? cur)
  }, [])

  /**
   * The drop write: status + position (+ completed_at when the column
   * changed), applied optimistically so the card lands before the wire
   * settles. On failure the board refetches — the database wins.
   */
  const moveTask = useCallback(
    async (id: string, patch: { position: number; status?: TaskStatus; completed_at?: string | null }) => {
      setTasks((cur) => cur?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? cur)
      const { data, error: err } = await supabase
        .from('tasks')
        .update(patch)
        .eq('id', id)
        .select('id')
      if (err || (data?.length ?? 0) !== 1) {
        setError(err?.message ?? 'Could not move the task.')
        await refresh()
      }
    },
    [refresh],
  )

  return { tasks, error, refresh, createTask, updateTask, deleteTask, moveTask }
}

/**
 * Create-task-from-message — SPEC §1.6, the pair of writes the app exists
 * for: a `tasks` row carrying `source_message_id`, then one `links` row
 * (`created_from`) once the task's uuid exists. Standalone rather than on the
 * hook because ChannelView calls it without mounting the task list.
 *
 * Not a transaction, deliberately: two inserts from a trusted client at team
 * scale; a crash between them loses the provenance chip, not the task.
 */
export async function createTaskFromMessage(
  message: TaskSourceMessage,
  opts: {
    title: string
    status: TaskStatus
    assigneeId: string | null
    dueDate: string | null
    description: string
    createdBy: string
  },
): Promise<void> {
  // Append to the bottom of the chosen column: one max-position read, shaped
  // so `appendPosition` owns the arithmetic.
  const top = await supabase
    .from('tasks')
    .select('position')
    .eq('status', opts.status)
    .order('position', { ascending: false })
    .limit(1)
  if (top.error) throw new Error(top.error.message)
  const position = appendPosition((top.data ?? []) as { position: number }[])

  const payload: TaskInsert = {
    ...taskFromMessagePayload(message, { title: opts.title, position, createdBy: opts.createdBy }),
    status: opts.status,
    assignee_id: opts.assigneeId,
    due_date: opts.dueDate,
    description_rich: richFromPlain(opts.description),
  }

  const ins = await supabase.from('tasks').insert(payload).select('id').single<{ id: string }>()
  if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'Could not create the task.')

  const link = await supabase
    .from('links')
    .insert(linkForTask(ins.data.id, message.id))
    .select('id')
    .single()
  if (link.error) {
    throw new Error(`Task created, but its source link failed: ${link.error.message}`)
  }
}
