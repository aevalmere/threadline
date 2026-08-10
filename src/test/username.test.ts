import { describe, expect, it } from 'vitest'

import {
  normalizeDisplayName,
  normalizeUsername,
  slugifyUsername,
  USERNAME_MAX,
} from '@/lib/username'

/** The rule as the database states it, to test against independently. */
const DB_CHECK = /^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/

function accepted(raw: string): string | null {
  const r = normalizeUsername(raw)
  return r.ok ? r.username : null
}

describe('normalizeUsername', () => {
  it('accepts an ordinary handle', () => {
    expect(accepted('ethan')).toBe('ethan')
  })

  it('accepts dots, dashes and underscores inside', () => {
    expect(accepted('ethan.zhang50')).toBe('ethan.zhang50')
    expect(accepted('a.b-c_d')).toBe('a.b-c_d')
  })

  it('lowercases, because the database only stores lower case', () => {
    expect(accepted('Ethan')).toBe('ethan')
  })

  it('strips a leading @, which is mention syntax rather than the name', () => {
    expect(accepted('@ethan')).toBe('ethan')
    expect(accepted('@@ethan')).toBe('ethan')
  })

  it('trims surrounding whitespace', () => {
    expect(accepted('  ethan  ')).toBe('ethan')
  })

  it('rejects an empty or @-only input', () => {
    expect(accepted('')).toBeNull()
    expect(accepted('   ')).toBeNull()
    expect(accepted('@')).toBeNull()
  })

  it('enforces the length bounds', () => {
    expect(accepted('ab')).toBeNull()
    expect(accepted('abc')).toBe('abc')
    expect(accepted('a'.repeat(USERNAME_MAX))).toBe('a'.repeat(USERNAME_MAX))
    expect(accepted('a'.repeat(USERNAME_MAX + 1))).toBeNull()
  })

  it('rejects characters the column will not hold', () => {
    expect(accepted('ethan zhang')).toBeNull()
    expect(accepted('ethan!')).toBeNull()
    expect(accepted('éthan')).toBeNull()
    expect(accepted('ethan@home')).toBeNull()
  })

  /**
   * The regression that matters. A trailing separator was legal under the first
   * version of the CHECK but stripped by slugify_username(), so registering
   * `bob.` created an account named `bob` its owner could not sign into.
   */
  it('rejects a leading or trailing separator, both ends', () => {
    for (const bad of ['.bob', '-bob', '_bob', 'bob.', 'bob-', 'bob_', '.bob.']) {
      expect(accepted(bad)).toBeNull()
    }
  })

  it('rejects separators only', () => {
    expect(accepted('...')).toBeNull()
    expect(accepted('---')).toBeNull()
  })

  it('never returns something the database CHECK would refuse', () => {
    const inputs = [
      'ethan',
      'Ethan',
      '@ethan.zhang50',
      '  a.b-c_d  ',
      'x'.repeat(USERNAME_MAX),
      'bob.',
      '.bob',
      'ab',
      'ethan zhang',
      '',
      'a1',
      '9lives',
    ]
    for (const raw of inputs) {
      const out = accepted(raw)
      if (out !== null) expect(out).toMatch(DB_CHECK)
    }
  })
})

describe('slugifyUsername', () => {
  it('mirrors the SQL: everything it returns is already acceptable', () => {
    const inputs = [
      'Ethan Zhang',
      'bob.',
      '...bob...',
      'ethan@company.com',
      'a'.repeat(40),
      'Ethan  Zhang  50',
      '--weird--name--',
    ]
    for (const raw of inputs) {
      const slug = slugifyUsername(raw)
      // Under three characters is the SQL's "unusable" case, which callers
      // handle rather than the slug itself.
      if (slug.length >= 3) expect(slug).toMatch(DB_CHECK)
    }
  })

  it('is idempotent — slugging a slug changes nothing', () => {
    for (const raw of ['Ethan Zhang', 'bob.', 'ethan@company.com', '-x-']) {
      const once = slugifyUsername(raw)
      expect(slugifyUsername(once)).toBe(once)
    }
  })

  it('turns an email local part into a usable suggestion', () => {
    expect(slugifyUsername('ethan.zhang50')).toBe('ethan.zhang50')
    expect(slugifyUsername('lights.darke')).toBe('lights.darke')
  })

  it('caps at the column length and does not leave a trailing separator', () => {
    const long = slugifyUsername(`${'a'.repeat(23)}.bbbb`)
    expect(long.length).toBeLessThanOrEqual(USERNAME_MAX)
    expect(long).toMatch(DB_CHECK)
  })

  it('accepts what normalizeUsername accepts, unchanged', () => {
    // Anything already legal is a fixed point — this is the property the
    // register function and the CHECK both rely on.
    for (const good of ['ethan', 'a.b-c_d', 'ethan.zhang50', 'x9']) {
      const r = normalizeUsername(good)
      if (r.ok) expect(slugifyUsername(r.username)).toBe(r.username)
    }
  })
})

describe('normalizeDisplayName', () => {
  it('accepts a human name and collapses inner whitespace', () => {
    expect(normalizeDisplayName('  Ethan   Zhang ')).toEqual({
      ok: true,
      username: 'Ethan Zhang',
    })
  })

  it('rejects an empty name', () => {
    expect(normalizeDisplayName('   ').ok).toBe(false)
  })

  it('does not impose username rules on it', () => {
    expect(normalizeDisplayName('Ethan Zhang!').ok).toBe(true)
    expect(normalizeDisplayName('日本語').ok).toBe(true)
  })

  it('has an upper bound', () => {
    expect(normalizeDisplayName('a'.repeat(49)).ok).toBe(false)
  })
})
