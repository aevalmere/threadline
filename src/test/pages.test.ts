import { describe, expect, it } from 'vitest'

import {
  HEARTBEAT_STALE_MS,
  editingBanner,
  flattenTree,
  heartbeatPatch,
  linkDiff,
  linkForPage,
  linkTargetFromHref,
  linksFromDoc,
  pageInsertPayload,
  releasePatch,
  savePatch,
  type Collection,
} from '@/lib/pages'

const ORIGIN = 'https://threadline-cc0.pages.dev'
const ME = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000002'
const TASK = 'd0000000-0000-4000-8000-000000000004'
const POST = 'e0000000-0000-4000-8000-000000000005'
const PAGE = 'f0000000-0000-4000-8000-000000000006'
const CHANNEL = 'c0000000-0000-4000-8000-000000000003'

function collection(over: Partial<Collection> & Pick<Collection, 'id' | 'name'>): Collection {
  return { parent_id: null, position: 1024, created_at: '2026-08-22T00:00:00Z', ...over }
}

describe('pageInsertPayload', () => {
  it('defaults an empty title to Untitled and stores null body', () => {
    expect(pageInsertPayload({ collectionId: null, createdBy: ME })).toEqual({
      collection_id: null,
      title: 'Untitled',
      body_rich: null,
      created_by: ME,
    })
    expect(pageInsertPayload({ collectionId: null, createdBy: ME, title: '   ' }).title).toBe(
      'Untitled',
    )
  })

  it('trims a given title and carries the collection', () => {
    const p = pageInsertPayload({ collectionId: POST, createdBy: ME, title: ' Roadmap ' })
    expect(p.title).toBe('Roadmap')
    expect(p.collection_id).toBe(POST)
  })
})

describe('savePatch', () => {
  it('carries title, document, and the client-stamped updated_at', () => {
    const doc = [{ type: 'paragraph', content: [] }]
    expect(savePatch(' Notes ', doc, '2026-08-22T10:00:00Z')).toEqual({
      title: 'Notes',
      body_rich: doc,
      updated_at: '2026-08-22T10:00:00Z',
    })
  })

  it('never writes an empty title', () => {
    expect(savePatch('', null, '2026-08-22T10:00:00Z').title).toBe('Untitled')
  })
})

describe('edit-lock patches', () => {
  it('heartbeatPatch touches only the two lock columns', () => {
    expect(heartbeatPatch(ME, '2026-08-22T10:00:00Z')).toEqual({
      editing_user_id: ME,
      editing_heartbeat_at: '2026-08-22T10:00:00Z',
    })
  })

  it('releasePatch clears both', () => {
    expect(releasePatch()).toEqual({ editing_user_id: null, editing_heartbeat_at: null })
  })
})

describe('editingBanner', () => {
  const now = Date.parse('2026-08-22T10:00:00Z')
  const fresh = new Date(now - 5_000).toISOString()

  it('names another user with a fresh heartbeat', () => {
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: fresh }, ME, now),
    ).toBe(OTHER)
  })

  it('never names yourself', () => {
    expect(editingBanner({ editing_user_id: ME, editing_heartbeat_at: fresh }, ME, now)).toBeNull()
  })

  it('is null with no claim at all', () => {
    expect(
      editingBanner({ editing_user_id: null, editing_heartbeat_at: null }, ME, now),
    ).toBeNull()
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: null }, ME, now),
    ).toBeNull()
  })

  it('drops a stale claim instead of naming a ghost', () => {
    const stale = new Date(now - HEARTBEAT_STALE_MS - 1).toISOString()
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: stale }, ME, now),
    ).toBeNull()
  })

  it('a heartbeat exactly at the threshold still counts', () => {
    const edge = new Date(now - HEARTBEAT_STALE_MS).toISOString()
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: edge }, ME, now),
    ).toBe(OTHER)
  })

  it('tolerates an unparseable timestamp', () => {
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: 'garbage' }, ME, now),
    ).toBeNull()
  })

  it('a signed-out reader (meId null) still sees the banner', () => {
    expect(
      editingBanner({ editing_user_id: OTHER, editing_heartbeat_at: fresh }, null, now),
    ).toBe(OTHER)
  })
})

