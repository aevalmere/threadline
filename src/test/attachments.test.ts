import { describe, expect, it } from 'vitest'

import {
  attachmentsByOwner,
  extensionOf,
  formatBytes,
  isImage,
  isPlayable,
  isVideo,
  MAX_UPLOAD_BYTES,
  storagePathFor,
  validateFile,
} from '@/lib/attachments'

const UUID = '11111111-2222-3333-4444-555555555555'
const CHANNEL = 'ch-uuid'

describe('validateFile', () => {
  it('accepts an ordinary file', () => {
    expect(validateFile({ name: 'a.png', size: 1024 })).toEqual({ ok: true })
  })

  it('accepts a file of exactly the limit', () => {
    expect(validateFile({ name: 'a.png', size: MAX_UPLOAD_BYTES })).toEqual({ ok: true })
  })

  it('rejects one byte over the limit', () => {
    const r = validateFile({ name: 'big.png', size: MAX_UPLOAD_BYTES + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/limit is 10\.0 MB/)
  })

  it('names the offending file in the error', () => {
    const r = validateFile({ name: 'holiday.mov', size: MAX_UPLOAD_BYTES * 3 })
    if (!r.ok) expect(r.error).toContain('holiday.mov')
  })

  it('rejects an empty file', () => {
    const r = validateFile({ name: 'empty.txt', size: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/i)
  })

  it('agrees with the bucket limit', () => {
    // The migration sets file_size_limit = 10485760. If these ever disagree the
    // client either wastes an upload or refuses a legal file.
    expect(MAX_UPLOAD_BYTES).toBe(10485760)
  })
})

describe('extensionOf', () => {
  it('takes the last extension, lowercased', () => {
    expect(extensionOf('Photo.PNG')).toBe('png')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('returns empty for a name with no extension', () => {
    expect(extensionOf('README')).toBe('')
  })

  it('returns empty for a dotfile', () => {
    expect(extensionOf('.gitignore')).toBe('')
  })

  it('returns empty for a trailing dot', () => {
    expect(extensionOf('weird.')).toBe('')
  })

  it('refuses anything that is not plainly alphanumeric', () => {
    expect(extensionOf('sneaky.p n g')).toBe('')
    expect(extensionOf('evil.png/../..')).toBe('')
    expect(extensionOf('x.a'.padEnd(20, 'b'))).toBe('')
  })
})

describe('storagePathFor', () => {
  it('groups by channel and renames to the uuid', () => {
    expect(storagePathFor(CHANNEL, 'screenshot.png', UUID)).toBe(`${CHANNEL}/${UUID}.png`)
  })

  it('never reproduces the user’s filename in the path', () => {
    const path = storagePathFor(CHANNEL, 'my secret plan.png', UUID)
    expect(path).not.toContain('secret')
    expect(path).toBe(`${CHANNEL}/${UUID}.png`)
  })

  it('cannot be walked out of its channel folder', () => {
    const path = storagePathFor(CHANNEL, '../../etc/passwd', UUID)
    expect(path).not.toContain('..')
    expect(path.startsWith(`${CHANNEL}/`)).toBe(true)
  })

  it('drops the extension when there is not a usable one', () => {
    expect(storagePathFor(CHANNEL, 'LICENSE', UUID)).toBe(`${CHANNEL}/${UUID}`)
  })

  it('gives two identical filenames different paths', () => {
    const a = storagePathFor(CHANNEL, 'shot.png', 'uuid-a')
    const b = storagePathFor(CHANNEL, 'shot.png', 'uuid-b')
    expect(a).not.toBe(b)
  })
})

describe('isImage', () => {
  it('recognises the formats a browser renders inline', () => {
    for (const m of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(isImage(m)).toBe(true)
    }
  })

  it('is case- and whitespace-tolerant', () => {
    expect(isImage(' IMAGE/PNG ')).toBe(true)
  })

  it('rejects non-images', () => {
    expect(isImage('application/pdf')).toBe(false)
    expect(isImage('text/plain')).toBe(false)
    expect(isImage('video/mp4')).toBe(false)
  })

  it('rejects a missing mime rather than guessing', () => {
    expect(isImage(null)).toBe(false)
    expect(isImage(undefined)).toBe(false)
    expect(isImage('')).toBe(false)
  })
})

describe('isVideo', () => {
  it('recognises formats browsers actually decode', () => {
    for (const m of ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']) {
      expect(isVideo(m)).toBe(true)
    }
  })

  it('rejects containers that would render a dead black box', () => {
    // A <video> for these decodes to nothing and offers the user no way out;
    // the file chip at least downloads.
    expect(isVideo('video/x-matroska')).toBe(false)
    expect(isVideo('video/x-msvideo')).toBe(false)
  })

  it('is not confused by images or missing mimes', () => {
    expect(isVideo('image/png')).toBe(false)
    expect(isVideo(null)).toBe(false)
    expect(isVideo(undefined)).toBe(false)
  })
})

describe('isPlayable', () => {
  it('covers images and videos, nothing else', () => {
    expect(isPlayable('image/png')).toBe(true)
    expect(isPlayable('video/mp4')).toBe(true)
    expect(isPlayable('application/pdf')).toBe(false)
    expect(isPlayable(null)).toBe(false)
  })
})

describe('attachmentsByOwner', () => {
  const row = (id: string, owner_id: string, owner_type = 'message') => ({
    id,
    owner_id,
    owner_type,
  })

  it('groups by owner id', () => {
    const map = attachmentsByOwner([row('a', '1'), row('b', '1'), row('c', '2')])
    expect(map.get('1')?.map((r) => r.id)).toEqual(['a', 'b'])
    expect(map.get('2')?.map((r) => r.id)).toEqual(['c'])
  })

  it('ignores other owner types — ids collide across them', () => {
    // A message id and a task id can both be "1"; owner_type is what separates.
    const map = attachmentsByOwner([row('a', '1'), row('b', '1', 'task')])
    expect(map.get('1')?.map((r) => r.id)).toEqual(['a'])
  })

  it('returns an empty map for no rows', () => {
    expect(attachmentsByOwner([]).size).toBe(0)
  })
})

describe('formatBytes', () => {
  it('scales the unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
