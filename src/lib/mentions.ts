/**
 * @mentions. Pure, so the parsing rules are unit-tested rather than
 * click-tested — the same reasoning as `channel-name.ts` and `pending.ts`.
 *
 * **Mentions are stored as plain `@display_name` in `body`.** No `<@uuid>`
 * markup. Three reasons:
 *
 *  * the body stays readable everywhere it is not rendered by our components —
 *    a notification snippet, a `ts_headline` search result, a psql query;
 *  * `search_tsv` indexes words rather than uuids (SPEC §3);
 *  * P2 seeds a task title from a message body, and would otherwise have to
 *    strip markup first.
 *
 * The cost is that resolution depends on the profile list at the time the text
 * is read, so renaming a teammate breaks older mentions of them. At 5–30
 * teammates whose names come from their email local part, renames are rare and
 * the failure is cosmetic: the text still reads `@ethan`, it just stops
 * highlighting. That is a better trade than uuids in the body.
 */

export interface MentionCandidate {
  id: string
  display_name: string
}

/** A `@name` token that resolved to a teammate, or the plain text around one. */
export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; userId: string }

/**
 * Names longest-first, so `@ethan.zhang50` never resolves as `@ethan` followed
 * by a stray `.zhang50`. Every function here that matches a name relies on this
 * ordering.
 */
function byLengthDesc(profiles: MentionCandidate[]): MentionCandidate[] {
  return [...profiles].sort((a, b) => b.display_name.length - a.display_name.length)
}

/**
 * True when the character before a `@` allows it to start a mention.
 *
 * Start-of-text or whitespace only. This is what keeps `a@b.com` from opening
 * the picker mid-email, and it is why the rule lives in one place rather than
 * being spelled slightly differently in each of the three functions below.
 */
function canStartMention(text: string, at: number): boolean {
  if (at === 0) return true
  return /\s/.test(text[at - 1])
}

/**
 * The mention being typed at the caret, if any.
 *
 * Returns the `@`'s index and the partial name after it, so the caller can
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
 * An empty query — the moment `@` is typed — lists everyone, which is what
 * makes the picker a browsable member list rather than something you have to
 * guess the first letter of. Prefix matches rank above contains-matches so
 * typing `@et` puts `ethan` above `margaret`.
 */
export function matchMentions(
  query: string,
  profiles: MentionCandidate[],
  limit = 8,
): MentionCandidate[] {
  const q = query.toLowerCase()
  const scored: { p: MentionCandidate; rank: number }[] = []

  for (const p of profiles) {
    const name = p.display_name.toLowerCase()
    if (!q) scored.push({ p, rank: 1 })
    else if (name.startsWith(q)) scored.push({ p, rank: 0 })
    else if (name.includes(q)) scored.push({ p, rank: 1 })
  }

  scored.sort(
    (a, b) => a.rank - b.rank || a.p.display_name.localeCompare(b.p.display_name),
  )
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
  name: string,
): { text: string; caret: number } {
  const found = mentionQueryAt(text, caret)
  if (!found) return { text, caret }

  const inserted = `@${name} `
  const next = text.slice(0, found.start) + inserted + text.slice(caret)
  return { text: next, caret: found.start + inserted.length }
}

/**
 * Split a body into text and resolved-mention segments, for rendering.
 *
 * Adjacent text is *not* merged — a caller rendering segments in order gets the
 * original string back either way, and merging would cost a pass for no gain.
 */
export function splitMentions(
  body: string,
  profiles: MentionCandidate[],
): MentionSegment[] {
  const candidates = byLengthDesc(profiles)
  const segments: MentionSegment[] = []
  let plain = ''
  let i = 0

  while (i < body.length) {
    if (body[i] === '@' && canStartMention(body, i)) {
      const rest = body.slice(i + 1)
      const hit = candidates.find((p) => rest.startsWith(p.display_name))
      if (hit) {
        // A name may be a prefix of a longer *typed* word — `@ethan` matching
        // inside `@ethanx`. Longest-first ordering does not help when the
        // longer string is not itself a teammate, so require the character
        // after the name to end the token.
        const after = rest[hit.display_name.length]
        if (after === undefined || !/[\w.-]/.test(after)) {
          if (plain) {
            segments.push({ kind: 'text', text: plain })
            plain = ''
          }
          segments.push({
            kind: 'mention',
            text: `@${hit.display_name}`,
            userId: hit.id,
          })
          i += hit.display_name.length + 1
          continue
        }
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
 * This is what decides who gets a `notification` row, so it shares
 * `splitMentions`' matching rather than reimplementing it — two parsers that
 * disagree would mean highlighting someone the database never notified, or the
 * reverse.
 */
export function parseMentions(body: string, profiles: MentionCandidate[]): string[] {
  const seen = new Set<string>()
  for (const seg of splitMentions(body, profiles)) {
    if (seg.kind === 'mention') seen.add(seg.userId)
  }
  return [...seen]
}
