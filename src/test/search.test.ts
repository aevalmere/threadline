import { describe, expect, it } from 'vitest'

import {
  SEARCH_GROUPS,
  SEARCH_MIN_LENGTH,
  groupResults,
  jumpPathFor,
  queryReady,
  splitSnippet,
  type SearchResult,
} from '@/lib/search'

const CHANNEL = 'c0000000-0000-4000-8000-000000000001'
const POST = 'e0000000-0000-4000-8000-000000000005'
const PAGE = 'f0000000-0000-4000-8000-000000000006'
const TASK = 'd0000000-0000-4000-8000-000000000004'

function result(over: Partial<SearchResult> & Pick<SearchResult, 'entity_type' | 'entity_id'>): SearchResult {
  return {
    parent_type: null,
    parent_id: null,
    title: 't',
    snippet: 's',
    rank: 0,
    ...over,
  }
}

describe('queryReady', () => {
  it('requires the minimum length after trimming', () => {
    expect(queryReady('a')).toBe(false)
    expect(queryReady('  a  ')).toBe(false)
    expect(queryReady('ab')).toBe(true)
    expect(queryReady(' kanban plan ')).toBe(true)
    expect(SEARCH_MIN_LENGTH).toBe(2)
  })
})

describe('jumpPathFor — the search query builder never-break path', () => {
  it('routes a chat message to its channel with ?m=', () => {
    expect(
      jumpPathFor(
        result({ entity_type: 'message', entity_id: '42', parent_type: 'channel', parent_id: CHANNEL }),
      ),
    ).toBe(`/channels/${CHANNEL}?m=42`)
  })

  it('routes a forum comment to its post with ?m=', () => {
    expect(
      jumpPathFor(
        result({ entity_type: 'message', entity_id: '42', parent_type: 'post', parent_id: POST }),
      ),
    ).toBe(`/posts/${POST}?m=42`)
  })

  it('routes posts, pages, and tasks to their surfaces', () => {
    expect(jumpPathFor(result({ entity_type: 'post', entity_id: POST }))).toBe(`/posts/${POST}`)
    expect(jumpPathFor(result({ entity_type: 'page', entity_id: PAGE }))).toBe(`/docs/${PAGE}`)
    expect(jumpPathFor(result({ entity_type: 'task', entity_id: TASK }))).toBe(`/tasks?t=${TASK}`)
  })

  it('a person has no jump path — the palette re-searches their handle instead', () => {
    expect(
      jumpPathFor(result({ entity_type: 'person', entity_id: 'u1', snippet: '@ethan' })),
    ).toBeNull()
  })

  it('returns null for rows that cannot be navigated', () => {
    expect(jumpPathFor(result({ entity_type: 'message', entity_id: '42' }))).toBeNull()
    expect(
      jumpPathFor(
        result({ entity_type: 'message', entity_id: '42', parent_type: 'channel', parent_id: '' }),
      ),
    ).toBeNull()
    expect(
      jumpPathFor(result({ entity_type: 'unknown' as SearchResult['entity_type'], entity_id: 'x' })),
    ).toBeNull()
  })
})

describe('groupResults', () => {
  it('buckets by entity type, keeping rank order inside each bucket', () => {
    const rows = [
      result({ entity_type: 'task', entity_id: 't1', rank: 0.9 }),
      result({ entity_type: 'message', entity_id: '1', rank: 0.8 }),
      result({ entity_type: 'message', entity_id: '2', rank: 0.5 }),
      result({ entity_type: 'page', entity_id: 'p1', rank: 0.4 }),
    ]
    const grouped = groupResults(rows)
    expect(grouped.get('message')?.map((r) => r.entity_id)).toEqual(['1', '2'])
    expect(grouped.get('task')?.map((r) => r.entity_id)).toEqual(['t1'])
    expect(grouped.get('page')).toHaveLength(1)
    expect(grouped.get('post')).toBeUndefined()
  })

  it('drops unknown entity types instead of inventing a heading', () => {
    const rows = [result({ entity_type: 'widget' as SearchResult['entity_type'], entity_id: 'x' })]
    expect(groupResults(rows).size).toBe(0)
  })

  it('the fixed group order covers all five entity types, people first', () => {
    expect(SEARCH_GROUPS.map((g) => g.type)).toEqual([
      'person',
      'message',
      'post',
      'page',
      'task',
    ])
  })
})

describe('splitSnippet', () => {
  it('parses ⟦⟧ markers into match segments', () => {
    expect(splitSnippet('the ⟦kanban⟧ board and the ⟦kanban⟧ flow')).toEqual([
      { text: 'the ', match: false },
      { text: 'kanban', match: true },
      { text: ' board and the ', match: false },
      { text: 'kanban', match: true },
      { text: ' flow', match: false },
    ])
  })

  it('a snippet with no markers is one plain segment', () => {
    expect(splitSnippet('nothing highlighted')).toEqual([
      { text: 'nothing highlighted', match: false },
    ])
  })

  it('degrades unbalanced markers to plain text', () => {
    expect(splitSnippet('broken ⟦half')).toEqual([{ text: 'broken half', match: false }])
    expect(splitSnippet('')).toEqual([])
  })
})
