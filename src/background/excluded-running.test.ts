/**
 * What the excluded-sites list stops (#131, #28).
 *
 * The disclosure tells the user that on an excluded site Web Alchemist does not
 * run saved JavaScript, does not apply saved CSS, does not count transforms on
 * the badge, does not check the page and does not load its content script.
 * Each sentence is measured here against the real background script, and each
 * test has a control on a site that is not excluded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const BANK_TAB = 1
const NEWS_TAB = 2
const BANK = 'https://login.bank.example/'
const NEWS = 'https://news.example/'

let h: Harness
const ask = async (message: unknown) => (await h.onMessage(message)).data

const healthRequests = (tabId: number) =>
  h.calls.sendMessage.filter((c) => c.tabId === tabId && c.message.type === 'run-health-check')
const bankCss = () => h.calls.insertCSS.filter((c) => c.tabId === BANK_TAB)
const newsCss = () => h.calls.insertCSS.filter((c) => c.tabId === NEWS_TAB)
const commit = (tabId: number, url: string) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId, url })

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  h = createHarness()
  h.hasUserScripts = true
  h.origins = ['*://*.bank.example/*', '*://news.example/*']
  h.local.set('transforms', [
    cssTransform({ id: 'css-bank', match: 'login.bank.example/*' }),
    cssTransform({ id: 'css-news', match: 'news.example/*' }),
    cssTransform({ id: 'js-bank', kind: 'js', world: 'USER_SCRIPT', code: 'document.title = "x"', match: 'login.bank.example/*' }),
    cssTransform({ id: 'js-news', kind: 'js', world: 'USER_SCRIPT', code: 'document.title = "x"', match: 'news.example/*' }),
  ])
  h.tabUrls.set(BANK_TAB, BANK)
  h.tabUrls.set(NEWS_TAB, NEWS)
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
})

describe('registrations', () => {
  it('start without an exclusion when the list is empty (control)', () => {
    expect(h.userScriptsHeld.get('js-bank').excludeMatches).toBeNull()
    for (const script of h.contentScriptsHeld.values()) expect(script.excludeMatches).toBeUndefined()
  })

  it('carry the excluded host and its subdomains in every user script and content script', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    expect(h.userScriptsHeld.get('js-bank').excludeMatches).toEqual(['*://*.bank.example/*'])
    expect(h.userScriptsHeld.get('js-news').excludeMatches).toEqual(['*://*.bank.example/*'])
    expect(h.contentScriptsHeld.size).toBeGreaterThan(0)
    for (const script of h.contentScriptsHeld.values()) {
      expect(script.excludeMatches).toEqual(['*://*.bank.example/*'])
    }
  })

  it('combine with the sites that are turned off one by one', async () => {
    await ask({ type: 'set-site-off', url: 'https://news.example/x', off: true })
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    expect(h.userScriptsHeld.get('js-news').excludeMatches).toEqual([
      '*://*.bank.example/*',
      '*://news.example/*',
    ])
  })

  it('are rebuilt again when the list changes, and lose the exclusion when it is emptied', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    await ask({ type: 'set-excluded-sites', sites: [] })
    expect(h.userScriptsHeld.get('js-bank').excludeMatches).toBeNull()
    for (const script of h.contentScriptsHeld.values()) expect(script.excludeMatches).toBeUndefined()
  })

  it('keep the exclusion after the event page wakes again', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    await h.boot()
    expect(h.userScriptsHeld.get('js-bank').excludeMatches).toEqual(['*://*.bank.example/*'])
    for (const script of h.contentScriptsHeld.values()) {
      expect(script.excludeMatches).toEqual(['*://*.bank.example/*'])
    }
  })
})

describe('a page load', () => {
  it('applies CSS and checks the page on a site that is not excluded (control)', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    h.calls.insertCSS.length = 0
    h.calls.sendMessage.length = 0
    await commit(NEWS_TAB, NEWS)
    await vi.waitFor(() => expect(healthRequests(NEWS_TAB)).toHaveLength(1))
    expect(newsCss().length).toBeGreaterThan(0)
  })

  it('applies no CSS, sets no badge count and reads no page on an excluded site', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    h.calls.insertCSS.length = 0
    h.calls.sendMessage.length = 0
    h.calls.setBadgeText.length = 0
    await commit(BANK_TAB, BANK)
    // The control above takes under a second to show a check on the other tab.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(bankCss()).toEqual([])
    expect(h.calls.sendMessage.filter((c) => c.tabId === BANK_TAB)).toEqual([])
    expect(h.calls.setBadgeText.filter((c) => c.tabId === BANK_TAB && c.text)).toEqual([])
  })

  it('answers a manual check with nothing and sends no request to the page', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    h.calls.sendMessage.length = 0
    expect(await ask({ type: 'check-now', tabId: BANK_TAB, url: BANK })).toEqual([])
    expect(h.calls.sendMessage).toEqual([])
    // Control: the other site is asked.
    await ask({ type: 'check-now', tabId: NEWS_TAB, url: NEWS })
    expect(healthRequests(NEWS_TAB)).toHaveLength(1)
  })
})

describe('adding a site while its tab is open', () => {
  it('removes the CSS that was applied there and leaves the other tab styled', async () => {
    await commit(BANK_TAB, BANK)
    await commit(NEWS_TAB, NEWS)
    await vi.waitFor(() => expect(bankCss().length).toBeGreaterThan(0))
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    expect(h.calls.removeCSS.filter((c) => c.tabId === BANK_TAB)).toHaveLength(1)
    expect(h.calls.removeCSS.filter((c) => c.tabId === NEWS_TAB)).toHaveLength(0)
  })

  it('puts the CSS back when the site is removed from the list', async () => {
    await ask({ type: 'set-excluded-sites', sites: ['bank.example'] })
    h.calls.insertCSS.length = 0
    await ask({ type: 'set-excluded-sites', sites: [] })
    expect(bankCss().length).toBeGreaterThan(0)
  })
})
