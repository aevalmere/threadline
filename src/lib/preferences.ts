/**
 * Per-person UI preferences — theme, accent, pane widths, and the handful of
 * view toggles that used to reset on every navigation.
 *
 * **Why localStorage and not a `profiles` column.** Everything the app persists
 * today goes to Postgres, but all of it is *workspace-shared* on purpose: the
 * `position` columns from beta round 3 order the sidebar for everyone at once
 * (`20260823001537_sidebar_and_docs_ordering.sql`). These are the opposite —
 * one person's choices, on one machine, worth nothing to anybody else and
 * costing a migration, an RLS surface and a round trip to store server-side.
 * The trade is real and stated: preferences do not follow you to a second
 * device. A `profiles.preferences jsonb` column is the upgrade if that ever
 * stings.
 *
 * **Decision/IO split, same as `pages.ts` and `tasks.ts`.** Everything above
 * `readPreference` is pure and tested; the storage access and the hook sit
 * below it. Nothing here touches `window` at module scope, because the vitest
 * environment is `node` with no DOM and no jsdom (vite.config.ts) — an import
 * that reached for `localStorage` would break the whole suite.
 */

import { useCallback, useState } from 'react'

/** One namespace so a stray key in devtools is obviously ours. */
const PREFIX = 'threadline:'

export type Theme = 'light' | 'dark' | 'system'
/** What `system` resolves to once the media query is read. */
export type ResolvedTheme = 'light' | 'dark'
export type AccentName = 'default' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose'
/** Matches the `View` union in `src/routes/Tasks.tsx`. */
export type TasksView = 'board' | 'mine'

export const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/**
 * Accents override three tokens and no more: `--primary`, its foreground, and
 * `--ring`. Everything else in `index.css` stays put, which is what keeps an
 * accent a tint rather than a re-skin nobody asked for.
 *
 * Each accent carries a light *and* a dark value because the default primary
 * inverts between themes — near-black on light (`oklch(0.208 …)`), near-white
 * on dark (`oklch(0.929 …)`). A single mid-tone colour would read as a muddy
 * smear in one of the two. The dark values are lighter and less saturated for
 * the same reason every dark palette is.
 *
 * `on` is the text that sits on top of the accent, so it flips with it.
 * Values are oklch to match the tokens they replace.
 */
export const ACCENTS: Record<
  AccentName,
  { label: string; light: string; dark: string; onLight: string; onDark: string } | null
> = {
  // Null means "change nothing" — index.css already holds the answer, and
  // writing the same value back as an inline style would defeat the .dark
  // block the moment the theme flips.
  default: null,
  blue: {
    label: 'Blue',
    light: 'oklch(0.546 0.215 262.881)',
    dark: 'oklch(0.707 0.165 254.624)',
    onLight: 'oklch(0.984 0.003 247.858)',
    onDark: 'oklch(0.208 0.042 265.755)',
  },
  violet: {
    label: 'Violet',
    light: 'oklch(0.541 0.281 293.009)',
    dark: 'oklch(0.702 0.183 293.541)',
    onLight: 'oklch(0.984 0.003 247.858)',
    onDark: 'oklch(0.208 0.042 265.755)',
  },
  emerald: {
    label: 'Emerald',
    light: 'oklch(0.508 0.118 165.612)',
    dark: 'oklch(0.696 0.17 162.48)',
    onLight: 'oklch(0.984 0.003 247.858)',
    onDark: 'oklch(0.208 0.042 265.755)',
  },
  amber: {
    label: 'Amber',
    light: 'oklch(0.555 0.163 48.998)',
    dark: 'oklch(0.769 0.188 70.08)',
    onLight: 'oklch(0.984 0.003 247.858)',
    onDark: 'oklch(0.208 0.042 265.755)',
  },
  rose: {
    label: 'Rose',
    light: 'oklch(0.586 0.253 17.585)',
    dark: 'oklch(0.712 0.194 13.428)',
    onLight: 'oklch(0.984 0.003 247.858)',
    onDark: 'oklch(0.208 0.042 265.755)',
  },
}

export interface Preferences {
  theme: Theme
  accent: AccentName
  /** Pane widths in px, read by the resizers in Batch 2. */
  sidebarWidth: number
  membersWidth: number
  docsTreeWidth: number
  tasksView: TasksView
  membersOpen: boolean
  /** Collection ids collapsed in the docs tree. */
  docsCollapsed: string[]
}

