import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase'

const BUCKET = 'attachments'
/** Signed URLs last an hour; re-signed a minute early to avoid a race. */
const TTL_SECONDS = 3600
const REFRESH_MARGIN_MS = 60_000

interface Signed {
  url: string
  expiresAt: number
}

/**
 * Signed URLs for private-bucket objects (DECISIONS #9).
 *
 * The bucket is private, so nothing renders without one. Three things matter:
 *
 *  * **Batch.** `createSignedUrls` takes a list, so a page of twenty images is
 *    one request, not twenty.
 *  * **Cache.** Keyed by path with its expiry, so a re-render does not re-sign.
 *  * **Never `getPublicUrl`.** On a private bucket it returns a URL that 400s —
 *    which the `private` assertion in scripts/seed.ts verifies against the live
 *    project on every seed run.
 */
export function useSignedUrls(paths: readonly string[]) {
  // Callers build the array inline, so a new array holding the same paths must
  // not re-run the effect. Keyed by content, not identity.
  const key = paths.join(' ')

  const cache = useRef(new Map<string, Signed>())
  const inFlight = useRef(new Set<string>())
  // Bumped when new URLs land, so consumers re-render. The cache itself is a
  // ref because it must survive re-renders without causing them.
  const [, bump] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const wanted = key.split(' ').filter((p) => {
      if (!p) return false
      if (inFlight.current.has(p)) return false
      const hit = cache.current.get(p)
      return !hit || hit.expiresAt - REFRESH_MARGIN_MS <= now
    })
    if (wanted.length === 0) return

    for (const p of wanted) inFlight.current.add(p)

    void supabase.storage
      .from(BUCKET)
      .createSignedUrls(wanted, TTL_SECONDS)
      .then(({ data }) => {
        // Cleared here and only here. Clearing these in the effect's cleanup
        // would mark the paths idle while their request was still outstanding,
        // so a re-render mid-flight would sign the same paths a second time.
        for (const p of wanted) inFlight.current.delete(p)
        if (!data) return

        // The cache outlives any single effect run, so a result landing after
        // the deps changed is still worth keeping — it is what the next render
        // is about to ask for. Hence no staleness guard on the write.
        const expiresAt = Date.now() + TTL_SECONDS * 1000
        let added = false
        for (const row of data) {
          // A failed row carries `error` and a null URL; skip it rather than
          // caching a broken entry, so the next render retries.
          if (row.signedUrl && row.path) {
            cache.current.set(row.path, { url: row.signedUrl, expiresAt })
            added = true
          }
        }
        if (added) bump((n) => n + 1)
      })
  }, [key])

  return useCallback((path: string) => cache.current.get(path)?.url ?? null, [])
}
