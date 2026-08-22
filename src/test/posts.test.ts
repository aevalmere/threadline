import { describe, expect, it } from 'vitest'

import {
  TAG_NAME_MAX,
  TAG_PALETTE,
  commentCounts,
  filterByTag,
  normalizeTagName,
  parseTagInput,
  postInsertPayload,
  postPatch,
  tagColor,
  tagDiff,
  tagsByPost,
  type Tag,
} from '@/lib/posts'
import { richFromPlain } from '@/lib/rich'

const CHANNEL = 'c0000000-0000-4000-8000-000000000001'
const AUTHOR = 'a0000000-0000-4000-8000-000000000001'

function tag(over: Partial<Tag> & Pick<Tag, 'id' | 'name'>): Tag {
  return { color: null, ...over }
}

describe('normalizeTagName', () => {
  it('lowercases, trims, and collapses inner whitespace to hyphens', () => {
    expect(normalizeTagName('  Bug Report ')).toBe('bug-report')
    expect(normalizeTagName('BUG')).toBe('bug')
    expect(normalizeTagName('a  \t b')).toBe('a-b')
  })

  it('caps at TAG_NAME_MAX', () => {
    expect(normalizeTagName('x'.repeat(TAG_NAME_MAX + 10))).toHaveLength(TAG_NAME_MAX)
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeTagName('   ')).toBe('')
  })
})

describe('parseTagInput', () => {
  it('splits on commas, normalizes, and drops empties', () => {
    expect(parseTagInput('Bug, feature idea, ,')).toEqual(['bug', 'feature-idea'])
  })

  it('dedupes case-insensitively, first occurrence wins', () => {
    expect(parseTagInput('Bug, bug, BUG')).toEqual(['bug'])
  })

  it('returns [] for empty input', () => {
    expect(parseTagInput('')).toEqual([])
  })
})

describe('tagColor', () => {
  it('is deterministic and always picks from the palette', () => {
    expect(tagColor('bug')).toBe(tagColor('bug'))
    for (const name of ['bug', 'feature', 'q3-planning', 'a', '']) {
      expect(TAG_PALETTE).toContain(tagColor(name))
    }
  })

  it('different names can land on different colors', () => {
    const colors = new Set(
      ['bug', 'feature', 'idea', 'infra', 'design', 'urgent'].map(tagColor),
    )
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('postInsertPayload', () => {
  // The never-break shape: full-object equality so an added field fails loudly.
  it('builds the exact insert payload, body through richFromPlain', () => {
    const payload = postInsertPayload({
      channelId: CHANNEL,
      authorId: AUTHOR,
      title: '  Launch plan  ',
      body: 'two\nlines',
    })
    expect(payload).toEqual({
      channel_id: CHANNEL,
      author_id: AUTHOR,
      title: 'Launch plan',
      body_rich: richFromPlain('two\nlines'),
    })
  })

  it('stores null body_rich for an empty body, never []', () => {
    const payload = postInsertPayload({
      channelId: CHANNEL,
      authorId: AUTHOR,
      title: 't',
      body: '   ',
    })
    expect(payload.body_rich).toBeNull()
  })
})

describe('postPatch', () => {
  it('carries only title and body_rich', () => {
    expect(postPatch({ title: ' t ', body: 'b' })).toEqual({
      title: 't',
      body_rich: richFromPlain('b'),
    })
  })
})

describe('tagDiff', () => {
  const current = [tag({ id: 't1', name: 'bug' }), tag({ id: 't2', name: 'infra' })]

  it('adds names not carried and removes ids no longer wanted', () => {
    expect(tagDiff(current, ['bug', 'design'])).toEqual({
      add: ['design'],
      remove: ['t2'],
    })
  })

  it('is empty both ways when nothing changed', () => {
    expect(tagDiff(current, ['bug', 'infra'])).toEqual({ add: [], remove: [] })
  })

  it('clears everything when the form holds no tags', () => {
    expect(tagDiff(current, [])).toEqual({ add: [], remove: ['t1', 't2'] })
  })
})

describe('commentCounts', () => {
  it('folds rows into per-post counts, skipping null post_id', () => {
    const counts = commentCounts([
      { post_id: 'p1' },
      { post_id: 'p1' },
      { post_id: 'p2' },
      { post_id: null },
    ])
    expect(counts.get('p1')).toBe(2)
    expect(counts.get('p2')).toBe(1)
    // Absent, not zero — read sites use `?? 0`.
    expect(counts.has('p3')).toBe(false)
  })
})

describe('tagsByPost', () => {
  const tags = [tag({ id: 't1', name: 'infra' }), tag({ id: 't2', name: 'bug' })]

  it('groups per post, sorted by name for stable chip order', () => {
    const grouped = tagsByPost(
      [
        { post_id: 'p1', tag_id: 't1' },
        { post_id: 'p1', tag_id: 't2' },
        { post_id: 'p2', tag_id: 't2' },
      ],
      tags,
    )
    expect(grouped.get('p1')?.map((t) => t.name)).toEqual(['bug', 'infra'])
    expect(grouped.get('p2')?.map((t) => t.name)).toEqual(['bug'])
  })

  it('drops rows pointing at tags the fetch did not return', () => {
    const grouped = tagsByPost([{ post_id: 'p1', tag_id: 'gone' }], tags)
    expect(grouped.has('p1')).toBe(false)
  })
})

describe('filterByTag', () => {
  const posts = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
  const byPost = new Map<string, Tag[]>([
    ['p1', [tag({ id: 't1', name: 'bug' })]],
    ['p3', [tag({ id: 't1', name: 'bug' }), tag({ id: 't2', name: 'infra' })]],
  ])

  it('returns all posts, order preserved, when no filter is set', () => {
    expect(filterByTag(posts, byPost, null)).toEqual(posts)
    expect(filterByTag(posts, byPost, '')).toEqual(posts)
  })

  it('keeps only posts carrying the named tag, order preserved', () => {
    expect(filterByTag(posts, byPost, 'bug').map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(filterByTag(posts, byPost, 'infra').map((p) => p.id)).toEqual(['p3'])
  })

  it('matches nothing for a tag no post carries', () => {
    expect(filterByTag(posts, byPost, 'ghost')).toEqual([])
  })
})
