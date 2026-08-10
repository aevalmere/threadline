import { describe, expect, it } from 'vitest'

import {
  dropPending,
  markPending,
  reconcilePending,
  reconcilePendingForChannel,
  sweepQuery,
  type PendingMessage,
} from '@/lib/pending'

const ALICE = 'alice-uuid'
const BOB = 'bob-uuid'

function pending(
  key: string,
  body: string,
  authorId = ALICE,
  sinceId = 100,
  channelId = 'channel-uuid',
  threadRootId: number | null = null,
): PendingMessage {
  return { key, body, authorId, channelId, threadRootId, sinceId, status: 'sending' }
}

function confirmed(
  id: number,
  body: string,
  author_id = ALICE,
  thread_root_id: number | null = null,
) {
  return { id, body, author_id, thread_root_id }
}

describe('reconcilePending', () => {
  it('returns nothing when there is nothing pending', () => {
    expect(reconcilePending([], [confirmed(101, 'hello')])).toEqual([])
  })

  it('keeps everything when no confirmed row matches', () => {
    const p = [pending('k1', 'hello')]
    expect(reconcilePending(p, [confirmed(101, 'different')])).toEqual(p)
  })

  it('drops a pending entry once its row comes back', () => {
    const p = [pending('k1', 'hello')]
    expect(reconcilePending(p, [confirmed(101, 'hello')])).toEqual([])
  })

  it('ignores a row that predates the send', () => {
    // id 99 existed before the message was typed, so it cannot be the echo.
    const p = [pending('k1', 'hello', ALICE, 100)]
    expect(reconcilePending(p, [confirmed(99, 'hello')])).toEqual(p)
  })

  it('ignores an identical body from a different author', () => {
    const p = [pending('k1', 'hello', ALICE)]
    expect(reconcilePending(p, [confirmed(101, 'hello', BOB)])).toEqual(p)
  })

  it('cancels one pending entry per confirmed row, not all of them', () => {
    const p = [pending('k1', 'on it'), pending('k2', 'on it')]
    const left = reconcilePending(p, [confirmed(101, 'on it')])
    expect(left).toHaveLength(1)
    expect(left[0].key).toBe('k2')
  })

  it('clears both once both rows arrive', () => {
    const p = [pending('k1', 'on it'), pending('k2', 'on it')]
    expect(reconcilePending(p, [confirmed(101, 'on it'), confirmed(102, 'on it')])).toEqual(
      [],
    )
  })

  it('matches the oldest pending entry first', () => {
    const p = [pending('k1', 'same'), pending('k2', 'same')]
    const left = reconcilePending(p, [confirmed(105, 'same')])
    expect(left.map((x) => x.key)).toEqual(['k2'])
  })

  it('reconciles a failed entry too — a send can error after the row landed', () => {
    const p: PendingMessage[] = [{ ...pending('k1', 'hello'), status: 'failed' }]
    expect(reconcilePending(p, [confirmed(101, 'hello')])).toEqual([])
  })

  it('does not let a reply claim a top-level bubble with the same text', () => {
    const p = [pending('k1', 'ok')] // top-level: threadRootId null
    const asReply = [confirmed(101, 'ok', ALICE, 42)]
    expect(reconcilePending(p, asReply)).toEqual(p)
  })

  it('matches a reply to its own thread', () => {
    const p = [pending('k1', 'ok', ALICE, 100, 'channel-uuid', 42)]
    expect(reconcilePending(p, [confirmed(101, 'ok', ALICE, 42)])).toEqual([])
  })

  it('does not let a reply in another thread claim it', () => {
    const p = [pending('k1', 'ok', ALICE, 100, 'channel-uuid', 42)]
    const otherThread = [confirmed(101, 'ok', ALICE, 99)]
    expect(reconcilePending(p, otherThread)).toEqual(p)
  })

  it('preserves the order of what remains', () => {
    const p = [pending('k1', 'a'), pending('k2', 'b'), pending('k3', 'c')]
    const left = reconcilePending(p, [confirmed(101, 'b')])
    expect(left.map((x) => x.key)).toEqual(['k1', 'k3'])
  })

  it('does not mutate its input', () => {
    const p = [pending('k1', 'hello')]
    const copy = structuredClone(p)
    reconcilePending(p, [confirmed(101, 'hello')])
    expect(p).toEqual(copy)
  })
})

