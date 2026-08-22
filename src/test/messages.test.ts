import { describe, expect, it } from 'vitest'

import {
  PAGE_SIZE,
  channelParent,
  hasMorePages,
  highestMessageId,
  mergeMessages,
  oldestMessageId,
  pageQuery,
  postParent,
  resyncQuery,
  sameParent,
} from '@/lib/messages'

const CH = channelParent('channel-1')

describe('message parents', () => {
  it('names the column each parent kind filters on', () => {
    expect(channelParent('c1')).toEqual({ column: 'channel_id', id: 'c1' })
    expect(postParent('p1')).toEqual({ column: 'post_id', id: 'p1' })
  })

  it('sameParent requires both column and id to match', () => {
    expect(sameParent(channelParent('x'), channelParent('x'))).toBe(true)
    expect(sameParent(channelParent('x'), channelParent('y'))).toBe(false)
    // The same id string under a different column is a different parent.
    expect(sameParent(channelParent('x'), postParent('x'))).toBe(false)
  })
})

describe('pageQuery', () => {
  it('defaults to 50 per page, newest first, unbounded', () => {
    expect(pageQuery(CH)).toEqual({
      parent: CH,
      beforeId: null,
      limit: 50,
      ascending: false,
    })
    expect(PAGE_SIZE).toBe(50)
  })

  it('walks backwards from the oldest id held', () => {
    expect(pageQuery(CH, 120).beforeId).toBe(120)
  })

  it('honours an explicit limit', () => {
    expect(pageQuery(CH, null, 10).limit).toBe(10)
  })

  it('carries a post parent unchanged — comments page the same way', () => {
    expect(pageQuery(postParent('p1')).parent).toEqual({ column: 'post_id', id: 'p1' })
  })
})

describe('resyncQuery', () => {
  it('fetches strictly after the newest id held', () => {
    expect(resyncQuery(CH, 42)).toEqual({ parent: CH, afterId: 42, ascending: true })
  })

  it('fetches from the beginning when nothing is held', () => {
    // A cold join has no cursor; afterId 0 is below every identity value.
    expect(resyncQuery(CH, null).afterId).toBe(0)
  })
})

describe('highestMessageId / oldestMessageId', () => {
  it('finds the cursors regardless of array order', () => {
    const held = [{ id: 9 }, { id: 3 }, { id: 14 }, { id: 7 }]
    expect(highestMessageId(held)).toBe(14)
    expect(oldestMessageId(held)).toBe(3)
  })

  it('handles an empty set', () => {
    expect(highestMessageId([])).toBe(0)
    expect(oldestMessageId([])).toBeNull()
  })

  it('feeds resyncQuery directly', () => {
    const held = [{ id: 5 }, { id: 11 }]
    expect(resyncQuery(CH, highestMessageId(held)).afterId).toBe(11)
  })
})

describe('mergeMessages', () => {
  it('returns ascending order', () => {
    const merged = mergeMessages([{ id: 3 }, { id: 1 }], [{ id: 2 }])
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('dedupes rows that arrive via both realtime and resync', () => {
    const existing = [{ id: 1 }, { id: 2 }]
    const incoming = [{ id: 2 }, { id: 3 }]
    expect(mergeMessages(existing, incoming).map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('prefers the incoming copy of a duplicated row', () => {
    // Resync reflects the table, so an edit or soft delete must win.
    const existing = [{ id: 1, body: 'stale' }]
    const incoming = [{ id: 1, body: 'edited' }]
    expect(mergeMessages(existing, incoming)).toEqual([{ id: 1, body: 'edited' }])
  })

  it('is a no-op when the resync finds nothing new', () => {
    const existing = [{ id: 1 }, { id: 2 }]
    expect(mergeMessages(existing, [])).toEqual(existing)
  })

  it('does not mutate its inputs', () => {
    const existing = [{ id: 2 }]
    const incoming = [{ id: 1 }]
    mergeMessages(existing, incoming)
    expect(existing).toEqual([{ id: 2 }])
    expect(incoming).toEqual([{ id: 1 }])
  })
})

describe('hasMorePages', () => {
  it('assumes more when a full page comes back', () => {
    expect(hasMorePages(50)).toBe(true)
  })

  it('stops on a short page', () => {
    expect(hasMorePages(49)).toBe(false)
    expect(hasMorePages(0)).toBe(false)
  })
})
