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
  /**
   * The size of the viewport without rounding. A content script reads
   * `innerWidth` as a whole number, and the real value can have a fraction
   * (685.5 at a pixel ratio of 2 in the measured case), which changes the
   * scale of a crop by 0.07 percent.
   */
  exactWidth?: number
  exactHeight?: number
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

export interface PixelSize {
  width: number
  height: number
}

/**
 * The part of a capture that a region covers, as whole pixels of the capture.
 *
 * `captureVisibleTab` returns an image of the viewport in device pixels. A
 * region is in CSS pixels, so it is scaled by the size of the image over the
 * size of the viewport. The scale is not the device pixel ratio: at a page zoom
 * of 133 percent Firefox captured 1.9949 pixels for each CSS pixel while the
 * page reported a ratio of 2 (test/screenshot/README.md). The sides of the image
 * are whole numbers and round on their own, by up to one pixel, so one scale is
 * taken from the width and the height together (a single rounding error is
 * spread over more pixels), and the viewport size is read without rounding where
 * it can be. The edges are rounded to whole pixels and not left fractional: a
 * fractional source rectangle makes `drawImage` resample, which blurs every edge
 * in the image.
 *
 * `clipped` is true when the region reaches more than one CSS pixel past the
 * image, as it does when it is taller than the viewport. The picker rounds a
 * region that ends at the edge of the viewport up by up to a CSS pixel, and that
 * must not be reported as a clip.
 */
export function cropWindow(
  rect: { x: number; y: number; width: number; height: number },
  image: PixelSize,
  viewport: PixelSize,
): { source: { x: number; y: number; width: number; height: number }; clipped: boolean } {
  const scale = (image.width + image.height) / Math.max(1, viewport.width + viewport.height)
  const scaleX = scale
  const scaleY = scale
  // One CSS pixel, and never less than one device pixel.
  const tolerance = Math.max(1, scale)
  const wantLeft = rect.x * scaleX
  const wantTop = rect.y * scaleY
  const wantRight = (rect.x + rect.width) * scaleX
  const wantBottom = (rect.y + rect.height) * scaleY
  const within = (value: number, size: number) => Math.min(size, Math.max(0, Math.round(value)))
  let left = within(wantLeft, image.width)
  let top = within(wantTop, image.height)
  const right = within(wantRight, image.width)
  const bottom = within(wantBottom, image.height)
  // At least one pixel, so the canvas is never empty.
  if (right <= left) left = Math.max(0, right - 1)
  if (bottom <= top) top = Math.max(0, bottom - 1)
  return {
    source: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
    clipped:
      wantLeft < -tolerance ||
      wantTop < -tolerance ||
      wantRight > image.width + tolerance ||
      wantBottom > image.height + tolerance,
  }
}
