import { Link } from 'react-router-dom'

import { HashIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useChannels } from '@/lib/channels-context'

/**
 * All forums — the landing page for the sidebar's "All forums" link. Forum
 * creation lives on /channels with the rest of channel CRUD; this page only
 * navigates.
 */
export default function Forums() {
  const { forum, loading, error } = useChannels()

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Forums</h1>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not load forums: {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : forum.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No forums yet. Create one from the Channels page with kind “forum”.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {forum.map((c) => (
            <li key={c.id}>
              <Link
                to={`/forums/${c.id}`}
                className="hover:bg-accent/40 flex items-center gap-3 px-3 py-2.5"
              >
                <HashIcon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  {c.topic && (
                    <p className="text-muted-foreground truncate text-xs">{c.topic}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
