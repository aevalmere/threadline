import { cn } from '@/lib/utils'

/**
 * The default face for someone with no uploaded photo (`profiles.avatar_url`
 * null).
 *
 * ## The shape
 *
 * One unbroken stroke. It starts at the left shoulder tip, rises to the neck,
 * loops all the way around to become the head, comes back down through its own
 * path, and runs out to the right shoulder tip — a single thread that keeps its
 * through-line and ends up a person. That is the product's whole argument
 * (chat → task → doc, still connected) said in one line, and it is why the head
 * is not the usual detached circle floating over a bust: detaching it would
 * break the thread.
 *
 * ## Why it is drawn this heavy
 *
 * The smallest live caller is 20px (`size-5`, the task assignee chip) and the
 * spec floor is 24px. At that size fine detail is gone, so this is deliberately
 * one shape at one gauge rather than several thin strokes: stroke-width 2.8 on
 * a 24 viewBox, round caps and joins. The stroke crosses itself just under the
 * head, which packs mass into the neck exactly where a small glyph needs it —
 * at 24px that crossing reads as a solid neck, and only at 64px+ do you see it
 * is the thread passing over itself. The head's loop is left open at the bottom
 * for the same reason: the crossing fills the gap at small sizes, and the open
 * loop shows at large ones.
 *
 * The shoulders are drawn past the frame on purpose. Inside `Avatar`
 * (`rounded-full overflow-hidden`) they crop against the circle like a portrait
 * rather than tapering to visible stub ends; standalone, they still sit inside
 * the 24×24 box.
 *
 * ## Color
 *
 * `bg-muted` + `text-muted-foreground`, the same pair `AvatarFallback` already
 * uses, and the stroke is `currentColor` — so it inherits any override and
 * clears 3:1 against its own ground in both themes (~3.5:1 light, ~4.6:1 dark).
 * No new palette.
 */
export function AnonymousAvatar({
  name,
  className,
}: {
  /**
   * Display name, used only as the accessible label. Omit it wherever a name
   * already sits next to the avatar — the mark is decorative then, matching
   * the `alt=""` that `AuthorAvatar` passes to `AvatarImage`.
   */
  name?: string
  className?: string
}) {
  return (
    <span
      data-slot="anonymous-avatar"
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      className={cn(
        'bg-muted text-muted-foreground flex size-full items-center justify-center overflow-hidden rounded-full',
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-full"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Left shoulder → neck → 300° head loop → back through the neck →
            right shoulder. One `d`, so the gauge can never drift between the
            head and the body. */}
        <path
          d="M4.6 20.6
             C4.6 17.2 5.4 15.4 8 14.9
             C9.8 14.5 11.91 13.04 14.08 11.79
             A4.15 4.15 0 1 0 9.92 11.79
             C12.09 13.04 14.2 14.5 16 14.9
             C18.6 15.4 19.4 17.2 19.4 20.6"
        />
      </svg>
    </span>
  )
}
