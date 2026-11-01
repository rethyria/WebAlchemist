/**
 * Private windows and containers (#127), against the real index.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_WINDOW_MESSAGE } from './private-window'
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
    function generate() {
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
      onMessage({ context: {}, instruction: 'x', history: [], tabId: TAB })
      return posted
    }

    it('is refused before anything is sent to a provider', async () => {
      h.privateTabs.add(TAB)
      const posted = generate()
      await settle()
      expect(posted).toEqual([{ type: 'error', error: { message: PRIVATE_WINDOW_MESSAGE } }])
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
