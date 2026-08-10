/**
 * Attachment rules — SPEC.md §2.3.
 *
 * Pure, so the size cap and the storage-path shape are unit-tested rather than
 * click-tested. The cap in particular is worth testing: the bucket enforces it
 * too, but a wrong client-side number means either a wasted 10 MB upload that
 * the server then rejects, or a file refused that would have been fine.
 */

/** Matches `file_size_limit` on the bucket. Both are the same 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface Attachment {
  id: string
  owner_type: 'message' | 'post' | 'page' | 'task'
  owner_id: string
  storage_path: string
  filename: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export type FileCheck = { ok: true } | { ok: false; error: string }

export interface CheckableFile {
  name: string
  size: number
  type?: string
}

export function validateFile(file: CheckableFile): FileCheck {
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty.` }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    }
  }
  return { ok: true }
}

/**
 * Where the file lands in the bucket.
 *
 * Grouped by channel so a channel's files can later be removed with one prefix
 * operation. The stored name is a fresh uuid, never the user's filename: two
 * people uploading `screenshot.png` must not collide, and a filename is
 * untrusted input that has no business being a path. The real name is kept in
 * `attachments.filename` for display and download.
 */
export function storagePathFor(
  channelId: string,
  filename: string,
  uuid: string,
): string {
  const ext = extensionOf(filename)
  return ext ? `${channelId}/${uuid}.${ext}` : `${channelId}/${uuid}`
}

/** Lowercased extension without the dot, or '' when there isn't a usable one. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0 || dot === filename.length - 1) return ''
  const raw = filename.slice(dot + 1).toLowerCase()
  // Anything outside [a-z0-9] is not an extension worth reproducing in a path.
  return /^[a-z0-9]{1,12}$/.test(raw) ? raw : ''
}

/** Images render as inline thumbnails; everything else becomes a file chip. */
export function isImage(mime: string | null | undefined): boolean {
  if (!mime) return false
  return /^image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml)$/i.test(mime.trim())
}

/**
 * Videos a browser can play back natively.
 *
 * Deliberately a short list rather than `video/*`: rendering a <video> for a
 * format the browser cannot decode gives a dead black box with no explanation,
 * where the file chip at least offers a download. mkv and avi are the common
 * ones that fail.
 */
export function isVideo(mime: string | null | undefined): boolean {
  if (!mime) return false
  return /^video\/(mp4|webm|ogg|quicktime)$/i.test(mime.trim())
}

/** Renders in place rather than as a download chip. */
export function isPlayable(mime: string | null | undefined): boolean {
  return isImage(mime) || isVideo(mime)
}

/** Group attachment rows for joining onto the messages they belong to. */
export function attachmentsByOwner<T extends { owner_type: string; owner_id: string }>(
  rows: readonly T[],
  ownerType = 'message',
): Map<string, T[]> {
  const byOwner = new Map<string, T[]>()
  for (const row of rows) {
    if (row.owner_type !== ownerType) continue
    const existing = byOwner.get(row.owner_id)
    if (existing) existing.push(row)
    else byOwner.set(row.owner_id, [row])
  }
  return byOwner
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
