/**
 * Private windows and containers (#127), against the real index.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_WINDOW_MESSAGE, TAB_UNKNOWN_MESSAGE } from './private-window'
import { createHarness, cssTransform, extensionPage, type Harness } from './test-browser'

const TAB = 3
const PAGE = 'https://example.com/app'
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let h: Harness
beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  h = createHarness()
  h.tabUrls.set(TAB, PAGE)
  h.contentReply = (message) =>
    message.type === 'ping' ? true : { type: 'health-check-result', states: [] }
  await h.boot()
})

const commit = () =>
  h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url: PAGE })

describe('a private window', () => {
  const refused: [string, () => Record<string, unknown>][] = [
    ['picking', () => ({ type: 'start-picking', tabId: TAB })],
    ['re-reading the page', () => ({ type: 'recapture', tabId: TAB })],
    ['reading the page for an anchor', () => ({ type: 'context-for-anchor', tabId: TAB, anchor: {} })],
    ['a screenshot', () => ({ type: 'capture-region', tabId: TAB, rect: {}, viewportWidth: 1, url: PAGE })],
    ['saving', () => ({ type: 'save-transform', transform: cssTransform({ id: 'new' }), tabId: TAB })],
    ['a repair', () => ({ type: 'repair', transformId: 't1', context: {}, brokenReason: 'x', tabId: TAB })],
  ]

  it.each(refused)('refuses %s with the plain message and stores nothing', async (_name, message) => {
    h.local.set('transforms', [cssTransform()])
    h.privateTabs.add(TAB)

    const reply = await h.onMessage(message())

    expect(reply.ok).toBe(false)
    expect(reply.error.message).toBe(PRIVATE_WINDOW_MESSAGE)
    expect((h.local.get('transforms') as unknown[]).length).toBe(1)
  })

  // Control: the same messages for a tab in a normal window are not refused
  // for this reason, so the refusals above come from the window check.
  it.each(refused)('control: %s is not refused in a normal window', async (_name, message) => {
    h.local.set('transforms', [cssTransform()])

    const reply = await h.onMessage(message())

    expect(reply.error?.message).not.toBe(PRIVATE_WINDOW_MESSAGE)
  })

  it('control: a save in a normal window is stored', async () => {
    const reply = await h.onMessage({
      type: 'save-transform',
      transform: cssTransform({ id: 'new' }),
      tabId: TAB,
    })
    expect(reply.ok).toBe(true)
    expect((h.local.get('transforms') as unknown[]).length).toBe(1)
  })

  describe('generation over the port', () => {
    function generate(tabId: number | null = TAB) {
      const posted: any[] = []
      let onMessage: (message: unknown) => void = () => {}
      const port = {
        name: 'wa-generate',
        sender: extensionPage,
        disconnect: () => {},
        postMessage: (m: unknown) => posted.push(m),
        onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
        onDisconnect: { addListener: () => {} },
      }
      h.listeners.get('browser.runtime.onConnect')!(port)
      onMessage({ context: {}, instruction: 'x', history: [], ...(tabId === null ? {} : { tabId }) })
      return posted
    }

    it('is refused before anything is sent to a provider', async () => {
      h.privateTabs.add(TAB)
      const posted = generate()
      await settle()
      expect(posted).toEqual([{ type: 'error', error: { message: PRIVATE_WINDOW_MESSAGE } }])
    })

    it('is refused when no tab id is given, or the tab cannot be read (#127)', async () => {
      const without = generate(null)
      h.closedTabs.add(9)
      const closed = generate(9)
      await settle()
      expect(without).toEqual([{ type: 'error', error: { message: TAB_UNKNOWN_MESSAGE } }])
      expect(closed).toEqual([{ type: 'error', error: { message: TAB_UNKNOWN_MESSAGE } }])
    })

    // Control: with no provider configured a normal window also ends in an
    // error, but not this one, and the request got as far as the provider.
    it('control: a normal window is not refused for the window', async () => {
      const posted = generate()
      await settle()
      expect(posted.at(-1)?.type).toBe('error')
      expect(posted.at(-1)?.error.message).not.toBe(PRIVATE_WINDOW_MESSAGE)
    })
  })

  describe('the handlers that send the page to a model refuse when the tab is unknown (#127)', () => {
    const sends: [string, (tabId?: number) => Record<string, unknown>][] = [
      [
        'repair',
        (tabId) => ({ type: 'repair', transformId: 't1', context: {}, brokenReason: 'x', ...(tabId === undefined ? {} : { tabId }) }),
      ],
    ]

    it.each(sends)('%s with no tab id', async (_name, message) => {
      h.local.set('transforms', [cssTransform()])
      const reply = await h.onMessage(message())
      expect(reply.ok).toBe(false)
      expect(reply.error.message).toBe(TAB_UNKNOWN_MESSAGE)
    })

    it.each(sends)('%s with a tab that cannot be read', async (_name, message) => {
      h.local.set('transforms', [cssTransform()])
      h.closedTabs.add(TAB)
      const reply = await h.onMessage(message(TAB))
      expect(reply.error.message).toBe(TAB_UNKNOWN_MESSAGE)
    })

    // Control: the same messages for a readable tab are not refused for this
    // reason, so the refusals above come from the missing tab.
    it.each(sends)('control: %s with a readable tab', async (_name, message) => {
      h.local.set('transforms', [cssTransform()])
      const reply = await h.onMessage(message(TAB))
      expect(reply.error?.message).not.toBe(TAB_UNKNOWN_MESSAGE)
    })
  })

  it('still applies a saved transform', async () => {
    h.local.set('transforms', [cssTransform()])
    h.privateTabs.add(TAB)
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
  })
})

describe('a transform restricted to a container', () => {
  const restricted = () => cssTransform({ cookieStoreId: 'firefox-container-2' })

  it('is not applied in a tab of another container, or outside containers', async () => {
    h.local.set('transforms', [restricted()])
    h.tabContainers.set(TAB, 'firefox-container-1')
    await commit()
    expect(h.calls.insertCSS).toHaveLength(0)

    h.tabContainers.delete(TAB)
    await commit()
    expect(h.calls.insertCSS).toHaveLength(0)
  })

  // Without the cookies permission Firefox leaves cookieStoreId out of a tab.
  // The restriction then cannot be checked, so the transform does not apply,
  // and a transform with no restriction still does.
  it('is not applied when the tab does not report its container (permission removed)', async () => {
    h.local.set('transforms', [restricted(), cssTransform({ id: 'free', name: 'Free', code: 'p { color: blue }' })])
    h.cookiesWithheld = true
    await commit()
    const css = h.calls.insertCSS.map((c) => c.css).join('\n')
    expect(css).toContain('Free')
    expect(css).not.toContain('Dark')
  })

  it('control: the same transforms both apply once the tab reports its container', async () => {
    h.local.set('transforms', [restricted(), cssTransform({ id: 'free', name: 'Free', code: 'p { color: blue }' })])
    h.tabContainers.set(TAB, 'firefox-container-2')
    await commit()
    const css = h.calls.insertCSS.map((c) => c.css).join('\n')
    expect(css).toContain('Free')
    expect(css).toContain('Dark')
  })

  it('control: it is applied in a tab of its own container', async () => {
    h.local.set('transforms', [restricted()])
    h.tabContainers.set(TAB, 'firefox-container-2')
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
  })

  it('control: a transform with no restriction is applied in every container', async () => {
    h.local.set('transforms', [cssTransform()])
    h.tabContainers.set(TAB, 'firefox-container-1')
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
  })

  it('applies a restriction to tabs outside any container when it names the default store', async () => {
    h.local.set('transforms', [cssTransform({ cookieStoreId: 'firefox-default' })])
    await commit()
    expect(h.calls.insertCSS.filter((c) => c.css.includes('Dark'))).toHaveLength(1)
  })

  // Applying after a save goes through the queue in reapply, which filters by
  // container on its own, apart from the filter used when a page loads.
  describe('when CSS is applied after a change in the panel (#127)', () => {
    const inside = () => cssTransform({ id: 'in', name: 'Inside', code: 'p { color: red }', cookieStoreId: 'firefox-container-2' })
    const outside = () => cssTransform({ id: 'out', name: 'Outside', code: 'p { color: blue }' })
    const appliedCss = () => h.calls.insertCSS.map((c) => c.css).join('\n')

    const toggle = () => h.onMessage({ type: 'set-enabled', id: 'out', enabled: true, tabId: TAB })

    it('applies the unrestricted transform and not the restricted one in another container', async () => {
      h.local.set('transforms', [inside(), outside()])
      h.tabContainers.set(TAB, 'firefox-container-1')
      await toggle()
      expect(appliedCss()).toContain('Outside')
      expect(appliedCss()).not.toContain('Inside')
    })

    // Control: in the restricted transform's own container both are applied,
    // so the missing one above is left out by the container check.
    it('control: applies both in the container the restriction names', async () => {
      h.local.set('transforms', [inside(), outside()])
      h.tabContainers.set(TAB, 'firefox-container-2')
      await toggle()
      expect(appliedCss()).toContain('Outside')
      expect(appliedCss()).toContain('Inside')
    })
  })

  it('keeps the field when it is saved', async () => {
    await h.onMessage({ type: 'save-transform', transform: restricted() })
    expect((h.local.get('transforms') as any[])[0].cookieStoreId).toBe('firefox-container-2')
  })

  it('keeps the stored restriction when a save omits the field (#127)', async () => {
    h.local.set('transforms', [restricted()])
    const withoutField = cssTransform()
    await h.onMessage({ type: 'save-transform', transform: { ...withoutField, code: 'a { color: blue }' } })
    const [stored] = h.local.get('transforms') as any[]
    expect(stored.code).toBe('a { color: blue }')
    expect(stored.cookieStoreId).toBe('firefox-container-2')
  })

  it('removes the stored restriction when the save asks for it', async () => {
    h.local.set('transforms', [restricted()])
    const withoutField = cssTransform()
    await h.onMessage({ type: 'save-transform', transform: withoutField, clearContainer: true })
    expect((h.local.get('transforms') as any[])[0].cookieStoreId).toBeUndefined()
  })

  it('refuses a stored value that is not a string, and the control accepts one that is', async () => {
    const bad = await h.onMessage({
      type: 'save-transform',
      transform: cssTransform({ cookieStoreId: 7 }),
    })
    expect(bad.ok).toBe(false)
    const good = await h.onMessage({ type: 'save-transform', transform: restricted() })
    expect(good.ok).toBe(true)
  })
})
