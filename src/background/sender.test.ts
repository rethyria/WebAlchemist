/**
 * Sender checks on the background's message and port listeners (#68).
 *
 * These tests load the real src/background/index.ts against a stubbed
 * `browser` and call the listeners it registers, so what is tested is the
 * listener the extension runs and not a copy of its logic. The stub records
 * every `addListener` call and answers storage reads with nothing stored.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'moz-extension://abc-123/'

type Listener = (...args: any[]) => any
const listeners = new Map<string, Listener>()

/** Any property access returns another stub; `addListener` records its function. */
function stub(path: string): any {
  const fn = () => Promise.resolve(undefined)
  return new Proxy(fn, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined
      if (prop === 'addListener') return (l: Listener) => listeners.set(path, l)
      return stub(`${path}.${prop}`)
    },
    apply: () => Promise.resolve(undefined),
  })
}

const base = stub('browser')
vi.stubGlobal(
  'browser',
  new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'runtime') {
          return new Proxy(stub('browser.runtime'), {
            get(target, p: string) {
              if (p === 'getURL') return (path: string) => ORIGIN + path
              if (p === 'id') return 'wa@test'
              return Reflect.get(target, p)
            },
          })
        }
        if (prop === 'permissions') {
          // Start-up reconciles content scripts against the granted origins.
          return new Proxy(stub('browser.permissions'), {
            get(target, p: string) {
              if (p === 'getAll') return async () => ({ origins: [], permissions: [] })
              return Reflect.get(target, p)
            },
          })
        }
        if (prop === 'storage') {
          return { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
        }
        return base[prop]
      },
    },
  ),
)

let onMessage: Listener
let onConnect: Listener

beforeAll(async () => {
  await import('./index')
  onMessage = listeners.get('browser.runtime.onMessage')!
  onConnect = listeners.get('browser.runtime.onConnect')!
})

const extensionPage = { url: `${ORIGIN}src/options/index.html`, id: 'wa@test' }
const editorTab = { url: `${ORIGIN}src/editor/index.html?id=1`, id: 'wa@test', tab: { id: 7 } }
const contentScript = { url: 'https://example.com/page', id: 'wa@test', tab: { id: 7 } }

describe('privileged messages', () => {
  // A representative message from each group listed in #68.
  const privileged: Record<string, unknown>[] = [
    { type: 'save-settings', settings: {} },
    { type: 'set-credential', providerId: 'anthropic', credential: { kind: 'api_key', value: 'k' } },
    { type: 'discard-vault' },
    { type: 'delete-transform', id: 'x' },
    { type: 'import-transforms', bundle: {} },
    { type: 'capture-region', tabId: 1 },
    { type: 'a-type-nobody-defined' },
  ]

  it.each(privileged)('refuses %o from a content script', async (message) => {
    const reply = await onMessage(message, contentScript)
    expect(reply).toMatchObject({ ok: false })
    expect(reply.error.message).toContain('extension')
  })

  it.each(privileged.slice(0, 2))('accepts %o from an extension page', async (message) => {
    // Control for the refusals above: the same messages, from an extension
    // page, are handled and not refused by the sender check.
    const reply = await onMessage(message, extensionPage)
    expect(reply.error?.message ?? '').not.toContain('only accepted')
  })

  it('accepts get-settings from an extension page and returns data', async () => {
    const reply = await onMessage({ type: 'get-settings' }, extensionPage)
    expect(reply.ok).toBe(true)
    expect(reply.data).toBeTruthy()
  })

  it('accepts a message from the editor page, which carries a tab', async () => {
    const reply = await onMessage({ type: 'get-settings' }, editorTab)
    expect(reply.ok).toBe(true)
  })

  it('refuses a sender with no url', async () => {
    const reply = await onMessage({ type: 'get-settings' }, { id: 'wa@test' })
    expect(reply).toMatchObject({ ok: false })
  })

  it('refuses a page whose url only contains the extension origin', async () => {
    const reply = await onMessage(
      { type: 'get-settings' },
      { url: `https://evil.example/?${ORIGIN}`, tab: { id: 1 } },
    )
    expect(reply).toMatchObject({ ok: false })
  })
})

describe('events the content script sends', () => {
  it.each([
    'element-hovered',
    'element-picked',
    'element-referenced',
    'picking-cancelled',
    'region-selected',
  ])('does not refuse %s from a content script; it is left for other listeners', async (type) => {
    // `undefined` means "not answered here", which is what lets the sidebar's
    // own listener answer. A refusal would be an object.
    expect(await onMessage({ type }, contentScript)).toBeUndefined()
  })
})

describe('ports', () => {
  const port = (name: string, sender: unknown) => ({
    name,
    sender,
    disconnect: vi.fn(),
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
  })

  it.each(['wa-generate', 'wa-sidebar'])('disconnects a %s port from a content script', (name) => {
    const p = port(name, contentScript)
    onConnect(p)
    expect(p.disconnect).toHaveBeenCalled()
    expect(p.onMessage.addListener).not.toHaveBeenCalled()
    expect(p.onDisconnect.addListener).not.toHaveBeenCalled()
  })

  it('keeps a wa-generate port from an extension page', () => {
    const p = port('wa-generate', extensionPage)
    onConnect(p)
    expect(p.disconnect).not.toHaveBeenCalled()
    expect(p.onMessage.addListener).toHaveBeenCalled()
  })

  it('keeps a wa-sidebar port from an extension page', () => {
    const p = port('wa-sidebar', { url: `${ORIGIN}src/sidebar/index.html` })
    onConnect(p)
    expect(p.disconnect).not.toHaveBeenCalled()
    expect(p.onDisconnect.addListener).toHaveBeenCalled()
  })
})
