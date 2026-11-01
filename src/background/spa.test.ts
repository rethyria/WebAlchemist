/**
 * Route changes in single-page apps (#83).
 *
 * A route change fires `webNavigation.onHistoryStateUpdated` and no page load,
 * so `onCommitted` never runs. These tests load the real index.ts and call the
 * listeners it registers.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 3
const app = cssTransform({ match: 'example.com/app/*', code: 'body { color: red }' })
const stamped = `/* transform 1 */\n${app.code}`
const ON_APP = 'https://example.com/app/one'
const ELSEWHERE = 'https://example.com/about'

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [app])
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
})

const commit = (url: string) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url })
const route = (url: string, frameId = 0) =>
  h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId, tabId: TAB, url })
const healthChecks = () =>
  h.calls.sendMessage.filter((c) => c.message.type === 'run-health-check').length
const lastBadge = () => h.calls.setBadgeText.filter((c) => c.tabId === TAB).at(-1)?.text

describe('a route change in the top frame', () => {
  it('takes the CSS out when the new route matches no transform', async () => {
    await commit(ON_APP)
    expect(h.calls.insertCSS).toEqual([{ tabId: TAB, css: stamped }])
    await route(ELSEWHERE)
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped }])
  })

  it('applies the CSS when the new route matches', async () => {
    await commit(ELSEWHERE)
    expect(h.calls.insertCSS).toEqual([])
    await route(ON_APP)
    expect(h.calls.insertCSS).toEqual([{ tabId: TAB, css: stamped }])
  })

  it('does not insert the CSS twice when it already applies', async () => {
    await commit(ON_APP)
    await route('https://example.com/app/two')
    expect(h.calls.insertCSS).toHaveLength(1)
    expect(h.calls.removeCSS).toEqual([])
  })

  it('updates the badge count in both directions', async () => {
    await commit(ELSEWHERE)
    expect(lastBadge()).toBe('')
    await route(ON_APP)
    expect(lastBadge()).toBe('1')
    await route(ELSEWHERE)
    expect(lastBadge()).toBe('')
  })

  it('runs the health check when the mode is every-load', async () => {
    await commit(ELSEWHERE)
    await route(ON_APP)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(healthChecks()).toBe(1)
  })

  it('does not run the health check in manual mode', async () => {
    // Control for the test above: the check is the mode's decision.
    h.local.set('settings', { healthCheckMode: 'manual' })
    await commit(ELSEWHERE)
    await route(ON_APP)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(healthChecks()).toBe(0)
    expect(h.calls.insertCSS).toHaveLength(1)
  })

  it('ignores a route change in a subframe', async () => {
    await commit(ELSEWHERE)
    await route(ON_APP, 7)
    expect(h.calls.insertCSS).toEqual([])
    expect(lastBadge()).toBe('')
  })

  it('still tells the content script the URL changed', async () => {
    await route(ON_APP)
    expect(h.calls.sendMessage[0]!.message).toEqual({ type: 'url-changed', url: ON_APP })
  })
})
