import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import {
  FileTextIcon,
  HashIcon,
  KanbanIcon,
  MessagesSquareIcon,
  NewspaperIcon,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'
import { useDragClickGuard } from '@/lib/useDragClickGuard'
import { useProfiles } from '@/lib/profiles-context'
import type { Channel } from '@/lib/supabase'
import { useUnread } from '@/lib/unread-context'

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
      : 'hover:bg-sidebar-accent/60',
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, signOut } = useAuth()
  const { chat, forum, loading, error } = useChannels()
  const { avatarUrlFor } = useProfiles()
  const { badgeFor } = useUnread()

  return (
    // No border-r: the Resizer beside it draws the seam on desktop, and in the
    // mobile sheet SheetContent already carries its own.
    <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col">
      <div className="px-4 py-4">
        <span className="text-base font-semibold tracking-tight">Threadline</span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        <section>
          <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
            Channels
          </p>
          <NavLink to="/channels" className={navClass} onClick={onNavigate} end>
            <MessagesSquareIcon /> All channels
          </NavLink>
          {loading ? (
            <div className="space-y-1 px-2 py-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          ) : (
            <SortableChannelList
              kind="chat"
              channels={chat}
              hrefFor={(c) => `/channels/${c.id}`}
              icon={<HashIcon />}
              badgeFor={badgeFor}
              onNavigate={onNavigate}
            />
          )}
        </section>

        <section>
          <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
            Forums
          </p>
          <NavLink to="/forums" className={navClass} onClick={onNavigate} end>
            <MessagesSquareIcon /> All forums
          </NavLink>
          {loading ? (
            <div className="space-y-1 px-2 py-1">
              <Skeleton className="h-5 w-24" />
            </div>
          ) : (
            <SortableChannelList
              kind="forum"
              channels={forum}
              hrefFor={(c) => `/forums/${c.id}`}
              icon={<NewspaperIcon />}
              onNavigate={onNavigate}
            />
          )}
        </section>

        <section>
          <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
            Workspace
          </p>
          <NavLink to="/docs" className={navClass} onClick={onNavigate}>
            <FileTextIcon /> Docs
          </NavLink>
          <NavLink to="/tasks" className={navClass} onClick={onNavigate}>
            <KanbanIcon /> Tasks
          </NavLink>
        </section>

        {error && (
          <p role="alert" className="text-destructive px-2 text-xs">
            Could not load channels: {error}
          </p>
        )}
      </nav>

      <div className="border-sidebar-border flex items-center gap-2 border-t px-3 py-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className="hover:bg-sidebar-accent/60 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1"
        >
          <AuthorAvatar
            name={profile?.display_name ?? '?'}
            url={avatarUrlFor(profile?.id ?? null)}
            className="size-7"
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {profile?.display_name ?? '…'}
          </span>
        </NavLink>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

/**
 * One drag-reorderable list of channels — SPEC §1.2. Chat and forum are two
 * separate DndContexts so a channel can never be dropped into the other kind's
 * list, which would be a `kind` change disguised as a reorder.
 *
 * A drop writes exactly one row (`moveChannel` → `positionForMove`). The order
 * is shared by the whole workspace, not per person.
 *
 * No `touch-action: none` on the rows: it is what PointerSensor wants on
 * touch devices, but it would also stop a finger scrolling the sidebar from a
 * channel row, and on mobile the sidebar is a sheet you scroll far more often
 * than you reorder. Reordering is a pointer-device affordance here.
 */
function SortableChannelList({
  kind,
  channels,
  hrefFor,
  icon,
  badgeFor,
  onNavigate,
}: {
  kind: Channel['kind']
  channels: Channel[]
  hrefFor: (c: Channel) => string
  icon: React.ReactNode
  badgeFor?: (id: string) => string | null
  onNavigate?: () => void
}) {
  const { moveChannel } = useChannels()
  const { markDragged, swallowClick } = useDragClickGuard()
  const [moveError, setMoveError] = useState<string | null>(null)
  // 6px, matching the board: below that a press is a click, so navigating to a
  // channel by clicking it still works with the whole row as the drag surface.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function onDragEnd(e: DragEndEvent) {
    markDragged()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = channels.findIndex((c) => c.id === active.id)
    const to = channels.findIndex((c) => c.id === over.id)
    if (from === -1 || to === -1) return
    // moveChannel rethrows on a failed write after refreshing back to the
    // server's order, so the row visibly snaps home — but a bare `void` here
    // made that an unhandled rejection with nothing said. Same shape as
    // DocsArea's run().
    setMoveError(null)
    moveChannel(kind, from, to).catch((err: unknown) =>
      setMoveError(err instanceof Error ? err.message : 'Could not save the new order.'),
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      onDragCancel={markDragged}
    >
      <SortableContext
        items={channels.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {channels.map((c) => (
          <SortableChannelRow
            key={c.id}
            channel={c}
            to={hrefFor(c)}
            icon={icon}
            badge={badgeFor?.(c.id) ?? null}
            onNavigate={onNavigate}
            swallowClick={swallowClick}
          />
        ))}
      </SortableContext>
      {moveError && (
        <p role="alert" className="text-destructive px-2 text-xs">
          {moveError}
        </p>
      )}
    </DndContext>
  )
}

function SortableChannelRow({
  channel,
  to,
  icon,
  badge,
  onNavigate,
  swallowClick,
}: {
  channel: Channel
  to: string
  icon: React.ReactNode
  badge: string | null
  onNavigate?: () => void
  swallowClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => boolean
}) {
  // Listeners only, never `attributes` — those would put role="button" and a
  // space-bar drag promise on a link, and the link is the keyboard path here.
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: channel.id,
  })

  return (
    <NavLink
      ref={setNodeRef}
      to={to}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={({ isActive }) =>
        cn(navClass({ isActive }), isDragging && 'opacity-40', 'relative')
      }
      onClick={(e) => {
        // A drop that lands on a different row ends with a pointerup there;
        // without this the app navigates every time you finish a drag.
        if (swallowClick(e)) return
        onNavigate?.()
      }}
      {...listeners}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
      <UnreadBadge count={badge} />
    </NavLink>
  )
}

/**
 * The unread count beside a channel. Null when there is nothing unread, so a
 * quiet sidebar stays quiet — SPEC §1.4.
 */
function UnreadBadge({ count }: { count: string | null }) {
  if (!count) return null
  return (
    <span className="bg-primary text-primary-foreground ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none font-medium tabular-nums">
      {count}
    </span>
  )
}
