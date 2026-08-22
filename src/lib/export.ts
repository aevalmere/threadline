/**
 * The data-export button's engine — ROADMAP P6, "day-one insurance". An
 * authenticated JSON dump of every content table, fetched keyset-paged so
 * PostgREST's 1000-row default can never silently truncate a big channel.
 * Rows only: storage objects are not in the dump (they are files, not rows —
 * the bucket is the export for those).
 */

import { supabase } from '@/lib/supabase'

/** Every content table, with the column its keyset pages on. */
export const EXPORT_TABLES: readonly { table: string; idColumn: string }[] = [
  { table: 'profiles', idColumn: 'id' },
  { table: 'channels', idColumn: 'id' },
  { table: 'channel_members', idColumn: 'channel_id' },
  { table: 'messages', idColumn: 'id' },
  { table: 'posts', idColumn: 'id' },
  { table: 'tags', idColumn: 'id' },
  { table: 'post_tags', idColumn: 'post_id' },
  { table: 'collections', idColumn: 'id' },
  { table: 'pages', idColumn: 'id' },
  { table: 'tasks', idColumn: 'id' },
  { table: 'links', idColumn: 'id' },
  { table: 'attachments', idColumn: 'id' },
  { table: 'notifications', idColumn: 'id' },
]

export const EXPORT_PAGE_SIZE = 1000
/** A runaway guard, far above any plausible table size at 5–30 users. */
export const EXPORT_MAX_PAGES = 500

export type FetchPage = (afterId: unknown) => Promise<Record<string, unknown>[]>

/**
 * Drain a table through a page fetcher: ask again after the last row's id
 * until a page comes back short. Pure over the injected fetcher, so the
 * stop conditions are unit-testable.
 */
export async function fetchAllRows(
  fetchPage: FetchPage,
  idColumn: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let afterId: unknown = null
  for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
    const batch = await fetchPage(afterId)
    rows.push(...batch)
    if (batch.length < EXPORT_PAGE_SIZE) break
    afterId = batch[batch.length - 1][idColumn]
  }
  return rows
}

export interface WorkspaceExport {
  exported_at: string
  tables: Record<string, Record<string, unknown>[]>
}

/**
 * The whole workspace as one JSON value. Composite-keyed tables page on
 * their first key column — its order is stable, and a duplicate keyset value
 * across a page boundary is impossible for the sizes the guard allows.
 */
export async function exportWorkspace(): Promise<WorkspaceExport> {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const { table, idColumn } of EXPORT_TABLES) {
    tables[table] = await fetchAllRows(async (afterId) => {
      // The one legitimate select('*') in the app: an export must never
      // silently miss a column added later. The generated search_tsv rides
      // along and is stripped below — it is derived data, not content.
      let query = supabase
        .from(table)
        .select('*')
        .order(idColumn, { ascending: true })
        .limit(EXPORT_PAGE_SIZE)
      if (afterId !== null) query = query.gt(idColumn, afterId)
      const { data, error } = await query
      if (error) throw new Error(`Export failed on ${table}: ${error.message}`)
      return ((data ?? []) as Record<string, unknown>[]).map((row) => {
        if (!('search_tsv' in row)) return row
        const rest = { ...row }
        delete rest.search_tsv
        return rest
      })
    }, idColumn)
  }
  return { exported_at: new Date().toISOString(), tables }
}

/** The downloaded filename: threadline-export-YYYY-MM-DD.json. */
export function exportFilename(nowIso: string): string {
  return `threadline-export-${nowIso.slice(0, 10)}.json`
}
