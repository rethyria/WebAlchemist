/**
 * CSS and preview state across a suspension of the event page (#80).
 *
 * Firefox suspends the background after 30 seconds without activity, and every
 * module-level variable is lost with it. These tests boot the real index.ts,
 * perform one step, boot it again with fresh module state and the same fake
 * storage, then perform the step that depends on what the first boot knew.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, cssTransform, extensionPage, sidebarPort, type Harness } from './test-browser'

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

describe('previews after the sidebar closed during a suspension (#81)', () => {
  const GRACE = 3000
  const afterGrace = () => vi.advanceTimersByTimeAsync(GRACE + 100)

  beforeEach(async () => {
    vi.useFakeTimers()
    h.hasUserScripts = true
    await h.boot()
    await h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
    const r = await h.onMessage({
      type: 'preview-js',
      tabId: TAB,
      transform: {
        ...cssTransform({ id: 'draft', kind: 'js', code: 'document.title = "x"' }),
        world: 'USER_SCRIPT',
      },
    })
    expect(r.ok).toBe(true)
    // Registering a preview first unregisters the saved id it edits (pausing
    // it); only the calls made after that belong to the tests below.
    h.calls.unregister.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('are removed when the page starts and no sidebar connects', async () => {
    await h.boot() // suspension, then a wake for some other reason
    await afterGrace()
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
    expect(h.calls.unregister).toContain('preview-draft')
    expect(h.session.get(`wa-css-preview-${TAB}`)).toBeUndefined()
  })

  it('are kept when a sidebar reconnects during start-up', async () => {
    // Control: the same start-up with an open panel removes nothing, so the
    // removal above comes from there being no sidebar and not from start-up.
    await h.boot()
    h.listeners.get('browser.runtime.onConnect')!(sidebarPort())
    await afterGrace()
    expect(h.calls.removeCSS).toEqual([])
    expect(h.calls.unregister).toEqual([])
  })

  it('are removed after the reconnected sidebar closes', async () => {
    await h.boot()
    const port = sidebarPort()
    h.listeners.get('browser.runtime.onConnect')!(port)
    await afterGrace()
    port.drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
    expect(h.calls.unregister).toContain('preview-draft')
  })

  it('are kept while another sidebar window is still connected', async () => {
    const first = sidebarPort()
    const second = sidebarPort()
    h.listeners.get('browser.runtime.onConnect')!(first)
    h.listeners.get('browser.runtime.onConnect')!(second)
    first.drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls.removeCSS).toEqual([])
    second.drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls.removeCSS).toEqual([{ tabId: TAB, css: 'a { color: red }' }])
  })
})

describe('the badge when a generation starts after a suspension (#92)', () => {
  const badgeText = () => h.calls.setBadgeText.filter((c) => c.tabId === TAB).map((c) => c.text)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  /** A `wa-generate` port that hands the request to the background. */
  function generatePort() {
    let onMessage: (message: unknown) => void = () => {}
    return {
      name: 'wa-generate',
      sender: extensionPage,
      disconnect: () => {},
      postMessage: () => {},
      onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
      onDisconnect: { addListener: () => {} },
      send: (message: unknown) => onMessage(message),
    }
  }

  async function generate() {
    const port = generatePort()
    h.listeners.get('browser.runtime.onConnect')!(port)
    // No provider is configured, so the request ends in the error path, which
    // is the same `finally` a finished generation passes through.
    port.send({ context: {}, instruction: 'x', history: [], tabId: TAB })
    await settle()
  }

  beforeEach(async () => {
    h.local.set('transforms', [cssTransform()])
    await h.boot()
    await commit()
    expect(badgeText().at(-1)).toBe('1')
  })

  it('shows the count again when the generation ends', async () => {
    await h.boot() // suspension
    await generate()
    expect(badgeText()).toContain('··')
    expect(badgeText().at(-1)).toBe('1')
  })

  it('control: without a suspension the badge also ends on the count', async () => {
    // Shows the final "1" above comes from the generation ending on the right
    // count and not from the stub leaving an earlier "1" in place.
    await generate()
    expect(badgeText()).toContain('··')
    expect(badgeText().at(-1)).toBe('1')
  })
})

