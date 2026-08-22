/**
 * File handling for the page editor — the BlockNote side of DECISIONS #9's
 * private-bucket rule.
 *
 * What uploadFile returns is stored VERBATIM in the block's `url` prop, i.e.
 * inside `body_rich` — so it must be the storage path, never a signed URL,
 * which would expire an hour after it was pasted into the document.
 * resolveFileUrl turns the stored path back into a fresh signed URL at render
 * time. It is a plain async function (BlockNote options are not hooks), so it
 * carries its own cache with the same TTL/margin semantics as useSignedUrls.
 */

import { storagePathFor, validateFile } from '@/lib/attachments'
import { supabase } from '@/lib/supabase'

const BUCKET = 'attachments'
const TTL_SECONDS = 3600
const REFRESH_MARGIN_MS = 60_000

/**
 * The `uploadFile` for a page's editor. Same discipline as message uploads
 * (useMessages): validate first, storage before rows, and roll the object
 * back if the attachments insert fails so a half-upload never eats the
 * bucket's 1 GB.
 */
export function makeUploadFile(pageId: string): (file: File) => Promise<string> {
  return async (file: File) => {
    const check = validateFile(file)
    if (!check.ok) throw new Error(check.error)

    const path = storagePathFor(pageId, file.name, crypto.randomUUID())
    const up = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined })
    if (up.error) throw new Error(`Could not upload ${file.name}: ${up.error.message}`)

    const row = await supabase.from('attachments').insert({
      owner_type: 'page',
      owner_id: pageId,
      storage_path: path,
      filename: file.name,
      mime: file.type || null,
      size_bytes: file.size,
    })
    if (row.error) {
      await supabase.storage.from(BUCKET).remove([path])
      throw new Error(`Could not attach ${file.name}: ${row.error.message}`)
    }
    return path
  }
}

const signedCache = new Map<string, { url: string; expiresAt: number }>()

/**
 * BlockNote's `resolveFileUrl`. A stored storage path becomes a fresh signed
 * URL; an absolute URL (the file panel's "Embed" tab, or a doc authored
 * elsewhere) passes through untouched.
 */
export async function resolveFileUrl(stored: string): Promise<string> {
  if (/^https?:\/\//i.test(stored)) return stored

  const hit = signedCache.get(stored)
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.url

  // The batched call, like useSignedUrls — it is also the only signing method
  // the mock backend implements.
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls([stored], TTL_SECONDS)
  const url = data?.[0]?.signedUrl ?? null
  if (error || url === null) {
    throw new Error(`Could not load the file: ${error?.message ?? 'signing failed'}`)
  }
  signedCache.set(stored, { url, expiresAt: Date.now() + TTL_SECONDS * 1000 })
  return url
}
