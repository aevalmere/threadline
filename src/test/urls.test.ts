import { describe, expect, it } from 'vitest'

import { internalPath, splitUrls } from '@/lib/urls'

const ORIGIN = 'https://threadline-cc0.pages.dev'

describe('splitUrls', () => {
  it('finds URLs between text runs, in order', () => {
    expect(splitUrls('see https://example.com and http://other.dev/x now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'url', text: 'https://example.com' },
      { kind: 'text', text: ' and ' },
      { kind: 'url', text: 'http://other.dev/x' },
      { kind: 'text', text: ' now' },
    ])
  })

  it('keeps trailing sentence punctuation out of the link', () => {
    expect(splitUrls('read https://example.com/a.')).toEqual([
      { kind: 'text', text: 'read ' },
      { kind: 'url', text: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ])
    expect(splitUrls('(https://example.com)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'url', text: 'https://example.com' },
      { kind: 'text', text: ')' },
    ])
  })

  it('keeps query strings and ids intact — the ?m= links Copy link makes', () => {
    expect(splitUrls(`${ORIGIN}/channels/abc?m=42`)).toEqual([
      { kind: 'url', text: `${ORIGIN}/channels/abc?m=42` },
    ])
  })

  it('plain text passes through as one segment', () => {
    expect(splitUrls('no links here')).toEqual([{ kind: 'text', text: 'no links here' }])
    expect(splitUrls('')).toEqual([])
  })
})

describe('internalPath', () => {
  it('resolves our own origin to an app path', () => {
    expect(internalPath(`${ORIGIN}/channels/abc?m=42`, ORIGIN)).toBe('/channels/abc?m=42')
    expect(internalPath(`${ORIGIN.toUpperCase()}/docs/x`, ORIGIN)).toBe('/docs/x')
  })

  it('external URLs are null', () => {
    expect(internalPath('https://example.com/channels/abc', ORIGIN)).toBeNull()
    expect(internalPath(ORIGIN, ORIGIN)).toBeNull()
  })
})
