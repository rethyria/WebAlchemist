/**
 * CSS and preview state across a suspension of the event page (#80).
 *
 * Firefox suspends the background after 30 seconds without activity, and every
 * module-level variable is lost with it. These tests boot the real index.ts,
 * perform one step, boot it again with fresh module state and the same fake
 * storage, then perform the step that depends on what the first boot knew.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const URL = 'https://example.com/page'
const TAB = 5
const stamped = (t: ReturnType<typeof cssTransform>) => `/* ${t.name} */\n${t.code}`

let h: Harness
beforeEach(() => {
  h = createHarness()
  h.tabUrls.set(TAB, URL)
})

async function commit(tabId = TAB, url = URL) {
  await h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId, url })
}

describe('CSS that a saved transform applied', () => {
  const dark = cssTransform()

  beforeEach(async () => {
    h.local.set('transforms', [dark])
    await h.boot()
    await commit()
    expect(h.calls.insertCSS).toEqual([{ tabId: TAB, css: stamped(dark) }])
  })

  it('is removed on delete after a suspension', async () => {
    await h.boot()
    await h.onMessage({ type: 'delete-transform', id: dark.id, tabId: TAB })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped(dark) }])
  })

  it('is removed on disable after a suspension', async () => {
    await h.boot()
    await h.onMessage({ type: 'set-enabled', id: dark.id, enabled: false, tabId: TAB })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped(dark) }])
  })

  it('is replaced, not stacked, on edit after a suspension', async () => {
    await h.boot()
    const edited = cssTransform({ code: 'body { color: blue }' })
    await h.onMessage({ type: 'save-transform', transform: edited, tabId: TAB })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped(dark) }])
    expect(h.calls.insertCSS.at(-1)).toEqual({ tabId: TAB, css: stamped(edited) })
  })

  it('is forgotten when the tab navigates, so a stale string is never removed', async () => {
    await h.boot()
    // A navigation to a page with no transforms. The old document is gone.
    await commit(TAB, 'https://other.example/')
    expect(h.session.get(`wa-css-applied-${TAB}`)).toBeUndefined()
    await h.boot()
    await h.onMessage({ type: 'delete-transform', id: dark.id, tabId: TAB })
    expect(h.calls.removeCSS).toEqual([])
  })

  it('is forgotten when the tab closes', async () => {
    await h.listeners.get('browser.tabs.onRemoved')!(TAB)
    expect(h.session.get(`wa-css-applied-${TAB}`)).toBeUndefined()
  })

  it('control: without a suspension the same delete removes it', async () => {
    // Shows the assertions above are about the suspension and not about the
    // stub: with module state intact, even the unfixed code removes the CSS.
    await h.onMessage({ type: 'delete-transform', id: dark.id, tabId: TAB })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: stamped(dark) }])
  })
})

describe('CSS that a preview injected', () => {
  beforeEach(async () => {
    await h.boot()
    await h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
    expect(h.calls.insertCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })

  it('is removed on discard after a suspension', async () => {
    await h.boot()
    await h.onMessage({ type: 'clear-preview-css', tabId: TAB, css: 'a { color: red }' })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })

  it('is replaced by the next preview after a suspension', async () => {
    await h.boot()
    await h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: blue }' })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })

  it('is removed using the string the message carries when nothing is stored', async () => {
    // The sidebar keeps the string it sent. If the stored copy is gone for any
    // reason, the message is the remaining source for what to remove.
    h.session.clear()
    await h.boot()
    await h.onMessage({ type: 'clear-preview-css', tabId: TAB, css: 'a { color: red }' })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })

  it('is forgotten when the tab navigates', async () => {
    await commit()
    expect(h.session.get(`wa-css-preview-${TAB}`)).toBeUndefined()
  })

  it('control: without a suspension a discard removes it', async () => {
    await h.onMessage({ type: 'clear-preview-css', tabId: TAB, css: 'a { color: red }' })
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })
})
