import { useCallback, useRef } from 'react'

import { WIDTH_BOUNDS, clampWidth } from '@/lib/preferences'
import { cn } from '@/lib/utils'

/** One arrow press. Shift multiplies it, for crossing the range quickly. */
const STEP = 16
const COARSE_STEP = 64

/**
 * The divider between two panes.
 *
 * **Hand-rolled rather than react-resizable-panels.** The panes that resize
 * are already flex siblings — `AppShell`'s row is `aside / flex-1 / aside`, and
 * the docs tree and editor are the same shape — so nothing needs restructuring
 * into a PanelGroup. A library here would buy about sixty lines and cost a
 * dependency against the Aug 28 freeze plus a rewrite of the shell's layout.
 *
 * **Width comes from a delta, not a measurement.** `pointerdown` records the
 * starting width and x, and every move applies `startWidth ± dx`. Reading the
 * pane's box on each frame would fight the reflow the drag is causing.
 *
 * **Keyboard, because this is a new drag surface.** WCAG 2.5.7 wants a non-drag
 * path for anything drag-only, and unlike the dnd-kit lists — where the
 * keyboard story is a settled decision recorded in `Tasks.tsx` and DECISIONS
 * #24 — a divider has an obvious one. This is the WAI window-splitter pattern:
 * `role="separator"` with a tabindex, arrows to nudge, Home and End for the
 * ends of the range.
 */
export function Resizer({
  label,
  boundKey,
  width,
  onChange,
  onCommit,
  /** Which side of the divider the pane being sized sits on. */
  side,
  className,
}: {
  label: string
  boundKey: keyof typeof WIDTH_BOUNDS
  width: number
  /** Fires on every move, so the pane tracks the pointer. */
  onChange: (width: number) => void
  /** Fires once at the end, so storage is written a single time per drag. */
  onCommit: (width: number) => void
  side: 'left' | 'right'
  className?: string
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const latest = useRef(width)
  const { min, max } = WIDTH_BOUNDS[boundKey]

  // A pane on the left grows as the pointer moves right; one on the right
  // grows as it moves left.
  const direction = side === 'left' ? 1 : -1

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Capture on the divider itself, so a fast drag that outruns the element
      // keeps sending moves here instead of to whatever it passed over.
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { startX: e.clientX, startWidth: width }
      latest.current = width
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = drag.current
      if (!start) return
      const next = clampWidth(boundKey, start.startWidth + (e.clientX - start.startX) * direction)
      latest.current = next
      onChange(next)
    },
    [boundKey, direction, onChange],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return
      drag.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      // One write per drag, not one per frame.
      onCommit(latest.current)
    },
    [onCommit],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? COARSE_STEP : STEP
      let next: number | null = null
      if (e.key === 'ArrowLeft') next = width - step * direction
      else if (e.key === 'ArrowRight') next = width + step * direction
      else if (e.key === 'Home') next = min
      else if (e.key === 'End') next = max
      if (next === null) return
      // Arrow keys scroll the pane behind the divider otherwise.
      e.preventDefault()
      const clamped = clampWidth(boundKey, next)
      onChange(clamped)
      onCommit(clamped)
    },
    [boundKey, direction, max, min, onChange, onCommit, width],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        // The divider reads as 1px but grabs across roughly 11, via the
        // pseudo-element below: a 24px-wide visible seam would look like a
        // gutter, and a 1px-wide grab target cannot be hit.
        'relative w-px shrink-0 cursor-col-resize touch-none',
        // Transparent at rest: every pane it divides already draws its own
        // border, and a second 1px line beside it reads as a double rule.
        'hover:bg-ring focus-visible:bg-ring bg-transparent transition-colors',
        'focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none',
        "after:absolute after:inset-y-0 after:-left-[5px] after:-right-[5px] after:content-['']",
        className,
      )}
    />
  )
}
