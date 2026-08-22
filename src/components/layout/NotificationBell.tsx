import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellIcon, XIcon } from 'lucide-react'

import { AuthorAvatar } from '@/components/layout/AuthorAvatar'
import { Button } from '@/components/ui/button'
import { useChannels } from '@/lib/channels-context'
import { useProfiles } from '@/lib/profiles-context'
import { useNotifications, type Notification } from '@/lib/useNotifications'
import { cn } from '@/lib/utils'

/** How long a toast stays before it slides away. */
const TOAST_MS = 6000

export function NotificationBell() {
  const navigate = useNavigate()
  const { nameFor, avatarUrlFor } = useProfiles()
  const { channels } = useChannels()
  const { items, targets, unread, latest, clearLatest, markRead, markAllRead } =
    useNotifications()

  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Notification[]>([])
  const panel = useRef<HTMLDivElement>(null)

  const channelName = (id: string | null | undefined) =>
    channels?.find((c) => c.id === id)?.name

  function describe(n: Notification): string {
    const who = nameFor(n.actor_id)
    const where = channelName(targets.get(n.entity_id)?.channel_id)
    const verb =
      n.kind === 'mention'
        ? 'mentioned you'
        : n.kind === 'reply'
          ? 'replied to your thread'
          : 'assigned you a task'
    return where ? `${who} ${verb} in #${where}` : `${who} ${verb}`
  }

  function openNotification(n: Notification) {
    void markRead(n.id)
    setOpen(false)
    setToasts((t) => t.filter((x) => x.id !== n.id))
    // An assignment points at a task, not a message — no target row loads for
    // it, so this branch must come before the message lookup (P5).
    if (n.entity_type === 'task') {
      navigate(`/tasks?t=${n.entity_id}`)
      return
    }
    const target = targets.get(n.entity_id)
    if (target?.channel_id) {
      navigate(`/channels/${target.channel_id}?m=${target.id}`)
    } else if (target?.post_id) {
      // A forum comment — exactly one parent is ever set (SPEC §1.3).
      navigate(`/posts/${target.post_id}?m=${target.id}`)
    }
  }

  /**
   * A live arrival announces itself exactly once — a desktop notification when
   * the tab is hidden, an in-app toast when it is not. Both for one event would
   * be shouting.
   *
   * `useNotifications` only sets `latest` once the target message has loaded,
   * so `describe()` has the channel name and the body has the text. `latest` is
   * cleared immediately, which is what keeps this to one announcement even
   * though the effect also depends on values that change underneath it.
   */
  useEffect(() => {
    if (!latest) return
    clearLatest()

    if (document.hidden && typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        const body = targets.get(latest.entity_id)?.body ?? ''
        new Notification(describe(latest), { body, tag: latest.id })
      }
    } else {
      setToasts((t) => (t.some((x) => x.id === latest.id) ? t : [...t, latest]))
    }
    // `describe` is redefined every render and `targets` changes as messages
    // load; neither can re-fire this, because `clearLatest` has already nulled
    // the trigger. Listing them would only add churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, clearLatest])

  // Click-away and Escape close the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div className="relative" ref={panel}>
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)}>
          <BellIcon />
          {unread > 0 && (
            <span className="bg-primary text-primary-foreground absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
          <span className="sr-only">
            {unread > 0 ? `${unread} unread notifications` : 'Notifications'}
          </span>
        </Button>

        {open && (
          <div className="bg-popover absolute top-full right-0 z-30 mt-1 w-80 overflow-hidden rounded-md border shadow-md">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-muted-foreground hover:text-foreground text-xs"
                >
                  Mark all read
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                Nothing yet.
              </p>
            ) : (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {items.map((n) => {
                  const target = targets.get(n.entity_id)
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(n)}
                        className={cn(
                          'hover:bg-accent flex w-full items-start gap-2 px-3 py-2 text-left',
                          !n.read_at && 'bg-primary/5',
                        )}
                      >
                        <AuthorAvatar
                          name={nameFor(n.actor_id)}
                          url={avatarUrlFor(n.actor_id)}
                          className="mt-0.5 size-6"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{describe(n)}</span>
                          {target && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {target.deleted_at ? 'message deleted' : target.body}
                            </span>
                          )}
                          <span className="text-muted-foreground block text-xs">
                            {relativeTime(n.created_at)}
                          </span>
                        </span>
                        {!n.read_at && (
                          <span className="bg-primary mt-2 size-2 shrink-0 rounded-full" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <DesktopPermission />
          </div>
        )}
      </div>

      {/* Toasts live outside the panel so closing it does not dismiss them. */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((n) => (
          <Toast
            key={n.id}
            title={describe(n)}
            body={targets.get(n.entity_id)?.body}
            avatar={
              <AuthorAvatar
                name={nameFor(n.actor_id)}
                url={avatarUrlFor(n.actor_id)}
                className="mt-0.5 size-6"
              />
            }
            onOpen={() => openNotification(n)}
            onDismiss={() => setToasts((t) => t.filter((x) => x.id !== n.id))}
          />
        ))}
      </div>
    </>
  )
}

/**
 * One toast, owning its own dismissal timer.
 *
 * A component rather than a shared timer effect over the whole list: keying
 * that effect on the array re-armed every countdown whenever any toast arrived
 * or was dismissed, so an old toast could outlive its six seconds indefinitely
 * on a busy channel. Mounting the timer with the toast makes each one's life
 * its own.
 */
function Toast({
  title,
  body,
  avatar,
  onOpen,
  onDismiss,
}: {
  title: string
  body: string | undefined
  avatar: React.ReactNode
  onOpen: () => void
  onDismiss: () => void
}) {
  // Held in a ref so a re-render with a new closure cannot restart the timer.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    const t = setTimeout(() => dismiss.current(), TOAST_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="bg-popover pointer-events-auto flex items-start gap-2 rounded-md border p-3 shadow-lg">
      {avatar}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block text-sm">{title}</span>
        {body && (
          <span className="text-muted-foreground block truncate text-xs">{body}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <XIcon className="size-4" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}

/**
 * Desktop notifications are opt-in and can only be requested from a real
 * click — browsers reject a request made without a gesture, and a `denied`
 * state cannot be re-prompted. So this appears only while the decision is
 * still open, and disappears for good either way.
 *
 * They deviate from BACKLOG's push-notification non-goal, at Ethan's explicit
 * request; DECISIONS #16 and SPEC §1.9 record that and say precisely what this
 * is and is not.
 */
function DesktopPermission() {
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  if (permission !== 'default') return null

  return (
    <div className="border-t px-3 py-2">
      <button
        type="button"
        onClick={() => void Notification.requestPermission().then(setPermission)}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        Enable desktop notifications
      </button>
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
