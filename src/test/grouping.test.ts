import { describe, expect, it } from 'vitest'

import { GROUP_WINDOW_MS, groupMessages } from '@/lib/grouping'

const ALICE = 'alice-uuid'
const BOB = 'bob-uuid'
const T0 = Date.parse('2026-08-09T12:00:00.000Z')

function msg(id: number, author_id: string, offsetMs = 0) {
  return { id, author_id, created_at: new Date(T0 + offsetMs).toISOString() }
}

describe('groupMessages', () => {
  it('returns nothing for an empty list', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('wraps a single message in one group', () => {
    const groups = groupMessages([msg(1, ALICE)])
    expect(groups).toHaveLength(1)
    expect(groups[0].authorId).toBe(ALICE)
    expect(groups[0].messages.map((m) => m.id)).toEqual([1])
  })

  it('groups consecutive messages from one author inside the window', () => {
    const groups = groupMessages([msg(1, ALICE), msg(2, ALICE, 1000), msg(3, ALICE, 2000)])
    expect(groups).toHaveLength(1)
    expect(groups[0].messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('starts a new group when the author changes', () => {
    const groups = groupMessages([msg(1, ALICE), msg(2, BOB, 1000), msg(3, ALICE, 2000)])
    expect(groups.map((g) => g.authorId)).toEqual([ALICE, BOB, ALICE])
  })

  it('starts a new group once the window lapses', () => {
    const groups = groupMessages([msg(1, ALICE), msg(2, ALICE, GROUP_WINDOW_MS + 1)])
    expect(groups).toHaveLength(2)
  })

  it('treats exactly the window boundary as still grouped', () => {
    const groups = groupMessages([msg(1, ALICE), msg(2, ALICE, GROUP_WINDOW_MS)])
    expect(groups).toHaveLength(1)
  })

  it('measures the gap from the previous message, not the group start', () => {
    // Each step is inside the window, so a long run stays one group.
    const step = GROUP_WINDOW_MS - 1000
    const groups = groupMessages([
      msg(1, ALICE),
      msg(2, ALICE, step),
      msg(3, ALICE, step * 2),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('keys each group by its first message id', () => {
    const groups = groupMessages([msg(7, ALICE), msg(8, BOB, 1000)])
    expect(groups.map((g) => g.key)).toEqual([7, 8])
  })

  it('preserves every message exactly once, in order', () => {
    const input = [msg(1, ALICE), msg(2, BOB, 1000), msg(3, BOB, 2000), msg(4, ALICE, 3000)]
    const flat = groupMessages(input).flatMap((g) => g.messages)
    expect(flat.map((m) => m.id)).toEqual([1, 2, 3, 4])
  })

  it('does not merge across an unparseable timestamp', () => {
    const groups = groupMessages([
      { id: 1, author_id: ALICE, created_at: 'not a date' },
      { id: 2, author_id: ALICE, created_at: new Date(T0).toISOString() },
    ])
    expect(groups).toHaveLength(2)
  })

  it('honours a custom window', () => {
    const groups = groupMessages([msg(1, ALICE), msg(2, ALICE, 5000)], 1000)
    expect(groups).toHaveLength(2)
  })
})