describe('reconcilePendingForChannel', () => {
  const RANDOM = 'channel-random'
  const GENERAL = 'channel-general'

  function row(id: number, body: string, channel_id: string, author_id = ALICE) {
    return { id, body, channel_id, author_id, thread_root_id: null }
  }

  it('drops an entry confirmed by a row in the same channel', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    expect(reconcilePendingForChannel(p, [row(101, 'ok', RANDOM)], RANDOM)).toEqual([])
  })

  it('does NOT let another channel’s identical message claim the entry', () => {
    // The regression this function exists for: ids are one global sequence, so
    // a later #general message can outrank a #random entry's sinceId.
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const generalRows = [row(500, 'ok', GENERAL)]
    expect(reconcilePendingForChannel(p, generalRows, RANDOM)).toEqual(p)
  })

  it('is a no-op while the loaded rows still belong to the previous channel', () => {
    const p = [pending('k1', 'thanks', ALICE, 1, RANDOM)]
    expect(reconcilePendingForChannel(p, [row(9, 'thanks', GENERAL)], RANDOM)).toEqual(p)
  })

  it('leaves other channels’ entries untouched while reconciling this one', () => {
    const p = [
      pending('k-random', 'ok', ALICE, 100, RANDOM),
      pending('k-general', 'ok', ALICE, 100, GENERAL),
    ]
    const left = reconcilePendingForChannel(p, [row(101, 'ok', RANDOM)], RANDOM)
    expect(left.map((x) => x.key)).toEqual(['k-general'])
  })

  it('ignores rows from a channel nobody is pending in', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const mixed = [row(101, 'ok', GENERAL), row(102, 'ok', RANDOM)]
    expect(reconcilePendingForChannel(p, mixed, RANDOM)).toEqual([])
  })

  it('returns everything when nothing is pending for this channel', () => {
    const p = [pending('k1', 'ok', ALICE, 100, GENERAL)]
    expect(reconcilePendingForChannel(p, [row(101, 'ok', RANDOM)], RANDOM)).toEqual(p)
  })

  it('tolerates a null channel_id without matching it', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const orphan = [
      { id: 101, body: 'ok', channel_id: null, author_id: ALICE, thread_root_id: null },
    ]
    expect(reconcilePendingForChannel(p, orphan, RANDOM)).toEqual(p)
  })

  it('preserves order across channels', () => {
    const p = [
      pending('k1', 'a', ALICE, 100, GENERAL),
      pending('k2', 'b', ALICE, 100, RANDOM),
      pending('k3', 'c', ALICE, 100, GENERAL),
    ]
    const left = reconcilePendingForChannel(p, [row(101, 'b', RANDOM)], RANDOM)
    expect(left.map((x) => x.key)).toEqual(['k1', 'k3'])
  })
})

describe('markPending', () => {
  it('flips only the addressed entry', () => {
    const p = [pending('k1', 'a'), pending('k2', 'b')]
    const next = markPending(p, 'k2', 'failed')
    expect(next.map((x) => x.status)).toEqual(['sending', 'failed'])
  })

  it('is a no-op for an unknown key', () => {
    const p = [pending('k1', 'a')]
    expect(markPending(p, 'nope', 'failed')).toEqual(p)
  })
})

describe('dropPending', () => {
  it('removes the addressed entry', () => {
    const p = [pending('k1', 'a'), pending('k2', 'b')]
    expect(dropPending(p, 'k1').map((x) => x.key)).toEqual(['k2'])
  })
})

/**
 * `sweepQuery` — the decision half of the stuck-bubble sweep (SPEC §1.5,
 * ROADMAP's known gap against reconnect-and-resync).
 *
 * A send that succeeds *after* you leave a channel keeps its bubble, and on
 * return the newest-50 page may not contain the confirming row, so the ordinary
 * reconcile never sees it. The sweep asks a narrower question instead. These
 * pin *what it asks*; `reconcilePendingForChannel` above pins what it does with
 * the answer. Deleting either half fails this file.
 */
describe('sweepQuery', () => {
  const ME = 'user-me'
  const CH = 'channel-a'

  const entry = (over: Partial<PendingMessage> = {}): PendingMessage => ({
    key: 'k1',
    body: 'did this send?',
    authorId: ME,
    channelId: CH,
    threadRootId: null,
    sinceId: 100,
    status: 'sending',
    ...over,
  })

  it('asks for nothing when nothing is outstanding', () => {
    expect(sweepQuery([], CH, ME)).toBeNull()
  })

  it('asks for my messages after the outstanding send', () => {
    expect(sweepQuery([entry()], CH, ME)).toEqual({ authorId: ME, afterId: 100 })
  })

  it('takes the oldest bound, not the newest', () => {
    // A higher bound would exclude the confirmation of the oldest stuck entry —
    // the one most likely to have scrolled out of the first page.
    const out = sweepQuery(
      [entry({ key: 'a', sinceId: 500 }), entry({ key: 'b', sinceId: 100 })],
      CH,
      ME,
    )
    expect(out).toEqual({ authorId: ME, afterId: 100 })
  })

  it('ignores another channel’s outstanding sends', () => {
    expect(sweepQuery([entry({ channelId: 'channel-b' })], CH, ME)).toBeNull()
    // …including when computing the bound.
    const out = sweepQuery(
      [entry({ key: 'a', channelId: 'channel-b', sinceId: 1 }), entry({ key: 'b' })],
      CH,
      ME,
    )
    expect(out).toEqual({ authorId: ME, afterId: 100 })
  })

  it('includes failed entries — a send can error after its row landed', () => {
    expect(sweepQuery([entry({ status: 'failed' })], CH, ME)).toEqual({
      authorId: ME,
      afterId: 100,
    })
  })

  it('ignores entries belonging to somebody else', () => {
    expect(sweepQuery([entry({ authorId: 'someone-else' })], CH, ME)).toBeNull()
  })
})
