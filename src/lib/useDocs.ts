/**
 * Docs state — SPEC §1.7, §2.3.
 *
 * Hooks, not a context: only the docs routes consume pages and collections,
 * the same test DECISIONS #6 applied to messages, tasks, and posts. No
 * realtime — SPEC §4 names what replicates and pages are deliberately absent;
 * the edit-lock banner POLLS the page row while it is open instead
 * (EDIT_LOCK_POLL_MS), and lists refetch after mutations like the task board.
 *
 * Error convention matches useTasks/usePosts: the load error is state,
 * mutation errors are thrown for the calling form to catch.
 */

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth-context'
import {
  COLLECTION_COLUMNS,
  PAGE_COLUMNS,
  PAGE_LIST_COLUMNS,
  heartbeatPatch,
  linkDiff,
  linkForPage,
  linksFromDoc,
  pageInsertPayload,
  releasePatch,
  savePatch,
  type Collection,
  type Page,
  type PageMeta,
} from '@/lib/pages'
import { appendPosition, byPosition, positionForMove } from '@/lib/ordering'
import { supabase } from '@/lib/supabase'

const BUCKET = 'attachments'

export function useCollections() {
  /** Null until the first fetch settles — the loading state. */
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await supabase
      .from('collections')
      .select(COLLECTION_COLUMNS)
      .order('position', { ascending: true })
    if (list.error) {
      setError(list.error.message)
      return
    }
    setError(null)
    setCollections((list.data ?? []) as Collection[])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createCollection = useCallback(
    async (name: string, parentId: string | null): Promise<Collection> => {
      const trimmed = name.trim()
      if (trimmed === '') throw new Error('A collection needs a name.')
      // Append below its siblings: one max-position read, same shape as the
      // board and the sidebar. Read from the server, not local state.
      const siblingQuery = supabase.from('collections').select('position')
      // `.is(col, null)` and `.eq(col, value)` are different filters in
      // PostgREST — `eq` with a null never matches, so the root list would
      // read an empty max and every root collection would be created at the
      // same position.
      const top = await (parentId === null
        ? siblingQuery.is('parent_id', null)
        : siblingQuery.eq('parent_id', parentId)
      )
        .order('position', { ascending: false })
        .limit(1)
      const ins = await supabase
        .from('collections')
        .insert({
          name: trimmed,
          parent_id: parentId,
          position: appendPosition((top.data ?? []) as { position: number }[]),
        })
        .select(COLLECTION_COLUMNS)
        .single()
      if (ins.error || !ins.data) {
        throw new Error(ins.error?.message ?? 'Could not create the collection.')
      }
      await refresh()
      return ins.data as Collection
    },
    [refresh],
  )

  /**
   * Drag-reorder a collection among its siblings. `from`/`to` index the
   * sibling list in render order, `to` being the destination in the final
   * array. One row written per drop (SPEC §1.7).
   */
  const moveCollection = useCallback(
    async (parentId: string | null, from: number, to: number) => {
      const siblings = (collections ?? [])
        .filter((c) => c.parent_id === parentId)
        .sort(byPosition)
      const moved = siblings[from]
      const position = positionForMove(siblings, from, to)
      if (!moved || position === null) return

      setCollections((current) =>
        (current ?? []).map((c) => (c.id === moved.id ? { ...c, position } : c)),
      )
      const { error: err } = await supabase
        .from('collections')
        .update({ position })
        .eq('id', moved.id)
      if (err) {
        await refresh()
        throw new Error(err.message)
      }
    },
    [collections, refresh],
  )

  const renameCollection = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      if (trimmed === '') throw new Error('A collection needs a name.')
      const { data, error: err } = await supabase
        .from('collections')
        .update({ name: trimmed })
        .eq('id', id)
        .select('id')
      // Judged on rows, not error absence (DECISIONS #5).
      if (err || (data?.length ?? 0) !== 1) {
        throw new Error(err?.message ?? 'The rename did not take effect.')
      }
      await refresh()
    },
    [refresh],
  )

  /**
   * Deleting a collection cascades its child collections but only un-files
   * pages — their FK is `set null` (SPEC §2.3), so no document is destroyed
   * and no attachment sweep is needed here.
   */
  const deleteCollection = useCallback(
    async (id: string) => {
      const { data, error: err } = await supabase
        .from('collections')
        .delete()
        .eq('id', id)
        .select('id')
      if (err || (data?.length ?? 0) !== 1) {
        throw new Error(err?.message ?? 'The delete did not take effect.')
      }
      await refresh()
    },
    [refresh],
  )

  return {
    collections,
    error,
    refresh,
    createCollection,
    renameCollection,
    deleteCollection,
    moveCollection,
  }
}

