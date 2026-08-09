import { describe, expect, it } from 'vitest'

import {
  dropPending,
  markPending,
  reconcilePending,
  reconcilePendingForChannel,
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
): PendingMessage {
  return { key, body, authorId, channelId, sinceId, status: 'sending' }
}

function confirmed(id: number, body: string, author_id = ALICE) {
  return { id, body, author_id }
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
    return { id, body, channel_id, author_id }
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
    const orphan = [{ id: 101, body: 'ok', channel_id: null, author_id: ALICE }]
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