describe('flattenTree', () => {
  it('walks depth-first with siblings in dragged position order', () => {
    // Names are deliberately the reverse of the positions: since beta round 3
    // the tree renders what was dragged, not what sorts alphabetically.
    const rows = flattenTree([
      collection({ id: 'b', name: 'Alpha', position: 2048 }),
      collection({ id: 'a', name: 'Beta', position: 1024 }),
      collection({ id: 'a2', name: 'Deep', parent_id: 'a', position: 2048 }),
      collection({ id: 'a1', name: 'Nested', parent_id: 'a', position: 1024 }),
    ])
    expect(rows.map((r) => [r.collection.id, r.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
    ])
  })

  it('breaks a position tie on id so the tree does not shuffle between renders', () => {
    const rows = flattenTree([
      collection({ id: 'z', name: 'Zulu', position: 1024 }),
      collection({ id: 'm', name: 'Mike', position: 1024 }),
    ])
    expect(rows.map((r) => r.collection.id)).toEqual(['m', 'z'])
  })

  it('renders an unknown parent_id at the root instead of hiding the row', () => {
    const rows = flattenTree([collection({ id: 'x', name: 'Orphan', parent_id: 'gone' })])
    expect(rows).toEqual([{ collection: expect.objectContaining({ id: 'x' }), depth: 0 }])
  })

  it('breaks a cycle instead of looping, and surfaces its members', () => {
    const rows = flattenTree([
      collection({ id: 'a', name: 'A', parent_id: 'b' }),
      collection({ id: 'b', name: 'B', parent_id: 'a' }),
    ])
    expect(rows.map((r) => r.collection.id).sort()).toEqual(['a', 'b'])
  })
})

describe('linkTargetFromHref', () => {
  it('resolves each internal URL shape the app mints', () => {
    expect(linkTargetFromHref(`/tasks?t=${TASK}`, ORIGIN)).toEqual({
      target_type: 'task',
      target_id: TASK,
    })
    expect(linkTargetFromHref(`/docs/${PAGE}`, ORIGIN)).toEqual({
      target_type: 'page',
      target_id: PAGE,
    })
    expect(linkTargetFromHref(`/posts/${POST}`, ORIGIN)).toEqual({
      target_type: 'post',
      target_id: POST,
    })
  })

  it('a ?m= parameter targets the exact message, on channels and posts alike', () => {
    expect(linkTargetFromHref(`/channels/${CHANNEL}?m=42`, ORIGIN)).toEqual({
      target_type: 'message',
      target_id: '42',
    })
    expect(linkTargetFromHref(`/posts/${POST}?m=42`, ORIGIN)).toEqual({
      target_type: 'message',
      target_id: '42',
    })
  })

  it('accepts absolute URLs only on our own origin', () => {
    expect(linkTargetFromHref(`${ORIGIN}/tasks?t=${TASK}`, ORIGIN)).toEqual({
      target_type: 'task',
      target_id: TASK,
    })
    expect(linkTargetFromHref(`https://example.com/tasks?t=${TASK}`, ORIGIN)).toBeNull()
  })

  it('rejects everything else', () => {
    expect(linkTargetFromHref('https://example.com/page', ORIGIN)).toBeNull()
    expect(linkTargetFromHref('mailto:team@example.com', ORIGIN)).toBeNull()
    expect(linkTargetFromHref('/channels/' + CHANNEL, ORIGIN)).toBeNull() // no ?m=
    expect(linkTargetFromHref('/tasks', ORIGIN)).toBeNull() // no ?t=
    expect(linkTargetFromHref('/channels/abc?m=notanumber', ORIGIN)).toBeNull()
    expect(linkTargetFromHref('docs/relative', ORIGIN)).toBeNull()
    expect(linkTargetFromHref(`/docs/${PAGE}/extra`, ORIGIN)).toBeNull()
  })
})

describe('linksFromDoc', () => {
  const link = (href: string, text = 'x') => ({
    type: 'link',
    href,
    content: [{ type: 'text', text, styles: {} }],
  })

  it('finds links in paragraph content, deduped in first-appearance order', () => {
    const doc = [
      {
        type: 'paragraph',
        content: [link(`/tasks?t=${TASK}`), { type: 'text', text: ' and ', styles: {} }, link(`/docs/${PAGE}`)],
      },
      { type: 'paragraph', content: [link(`/tasks?t=${TASK}`)] },
    ]
    expect(linksFromDoc(doc, ORIGIN)).toEqual([
      { target_type: 'task', target_id: TASK },
      { target_type: 'page', target_id: PAGE },
    ])
  })

  it('descends into nested children and table rows/cells', () => {
    const doc = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'top', styles: {} }],
        children: [{ type: 'bulletListItem', content: [link(`/posts/${POST}`)] }],
      },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [
            { cells: [[link(`/channels/${CHANNEL}?m=7`)]] },
            { cells: [{ type: 'tableCell', content: [link(`/docs/${PAGE}`)] }] },
          ],
        },
      },
    ]
    expect(linksFromDoc(doc, ORIGIN)).toEqual([
      { target_type: 'post', target_id: POST },
      { target_type: 'message', target_id: '7' },
      { target_type: 'page', target_id: PAGE },
    ])
  })

  it('ignores external links and survives foreign shapes', () => {
    expect(
      linksFromDoc([{ type: 'paragraph', content: [link('https://example.com')] }], ORIGIN),
    ).toEqual([])
    expect(linksFromDoc(null, ORIGIN)).toEqual([])
    expect(linksFromDoc('not a document', ORIGIN)).toEqual([])
    expect(linksFromDoc([{ type: 'paragraph' }], ORIGIN)).toEqual([])
  })
})

describe('linkForPage', () => {
  it('builds the references edge with the page as source', () => {
    expect(linkForPage(PAGE, { target_type: 'task', target_id: TASK })).toEqual({
      source_type: 'page',
      source_id: PAGE,
      target_type: 'task',
      target_id: TASK,
      kind: 'references',
    })
  })
})

describe('linkDiff', () => {
  const row = (id: string, target_type: string, target_id: string) => ({
    id,
    target_type,
    target_id,
  })

  it('adds what the document gained and removes what it lost, by row id', () => {
    const diff = linkDiff(
      [row('r1', 'task', TASK), row('r2', 'post', POST)],
      [
        { target_type: 'task', target_id: TASK },
        { target_type: 'page', target_id: PAGE },
      ],
    )
    expect(diff.add).toEqual([{ target_type: 'page', target_id: PAGE }])
    expect(diff.remove).toEqual(['r2'])
  })

  it('is a no-op when document and rows agree', () => {
    expect(
      linkDiff([row('r1', 'task', TASK)], [{ target_type: 'task', target_id: TASK }]),
    ).toEqual({ add: [], remove: [] })
  })
})
