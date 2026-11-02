/**
 * The screenshot capture in the background (#37), run against the real
 * src/background/index.ts with a stubbed browser and stubbed image functions.
 * What Firefox does is measured by test/screenshot; these tests check the
 * crop, the size limit and the order of requests that the code makes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type Harness } from './test-browser'

const URL = 'https://example.com/page'

interface Drawn {
  canvas: { width: number; height: number }
  args: number[]
  smoothing: string | undefined
}

/** Replaces the image functions that cropping uses with ones that record what they are asked for. */
function stubImages(bitmapSize: { width: number; height: number }) {
  const drawn: Drawn[] = []
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['x']) }))
  vi.stubGlobal('createImageBitmap', async () => ({ ...bitmapSize }))
  class FakeCanvas {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
    getContext() {
      const entry: Drawn = { canvas: this, args: [], smoothing: undefined }
      drawn.push(entry)
      return {
        set imageSmoothingQuality(value: string) {
          entry.smoothing = value
        },
        drawImage: (_bitmap: unknown, ...args: number[]) => {
          entry.args = args
        },
      }
    }
    async convertToBlob() {
      return new Blob([`${this.width}x${this.height}`])
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal(
    'FileReader',
    class {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,AAAA'
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  return drawn
}

describe('capture-region', () => {
  let h: Harness
  /** The messages the page's content script received, in order. */
  let toPage: string[]
  let viewport: Record<string, unknown>

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    h = createHarness()
    toPage = []
    viewport = { x: 0, y: 0, width: 686, height: 717, devicePixelRatio: 2, exactWidth: 685.5, exactHeight: 716.5 }
    h.contentReply = (message: { type: string; visible?: boolean }) => {
      if (message.type === 'get-viewport') return viewport
      if (message.type === 'set-lock-visible') toPage.push(message.visible ? 'show' : 'hide')
      return undefined
    }
    h.tabUrls.set(3, URL)
    h.tabUrls.set(4, URL)
    await h.boot()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const request = (over: Record<string, unknown> = {}) =>
    h.onMessage({
      type: 'capture-region',
      tabId: 3,
      rect: { x: 20, y: 20, width: 640, height: 680 },
      viewportWidth: 686,
      url: URL,
      ...over,
    })

  describe('the crop', () => {
    it('copies whole pixels, scaled by the size of the capture over the exact size of the viewport', async () => {
      const drawn = stubImages({ width: 1368, height: 1430 })
      const reply = await request()
      expect(reply.ok).toBe(true)
      // Without the exact size the scale was 1368 / 686 and the source rectangle had a fraction.
      expect(drawn[0]?.args).toEqual([40, 40, 1277, 1357, 0, 0, 1277, 1357])
      expect(drawn[0]?.canvas).toMatchObject({ width: 1277, height: 1357 })
      expect(reply.data.clipped).toBe(false)
      expect(reply.data.reduced).toBeUndefined()
    })

    it('control: with no exact size from the page it falls back to the rounded one, and the source has whole pixels either way', async () => {
      const drawn = stubImages({ width: 1368, height: 1430 })
      viewport = { x: 0, y: 0, width: 686, height: 717, devicePixelRatio: 2 }
      const reply = await request()
      expect(reply.ok).toBe(true)
      const [sx, sy, sw, sh] = drawn[0]!.args
      expect([sx, sy, sw, sh].every(Number.isInteger)).toBe(true)
      // The rounded size gives a different, shorter crop than the exact one (1277 by 1357).
      expect(sw).toBe(1276)
    })

    it('uses the width stored with the region when the page does not answer', async () => {
      const drawn = stubImages({ width: 1371, height: 1434 })
      h.contentReply = () => undefined
      const reply = await request({ viewportWidth: 914 })
      expect(reply.ok).toBe(true)
      expect(drawn[0]?.args.slice(0, 2)).toEqual([30, 30])
      expect(drawn[0]?.args[2]).toBe(960)
    })

    it('says when the region reaches past the capture', async () => {
      stubImages({ width: 1371, height: 1434 })
      viewport = { x: 0, y: 0, width: 914, height: 955, devicePixelRatio: 1.5, exactWidth: 914, exactHeight: 955.3333 }
      const reply = await request({ rect: { x: 120, y: 700, width: 200, height: 500 } })
      expect(reply.data.clipped).toBe(true)
    })
  })
})
