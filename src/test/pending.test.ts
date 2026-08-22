import { describe, expect, it } from 'vitest'

import { channelParent, postParent } from '@/lib/messages'
import {
  dropPending,
  markPending,
  reconcilePending,
  reconcilePendingForParent,
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
  return {
    key,
    body,
    authorId,
    parent: channelParent(channelId),
    threadRootId,
    sinceId,
    status: 'sending',
  }
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

describe('reconcilePendingForParent', () => {
  const RANDOM = 'channel-random'
  const GENERAL = 'channel-general'
  const POST = 'post-uuid'

  function row(id: number, body: string, channel_id: string, author_id = ALICE) {
    return { id, body, channel_id, post_id: null, author_id, thread_root_id: null }
  }

  function commentRow(id: number, body: string, post_id: string, author_id = ALICE) {
    return { id, body, channel_id: null, post_id, author_id, thread_root_id: null }
  }

  it('drops an entry confirmed by a row in the same channel', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    expect(
      reconcilePendingForParent(p, [row(101, 'ok', RANDOM)], channelParent(RANDOM)),
    ).toEqual([])
  })

  it('does NOT let another channel’s identical message claim the entry', () => {
    // The regression this function exists for: ids are one global sequence, so
    // a later #general message can outrank a #random entry's sinceId.
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const generalRows = [row(500, 'ok', GENERAL)]
    expect(reconcilePendingForParent(p, generalRows, channelParent(RANDOM))).toEqual(p)
  })

  it('is a no-op while the loaded rows still belong to the previous channel', () => {
    const p = [pending('k1', 'thanks', ALICE, 1, RANDOM)]
    expect(
      reconcilePendingForParent(p, [row(9, 'thanks', GENERAL)], channelParent(RANDOM)),
    ).toEqual(p)
  })

  it('leaves other channels’ entries untouched while reconciling this one', () => {
    const p = [
      pending('k-random', 'ok', ALICE, 100, RANDOM),
      pending('k-general', 'ok', ALICE, 100, GENERAL),
    ]
    const left = reconcilePendingForParent(p, [row(101, 'ok', RANDOM)], channelParent(RANDOM))
    expect(left.map((x) => x.key)).toEqual(['k-general'])
  })

  it('ignores rows from a channel nobody is pending in', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const mixed = [row(101, 'ok', GENERAL), row(102, 'ok', RANDOM)]
    expect(reconcilePendingForParent(p, mixed, channelParent(RANDOM))).toEqual([])
  })

  it('returns everything when nothing is pending for this channel', () => {
    const p = [pending('k1', 'ok', ALICE, 100, GENERAL)]
    expect(
      reconcilePendingForParent(p, [row(101, 'ok', RANDOM)], channelParent(RANDOM)),
    ).toEqual(p)
  })

  it('tolerates a null channel_id without matching it', () => {
    const p = [pending('k1', 'ok', ALICE, 100, RANDOM)]
    const orphan = [
      {
        id: 101,
        body: 'ok',
        channel_id: null,
        post_id: null,
        author_id: ALICE,
        thread_root_id: null,
      },
    ]
    expect(reconcilePendingForParent(p, orphan, channelParent(RANDOM))).toEqual(p)
  })

  it('preserves order across channels', () => {
    const p = [
      pending('k1', 'a', ALICE, 100, GENERAL),
      pending('k2', 'b', ALICE, 100, RANDOM),
      pending('k3', 'c', ALICE, 100, GENERAL),
    ]
    const left = reconcilePendingForParent(p, [row(101, 'b', RANDOM)], channelParent(RANDOM))
    expect(left.map((x) => x.key)).toEqual(['k1', 'k3'])
  })

  // The P3 half of the same coin: comments are messages keyed by post_id
  // (SPEC §1.3), and the reconciler must scope on whichever column the parent
  // names — not assume channel_id.
  it('drops a comment entry confirmed by a row under the same post', () => {
    const p: PendingMessage[] = [
      { ...pending('k1', 'ok', ALICE, 100), parent: postParent(POST) },
    ]
    expect(
      reconcilePendingForParent(p, [commentRow(101, 'ok', POST)], postParent(POST)),
    ).toEqual([])
  })

  it('does NOT let a channel row claim a comment entry, or vice versa', () => {
    const p: PendingMessage[] = [
      { ...pending('k1', 'ok', ALICE, 100), parent: postParent(POST) },
    ]
    expect(
      reconcilePendingForParent(p, [row(500, 'ok', RANDOM)], postParent(POST)),
    ).toEqual(p)

    const q = [pending('k2', 'ok', ALICE, 100, RANDOM)]
    expect(
      reconcilePendingForParent(q, [commentRow(500, 'ok', POST)], channelParent(RANDOM)),
    ).toEqual(q)
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
 * pin *what it asks*; `reconcilePendingForParent` above pins what it does with
 * the answer. Deleting either half fails this file.
 */
describe('sweepQuery', () => {
  const ME = 'user-me'
  const CH = channelParent('channel-a')

  const entry = (over: Partial<PendingMessage> = {}): PendingMessage => ({
    key: 'k1',
    body: 'did this send?',
    authorId: ME,
    parent: CH,
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

  it('ignores another parent’s outstanding sends', () => {
    expect(sweepQuery([entry({ parent: channelParent('channel-b') })], CH, ME)).toBeNull()
    // …including when computing the bound.
    const out = sweepQuery(
      [
        entry({ key: 'a', parent: channelParent('channel-b'), sinceId: 1 }),
        entry({ key: 'b' }),
      ],
      CH,
      ME,
    )
    expect(out).toEqual({ authorId: ME, afterId: 100 })
    // A post parent with the same id string is still a different parent.
    expect(sweepQuery([entry({ parent: postParent('channel-a') })], CH, ME)).toBeNull()
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