export function usePages() {
  const [pages, setPages] = useState<PageMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { authorId } = useAuth()

  const refresh = useCallback(async () => {
    // By position, not by recency: the tree is dragged into order now, and a
    // list you can drag cannot also rearrange itself when someone edits a
    // page (SPEC §1.7). The migration seeded positions from the old
    // updated_at order, so nothing jumped when it landed.
    const list = await supabase
      .from('pages')
      .select(PAGE_LIST_COLUMNS)
      .order('position', { ascending: true })
    if (list.error) {
      setError(list.error.message)
      return
    }
    setError(null)
    setPages((list.data ?? []) as PageMeta[])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createPage = useCallback(
    async (collectionId: string | null): Promise<PageMeta> => {
      if (!authorId) throw new Error('Not ready yet.')
      const siblingQuery = supabase.from('pages').select('position')
      const top = await (collectionId === null
        ? siblingQuery.is('collection_id', null)
        : siblingQuery.eq('collection_id', collectionId)
      )
        .order('position', { ascending: false })
        .limit(1)
      const ins = await supabase
        .from('pages')
        .insert(
          pageInsertPayload({
            collectionId,
            createdBy: authorId,
            position: appendPosition((top.data ?? []) as { position: number }[]),
          }),
        )
        .select(PAGE_LIST_COLUMNS)
        .single()
      if (ins.error || !ins.data) {
        throw new Error(ins.error?.message ?? 'Could not create the page.')
      }
      await refresh()
      return ins.data as PageMeta
    },
    [authorId, refresh],
  )

  /**
   * Drag-reorder a page within its collection — distinct from `movePage`,
   * which re-files it into a *different* collection. One row per drop.
   */
  const reorderPage = useCallback(
    async (collectionId: string | null, from: number, to: number) => {
      const siblings = (pages ?? [])
        .filter((p) => p.collection_id === collectionId)
        .sort(byPosition)
      const moved = siblings[from]
      const position = positionForMove(siblings, from, to)
      if (!moved || position === null) return

      setPages((current) =>
        (current ?? []).map((p) => (p.id === moved.id ? { ...p, position } : p)),
      )
      const { error: err } = await supabase
        .from('pages')
        .update({ position })
        .eq('id', moved.id)
      if (err) {
        await refresh()
        throw new Error(err.message)
      }
    },
    [pages, refresh],
  )

  const movePage = useCallback(
    async (id: string, collectionId: string | null) => {
      const { data, error: err } = await supabase
        .from('pages')
        .update({ collection_id: collectionId })
        .eq('id', id)
        .select('id')
      if (err || (data?.length ?? 0) !== 1) {
        throw new Error(err?.message ?? 'The move did not take effect.')
      }
      await refresh()
    },
    [refresh],
  )

  const deletePage = useCallback(
    async (id: string) => {
      await deletePageRecord(id)
      await refresh()
    },
    [refresh],
  )

  return { pages, error, refresh, createPage, movePage, reorderPage, deletePage }
}

/**
 * One page for the editor. `missing` distinguishes "gone" (deleted or bad
 * URL — show not-found) from a load error. `refreshLock` re-reads only the
 * two edit-lock columns — it runs on a poll while the page is open, and must
 * not refetch the whole document out from under the uncontrolled editor.
 */
export function usePage(pageId: string | undefined) {
  const [page, setPage] = useState<Page | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!pageId) return
    const { data, error: err } = await supabase
      .from('pages')
      .select(PAGE_COLUMNS)
      .eq('id', pageId)
      .maybeSingle()
    if (err) {
      setError(err.message)
      return
    }
    if (!data) {
      setMissing(true)
      return
    }
    setError(null)
    setMissing(false)
    setPage(data as Page)
  }, [pageId])

  useEffect(() => {
    setPage(null)
    setMissing(false)
    setError(null)
    void refresh()
  }, [refresh])

  const refreshLock = useCallback(async () => {
    if (!pageId) return
    const { data } = await supabase
      .from('pages')
      .select('editing_user_id,editing_heartbeat_at')
      .eq('id', pageId)
      .maybeSingle()
    // A poll failure is not worth an error banner; the next tick retries.
    if (!data) return
    const lock = data as Pick<Page, 'editing_user_id' | 'editing_heartbeat_at'>
    // The id guard drops an in-flight poll for a previous page — without it a
    // late response could paint the old page's lock onto the new one for a
    // poll period (batch reviewer, G4).
    setPage((prev) => (prev === null || prev.id !== pageId ? prev : { ...prev, ...lock }))
  }, [pageId])

  return { page, missing, error, refresh, refreshLock }
}

