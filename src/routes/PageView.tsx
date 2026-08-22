import { useParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { usePage } from '@/lib/useDocs'

/**
 * One doc page — SPEC §1.7. The editor, autosave, edit-lock banner, and
 * Linked items panel land here; this file stays the route shell that owns
 * the fetch, the not-found state, and the load error.
 */
export default function PageView() {
  const { pageId } = useParams<{ pageId: string }>()
  const { page, missing, error } = usePage(pageId)

  if (missing) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          This page is gone — deleted, or the link is stale.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="text-destructive text-sm">
          Could not load the page: {error}
        </p>
      </div>
    )
  }

  if (page === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {/* The BlockNote editor replaces this heading in the next slice; the
          shell exists so the tree's navigation is a complete vertical slice. */}
      <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
    </div>
  )
}
