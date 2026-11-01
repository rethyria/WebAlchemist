/**
 * Touch gestures for the picker (#128).
 *
 * A finger cannot hover, and dragging a finger scrolls the page. The picker
 * therefore reads a touch as one of three things: a tap, which selects the
 * element under the finger; a movement before the long-press delay, which is a
 * scroll and is left alone; and a long press followed by a drag, which draws a
 * rectangle. The page's scrolling is cancelled only while the finger is within
 * the slop (so that a long press can still start a drag) and during the drag.
 * A finger that moves past the slop is scrolling and is never cancelled.
 *
 * This file holds no timers and no DOM access, so the rules can be tested
 * directly. The caller starts a timer of LONG_PRESS_MS at touchstart and calls
 * `hold()` when it fires.
 */

import type { Rect } from '@shared/types'

/** How far a finger may move, in CSS pixels, and still count as held still. */
export const TAP_SLOP_PX = 10
/** How long a finger must stay still before a drag draws a rectangle. */
export const LONG_PRESS_MS = 500
/** A rectangle smaller than this in either direction is a tap, as with the mouse. */
export const MIN_RECT_PX = 12

export interface Point {
  x: number
  y: number
}

export type TouchOutcome =
  | { kind: 'tap'; at: Point }
  | { kind: 'rect'; rect: Rect }
  | { kind: 'none' }

export function movedPastSlop(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > TAP_SLOP_PX
}

export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** The state of one touch from finger down to finger up. */
export class TouchGesture {
  private start: Point | null = null
  private last: Point | null = null
  private dragging = false
  private scrolling = false

  /** A second finger means a pinch or a two-finger scroll, which is never a pick. */
  begin(at: Point, fingers: number): void {
    this.start = at
    this.last = at
    this.dragging = false
    this.scrolling = fingers > 1
  }

  /** True while the gesture is a drag, so the caller draws a rectangle. */
  get isDragging(): boolean {
    return this.dragging
  }

  /**
   * True when the caller cancels the touchmove, which keeps the page from
   * scrolling. That is a drag, and also the time between the finger going down
   * and the long-press delay while the finger is still within the slop. Firefox
   * decides whether a touch scrolls from its first moves, so a move that was
   * not cancelled before the drag started could have started a scroll that the
   * drag then cannot stop. A finger that has passed the slop, or a second
   * finger, is a scroll and is never cancelled.
   */
  get cancelsMove(): boolean {
    return this.start !== null && !this.scrolling
  }

  /** The rectangle to show after a move, or null when the move is not drawing one. */
  move(at: Point): Rect | null {
    if (!this.start) return null
    this.last = at
    if (this.dragging) return rectBetween(this.start, at)
    if (movedPastSlop(this.start, at)) this.scrolling = true
    return null
  }

  /**
   * The long-press delay has passed. Returns true when the finger has stayed
   * within the slop since it went down, which starts a drag.
   */
  hold(): boolean {
    if (!this.start || this.scrolling || this.dragging) return false
    if (this.last && movedPastSlop(this.start, this.last)) return false
    this.dragging = true
    return true
  }

  end(at: Point): TouchOutcome {
    const start = this.start
    const wasDragging = this.dragging
    const wasScrolling = this.scrolling
    this.cancel()
    if (!start || wasScrolling) return { kind: 'none' }
    if (wasDragging) {
      const rect = rectBetween(start, at)
      // A long press that was never dragged is a tap at the same place.
      if (rect.width < MIN_RECT_PX || rect.height < MIN_RECT_PX) return { kind: 'tap', at: start }
      return { kind: 'rect', rect }
    }
    if (movedPastSlop(start, at)) return { kind: 'none' }
    return { kind: 'tap', at }
  }

  cancel(): void {
    this.start = null
    this.last = null
    this.dragging = false
    this.scrolling = false
  }
}
