import { createContext, useContext } from 'react'

import type { AccentName, ResolvedTheme, Theme } from '@/lib/preferences'

/**
 * Context only — the provider lives in `theme.tsx`.
 *
 * Split for the same reason `auth-context.ts` is split from `auth.tsx`: a file
 * exporting both a component and a hook trips react-refresh's lint rule.
 */
export interface ThemeContextValue {
  /** What the person chose, which may be `system`. */
  theme: Theme
  setTheme: (theme: Theme) => void
  accent: AccentName
  setAccent: (accent: AccentName) => void
  /**
   * What `theme` resolves to right now. Read this to drive anything that needs
   * a real answer rather than a preference — BlockNote's `theme` prop is the
   * one that matters, since its core stylesheet keys off an explicit
   * `data-color-scheme` and cannot follow our `.dark` class.
   */
  resolved: ResolvedTheme
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
