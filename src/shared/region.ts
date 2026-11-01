import type { Rect } from './types'

/** How far a page is scrolled, in CSS pixels, and how large its viewport is. */
export interface ScrollOffset {
  x: number
  y: number
}

export interface Viewport extends ScrollOffset {
  width: number
  height: number
  devicePixelRatio?: number
}

/**
 * Whether the viewport changed in a way that makes a stored rectangle wrong.
 *
 * The rectangle is in CSS pixels and the capture is in device pixels, so the
 * background scales one by the other using the viewport width. A resized
 * window, a zoom change or a move to a screen with another pixel ratio changes
 * that scale, and the page may also reflow, so the rectangle no longer covers
 * what was drawn. A pixel ratio that was not recorded is not compared.
 */
export function viewportChanged(
  drawn: { width: number; devicePixelRatio?: number | undefined },
  now: Viewport,
): boolean {
  if (now.width !== drawn.width) return true
  return (
    drawn.devicePixelRatio !== undefined &&
    now.devicePixelRatio !== undefined &&
    now.devicePixelRatio !== drawn.devicePixelRatio
  )
}

/**
 * Where a rectangle drawn at one scroll position is on screen at another.
 *
 * A drawn rectangle is stored in viewport coordinates, which describe a place
 * on the screen and not a place on the page. If the page scrolls between
 * drawing and capturing, the same numbers point at different content. The
 * rectangle is moved by the scroll distance so that it covers the content that
 * was drawn around, then clamped to the viewport because a screenshot can show
 * nothing outside it. `clipped` says whether the clamp removed any part.
 *
 * Returns null when none of the rectangle is on screen any more.
 */
export function regionAtScroll(
  rect: Rect,
  drawnAt: ScrollOffset,
  now: Viewport,
): { rect: Rect; clipped: boolean } | null {
  const moved = { x: rect.x + drawnAt.x - now.x, y: rect.y + drawnAt.y - now.y }
  const left = Math.max(0, moved.x)
  const top = Math.max(0, moved.y)
  const right = Math.min(now.width, moved.x + rect.width)
  const bottom = Math.min(now.height, moved.y + rect.height)
  if (right <= left || bottom <= top) return null
  const clamped = { x: left, y: top, width: right - left, height: bottom - top }
  const clipped = clamped.width < rect.width - 1 || clamped.height < rect.height - 1
  return { rect: clamped, clipped }
}
