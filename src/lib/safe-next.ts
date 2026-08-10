/**
 * Constrain a `?next=` redirect target to this origin.
 *
 * `/auth/callback` reads this from the URL and redirects to it while the user
 * is freshly authenticated — precisely the shape of an open redirect. Pure and
 * tested rather than inlined, because "which strings are same-origin" is a
 * question with a long history of wrong answers.
 *
 * Rejected, and why:
 *
 *  * anything not starting with `/` — a scheme, or a bare host
 *  * `//evil.com` — protocol-relative, a different origin
 *  * a backslash anywhere — browsers normalise it to `/` for http(s), so
 *    `/\evil.com` is the previous case wearing a hat. Today it happens to land
 *    as a crash rather than a redirect (`<Navigate replace>` reaches
 *    `history.replaceState`, which throws `SecurityError` cross-origin), but
 *    React Router's *push* path catches that throw and falls back to
 *    `location.assign` — which would redirect. Rejecting the character means
 *    this does not depend on which navigation a future caller happens to use.
 *  * whitespace and control characters — stripped or normalised during URL
 *    parsing, which changes what the string means *after* it has been checked
 */
function hasUnsafeCharacter(path: string): boolean {
  for (const ch of path) {
    if (ch === '\\') return true
    const code = ch.codePointAt(0) ?? 0
    // C0 controls, space, and DEL. Checked numerically rather than with a
    // regex character class, where a stray hyphen silently becomes a range.
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeNext(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  if (hasUnsafeCharacter(raw)) return fallback
  return raw
}
