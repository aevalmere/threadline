import { AnonymousAvatar } from '@/components/ui/anonymous-avatar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/**
 * A teammate's avatar, falling back to the anonymous mark.
 *
 * Lives here rather than in `ChannelView` because the member list renders the
 * same faces as the message list, and two implementations of "what does a
 * teammate look like" drift the moment one of them gains a ring or a size.
 *
 * The fallback was initials until 2026-08-29, when Ethan asked for a default
 * anonymous icon. Worth knowing what that trades away: initials told two
 * photo-less teammates apart in the message list and the member list, and the
 * mark does not — everyone without a photo now renders the same face.
 * `src/lib/initials.ts` is left in place, unreferenced, because reversing this
 * is a one-line change.
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
      <AvatarFallback>
        {/*
          Labelled, not decorative. The initials this replaced were text, so a
          screen reader always had something here, and the assignee chip on a
          task card (`size-5`, Tasks.tsx) renders the avatar with no name beside
          it at all.
        */}
        <AnonymousAvatar name={name} />
      </AvatarFallback>
    </Avatar>
  )
}
