import { describe, expect, it } from 'vitest'

import { replyCount, splitThreads, threadRootFor } from '@/lib/threads'

function root(id: number) {
  return { id, thread_root_id: null }
}
function reply(id: number, rootId: number) {
  return { id, thread_root_id: rootId }
}

describe('threadRootFor', () => {
  it('targets a top-level message itself', () => {
    expect(threadRootFor(root(10))).toBe(10)
  })

  it('targets a reply’s root, not the reply — threads are one level deep', () => {
    expect(threadRootFor(reply(11, 10))).toBe(10)
  })

  it('never nests, however deep the chain of replies looks', () => {
    // Both replies already belong to root 10; replying to either stays on 10.
    expect(threadRootFor(reply(12, 10))).toBe(10)
    expect(threadRootFor(reply(13, 10))).toBe(10)
  })
})

describe('splitThreads', () => {
  it('handles an empty page', () => {
    const s = splitThreads([])
    expect(s.roots).toEqual([])
    expect(s.repliesByRoot.size).toBe(0)
  })

  it('treats every top-level message as a root', () => {
    const s = splitThreads([root(1), root(2)])
    expect(s.roots.map((m) => m.id)).toEqual([1, 2])
    expect(s.repliesByRoot.size).toBe(0)
  })

  it('files replies under their root and keeps them out of the main list', () => {
    const s = splitThreads([root(1), reply(2, 1), reply(3, 1), root(4)])
    expect(s.roots.map((m) => m.id)).toEqual([1, 4])
    expect(s.repliesByRoot.get(1)?.map((m) => m.id)).toEqual([2, 3])
  })

  it('keeps threads separate', () => {
    const s = splitThreads([root(1), root(2), reply(3, 1), reply(4, 2)])
    expect(s.repliesByRoot.get(1)?.map((m) => m.id)).toEqual([3])
    expect(s.repliesByRoot.get(2)?.map((m) => m.id)).toEqual([4])
  })

  it('promotes an orphan reply rather than hiding it', () => {
    // Root 1 scrolled out of the loaded page; its reply must still render.
    const s = splitThreads([reply(2, 1), root(3)])
    expect(s.roots.map((m) => m.id)).toEqual([2, 3])
    expect(s.repliesByRoot.size).toBe(0)
  })

  it('sorts roots by id regardless of input order', () => {
    const s = splitThreads([root(9), root(2), root(5)])
    expect(s.roots.map((m) => m.id)).toEqual([2, 5, 9])
  })

  it('sorts replies within a thread by id', () => {
    const s = splitThreads([root(1), reply(7, 1), reply(3, 1)])
    expect(s.repliesByRoot.get(1)?.map((m) => m.id)).toEqual([3, 7])
  })

  it('loses no message', () => {
    const input = [root(1), reply(2, 1), root(3), reply(4, 99), reply(5, 3)]
    const s = splitThreads(input)
    const seen = [...s.roots, ...[...s.repliesByRoot.values()].flat()].map((m) => m.id)
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('replyCount', () => {
  it('counts a thread’s replies', () => {
    const s = splitThreads([root(1), reply(2, 1), reply(3, 1)])
    expect(replyCount(s, 1)).toBe(2)
  })

  it('is zero for a root with no replies and for an unknown id', () => {
    const s = splitThreads([root(1)])
    expect(replyCount(s, 1)).toBe(0)
    expect(replyCount(s, 404)).toBe(0)
  })
})
