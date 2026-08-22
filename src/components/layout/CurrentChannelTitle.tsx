import { useLocation } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useChannels } from '@/lib/channels-context'

/**
 * The open channel's name and topic, shown in the app header beside search.
 *
 * Derived from the path rather than passed down: AppShell is a layout above
 * `/channels/:channelId`, so it has no param of its own, and threading a title
 * up from the route would mean a context whose only job is one string.
 */
export function CurrentChannelTitle() {
  const { pathname } = useLocation()
  const { channels, loading } = useChannels()

  // Forums share the header treatment; a post page renders its own title.
  const match = /^\/(?:channels|forums)\/([^/]+)/.exec(pathname)
  if (!match) return null

  const channel = channels?.find((c) => c.id === match[1])
  if (!channel) {
    return loading ? <Skeleton className="h-5 w-32" /> : null
  }

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold">#{channel.name}</span>
      {channel.topic && (
        <span className="text-muted-foreground hidden truncate text-sm md:inline">
          {channel.topic}
        </span>
      )}
    </div>
  )
}
