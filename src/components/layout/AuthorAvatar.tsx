import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials } from '@/lib/initials'
import { cn } from '@/lib/utils'

/**
 * A teammate's avatar, falling back to their initials.
 *
 * Lives here rather than in `ChannelView` because the member list renders the
 * same faces as the message list, and two implementations of "what does a
 * teammate look like" drift the moment one of them gains a ring or a size.
 */
export function AuthorAvatar({
  name,
  url,
  className,
}: {
  name: string
  url: string | null
  className?: string
}) {
  return (
    <Avatar className={cn('size-8 shrink-0', className)}>
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
