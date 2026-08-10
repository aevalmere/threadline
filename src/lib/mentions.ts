/**
 * @mentions. Pure, so the parsing rules are unit-tested rather than
 * click-tested — the same reasoning as `channel-name.ts` and `username.ts`.
 *
 * **Mentions resolve on `username`, never `display_name`.** Usernames are
 * unique (SPEC §2.3); display names are not, so a mention of "Ethan" in a team
 * with two of them has no correct answer. This is why the account system
 * (DECISIONS #14) had to land before this did.
 *
 * **Stored as plain `@username` in `body`.** No `<@uuid>` markup:
 *
 *  * the body stays readable everywhere our components do not render it — a
 *    notification snippet, a `ts_headline` search result, a psql query;
 *  * `search_tsv` indexes words rather than uuids (SPEC §3);
 *  * P2 seeds a task title from a message body and would otherwise have to
 *    strip markup first.
 *
 * The cost is that a rename breaks older mentions of that person: the text
 * still reads `@ethan`, it just stops highlighting and stops being a link. At
 * this size that is cosmetic, and it is a better trade than uuids in the body.
 */

import { USERNAME_MAX } from '@/lib/username'

export interface MentionCandidate {
  id: string
  username: string
}

/** A `@username` that resolved, or the plain text around one. */
export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; userId: string; username: string }

/**
 * The characters a username can contain, per `profiles_username_format`.
 * Kept in step with `src/lib/username.ts` — a mention that stops scanning
 * earlier than the column allows would truncate a legal name.
 */
const USERNAME_CHARS = /[a-z0-9._-]/

/**
 * True when the character before a `@` allows it to start a mention.
 *
 * Start-of-text or whitespace only. This is what keeps `a@b.com` from being
 * read as a mention of `@b`, and it lives in one place so the three functions
 * below cannot spell it differently.
 */
function canStartMention(text: string, at: number): boolean {
  if (at === 0) return true
  return /\s/.test(text[at - 1])
}

/**
 * How far a username could possibly run from `start`.
 *
 * A username may contain `.` `-` `_`, so `@ethan.zhang50` is a single candidate
 * token rather than `@ethan` followed by punctuation. The caller then tries
 * progressively shorter prefixes, longest first — `ethan` and `ethan.zhang50`
 * can both exist, and the longer one has to win.
 */
function tokenEnd(text: string, start: number): number {
  let i = start
  while (i < text.length && USERNAME_CHARS.test(text[i].toLowerCase())) i += 1
  return i
}

/**
 * The mention being typed at the caret, if any.
 *
 * Returns the `@`'s index and the partial username after it, so the caller can
 * filter the picker and know what to replace. Null when the caret is not inside
 * a mention token.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  // Walk back from the caret to the nearest `@`, stopping at whitespace — a
  // mention token never contains a space, so anything further back belongs to
  // an earlier word.
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i]
    if (/\s/.test(ch)) return null
    if (ch === '@') {
      if (!canStartMention(text, i)) return null
      return { start: i, query: text.slice(i + 1, caret) }
    }
  }
  return null
}

/**
 * Teammates matching a partial mention, best-first.
 *
 * An empty query — the moment `@` is typed — lists everyone, which makes the
 * picker a browsable member list rather than something you must guess the first
 * letter of. Prefix matches rank above contains-matches, so `@et` puts `ethan`
 * above `margaret`.
 */
export function matchMentions<T extends MentionCandidate>(
  query: string,
  profiles: readonly T[],
  limit = 8,
): T[] {
  const q = query.toLowerCase()
  const scored: { p: T; rank: number }[] = []

  for (const p of profiles) {
    const name = p.username.toLowerCase()
    if (!q) scored.push({ p, rank: 1 })
    else if (name.startsWith(q)) scored.push({ p, rank: 0 })
    else if (name.includes(q)) scored.push({ p, rank: 1 })
  }

  scored.sort((a, b) => a.rank - b.rank || a.p.username.localeCompare(b.p.username))
  return scored.slice(0, limit).map((s) => s.p)
}

/**
 * Replace the partial mention at the caret with a full one.
 *
 * Appends a trailing space so the next word is not glued to the name, and
 * reports where the caret should land — the textarea has to be told, because
 * setting `value` programmatically otherwise drops the caret at the end.
 */
export function applyMention(
  text: string,
  caret: number,
  username: string,
): { text: string; caret: number } {
  const found = mentionQueryAt(text, caret)
  if (!found) return { text, caret }

  // Replace to the end of the token being typed, not merely to the caret —
  // otherwise editing the middle of `@ethanzz` leaves the tail behind.
  const end = tokenEnd(text, found.start + 1)
  const inserted = `@${username} `
  return {
    text: text.slice(0, found.start) + inserted + text.slice(Math.max(caret, end)),
    caret: found.start + inserted.length,
  }
}

/**
 * Split a body into text and resolved-mention segments, for rendering.
 *
 * Adjacent text is not merged — rendering the segments in order reproduces the
 * original string either way, and merging would cost a pass for no gain.
 */
export function splitMentions(
  body: string,
  profiles: readonly MentionCandidate[],
): MentionSegment[] {
  const byName = new Map(profiles.map((p) => [p.username.toLowerCase(), p]))
  const segments: MentionSegment[] = []
  let plain = ''
  let i = 0

  while (i < body.length) {
    if (body[i] === '@' && canStartMention(body, i)) {
      // Bounded by the longest legal username, not by the token. Without the
      // cap this loop is O(k²) in the token length — a whitespace-preceded `@`
      // followed by ten thousand dots is a legal message, and it would cost
      // ~10^8 character operations on *every render* of that message.
      const end = Math.min(tokenEnd(body, i + 1), i + 1 + USERNAME_MAX)
      // Longest first: `ethan` and `ethan.zhang50` can both be real, and
      // stopping at the first hit would resolve the wrong one.
      let matched: MentionCandidate | undefined
      let matchedTo = i + 1
      for (let j = end; j > i + 1; j -= 1) {
        const hit = byName.get(body.slice(i + 1, j).toLowerCase())
        if (hit) {
          matched = hit
          matchedTo = j
          break
        }
      }

      if (matched) {
        if (plain) {
          segments.push({ kind: 'text', text: plain })
          plain = ''
        }
        segments.push({
          kind: 'mention',
          text: body.slice(i, matchedTo),
          userId: matched.id,
          username: matched.username,
        })
        i = matchedTo
        continue
      }
    }
    plain += body[i]
    i += 1
  }

  if (plain) segments.push({ kind: 'text', text: plain })
  return segments
}

/**
 * Every teammate mentioned in a body, deduped, in the order they appear.
 *
 * This decides who gets a `notification` row, so it shares `splitMentions`'
 * matching rather than reimplementing it — two parsers that disagree would mean
 * highlighting someone the database never notified, or the reverse.
 */
export function parseMentions(
  body: string,
  profiles: readonly MentionCandidate[],
): string[] {
  const seen = new Set<string>()
  for (const seg of splitMentions(body, profiles)) {
    if (seg.kind === 'mention') seen.add(seg.userId)
  }
  return [...seen]
}
