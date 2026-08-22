/**
 * Incoming links — the "Linked items" panel (SPEC §1.8). One query on the
 * `(target_type, target_id)` index the links table was built with, then one
 * batched title resolve. Only doc pages write `references` edges today, so
 * every backlink resolves to a page; a source page that is gone (or whose
 * edge is mid-sweep) is dropped rather than rendered as a hole.
 */

import { useCallback, useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'

export interface Backlink {
  pageId: string
  title: string
}

export function useBacklinks(
  targetType: 'task' | 'page',
  targetId: string | undefined,
) {
  /** Null until the first fetch settles — the loading state. */
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null)

  const refresh = useCallback(async () => {
    if (!targetId) return
    const edges = await supabase
      .from('links')
      .select('source_type,source_id')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
    if (edges.error) {
      // The panel is auxiliary — an empty panel beats an error banner here.
      setBacklinks([])
      return
    }
    const pageIds = [
      ...new Set(
        ((edges.data ?? []) as { source_type: string; source_id: string }[])
          .filter((e) => e.source_type === 'page')
          .map((e) => e.source_id),
      ),
    ]
    if (pageIds.length === 0) {
      setBacklinks([])
      return
    }
    const pages = await supabase.from('pages').select('id,title').in('id', pageIds)
    if (pages.error) {
      setBacklinks([])
      return
    }
    setBacklinks(
      ((pages.data ?? []) as { id: string; title: string }[])
        .map((p) => ({ pageId: p.id, title: p.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    )
  }, [targetType, targetId])

  useEffect(() => {
    setBacklinks(null)
    void refresh()
  }, [refresh])

  return { backlinks, refresh }
}
