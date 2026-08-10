import { describe, expect, it } from 'vitest'

import { resolveJump } from '@/lib/jump'

const ROOT = { id: 10, thread_root_id: null }
const REPLY = { id: 11, thread_root_id: 10 }

/** The settled, happy state: #general's page is loaded and we are on #general. */
function base(over: Partial<Parameters<typeof resolveJump>[0]> = {}) {
  return resolveJump({
    jumpTo: '10',
    loading: false,
    loadedChannelId: 'general',
    channelId: 'general',
    messages: [ROOT, REPLY],
    ...over,
  })
}

describe('resolveJump', () => {
  it('is idle without a parameter', () => {
    expect(base({ jumpTo: null })).toEqual({ status: 'idle' })
    expect(base({ jumpTo: '' })).toEqual({ status: 'idle' })
  })

  it('finds a top-level message and opens no thread', () => {
    expect(base()).toEqual({ status: 'hit', id: 10, openThread: null })
  })

  it('opens the thread when the target is a reply', () => {
    // The reason `reply` notifications were broken: a reply is only rendered
    // inside an expanded thread, so the row does not exist until it opens.
    expect(base({ jumpTo: '11' })).toEqual({ status: 'hit', id: 11, openThread: 10 })
  })

  it('waits while the page is still loading', () => {
    expect(base({ loading: true })).toEqual({ status: 'wait' })
  })

  /**
   * The regression that matters. Navigating between channels re-renders without
   * remounting, so for one commit `channelId` is the new channel while the
   * loaded rows are still the old one's. Consuming here would clear `?m=`
   * before the target could exist, and the jump would never happen.
   */
  it('waits when the loaded page belongs to a different channel', () => {
    expect(
      base({ channelId: 'random', loadedChannelId: 'general', messages: [ROOT] }),
    ).toEqual({ status: 'wait' })
  })

  it('waits before any page has loaded at all', () => {
    expect(base({ loadedChannelId: undefined })).toEqual({ status: 'wait' })
  })

  it('waits when there is no routed channel yet', () => {
    expect(base({ channelId: undefined })).toEqual({ status: 'wait' })
  })

  it('hits once the new channel’s page has landed', () => {
    expect(
      base({ channelId: 'random', loadedChannelId: 'random', messages: [ROOT] }),
    ).toEqual({ status: 'hit', id: 10, openThread: null })
  })

  it('misses when the message is not in the loaded page', () => {
    expect(base({ jumpTo: '999' })).toEqual({ status: 'miss' })
  })

  it('misses on a parameter that is not a message id', () => {
    // Asserted exactly, not as `miss || idle` — that weaker form would also
    // pass an implementation that returned `idle` for everything.
    for (const bad of ['abc', '1.5', 'NaN', '1e3x', '10abc']) {
      expect(base({ jumpTo: bad }).status).toBe('miss')
    }
    // Empty is genuinely nothing to do, not a bad id.
    expect(base({ jumpTo: '' }).status).toBe('idle')
  })

  it('never reports a hit while waiting — the parameter must survive', () => {
    // Anything that is not a hit and not a miss has to be `wait`, because only
    // `hit` and `miss` are allowed to clear `?m=`.
    const waiting = [
      base({ loading: true }),
      base({ loadedChannelId: 'other' }),
      base({ loadedChannelId: undefined }),
    ]
    for (const d of waiting) expect(d.status).toBe('wait')
  })
})
