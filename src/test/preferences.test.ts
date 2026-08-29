import { describe, expect, it } from 'vitest'

import {
  ACCENTS,
  PREFERENCE_DEFAULTS,
  WIDTH_BOUNDS,
  accentVars,
  clampWidth,
  parsePreference,
  resolveTheme,
} from '@/lib/preferences'

describe('parsePreference', () => {
  // Stored values outlive the code that wrote them, so the parser is the only
  // thing standing between a hand-edited devtools string and a render.
  it('accepts the values it should', () => {
    expect(parsePreference('theme', 'dark')).toBe('dark')
    expect(parsePreference('accent', 'violet')).toBe('violet')
    expect(parsePreference('tasksView', 'mine')).toBe('mine')
    expect(parsePreference('membersOpen', true)).toBe(true)
    expect(parsePreference('docsCollapsed', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('falls back to the default for junk rather than passing it through', () => {
    expect(parsePreference('theme', 'purple')).toBe(PREFERENCE_DEFAULTS.theme)
    expect(parsePreference('theme', null)).toBe(PREFERENCE_DEFAULTS.theme)
    expect(parsePreference('accent', 'chartreuse')).toBe(PREFERENCE_DEFAULTS.accent)
    expect(parsePreference('tasksView', 42)).toBe(PREFERENCE_DEFAULTS.tasksView)
    expect(parsePreference('membersOpen', 'yes')).toBe(PREFERENCE_DEFAULTS.membersOpen)
  })

  it('rejects an array that is not all strings', () => {
    // A mixed array would reach the docs tree and be compared against
    // collection ids, matching nothing and silently un-collapsing everything.
    expect(parsePreference('docsCollapsed', ['a', 7])).toEqual([])
  })

  it('clamps a stored width instead of trusting it', () => {
    expect(parsePreference('sidebarWidth', 999_999)).toBe(WIDTH_BOUNDS.sidebarWidth.max)
    expect(parsePreference('sidebarWidth', 1)).toBe(WIDTH_BOUNDS.sidebarWidth.min)
    expect(parsePreference('sidebarWidth', 300)).toBe(300)
    expect(parsePreference('sidebarWidth', 'wide')).toBe(PREFERENCE_DEFAULTS.sidebarWidth)
  })
})

describe('clampWidth', () => {
  it('holds both ends and rounds', () => {
    expect(clampWidth('membersWidth', 100)).toBe(WIDTH_BOUNDS.membersWidth.min)
    expect(clampWidth('membersWidth', 10_000)).toBe(WIDTH_BOUNDS.membersWidth.max)
    expect(clampWidth('membersWidth', 200.4)).toBe(200)
  })

  it('returns the default for a non-finite drag result', () => {
    // A pointer event on a zero-width container can produce NaN, and NaN would
    // survive every comparison in a naive clamp and land in the style attribute.
    expect(clampWidth('sidebarWidth', Number.NaN)).toBe(PREFERENCE_DEFAULTS.sidebarWidth)
    expect(clampWidth('sidebarWidth', Number.POSITIVE_INFINITY)).toBe(
      PREFERENCE_DEFAULTS.sidebarWidth,
    )
  })
})

describe('resolveTheme', () => {
  it('passes an explicit choice through, whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the OS only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('accentVars', () => {
  it('writes nothing for the default, leaving index.css in charge', () => {
    expect(accentVars('default', 'light')).toEqual({})
    expect(accentVars('default', 'dark')).toEqual({})
  })

  it('picks the per-theme value, not one colour for both', () => {
    // The default primary inverts between themes, so an accent that ignored
    // the resolved theme would read as a smear in one of the two.
    const light = accentVars('blue', 'light')
    const dark = accentVars('blue', 'dark')
    expect(light['--primary']).toBe(ACCENTS.blue!.light)
    expect(dark['--primary']).toBe(ACCENTS.blue!.dark)
    expect(light['--primary']).not.toBe(dark['--primary'])
  })

  it('flips the on-accent text with the theme', () => {
    expect(accentVars('rose', 'light')['--primary-foreground']).toBe(ACCENTS.rose!.onLight)
    expect(accentVars('rose', 'dark')['--primary-foreground']).toBe(ACCENTS.rose!.onDark)
  })

  it('ties the focus ring to the accent', () => {
    const vars = accentVars('emerald', 'light')
    expect(vars['--ring']).toBe(vars['--primary'])
  })

  it('covers every accent in both themes', () => {
    for (const name of Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]) {
      if (!ACCENTS[name]) continue
      for (const mode of ['light', 'dark'] as const) {
        const vars = accentVars(name, mode)
        expect(Object.keys(vars).sort()).toEqual([
          '--primary',
          '--primary-foreground',
          '--ring',
        ])
      }
    }
  })
})
