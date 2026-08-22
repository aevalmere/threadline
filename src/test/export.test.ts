import { describe, expect, it } from 'vitest'

import {
  EXPORT_MAX_PAGES,
  EXPORT_PAGE_SIZE,
  EXPORT_TABLES,
  exportFilename,
  fetchAllRows,
} from '@/lib/export'

function rows(from: number, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ id: from + i }))
}

describe('fetchAllRows', () => {
  it('stops after one short page without asking again', async () => {
    const calls: unknown[] = []
    const result = await fetchAllRows(async (afterId) => {
      calls.push(afterId)
      return rows(1, 3)
    }, 'id')
    expect(result).toHaveLength(3)
    expect(calls).toEqual([null])
  })

  it('pages with the last row id as the keyset cursor', async () => {
    const calls: unknown[] = []
    const result = await fetchAllRows(async (afterId) => {
      calls.push(afterId)
      if (afterId === null) return rows(1, EXPORT_PAGE_SIZE)
      return rows(EXPORT_PAGE_SIZE + 1, 5)
    }, 'id')
    expect(result).toHaveLength(EXPORT_PAGE_SIZE + 5)
    expect(calls).toEqual([null, EXPORT_PAGE_SIZE])
  })

  it('a table that is an exact multiple of the page size asks once more and stops on empty', async () => {
    const calls: unknown[] = []
    const result = await fetchAllRows(async (afterId) => {
      calls.push(afterId)
      return afterId === null ? rows(1, EXPORT_PAGE_SIZE) : []
    }, 'id')
    expect(result).toHaveLength(EXPORT_PAGE_SIZE)
    expect(calls).toHaveLength(2)
  })

  it('the runaway guard caps a fetcher that never runs dry', async () => {
    let calls = 0
    const result = await fetchAllRows(async () => {
      calls++
      return rows(calls * EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE)
    }, 'id')
    expect(calls).toBe(EXPORT_MAX_PAGES)
    expect(result).toHaveLength(EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE)
  })
})

describe('export shape', () => {
  it('covers every content table exactly once', () => {
    const names = EXPORT_TABLES.map((t) => t.table)
    expect(new Set(names).size).toBe(names.length)
    for (const expected of [
      'profiles',
      'channels',
      'channel_members',
      'messages',
      'posts',
      'tags',
      'post_tags',
      'collections',
      'pages',
      'tasks',
      'links',
      'attachments',
      'notifications',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('names the file by the export date', () => {
    expect(exportFilename('2026-08-22T14:30:00.000Z')).toBe('threadline-export-2026-08-22.json')
  })
})
