/**
 * Channel name normalisation. Pure, so it is unit-tested rather than
 * click-tested.
 *
 * Channels render as `# general`, and `channels` carries a unique (name, kind)
 * constraint, so names are slugified before they reach Postgres: two people
 * typing "Design Review" and "design-review" should collide at the constraint
 * rather than create near-duplicate channels nobody can tell apart.
 */

export const CHANNEL_NAME_MAX = 32

export type ChannelNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string }

export function normalizeChannelName(raw: string): ChannelNameResult {
  // People type the # out of habit; it is decoration, not part of the name.
  const stripped = raw.trim().replace(/^#+/, '').trim()
  if (!stripped) return { ok: false, error: 'Give the channel a name.' }

  const slug = stripped
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')

  if (!slug) return { ok: false, error: 'Use at least one letter or number.' }

  if (slug.length > CHANNEL_NAME_MAX) {
    return { ok: false, error: `Keep it to ${CHANNEL_NAME_MAX} characters or fewer.` }
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
    return { ok: false, error: 'Letters, numbers, dashes, dots and underscores only.' }
  }

  return { ok: true, name: slug }
}
