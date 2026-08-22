import type { Tag } from '@/lib/posts'
import { cn } from '@/lib/utils'

/**
 * One tag, as a chip. Color appears only as the dot — never as text or
 * background — so contrast holds in both themes without per-color tuning.
 * Interactive when `onClick` is given (the tag filter), plain text otherwise.
 */
export function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: Tag
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: tag.color ?? 'var(--muted-foreground)' }}
      />
      {tag.name}
    </>
  )

  if (!onClick) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors',
        active
          ? 'bg-accent text-accent-foreground border-transparent font-medium'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {body}
    </button>
  )
}
