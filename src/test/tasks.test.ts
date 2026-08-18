import { describe, expect, it } from 'vitest'

import {
  POSITION_STEP,
  TITLE_MAX,
  appendPosition,
  fieldsFromTask,
  groupByStatus,
  isOverdue,
  linkForTask,
  myTasks,
  patchFromFields,
  plainFromRich,
  positionBetween,
  richFromPlain,
  statusPatch,
  taskFromMessagePayload,
  titleFromBody,
  type Task,
} from '@/lib/tasks'

const ALICE = 'a0000000-0000-4000-8000-000000000001'
const BOB = 'b0000000-0000-4000-8000-000000000002'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't0000000-0000-4000-8000-000000000001',
    title: 'Fix the thing',
    description_rich: null,
    status: 'todo',
    assignee_id: null,
    due_date: null,
    position: POSITION_STEP,
    source_message_id: null,
    source_post_id: null,
    created_by: ALICE,
    created_at: '2026-08-18T10:00:00.000Z',
    completed_at: null,
    ...over,
  }
}

describe('positionBetween', () => {
  it('drops into an empty column at the base step', () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP)
  })

  it('drops at the head below the first card', () => {
    expect(positionBetween(null, 1024)).toBe(0)
  })

  it('drops at the tail above the last card', () => {
    expect(positionBetween(2048, null)).toBe(2048 + POSITION_STEP)
  })

  it('drops between neighbours at their midpoint — SPEC §1.6', () => {
    expect(positionBetween(1024, 2048)).toBe(1536)
  })

  it('head drops can go negative and stay ordered', () => {
    const p = positionBetween(null, 0)
    expect(p).toBeLessThan(0)
  })
})

describe('appendPosition', () => {
  it('starts an empty column at the base step', () => {
    expect(appendPosition([])).toBe(POSITION_STEP)
  })

  it('lands one step past the current maximum, not the last element', () => {
    // Order of the input array must not matter.
    expect(appendPosition([{ position: 3072 }, { position: 1024 }])).toBe(3072 + POSITION_STEP)
  })
})

