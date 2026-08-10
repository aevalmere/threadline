import { useMemo } from 'react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/lib/auth-context'
import { useProfiles } from '@/lib/profiles-context'

/**
 * Everyone in the workspace.
 *
 * Reads `ProfilesProvider`, which already holds every profile for message
 * authorship — so this panel costs one sort and no query. There is no
 * per-channel membership filter on purpose: `channel_members` exists to carry
 * `last_read_message_id` (SPEC §1.4), not to gate access. One trusted
 * workspace, no roles (SPEC §1.1).
 */
export function MemberList() {
  const { byId, loading } = useProfiles()
  const { authorId } = useAuth()

  const members = useMemo(
    () => [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [byId],
  )

  return (
    <div className="flex h-full flex-col">
      <p className="text-muted-foreground shrink-0 px-4 pt-4 pb-2 text-xs font-medium tracking-wide uppercase">
        Members{!loading && ` — ${members.length}`}
      </p>

      {loading ? (
        <div className="space-y-2 px-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <AuthorAvatar name={m.display_name} url={m.avatar_url} className="size-7" />
              <span className="min-w-0 flex-1 truncate text-sm">{m.display_name}</span>
              {m.id === authorId && (
                <span className="text-muted-foreground shrink-0 text-xs">you</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
