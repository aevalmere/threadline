import { FileTextIcon, HashIcon, KanbanIcon, MessagesSquareIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { useChannels } from '@/lib/channels-context'

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

  return (
    <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full flex-col border-r">
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
            chat.map((c) => (
              <NavLink
                key={c.id}
                to={`/channels/${c.id}`}
                className={navClass}
                onClick={onNavigate}
              >
                <HashIcon /> {c.name}
              </NavLink>
            ))
          )}
        </section>

        <section>
          <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
            Forums
          </p>
          <NavLink to="/forums" className={navClass} onClick={onNavigate} end>
            <MessagesSquareIcon /> All forums
          </NavLink>
          {forum.map((c) => (
            <NavLink
              key={c.id}
              to={`/forums/${c.id}`}
              className={navClass}
              onClick={onNavigate}
            >
              <HashIcon /> {c.name}
            </NavLink>
          ))}
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

      <div className="border-sidebar-border flex items-center justify-between gap-2 border-t px-3 py-3">
        <span className="truncate text-sm">{profile?.display_name ?? '…'}</span>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