describe('groupByStatus', () => {
  it('always yields all three columns, even empty ones', () => {
    const g = groupByStatus([])
    expect(Object.keys(g).sort()).toEqual(['doing', 'done', 'todo'])
    expect(g.todo).toEqual([])
  })

  it('sorts each column by position ascending', () => {
    const g = groupByStatus([
      task({ id: 'b', position: 2048 }),
      task({ id: 'a', position: 1024 }),
    ])
    expect(g.todo.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the input array', () => {
    const input = [task({ position: 2048 }), task({ position: 1024 })]
    const snapshot = structuredClone(input)
    groupByStatus(input)
    expect(input).toEqual(snapshot)
  })
})

describe('myTasks', () => {
  it('keeps only the given assignee', () => {
    const mine = myTasks([task({ assignee_id: ALICE }), task({ assignee_id: BOB })], ALICE)
    expect(mine).toHaveLength(1)
    expect(mine[0].assignee_id).toBe(ALICE)
  })

  it('orders by due date ascending with undated last', () => {
    const mine = myTasks(
      [
        task({ id: 'undated', assignee_id: ALICE, due_date: null }),
        task({ id: 'later', assignee_id: ALICE, due_date: '2026-09-01' }),
        task({ id: 'soon', assignee_id: ALICE, due_date: '2026-08-20' }),
      ],
      ALICE,
    )
    expect(mine.map((t) => t.id)).toEqual(['soon', 'later', 'undated'])
  })

  it('returns nothing while signed out rather than everything', () => {
    expect(myTasks([task({ assignee_id: null })], null)).toEqual([])
  })
})

describe('isOverdue', () => {
  it('is overdue strictly before today', () => {
    expect(isOverdue(task({ due_date: '2026-08-17' }), '2026-08-18')).toBe(true)
    expect(isOverdue(task({ due_date: '2026-08-18' }), '2026-08-18')).toBe(false)
  })

  it('done tasks are never overdue', () => {
    expect(isOverdue(task({ due_date: '2026-08-01', status: 'done' }), '2026-08-18')).toBe(false)
  })

  it('undated tasks are never overdue', () => {
    expect(isOverdue(task({ due_date: null }), '2026-08-18')).toBe(false)
  })
})

describe('titleFromBody', () => {
  it('takes the first non-empty line', () => {
    expect(titleFromBody('\n\nship the fix\nsecond line')).toBe('ship the fix')
  })

  it('collapses runs of whitespace', () => {
    expect(titleFromBody('fix   the\t\tthing')).toBe('fix the thing')
  })

  it('keeps @mention tokens as plain text', () => {
    expect(titleFromBody('@ethan can you look at this')).toBe('@ethan can you look at this')
  })

  it('caps at TITLE_MAX with an ellipsis', () => {
    const long = 'x'.repeat(TITLE_MAX + 20)
    const title = titleFromBody(long)
    expect(title.length).toBe(TITLE_MAX + 1)
    expect(title.endsWith('…')).toBe(true)
  })

  it('returns empty for whitespace-only bodies', () => {
    expect(titleFromBody('  \n \t ')).toBe('')
  })
})

// The never-break P2 test path (ROADMAP): the exact payload pair that
// create-task-from-message writes — a tasks row with source_message_id, and
// one links row task→message kind created_from with a stringified message id.
describe('taskFromMessagePayload', () => {
  const message = { id: 4207, body: 'deploy is broken on the login page' }

  it('builds the tasks insert with source_message_id kept numeric (bigint FK)', () => {
    const payload = taskFromMessagePayload(message, { position: 1024, createdBy: ALICE })
    expect(payload).toEqual({
      title: 'deploy is broken on the login page',
      description_rich: null,
      status: 'todo',
      assignee_id: null,
      due_date: null,
      position: 1024,
      source_message_id: 4207,
      created_by: ALICE,
    })
    expect(typeof payload.source_message_id).toBe('number')
  })

  it('an explicit title wins over the seeded one', () => {
    const payload = taskFromMessagePayload(message, {
      title: 'Fix login deploy',
      position: 1024,
      createdBy: ALICE,
    })
    expect(payload.title).toBe('Fix login deploy')
  })
})

describe('linkForTask', () => {
  it('builds the created_from edge with the message id as text — DECISIONS #2', () => {
    const link = linkForTask('t-uuid', 4207)
    expect(link).toEqual({
      source_type: 'task',
      source_id: 't-uuid',
      target_type: 'message',
      target_id: '4207',
      kind: 'created_from',
    })
    expect(typeof link.target_id).toBe('string')
  })
})

describe('statusPatch', () => {
  const NOW = '2026-08-18T12:00:00.000Z'

  it('stamps completed_at on entering done', () => {
    expect(statusPatch('done', NOW)).toEqual({ status: 'done', completed_at: NOW })
  })

  it('clears completed_at when a task is reopened', () => {
    expect(statusPatch('doing', NOW)).toEqual({ status: 'doing', completed_at: null })
  })
})

describe('fieldsFromTask / patchFromFields', () => {
  const NOW = '2026-08-18T12:00:00.000Z'

  it('round-trips a task through the form without changing it', () => {
    const t = task({
      assignee_id: BOB,
      due_date: '2026-08-25',
      description_rich: richFromPlain('two\nlines'),
    })
    const patch = patchFromFields(fieldsFromTask(t), t.status, NOW)
    expect(patch).toEqual({
      title: t.title,
      assignee_id: BOB,
      due_date: '2026-08-25',
      description_rich: richFromPlain('two\nlines'),
    })
  })

  it('leaves completed_at alone when status did not change', () => {
    // Editing a done task's title must not re-stamp its completion date.
    const patch = patchFromFields(fieldsFromTask(task({ status: 'done' })), 'done', NOW)
    expect('completed_at' in patch).toBe(false)
    expect('status' in patch).toBe(false)
  })

  it('carries completed_at with a status transition', () => {
    const fields = { ...fieldsFromTask(task()), status: 'done' as const }
    const patch = patchFromFields(fields, 'todo', NOW)
    expect(patch.status).toBe('done')
    expect(patch.completed_at).toBe(NOW)
  })

  it('clearing the description writes null, not empty blocks', () => {
    const fields = { ...fieldsFromTask(task()), description: '' }
    expect(patchFromFields(fields, 'todo', NOW).description_rich).toBeNull()
  })
})

describe('rich text round-trip', () => {
  it('plain → rich → plain preserves lines, including empty ones', () => {
    const text = 'first line\n\nthird line'
    expect(plainFromRich(richFromPlain(text))).toBe(text)
  })

  it('whitespace-only text stores null, not empty blocks', () => {
    expect(richFromPlain('   ')).toBeNull()
  })

  it('plainFromRich tolerates a foreign or null column value', () => {
    expect(plainFromRich(null)).toBe('')
    expect(plainFromRich({ not: 'blocks' })).toBe('')
  })

  it('rich blocks carry the BlockNote paragraph shape P4 will load', () => {
    const rich = richFromPlain('hello')
    expect(rich).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello', styles: {} }] },
    ])
  })
})
