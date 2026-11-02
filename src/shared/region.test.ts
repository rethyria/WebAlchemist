import { describe, expect, it } from 'vitest'
import { cropWindow, MAX_IMAGE_SIDE, reducedSize, regionAtScroll, viewportChanged } from './region'

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

describe('cropWindow', () => {
  const region = { x: 20, y: 20, width: 640, height: 680 }

  // Sizes read from Firefox 159 with the grid page of test/screenshot: the capture
  // and the viewport at three page zooms. The ratio of 2 is the case in which the
  // old crop came back 4 device pixels short of 1280 and resampled.
  it('crops whole pixels at the three ratios that were measured', () => {
    expect(cropWindow(region, { width: 1371, height: 1434 }, { width: 914, height: 955.3333 }).source).toEqual({ x: 30, y: 30, width: 960, height: 1020 })
    expect(cropWindow(region, { width: 1368, height: 1430 }, { width: 685.5, height: 716.5 }).source).toEqual({ x: 40, y: 40, width: 1277, height: 1357 })
    expect(cropWindow(region, { width: 1377, height: 1440 }, { width: 1371, height: 1433 }).source).toEqual({ x: 20, y: 20, width: 643, height: 683 })
  })

  it('control: the old crop, from the rounded width alone, left a fractional rectangle and was short', () => {
    const image = { width: 1368, height: 1430 }
    const oldScale = image.width / 686
    const oldWidth = region.width * oldScale
    expect(Number.isInteger(oldWidth)).toBe(false)
    expect(oldWidth).toBeCloseTo(1276.27, 1)
    const fixed = cropWindow(region, image, { width: 685.5, height: 716.5 }).source
    expect(Number.isInteger(fixed.x) && Number.isInteger(fixed.y) && Number.isInteger(fixed.width) && Number.isInteger(fixed.height)).toBe(true)
    // The true size of the region in this capture is 640 * 1.9949 = 1276.7 pixels; the fixed crop is within a pixel of it.
    expect(Math.abs(fixed.width - 640 * 1.9949)).toBeLessThan(0.5)
    expect(Math.abs(oldWidth - 640 * 1.9949)).toBeGreaterThan(0.4)
  })

  it('keeps the region where it was drawn: its edges in CSS pixels come back within one device pixel', () => {
    for (const [image, viewport, truth] of [
      [{ width: 1371, height: 1434 }, { width: 914, height: 955.3333 }, 1.5],
      [{ width: 1368, height: 1430 }, { width: 685.5, height: 716.5 }, 1.9949],
      [{ width: 1359, height: 1420 }, { width: 754.05, height: 788.15 }, 1.8],
      [{ width: 1388, height: 1451 }, { width: 616.95, height: 644.85 }, 2.25],
    ] as const) {
      // A region that fits the smallest viewport of the four.
      const inside = { x: 20, y: 20, width: 560, height: 600 }
      const { source } = cropWindow(inside, image, viewport)
      expect(Math.abs(source.x - inside.x * truth)).toBeLessThanOrEqual(1)
      expect(Math.abs(source.y - inside.y * truth)).toBeLessThanOrEqual(1)
      expect(Math.abs(source.x + source.width - (inside.x + inside.width) * truth)).toBeLessThanOrEqual(1)
      expect(Math.abs(source.y + source.height - (inside.y + inside.height) * truth)).toBeLessThanOrEqual(1)
    }
  })

  it('is not clipped when the region is inside the image', () => {
    expect(cropWindow(region, { width: 1371, height: 1434 }, { width: 914, height: 955.3333 }).clipped).toBe(false)
  })

  it('does not call a region that ends at the viewport edge clipped, when the picker rounded it up by a fraction of a pixel', () => {
    // Measured with the window enlarged: the viewport is 2156.67 by 1225.33 CSS pixels, the capture is 3235 by 1839,
    // and the whole viewport was drawn as 2157 by 1225.
    const result = cropWindow({ x: 0, y: 0, width: 2157, height: 1225 }, { width: 3235, height: 1839 }, { width: 2156.6667, height: 1225.3333 })
    expect(result.clipped).toBe(false)
    expect(result.source).toEqual({ x: 0, y: 0, width: 3235, height: 1838 })
  })

  it('clamps a region that reaches past the image and says so', () => {
    const result = cropWindow({ x: 120, y: 700, width: 200, height: 500 }, { width: 1371, height: 1434 }, { width: 914, height: 955.3333 })
    expect(result.clipped).toBe(true)
    expect(result.source.y + result.source.height).toBe(1434)
    expect(result.source).toMatchObject({ x: 180, width: 300 })
  })

  it('never returns an empty rectangle', () => {
    const result = cropWindow({ x: 5000, y: 5000, width: 10, height: 10 }, { width: 100, height: 100 }, { width: 100, height: 100 })
    expect(result.source.width).toBeGreaterThanOrEqual(1)
    expect(result.source.height).toBeGreaterThanOrEqual(1)
    expect(result.clipped).toBe(true)
  })
})

describe('reducedSize', () => {
  it('returns null for an image whose longer side is at or below the limit', () => {
    expect(reducedSize({ width: 1568, height: 900 })).toBeNull()
    expect(reducedSize({ width: 600, height: 1568 })).toBeNull()
  })

  it('keeps the shape and brings the longer side to the limit', () => {
    expect(reducedSize({ width: 3136, height: 1568 })).toEqual({ width: MAX_IMAGE_SIDE, height: 784 })
    expect(reducedSize({ width: 1000, height: 2000 })).toEqual({ width: 784, height: MAX_IMAGE_SIDE })
    expect(reducedSize({ width: 1276, height: 1569 })).toEqual({ width: 1275, height: MAX_IMAGE_SIDE })
  })

  it('takes a limit', () => {
    expect(reducedSize({ width: 400, height: 200 }, 100)).toEqual({ width: 100, height: 50 })
  })
})
