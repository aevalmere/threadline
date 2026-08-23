import { useCallback, useRef } from 'react'

/**
 * Stops the click that a pointer-up fires at the end of a drag.
 *
 * Every draggable row in the app is also a click target — a channel navigates,
 * a task card opens. dnd-kit's PointerSensor suppresses the click on the
 * element it activated on, but a drop that lands on a *different* row still
 * ends with a pointerup there, and browsers are inconsistent about whether
 * that becomes a click. The symptom is the one Ethan reported on the board:
 * you drag something and the app opens something.
 *
 * So the drop stamps a time and the click checks it. 250ms is long enough to
 * cover the frame the drop lands in and short enough that a deliberate click
 * straight after a drag still works.
 */
const GUARD_MS = 250

export function useDragClickGuard() {
  const draggedAt = useRef(0)

  /** Call from onDragEnd (and onDragCancel). */
  const markDragged = useCallback(() => {
    draggedAt.current = Date.now()
  }, [])

  /** Wrap a row's onClick. Returns true when the click was swallowed. */
  const swallowClick = useCallback((e: { preventDefault: () => void; stopPropagation: () => void }) => {
    if (Date.now() - draggedAt.current >= GUARD_MS) return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }, [])

  return { markDragged, swallowClick }
}
