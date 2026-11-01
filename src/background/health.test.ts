/**
 * Health checks that outlive the page they were started for (#86).
 *
 * These load the real index.ts and hold the content script's answer to
 * `run-health-check` open, so the test can navigate the tab while a check is
 * still running.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 4
const app = cssTransform({ match: 'example.com/*' })
const OLD_PAGE = 'https://example.com/page'
const NEW_PAGE = 'https://other.example/'

const brokenState = [{ id: app.id, status: 'broken' }]

let h: Harness
let finishCheck: (reply: unknown) => void
let checkAsked: Promise<void>

beforeEach(async () => {
  h = createHarness()
  h.local.set('transforms', [app])
  let announce: () => void
  checkAsked = new Promise((resolve) => (announce = resolve))
  h.contentReply = (message) => {
    if (message.type === 'ping') return true
    // The content script is still checking when the test navigates the tab.
    return new Promise((resolve) => {
      finishCheck = resolve
      announce()
    })
  }
  await h.boot()
})

const commit = (url: string) =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url })
const badgeText = () => h.calls.setBadgeText.filter((c) => c.tabId === TAB).at(-1)?.text
describe('a health check that finishes after the tab navigated', () => {
  it('does not mark the new page broken', async () => {
    await commit(OLD_PAGE)
    await checkAsked
    await commit(NEW_PAGE)
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(badgeText()).toBe('')
  })

  it('control: the same result on the page it was started for marks it broken', async () => {
    // Shows the assertion above is about the navigation: with no navigation in
    // between, the identical reply does reach the badge.
    await commit(OLD_PAGE)
    await checkAsked
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(badgeText()).toBe('!')
  })
})

describe('the result broadcast to extension pages (#87)', () => {
  it('names the tab it was run in', async () => {
    // Several tabs finish loading while one sidebar is open; the sidebar can
    // only ignore another tab's result if the message says which tab it is.
    await commit(OLD_PAGE)
    await checkAsked
    finishCheck({ type: 'health-check-result', states: brokenState })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.calls.runtimeMessages).toEqual([
      { type: 'health-check-result', tabId: TAB, states: brokenState },
    ])
  })
})
