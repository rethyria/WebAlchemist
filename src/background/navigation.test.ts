/**
 * Navigation details that decide what is kept or skipped (#80, #83).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 3
const app = cssTransform({ match: 'example.com/*' })
const PAGE = 'https://example.com/app'

let h: Harness
beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [app])
  h.tabUrls.set(TAB, PAGE)
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
})

const commit = (qualifiers?: string[]) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({
    frameId: 0,
    tabId: TAB,
    url: PAGE,
    ...(qualifiers ? { transitionQualifiers: qualifiers } : {}),
  })

describe('a preview when the page is shown again from the back-forward cache (#80)', () => {
  beforeEach(async () => {
    await h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
  })

  it('keeps the preview string so the preview can still be removed', async () => {
    await commit(['forward_back'])
    expect(h.session.get(`wa-css-preview-${TAB}`)).toBe('a { color: red }')
    await h.onMessage({ type: 'clear-preview-css', tabId: TAB, css: 'a { color: red }' })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })

  it('control: an ordinary load forgets it', async () => {
    await commit()
    expect(h.session.get(`wa-css-preview-${TAB}`)).toBeUndefined()
  })

  it('still forgets the applied string, so the CSS is inserted again', async () => {
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
    await commit(['forward_back'])
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(2)
  })
})

describe('a history event that leaves the URL unchanged (#83)', () => {
  const route = (url: string) =>
    h.listeners.get('browser.webNavigation.onHistoryStateUpdated')!({ frameId: 0, tabId: TAB, url })
  const checks = () => h.calls.sendMessage.filter((c) => c.message.type === 'run-health-check')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('does not run another health check', async () => {
    await commit()
    await settle()
    expect(checks()).toHaveLength(1)
    await route(PAGE)
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(1)
  })

  it('still evaluates a real route change', async () => {
    // Control: the skip depends on the URL being the same, not on every
    // history event being ignored.
    await commit()
    await route('https://example.com/app/two')
    await settle()
    expect(checks()).toHaveLength(2)
  })

  it('skips an unchanged URL after a suspension too', async () => {
    await commit()
    await settle()
    await h.boot()
    await route(PAGE)
    await settle()
    expect(checks()).toHaveLength(1)
  })
})
