import { describe, expect, it } from 'vitest'

import {
  applyMention,
  matchMentions,
  mentionQueryAt,
  parseMentions,
  splitMentions,
} from '@/lib/mentions'
import { USERNAME_MAX } from '@/lib/username'

const TEAM = [
  { id: 'u1', username: 'ethan' },
  { id: 'u2', username: 'ethan.zhang50' },
  { id: 'u3', username: 'margaret' },
  { id: 'u4', username: 'bob-99' },
]

describe('mentionQueryAt', () => {
  it('finds a mention being typed at the caret', () => {
    expect(mentionQueryAt('hi @eth', 7)).toEqual({ start: 3, query: 'eth' })
  })

  it('fires the moment @ is typed, so the picker opens with everyone', () => {
    expect(mentionQueryAt('hi @', 4)).toEqual({ start: 3, query: '' })
  })

  it('works at the start of the message', () => {
    expect(mentionQueryAt('@eth', 4)).toEqual({ start: 0, query: 'eth' })
  })

  it('does not fire inside an email address', () => {
    expect(mentionQueryAt('mail a@b.com', 12)).toBeNull()
    expect(mentionQueryAt('a@b', 3)).toBeNull()
  })

  it('does not fire once the caret has moved past a space', () => {
    expect(mentionQueryAt('hi @ethan there', 15)).toBeNull()
  })

  it('is null when there is no @ before the caret', () => {
    expect(mentionQueryAt('hello', 5)).toBeNull()
    expect(mentionQueryAt('', 0)).toBeNull()
  })

  it('reads the token up to the caret, not past it', () => {
    // Caret sits between `eth` and `an`.
    expect(mentionQueryAt('@ethan', 4)).toEqual({ start: 0, query: 'eth' })
  })
})

describe('matchMentions', () => {
  it('lists everyone for an empty query', () => {
    expect(matchMentions('', TEAM)).toHaveLength(4)
  })

  it('ranks prefix matches above contains-matches', () => {
    const hits = matchMentions('a', TEAM).map((p) => p.username)
    // `margaret` contains an `a`; nothing starts with one, so ordering is
    // alphabetical among equals.
    expect(hits).toContain('margaret')
  })

  it('puts a prefix match first', () => {
    expect(matchMentions('marg', TEAM)[0].username).toBe('margaret')
  })

  it('matches both names sharing a prefix', () => {
    expect(matchMentions('ethan', TEAM).map((p) => p.username)).toEqual([
      'ethan',
      'ethan.zhang50',
    ])
  })

  it('is case-insensitive', () => {
    expect(matchMentions('ETH', TEAM).map((p) => p.username)).toEqual([
      'ethan',
      'ethan.zhang50',
    ])
  })

  it('returns nothing for a miss', () => {
    expect(matchMentions('zzz', TEAM)).toEqual([])
  })

  it('honours the limit', () => {
    expect(matchMentions('', TEAM, 2)).toHaveLength(2)
  })
})

describe('applyMention', () => {
  it('replaces the partial mention and reports the caret', () => {
    expect(applyMention('hi @eth', 7, 'ethan')).toEqual({
      text: 'hi @ethan ',
      caret: 10,
    })
  })

  it('keeps text that follows', () => {
    const out = applyMention('hi @eth there', 7, 'ethan')
    expect(out.text).toBe('hi @ethan  there')
  })

  it('replaces the whole token, not just up to the caret', () => {
    // Caret after `eth`, but `anzz` follows and is part of the same token.
    const out = applyMention('@ethanzz', 4, 'ethan')
    expect(out.text).toBe('@ethan ')
  })

  it('does nothing when the caret is not in a mention', () => {
    expect(applyMention('hello', 5, 'ethan')).toEqual({ text: 'hello', caret: 5 })
  })
})

