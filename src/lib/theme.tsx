import { type ReactNode, useEffect, useMemo, useState } from 'react'

import {
  ACCENT_VARS,
  type Theme,
  accentVars,
  resolveTheme,
  usePreference,
} from '@/lib/preferences'
import { ThemeContext } from '@/lib/theme-context'

/**
 * Kept as one constant so JS and CSS cannot disagree, the same way
 * `useIsDesktop.ts` holds the `md` query.
 */
const DARK = '(prefers-color-scheme: dark)'

/**
 * Applies the theme to `<html>` and hands the choice to the tree.
 *
 * The dark half of every token already existed in `index.css` before this
 * provider did — a full `.dark` block plus `@custom-variant dark (&:is(.dark
 * *))`, shipped by shadcn and never switched on. So this does not repaint the
 * app; it puts a class on the root element and lets 25 tokens do the work.
 * That is also why there was no palette sweep to run first: nothing in `src/`
 * uses a Tailwind colour class, and the only literal colours are the eight tag
 * dots in `posts.ts`, which are dots and never text.
 *
 * Mounted outside `AuthProvider` in `App.tsx` on purpose: the sign-in page is
 * the first thing a person sees and it should already be in their theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = usePreference('theme')
  const [accent, setAccent] = usePreference('accent')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK).matches)

  useEffect(() => {
    const mq = window.matchMedia(DARK)
    const onChange = () => setSystemDark(mq.matches)
    // Re-read on mount: the OS setting can flip between the first render and
    // this effect, and the listener only fires on the *next* change.
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(theme, systemDark)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')

    // Clear before setting. An accent writes inline styles, and inline beats
    // both `:root` and `.dark` on specificity — so switching back to the
    // default has to remove the properties outright, not overwrite them with a
    // light-mode value that would then survive into dark mode.
    for (const name of ACCENT_VARS) root.style.removeProperty(name)
    for (const [name, value] of Object.entries(accentVars(accent, resolved))) {
      root.style.setProperty(name, value)
    }
  }, [resolved, accent])

  // Keep the UA hint honest: it drives form controls, scrollbars and the
  // caret, none of which our tokens reach. index.html declares "light dark",
  // which is right for `system` but wrong once someone picks a side.
  useEffect(() => {
    document.documentElement.style.colorScheme = theme === 'system' ? '' : resolved
  }, [theme, resolved])

  const value = useMemo(
    () => ({ theme, setTheme: (t: Theme) => setTheme(t), accent, setAccent, resolved }),
    [theme, setTheme, accent, setAccent, resolved],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