/** Widths match the Tailwind classes they replace: w-64, w-56, md:w-64. */
export const PREFERENCE_DEFAULTS: Preferences = {
  theme: 'system',
  accent: 'default',
  sidebarWidth: 256,
  membersWidth: 224,
  docsTreeWidth: 256,
  tasksView: 'board',
  membersOpen: false,
  docsCollapsed: [],
}

/** Per-pane bounds. Below the minimum a pane is unreadable; above it the
 *  centre column is the one that suffers, so both ends are held. */
export const WIDTH_BOUNDS: Record<'sidebarWidth' | 'membersWidth' | 'docsTreeWidth', {
  min: number
  max: number
}> = {
  sidebarWidth: { min: 180, max: 480 },
  membersWidth: { min: 160, max: 420 },
  docsTreeWidth: { min: 180, max: 480 },
}

export function clampWidth(
  key: keyof typeof WIDTH_BOUNDS,
  px: number,
): number {
  const { min, max } = WIDTH_BOUNDS[key]
  if (!Number.isFinite(px)) return PREFERENCE_DEFAULTS[key]
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Coerce whatever came out of storage into something valid.
 *
 * Stored JSON is not trustworthy input: it survives across deploys, so it can
 * hold a value some earlier version wrote, or a shape a person typed into
 * devtools. Anything unrecognised falls back to the default rather than
 * reaching a render, which is how a stale key stays a non-event instead of a
 * blank screen.
 */
export function parsePreference<K extends keyof Preferences>(
  key: K,
  raw: unknown,
): Preferences[K] {
  const fallback = PREFERENCE_DEFAULTS[key]
  switch (key) {
    case 'theme':
      return (THEMES.includes(raw as Theme) ? raw : fallback) as Preferences[K]
    case 'accent':
      return (
        typeof raw === 'string' && raw in ACCENTS ? raw : fallback
      ) as Preferences[K]
    case 'tasksView':
      return (raw === 'board' || raw === 'mine' ? raw : fallback) as Preferences[K]
    case 'membersOpen':
      return (typeof raw === 'boolean' ? raw : fallback) as Preferences[K]
    case 'sidebarWidth':
    case 'membersWidth':
    case 'docsTreeWidth':
      return (
        typeof raw === 'number' ? clampWidth(key as keyof typeof WIDTH_BOUNDS, raw) : fallback
      ) as Preferences[K]
    case 'docsCollapsed':
      return (
        Array.isArray(raw) && raw.every((v) => typeof v === 'string') ? raw : fallback
      ) as Preferences[K]
    default:
      return fallback
  }
}

/** `system` resolved against the media query, so callers get a real theme. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

/**
 * The inline styles an accent needs, given the theme it will render against.
 * Empty for `default`, which leaves index.css in charge.
 */
export const ACCENT_VARS = ['--primary', '--primary-foreground', '--ring'] as const

export function accentVars(
  accent: AccentName,
  resolved: ResolvedTheme,
): Record<string, string> {
  const spec = ACCENTS[accent]
  if (!spec) return {}
  const dark = resolved === 'dark'
  const color = dark ? spec.dark : spec.light
  return {
    '--primary': color,
    '--primary-foreground': dark ? spec.onDark : spec.onLight,
    // The focus ring follows the accent so a keyboard user sees the same
    // colour the buttons use, rather than the neutral slate ring.
    '--ring': color,
  }
}

// --- storage --------------------------------------------------------------

/**
 * Every access is wrapped: Safari in private mode throws on `setItem`, and a
 * browser set to block site data throws on read too. A preference is never
 * worth a crash, so a failure degrades to the default and the app carries on.
 */
export function readPreference<K extends keyof Preferences>(key: K): Preferences[K] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return PREFERENCE_DEFAULTS[key]
    return parsePreference(key, JSON.parse(raw))
  } catch {
    // Storage unavailable or the value is not JSON. Either way the default is
    // the right answer and there is nothing to report to anyone.
    return PREFERENCE_DEFAULTS[key]
  }
}

export function writePreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Quota or a blocked store. The value still applies for this session; it
    // just will not survive a reload.
  }
}

/** `useState` that seeds from storage and writes back on every set. */
export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], (value: Preferences[K]) => void] {
  const [value, setValue] = useState<Preferences[K]>(() => readPreference(key))
  const set = useCallback(
    (next: Preferences[K]) => {
      setValue(next)
      writePreference(key, next)
    },
    [key],
  )
  return [value, set]
}
