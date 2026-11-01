import { describe, expect, it } from 'vitest'
import { regionAtScroll, viewportChanged } from './region'

const viewport = { width: 800, height: 600 }
const rect = { x: 100, y: 300, width: 200, height: 100 }

describe('regionAtScroll', () => {
  it('leaves the rectangle alone when the page has not scrolled', () => {
    expect(regionAtScroll(rect, { x: 0, y: 40 }, { ...viewport, x: 0, y: 40 })).toEqual({
      rect,
      clipped: false,
    })
  })

  it('follows the content when the page scrolls down', () => {
    // Control: without the shift the result would be the original rect, which
    // after 150 px of scrolling covers content 150 px further down the page.
    const result = regionAtScroll(rect, { x: 0, y: 0 }, { ...viewport, x: 0, y: 150 })
    expect(result).toEqual({ rect: { ...rect, y: 150 }, clipped: false })
  })

  it('follows the content when the page scrolls sideways or back up', () => {
    const result = regionAtScroll(rect, { x: 50, y: 200 }, { ...viewport, x: 20, y: 100 })
    expect(result?.rect).toEqual({ x: 130, y: 400, width: 200, height: 100 })
  })

  it('clamps to the viewport and reports the cut', () => {
    const result = regionAtScroll(rect, { x: 0, y: 0 }, { ...viewport, x: 0, y: 350 })
    expect(result).toEqual({ rect: { x: 100, y: 0, width: 200, height: 50 }, clipped: true })
  })

  it('returns null once the rectangle is scrolled off screen', () => {
    expect(regionAtScroll(rect, { x: 0, y: 0 }, { ...viewport, x: 0, y: 1000 })).toBeNull()
  })
})

describe('viewportChanged', () => {
  const now = { x: 0, y: 0, width: 800, height: 600, devicePixelRatio: 2 }

  it('is false when the width and pixel ratio match (control)', () => {
    expect(viewportChanged({ width: 800, devicePixelRatio: 2 }, now)).toBe(false)
  })

  it('is true when the width differs', () => {
    expect(viewportChanged({ width: 700, devicePixelRatio: 2 }, now)).toBe(true)
  })

  it('is true when the pixel ratio differs', () => {
    expect(viewportChanged({ width: 800, devicePixelRatio: 1 }, now)).toBe(true)
  })

  it('does not compare a pixel ratio that was not recorded', () => {
    expect(viewportChanged({ width: 800 }, now)).toBe(false)
  })
})
