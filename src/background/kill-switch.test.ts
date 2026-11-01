/**
 * The setting that stops every transform, and the per-site off switch (#121).
 *
 * Each test opens two tabs on different sites and checks what happened to both,
 * so that a change that acted on every tab, or on none, fails. Run against the
 * background before #121, the switch left hand-written JavaScript registered,
 * left CSS in open tabs and answered nothing about reloads.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

const A = 1
const B = 2
const css = cssTransform({ id: 'css-a', name: 'A css', match: 'a.example/*', code: 'a { color: red }' })
const cssB = cssTransform({ id: 'css-b', name: 'B css', match: 'b.example/*', code: 'b { color: blue }', order: 1 })
const js = cssTransform({
  id: 'js-a',
  name: 'A js',
  match: 'a.example/*',
  kind: 'js',
  origin: 'user',
  world: 'USER_SCRIPT',
  code: 'document.title = "x"',
  order: 2,
})

let h: Harness
/** Sends a message and returns the answer's data, or throws the reported error. */
async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}
beforeEach(async () => {
  h = createHarness()
  h.hasUserScripts = true
  h.local.set('transforms', [css, cssB, js])
  h.local.set('settings', { ...DEFAULT_SETTINGS })
  h.tabUrls.set(A, 'https://a.example/page')
  h.tabUrls.set(B, 'https://b.example/page')
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
  // Both tabs show their CSS before the action.
  await ask({ type: 'reapply-everywhere', id: 'js-a' })
})

const setSwitch = (aiJsKillSwitch: boolean) =>
  ask({ type: 'patch-settings', change: { kind: 'fields', fields: { aiJsKillSwitch } } })
const stylesheetsRemoved = (tabId: number) => h.calls.removeCSS.filter((c) => c.tabId === tabId)

describe('the setting that stops all transforms', () => {
  it('starts with both tabs styled and the script registered (control)', () => {
    expect(h.calls.insertCSS.map((c) => c.tabId).sort()).toEqual([A, B])
    expect(h.userScriptsHeld.has('js-a')).toBe(true)
  })

  it('unregisters hand-written JavaScript as well', async () => {
    await setSwitch(true)
    expect(h.userScriptsHeld.has('js-a')).toBe(false)
  })

  it('removes CSS from every open tab', async () => {
    await setSwitch(true)
    expect(stylesheetsRemoved(A)).toHaveLength(1)
    expect(stylesheetsRemoved(B)).toHaveLength(1)
  })

  it('counts the tabs that ran JavaScript, not every tab', async () => {
    await setSwitch(true)
    // Only tab A matches the JavaScript transform; tab B has CSS only.
    expect(await ask({ type: 'count-js-tabs' })).toBe(1)
    expect(h.calls.reload).toEqual([])
  })

  it('touches no tab when the setting did not change (control)', async () => {
    await setSwitch(false)
    expect(h.calls.removeCSS).toEqual([])
  })

  it('puts the CSS back when the setting is turned off again', async () => {
    await setSwitch(true)
    const before = h.calls.insertCSS.length
    await setSwitch(false)
    expect(h.calls.insertCSS.length).toBe(before + 2)
    expect(h.userScriptsHeld.has('js-a')).toBe(true)
  })
})

describe('turning off one site', () => {
  it('removes CSS from that site and leaves the other site styled', async () => {
    await ask({ type: 'set-site-off', url: 'https://a.example/page', off: true })
    expect(stylesheetsRemoved(A)).toHaveLength(1)
    expect(stylesheetsRemoved(B)).toHaveLength(0)
  })

  it('reloads the tab that ran JavaScript and no other tab', async () => {
    const answer = await ask({ type: 'set-site-off', url: 'https://a.example/page', off: true })
    expect(h.calls.reload).toEqual([A])
    expect(answer).toMatchObject({ reloaded: 1 })
  })

  it('keeps the script registered but excluded from that host only', async () => {
    await ask({ type: 'set-site-off', url: 'https://a.example/page', off: true })
    expect(h.userScriptsHeld.get('js-a').excludeMatches).toEqual(['*://a.example/*'])
  })

  it('stores the host, and answers for it', async () => {
    expect(await ask({ type: 'get-site-off', url: 'https://a.example/x' })).toBe(false)
    await ask({ type: 'set-site-off', url: 'https://a.example/page', off: true })
    expect(await ask({ type: 'get-site-off', url: 'https://a.example/x' })).toBe(true)
    expect(await ask({ type: 'get-site-off', url: 'https://b.example/x' })).toBe(false)
  })

  it('restores the CSS and the script when the site is turned back on, without reloading', async () => {
    await ask({ type: 'set-site-off', url: 'https://a.example/page', off: true })
    h.calls.reload.length = 0
    const answer = await ask({ type: 'set-site-off', url: 'https://a.example/page', off: false })
    expect(h.userScriptsHeld.get('js-a').excludeMatches).toBeUndefined()
    expect(h.calls.insertCSS.filter((c) => c.tabId === A)).toHaveLength(2)
    expect(h.calls.reload).toEqual([])
    expect(answer).toMatchObject({ reloadTabs: 1 })
  })

  it('refuses a page that is not a website', async () => {
    await expect(ask({ type: 'set-site-off', url: 'about:blank', off: true })).rejects.toThrow(
      /not a website/,
    )
  })
})