describe('previews with two windows open (#81)', () => {
  const GRACE = 3000
  const afterGrace = () => vi.advanceTimersByTimeAsync(GRACE + 100)
  const TAB_B = 6
  const connect = (windowId: number | null) => {
    const port = sidebarPort(windowId)
    h.listeners.get('browser.runtime.onConnect')!(port)
    return port
  }
  const removed = () => h.calls.removeCSS.map((c) => c.tabId).sort()
  const jsPreview = (id: string, tabId: number) =>
    h.onMessage({
      type: 'preview-js',
      tabId,
      transform: {
        ...cssTransform({ id, kind: 'js', code: 'document.title = "x"' }),
        world: 'USER_SCRIPT',
      },
    })

  beforeEach(async () => {
    vi.useFakeTimers()
    h.hasUserScripts = true
    h.tabUrls.set(TAB_B, 'https://example.com/other')
    h.tabWindows.set(TAB, 1)
    h.tabWindows.set(TAB_B, 2)
    await h.boot()
    await h.onMessage({ type: 'preview-css', tabId: TAB, css: 'a { color: red }' })
    await h.onMessage({ type: 'preview-css', tabId: TAB_B, css: 'a { color: blue }' })
    await jsPreview('draft-1', TAB)
    await jsPreview('draft-2', TAB_B)
    h.calls.unregister.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('removes only the closed window\'s previews', async () => {
    const first = connect(1)
    connect(2)
    first.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(removed()).toEqual([TAB])
    expect(h.calls.unregister).toEqual(['preview-draft-1'])
    expect(h.session.get(`wa-css-preview-${TAB_B}`)).toBe('a { color: blue }')
  })

  it('removes the other window\'s previews when its panel closes too', async () => {
    const first = connect(1)
    const second = connect(2)
    first.drop()
    second.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(removed()).toEqual([TAB, TAB_B])
    expect(h.calls.unregister.sort()).toEqual(['preview-draft-1', 'preview-draft-2'])
  })

  it('control: a port that names no window, closing last, removes every preview', async () => {
    // The behaviour before ports named a window, which a sidebar that cannot
    // look up its window id still gets. It passes with and without the change,
    // so it shows the stub and the removal path work, and that the failures
    // above come from the per-window rule.
    const only = connect(null)
    only.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(removed()).toEqual([TAB, TAB_B])
    expect(h.calls.unregister.sort()).toEqual(['preview-draft-1', 'preview-draft-2'])
  })

  it('at start-up removes previews whose window has no sidebar and keeps the rest', async () => {
    await h.boot()
    connect(2)
    await afterGrace()
    expect(removed()).toEqual([TAB])
    expect(h.calls.unregister).toEqual(['preview-draft-1'])
    expect(h.session.get(`wa-css-preview-${TAB_B}`)).toBe('a { color: blue }')
  })

  it('does not remove another window\'s previews when a window closes right after start-up', async () => {
    // After a suspension the second sidebar has not reconnected yet when the
    // first one's port drops; the second is still open.
    await h.boot()
    const first = connect(1)
    first.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(removed()).toEqual([TAB])
    expect(h.session.get(`wa-css-preview-${TAB_B}`)).toBe('a { color: blue }')
  })
})

describe('a paused transform when its window\'s sidebar closes (#83)', () => {
  it('is applied again', async () => {
    vi.useFakeTimers()
    try {
      const dark = cssTransform()
      h.local.set('transforms', [dark])
      await h.boot()
      await commit()
      await h.onMessage({ type: 'suspend-transform', tabId: TAB, id: dark.id })
      expect(h.calls.insertCSS).toHaveLength(1)
      const port = sidebarPort(1)
      h.listeners.get('browser.runtime.onConnect')!(port)
      port.drop()
      await vi.advanceTimersByTimeAsync(50)
      expect(h.calls.insertCSS).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a pause is assigned to the window it was set in (#83)', () => {
  const dark = cssTransform()

  async function pauseThenMoveTab() {
    vi.useFakeTimers()
    h.local.set('transforms', [dark])
    h.tabWindows.set(TAB, 1)
    await h.boot()
    await commit()
    await h.onMessage({ type: 'suspend-transform', tabId: TAB, id: dark.id })
    expect(h.calls.insertCSS).toHaveLength(1)
    // The tab is dragged into window 2 after window 1's sidebar paused it.
    h.tabWindows.set(TAB, 2)
    const port1 = sidebarPort(1)
    const port2 = sidebarPort(2)
    h.listeners.get('browser.runtime.onConnect')!(port1)
    h.listeners.get('browser.runtime.onConnect')!(port2)
    return { port1, port2 }
  }
  afterEach(() => vi.useRealTimers())

  it('is lifted when the window that set it closes, wherever the tab is now', async () => {
    const { port1 } = await pauseThenMoveTab()
    port1.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(h.calls.insertCSS).toHaveLength(2)
    expect(h.session.get(`wa-pause-window-${TAB}`)).toBeUndefined()
  })

  it('control: stays paused when only the other window closes', async () => {
    // Before the change the tab's current window decided, so this was the
    // window whose closing lifted the pause.
    const { port2 } = await pauseThenMoveTab()
    port2.drop()
    await vi.advanceTimersByTimeAsync(50)
    expect(h.calls.insertCSS).toHaveLength(1)
  })
})