/**
 * Claim or refresh the soft edit-lock (SPEC §1.7). Touches only the two lock
 * columns — never updated_at, which is reserved for content saves.
 */
export async function claimEdit(pageId: string, userId: string): Promise<void> {
  await supabase
    .from('pages')
    .update(heartbeatPatch(userId, new Date().toISOString()))
    .eq('id', pageId)
  // Best-effort on purpose: a missed heartbeat degrades the banner, nothing
  // else, and the interval retries in 15s.
}

/**
 * Release the lock when leaving — but only if it is still ours. The `.eq` on
 * editing_user_id makes a stale unmount lose quietly to a teammate who has
 * since claimed the page.
 */
export async function releaseEdit(pageId: string, userId: string): Promise<void> {
  await supabase
    .from('pages')
    .update(releasePatch())
    .eq('id', pageId)
    .eq('editing_user_id', userId)
}

/**
 * The autosave write. Judged on rows: a page deleted under the editor makes
 * the save throw rather than silently vanish.
 */
export async function savePageRecord(
  pageId: string,
  title: string,
  bodyRich: unknown,
): Promise<void> {
  const { data, error: err } = await supabase
    .from('pages')
    .update(savePatch(title, bodyRich, new Date().toISOString()))
    .eq('id', pageId)
    .select('id')
  if (err || (data?.length ?? 0) !== 1) {
    throw new Error(err?.message ?? 'The save did not take effect.')
  }
}

/**
 * Make the page's stored `links` edges equal the document's internal links
 * (SPEC §1.8 — integrity is app-enforced, and the rows are DERIVED from the
 * document: deleting a link's text removes its edge on the next save). Runs
 * after every successful autosave; scoped to kind='references' so it can
 * never touch created_from provenance edges.
 */
export async function syncPageLinks(pageId: string, bodyRich: unknown): Promise<void> {
  const current = await supabase
    .from('links')
    .select('id,target_type,target_id')
    .eq('source_type', 'page')
    .eq('source_id', pageId)
    .eq('kind', 'references')
  if (current.error) throw new Error(current.error.message)

  const want = linksFromDoc(bodyRich, window.location.origin)
  const diff = linkDiff(
    (current.data ?? []) as { id: string; target_type: string; target_id: string }[],
    want,
  )
  for (const target of diff.add) {
    const ins = await supabase.from('links').insert(linkForPage(pageId, target))
    if (ins.error) throw new Error(ins.error.message)
  }
  if (diff.remove.length > 0) {
    const del = await supabase.from('links').delete().in('id', diff.remove)
    if (del.error) throw new Error(del.error.message)
  }
}

/**
 * Delete a page and everything only it holds up — the sweep discipline of
 * deletePostRecord (DECISIONS #11: deletion frees the bytes): storage objects
 * first (the failure that leaves bytes behind is the one worth avoiding),
 * then attachment rows, then links edges both directions, then the page.
 * Re-running Delete after a partial failure is safe: remove() is idempotent
 * and every query below tolerates already-gone rows.
 */
export async function deletePageRecord(id: string): Promise<void> {
  const owned = await supabase
    .from('attachments')
    .select('id,storage_path')
    .eq('owner_type', 'page')
    .eq('owner_id', id)
  if (owned.error) throw new Error(owned.error.message)
  const rows = (owned.data ?? []) as { id: string; storage_path: string }[]

  if (rows.length > 0) {
    const rm = await supabase.storage.from(BUCKET).remove(rows.map((a) => a.storage_path))
    if (rm.error) throw new Error(`Could not delete attached files: ${rm.error.message}`)
    const del = await supabase
      .from('attachments')
      .delete()
      .in('id', rows.map((a) => a.id))
    if (del.error) throw new Error(del.error.message)
  }

  for (const [typeCol, idCol] of [
    ['source_type', 'source_id'],
    ['target_type', 'target_id'],
  ] as const) {
    const edges = await supabase.from('links').delete().eq(typeCol, 'page').eq(idCol, id)
    if (edges.error) throw new Error(edges.error.message)
  }

  const { data, error: err } = await supabase.from('pages').delete().eq('id', id).select('id')
  if (err || (data?.length ?? 0) !== 1) {
    throw new Error(err?.message ?? 'The delete did not take effect.')
  }
}
