import { Link } from 'react-router-dom'

import { FileTextIcon } from 'lucide-react'

import { useBacklinks } from '@/lib/useBacklinks'

/**
 * The "Linked items" backlink panel (SPEC §1.8) — pages that link here.
 * Renders nothing while loading or when nothing links in: it is provenance,
 * not a surface worth an empty state. Shared by the task dialog and the page
 * view; deliberately free of docs-chunk imports so the task board can carry
 * it without pulling BlockNote.
 */
export function LinkedItems({
  targetType,
  targetId,
}: {
  targetType: 'task' | 'page'
  targetId: string
}) {
  const { backlinks } = useBacklinks(targetType, targetId)
  if (backlinks === null || backlinks.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Linked items
      </p>
      <ul className="space-y-0.5">
        {backlinks.map((b) => (
          <li key={b.pageId}>
            <Link
              to={`/docs/${b.pageId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1.5 text-sm"
            >
              <FileTextIcon className="size-3.5 shrink-0" />
              <span className="truncate">{b.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
