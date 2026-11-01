/**
 * Touch rules for the picker (#128): a tap selects, a movement before the long
 * press scrolls, and only a long press followed by a drag draws a rectangle.
 */

import { describe, expect, it } from 'vitest'
import { LONG_PRESS_MS, MIN_RECT_PX, TAP_SLOP_PX, TouchGesture, movedPastSlop, rectBetween } from './touch'

const at = (x: number, y: number) => ({ x, y })

describe('tap', () => {
  it('selects the point where the finger lifted', () => {
    const g = new TouchGesture()
    g.begin(at(100, 200), 1)
    expect(g.end(at(103, 201))).toEqual({ kind: 'tap', at: at(103, 201) })
  })

  it('tolerates a movement of exactly the slop', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    expect(g.end(at(TAP_SLOP_PX, 0)).kind).toBe('tap')
  })

  it('does not draw a rectangle while the finger is still moving only slightly', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    expect(g.move(at(3, 3))).toBeNull()
    expect(g.isDragging).toBe(false)
  })
})

describe('scrolling', () => {
  it('is not a tap when the finger moves past the slop', () => {
    // Control for the tap tests: the same start and end gap, made larger.
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    g.move(at(0, 40))
    expect(g.end(at(0, 80))).toEqual({ kind: 'none' })
  })

  it('is not a tap when the finger lifts far from where it went down, with no move seen', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    expect(g.end(at(0, 200))).toEqual({ kind: 'none' })
  })

  it('never starts a drag once the finger has moved before the long press', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    g.move(at(0, 30))
    expect(g.hold()).toBe(false)
    expect(g.isDragging).toBe(false)
  })

  it('is not a pick when a second finger is down', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 2)
    expect(g.hold()).toBe(false)
    expect(g.end(at(0, 0))).toEqual({ kind: 'none' })
  })

  it('is not a pick after the touch is cancelled', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    g.cancel()
    expect(g.end(at(0, 0))).toEqual({ kind: 'none' })
  })
})

describe('long press and drag', () => {
  it('starts a drag only when the hold timer fires with the finger still', () => {
    const g = new TouchGesture()
    g.begin(at(50, 50), 1)
    expect(g.hold()).toBe(true)
    expect(g.isDragging).toBe(true)
  })

  it('draws the rectangle from the press to the finger and ends with it', () => {
    const g = new TouchGesture()
    g.begin(at(50, 60), 1)
    g.hold()
    expect(g.move(at(150, 20))).toEqual({ x: 50, y: 20, width: 100, height: 40 })
    expect(g.end(at(150, 20))).toEqual({
      kind: 'rect',
      rect: { x: 50, y: 20, width: 100, height: 40 },
    })
  })

  it('treats a long press released without dragging as a tap where it began', () => {
    const g = new TouchGesture()
    g.begin(at(50, 60), 1)
    g.hold()
    expect(g.end(at(52, 61))).toEqual({ kind: 'tap', at: at(50, 60) })
  })

  it('treats a drag smaller than the minimum in one direction as a tap', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    g.hold()
    expect(g.end(at(200, MIN_RECT_PX - 1)).kind).toBe('tap')
  })

  it('can begin a new touch after a finished one', () => {
    const g = new TouchGesture()
    g.begin(at(0, 0), 1)
    g.hold()
    g.end(at(100, 100))
    g.begin(at(5, 5), 1)
    expect(g.isDragging).toBe(false)
    expect(g.end(at(5, 5)).kind).toBe('tap')
  })
})

describe('helpers', () => {
  it('measures movement past the slop by distance', () => {
    expect(movedPastSlop(at(0, 0), at(TAP_SLOP_PX, 0))).toBe(false)
    expect(movedPastSlop(at(0, 0), at(TAP_SLOP_PX + 1, 0))).toBe(true)
    expect(movedPastSlop(at(0, 0), at(8, 8))).toBe(true)
  })
  it('builds a rectangle whichever corner is first', () => {
    expect(rectBetween(at(10, 10), at(0, 4))).toEqual({ x: 0, y: 4, width: 10, height: 6 })
  })
  it('uses a long-press delay of half a second', () => {
    expect(LONG_PRESS_MS).toBe(500)
  })
})
