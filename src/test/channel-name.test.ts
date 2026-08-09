import { describe, expect, it } from 'vitest'

import { CHANNEL_NAME_MAX, normalizeChannelName } from '@/lib/channel-name'

function ok(raw: string): string {
  const r = normalizeChannelName(raw)
  if (!r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be valid, got: ${r.error}`)
  return r.name
}

function err(raw: string): string {
  const r = normalizeChannelName(raw)
  if (r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be rejected, got: ${r.name}`)
  return r.error
}

describe('normalizeChannelName', () => {
  it('passes through an already-clean name', () => {
    expect(ok('general')).toBe('general')
  })

  it('lowercases', () => {
    expect(ok('General')).toBe('general')
    expect(ok('DESIGN')).toBe('design')
  })

  it('trims surrounding whitespace', () => {
    expect(ok('  general  ')).toBe('general')
  })

  it('strips a leading # that people type out of habit', () => {
    expect(ok('#general')).toBe('general')
    expect(ok('## general')).toBe('general')
  })

  it('turns spaces into dashes', () => {
    expect(ok('design review')).toBe('design-review')
    expect(ok('Design   Review')).toBe('design-review')
  })

  it('collapses runs of dashes', () => {
    expect(ok('design---review')).toBe('design-review')
  })

  it('drops leading and trailing dashes and dots', () => {
    expect(ok('-general-')).toBe('general')
    expect(ok('.general.')).toBe('general')
  })

  it('keeps dots, dashes and underscores inside the name', () => {
    expect(ok('v1.2-release_notes')).toBe('v1.2-release_notes')
  })

  it('keeps digits, including a leading one', () => {
    expect(ok('2026-planning')).toBe('2026-planning')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(err('')).toMatch(/name/i)
    expect(err('   ')).toMatch(/name/i)
    expect(err('#')).toMatch(/name/i)
  })

  it('rejects a name that is only punctuation', () => {
    expect(err('---')).toMatch(/letter or number/i)
  })

  it('rejects characters that would look wrong after a #', () => {
    expect(err('general!')).toMatch(/only/i)
    expect(err('a/b')).toMatch(/only/i)
    expect(err('café')).toMatch(/only/i)
  })

  it('accepts exactly the maximum length and rejects one over', () => {
    expect(ok('a'.repeat(CHANNEL_NAME_MAX))).toHaveLength(CHANNEL_NAME_MAX)
    expect(err('a'.repeat(CHANNEL_NAME_MAX + 1))).toMatch(/characters/i)
  })

  it('measures length after slugifying, not before', () => {
    // Trailing spaces must not count toward the limit.
    expect(ok(`${'a'.repeat(CHANNEL_NAME_MAX)}    `)).toHaveLength(CHANNEL_NAME_MAX)
  })

  it('normalises two spellings of the same name to one slug', () => {
    expect(ok('Design Review')).toBe(ok('design-review'))
  })
})
