/**
 * Username rules. Pure, so they are unit-tested rather than click-tested — the
 * same reasoning as `channel-name.ts`.
 *
 * **This is the third statement of one rule.** The others are
 * `profiles_username_format` + `slugify_username()` in the database, and
 * `USERNAME_RE` in `supabase/functions/register/index.ts`. The database is the
 * wall; this exists so someone typing into a form gets an instant, specific
 * error instead of a round trip. DECISIONS #14 accepts the duplication and
 * requires the copies to change together.
 *
 * The accepted set is exactly the **fixed points of `slugify_username()`** —
 * values it returns unchanged. That is not a stylistic choice: registration
 * stores the *slug* of what was requested, while `/settings` stores the value
 * verbatim, so any name the two treat differently is a name that means
 * different things on different screens. When they last disagreed, asking for
 * `bob.` created an account called `bob` that its owner could not sign into.
 */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 24

/** Must match `profiles_username_format` in the database, character for character. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: string }

/**
 * The client-side half of `slugify_username()`.
 *
 * Offered as a suggestion — `/register` seeds the username field from the email
 * local part — rather than applied silently to what someone typed. Quietly
 * rewriting `bob.` to `bob` on submit is how you end up with an account whose
 * name its owner did not choose and does not remember.
 */
export function slugifyUsername(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, USERNAME_MAX)
    // `slice` can expose a trailing separator that the trim above removed, so
    // trim again after truncating — exactly what the SQL does with its two
    // `trim`s around `left()`.
    .replace(/[-._]+$/g, '')
}

export function normalizeUsername(raw: string): UsernameResult {
  // People type the @ out of habit; it is how a mention is written, not part
  // of the name. Same reasoning as `#` in normalizeChannelName.
  const trimmed = raw.trim().replace(/^@+/, '')
  if (!trimmed) return { ok: false, error: 'Pick a username.' }

  const lowered = trimmed.toLowerCase()

  if (lowered.length < USERNAME_MIN) {
    return { ok: false, error: `At least ${USERNAME_MIN} characters.` }
  }
  if (lowered.length > USERNAME_MAX) {
    return { ok: false, error: `At most ${USERNAME_MAX} characters.` }
  }
  if (!/^[a-z0-9._-]+$/.test(lowered)) {
    return {
      ok: false,
      error: 'Letters, numbers, dots, dashes and underscores only.',
    }
  }
  if (!USERNAME_RE.test(lowered)) {
    return {
      ok: false,
      error: 'Start and end with a letter or number.',
    }
  }

  return { ok: true, username: lowered }
}

/** Whether a display name is usable. Deliberately permissive — it is a label. */
export function normalizeDisplayName(raw: string): UsernameResult {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return { ok: false, error: 'Enter a display name.' }
  if (trimmed.length > 48) return { ok: false, error: 'At most 48 characters.' }
  return { ok: true, username: trimmed }
}