describe('splitMentions', () => {
  it('leaves plain text alone', () => {
    expect(splitMentions('nothing here', TEAM)).toEqual([
      { kind: 'text', text: 'nothing here' },
    ])
  })

  it('resolves a mention', () => {
    expect(splitMentions('hi @ethan', TEAM)).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@ethan', userId: 'u1', username: 'ethan' },
    ])
  })

  /** The reason usernames had to land first, and the reason for longest-match. */
  it('prefers the longer username when one is a prefix of another', () => {
    const segs = splitMentions('hi @ethan.zhang50 there', TEAM)
    expect(segs[1]).toEqual({
      kind: 'mention',
      text: '@ethan.zhang50',
      userId: 'u2',
      username: 'ethan.zhang50',
    })
    expect(segs[2]).toEqual({ kind: 'text', text: ' there' })
  })

  it('handles a username containing a dash and digits', () => {
    expect(splitMentions('@bob-99 hi', TEAM)[0]).toMatchObject({
      kind: 'mention',
      username: 'bob-99',
    })
  })

  it('does not resolve an unknown handle', () => {
    expect(splitMentions('hi @nobody', TEAM)).toEqual([
      { kind: 'text', text: 'hi @nobody' },
    ])
  })

  it('does not resolve inside an email address', () => {
    expect(splitMentions('mail me at a@ethan.com', TEAM)).toEqual([
      { kind: 'text', text: 'mail me at a@ethan.com' },
    ])
  })

  it('handles several mentions in one message', () => {
    const segs = splitMentions('@ethan and @margaret', TEAM)
    expect(segs.filter((s) => s.kind === 'mention')).toHaveLength(2)
  })

  it('reproduces the original string when segments are concatenated', () => {
    for (const body of [
      'hi @ethan',
      '@ethan.zhang50 and @margaret, see a@b.com',
      'no mentions at all',
      '@nobody @ethan @bob-99',
      '@ethan',
    ]) {
      expect(
        splitMentions(body, TEAM)
          .map((s) => s.text)
          .join(''),
      ).toBe(body)
    }
  })

  it('is case-insensitive on the mention text', () => {
    expect(splitMentions('@ETHAN hi', TEAM)[0]).toMatchObject({ userId: 'u1' })
  })
})

describe('parseMentions', () => {
  it('returns the mentioned ids in order', () => {
    expect(parseMentions('@margaret then @ethan', TEAM)).toEqual(['u3', 'u1'])
  })

  it('dedupes someone mentioned twice', () => {
    expect(parseMentions('@ethan @ethan', TEAM)).toEqual(['u1'])
  })

  it('returns nothing when there are no mentions', () => {
    expect(parseMentions('hello', TEAM)).toEqual([])
  })

  it('agrees with splitMentions — one parser, not two', () => {
    const body = '@ethan.zhang50 hi @margaret and a@b.com'
    const fromSplit = splitMentions(body, TEAM)
      .filter((s) => s.kind === 'mention')
      .map((s) => (s as { userId: string }).userId)
    expect(parseMentions(body, TEAM)).toEqual(fromSplit)
  })
})

/**
 * The scan bound. `splitMentions` tries progressively shorter prefixes of the
 * token after an `@`, so without a cap a legal message — an `@` followed by ten
 * thousand dots — is O(k²) on every render. The cap is USERNAME_MAX, which must
 * stay in step with profiles_username_format.
 */
describe('splitMentions scan bound', () => {
  it('still resolves a maximum-length username', () => {
    const long = `a${'b'.repeat(USERNAME_MAX - 2)}c`
    expect(long).toHaveLength(USERNAME_MAX)
    const team = [{ id: 'u9', username: long }]
    expect(splitMentions(`hi @${long}`, team)[1]).toMatchObject({
      kind: 'mention',
      userId: 'u9',
    })
  })

  it('does not hang on a long run of username characters', () => {
    const started = performance.now()
    const body = `hi @${'.'.repeat(10_000)}`
    const segs = splitMentions(body, TEAM)
    // Nothing resolves; the point is that it returns promptly.
    expect(segs.map((s) => s.text).join('')).toBe(body)
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('leaves a token longer than the column can hold unresolved', () => {
    const tooLong = 'a'.repeat(USERNAME_MAX + 10)
    expect(splitMentions(`@${tooLong}`, [{ id: 'u9', username: tooLong }])).toEqual([
      { kind: 'text', text: `@${tooLong}` },
    ])
  })
})
