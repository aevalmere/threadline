/**
 * Two letters from a display name, for an avatar fallback.
 *
 * Names are seeded from the email local part by `handle_new_user()`
 * (SPEC §2.3), so `ethan.zhang50` has to split on the dot to give `EZ` rather
 * than `ET`.
 */
export function initials(name: string): string {
  const parts = name.split(/[\s._+-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
