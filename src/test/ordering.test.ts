import { describe, expect, it } from 'vitest'

import {
  POSITION_STEP,
  byPosition,
  positionForMove,
  type Positioned,
} from '@/lib/ordering'

/** A list in the shape the backfill produces: 1024, 2048, 3072, 4096. */
function list(n: number): Positioned[] {
  return Array.from({ length: n }, (_, i) => ({ position: (i + 1) * POSITION_STEP }))
}

describe('positionForMove', () => {
  it('is a no-op when the row does not move', () => {
    expect(positionForMove(list(4), 2, 2)).toBeNull()
  })

  it('midpoints the two rows it lands between, dragging down', () => {
    // [1024, 2048, 3072, 4096], first row to index 2 -> between 3072 and 4096.
    expect(positionForMove(list(4), 0, 2)).toBe(3584)
  })

  it('midpoints the two rows it lands between, dragging up', () => {
    // Last row to index 1 -> between 1024 and 2048.
    expect(positionForMove(list(4), 3, 1)).toBe(1536)
  })

  it('drops below the first row when moved to the top', () => {
    expect(positionForMove(list(4), 2, 0)).toBe(POSITION_STEP - POSITION_STEP)
  })

  it('extends past the last row when moved to the bottom', () => {
    // Neighbour is 4096 (the old last row), so a step beyond it.
    expect(positionForMove(list(4), 0, 3)).toBe(4096 + POSITION_STEP)
  })

  it('removes the dragged row before reading neighbours', () => {
    // The off-by-one that makes a downward drag land one short: if the moved
    // row were still in the array at index 1, the neighbours would be
    // 1024/2048 and the result 1536 — which is where it already was.
    expect(positionForMove(list(3), 0, 1)).not.toBe(1536)
    expect(positionForMove(list(3), 0, 1)).toBe(2560)
  })

  it('handles a two-row swap in both directions', () => {
    expect(positionForMove(list(2), 0, 1)).toBe(2048 + POSITION_STEP)
    expect(positionForMove(list(2), 1, 0)).toBe(0)
  })

  it('refuses indices outside the list rather than inventing a position', () => {
    expect(positionForMove(list(3), -1, 1)).toBeNull()
    expect(positionForMove(list(3), 1, 3)).toBeNull()
    expect(positionForMove([], 0, 0)).toBeNull()
  })

  it('still separates rows after repeated drops into the same gap', () => {
    let rows = list(3)
    for (let i = 0; i < 20; i += 1) {
      const p = positionForMove(rows, 0, 1)
      expect(p).not.toBeNull()
      rows = [rows[1], { position: p as number }, rows[2]]
      // Every neighbour pair stays strictly ordered — no collapse to equality.
      expect(rows[0].position).toBeLessThan(rows[1].position)
      expect(rows[1].position).toBeLessThan(rows[2].position)
    }
  })
})

describe('byPosition', () => {
  it('sorts ascending by position', () => {
    const rows = [
      { id: 'c', position: 3072 },
      { id: 'a', position: 1024 },
      { id: 'b', position: 2048 },
    ]
    expect([...rows].sort(byPosition).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties on id so the order is stable across refreshes', () => {
    const rows = [
      { id: 'b', position: 1024 },
      { id: 'a', position: 1024 },
    ]
    expect([...rows].sort(byPosition).map((r) => r.id)).toEqual(['a', 'b'])
  })
})
