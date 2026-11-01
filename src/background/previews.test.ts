/**
 * The background's preview handlers: preview-js, clear-preview-js and the
 * clear-everything path taken when the sidebar's port closes.
 *
 * registry.test.ts covers the registry functions. This file loads the real
 * src/background/index.ts against a stubbed `browser` and calls the listeners
 * it registers, so changing which function a handler calls (for example back
 * to registering the preview under the saved id) fails here and not only in
 * the registry tests.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: any[]) => any
const listeners = new Map<string, Listener>()

/** Any property access returns another stub; `addListener` records its function. */
function stub(path: string): any {
  return new Proxy(() => Promise.resolve(undefined), {
    get(_target, prop: string) {
      if (prop === 'then') return undefined
      if (prop === 'addListener') return (l: Listener) => listeners.set(path, l)
      return stub(`${path}.${prop}`)
    },
    apply: () => Promise.resolve(undefined),
  })
}

const registered = new Map<string, any>()
let stored: any[] = []
const empty = { get: async () => ({}), set: async () => {}, remove: async () => {} }

/** An object whose missing members are stubs, so start-up listeners still register. */
const withFallback = (path: string, obj: object) =>
  new Proxy(obj, { get: (t, p: string) => (p in t ? (t as any)[p] : stub(`${path}.${p}`)) })

const realApis: Record<string, object> = {
  permissions: {
    contains: async () => true,
    getAll: async () => ({ origins: [], permissions: [] }),
  },
  storage: {
    local: {
      get: async () => ({ transforms: stored }),
      set: async () => {},
      remove: async () => {},
    },
    session: empty,
  },
  // The background refuses messages and ports that do not come from an
  // extension page (#68), which it decides by comparing the sender's url with
  // runtime.getURL(''), so the stub has to answer that call.
  runtime: { getURL: (path: string) => `moz-extension://abc/${path}` },
  tabs: { reload: async () => {} },
  userScripts: {
    configureWorld: async () => {},
    getScripts: async (f: { ids: string[] }) =>
      f.ids.filter((id) => registered.has(id)).map((id) => registered.get(id)),
    register: async (list: any[]) => list.forEach((r) => registered.set(r.id, r)),
    update: async (list: any[]) => list.forEach((r) => registered.set(r.id, r)),
    unregister: async (f: { ids?: string[] }) => {
      if (f.ids) f.ids.forEach((id) => registered.delete(id))
      else registered.clear()
    },
  },
}

const real: Record<string, unknown> = Object.fromEntries(
  Object.entries(realApis).map(([name, api]) => [name, withFallback(`browser.${name}`, api)]),
)

const base = stub('browser')
vi.stubGlobal(
  'browser',
  new Proxy(
    {},
    {
      get: (_t, prop: string) => (prop in real ? real[prop] : base[prop]),
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

const saved = {
  id: 'SAVED',
  name: 'Saved',
  enabled: true,
  order: 1,
  match: '*.example.com/*',
  kind: 'js',
  origin: 'user',
  world: 'USER_SCRIPT',
  capabilities: [],
  intent: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: 'html>body>div', landmarks: [], selector: 'div.x' },
  code: 'savedCode()',
  createdAt: 1,
  updatedAt: 1,
}
const extensionPage = { url: 'moz-extension://abc/src/sidebar/index.html', id: 'wa@test' }
const holds = (id: string) => JSON.stringify(registered.get(id) ?? null)

const previewJs = (code = 'draftCode()') =>
  onMessage(
    { type: 'preview-js', tabId: 1, transform: { ...saved, code } },
    extensionPage,
  )

beforeEach(async () => {
  // Leaves no preview from an earlier test in the background's own state.
  await onMessage({ type: 'clear-preview-js', id: 'SAVED' }, extensionPage)
  registered.clear()
  stored = [saved]
  registered.set('SAVED', { id: 'SAVED', js: [{ code: 'savedCode()' }] })
})

describe('preview-js and clear-preview-js', () => {
  it('pauses the saved script while the preview is registered', async () => {
    expect(await previewJs()).toMatchObject({ ok: true })
    expect(registered.has('SAVED')).toBe(false)
    expect(holds('preview-SAVED')).toContain('draftCode()')
  })

  it('registers the saved script again when the preview is cleared', async () => {
    await previewJs()
    expect(await onMessage({ type: 'clear-preview-js', id: 'SAVED' }, extensionPage)).toMatchObject({
      ok: true,
    })
    expect(registered.has('preview-SAVED')).toBe(false)
    expect(holds('SAVED')).toContain('savedCode()')
    expect(holds('SAVED')).not.toContain('draftCode()')
  })

  it('registers the saved script again when the sidebar closes with a preview running', async () => {
    await previewJs()
    expect(registered.has('SAVED')).toBe(false)

    const port = { name: 'wa-sidebar', sender: extensionPage, onDisconnect: { addListener: vi.fn() } }
    onConnect(port)
    // The handler does not return its promise, so wait for its effect.
    port.onDisconnect.addListener.mock.calls[0]![0]()
    await vi.waitFor(() => expect(registered.has('preview-SAVED')).toBe(false))
    await vi.waitFor(() => expect(holds('SAVED')).toContain('savedCode()'))
  })

  it('leaves the saved script running when no preview was started', async () => {
    // Control for the two tests above: a close with nothing to clear must not
    // change the saved registration, so a restore there is not just
    // re-registering on every disconnect.
    const port = { name: 'wa-sidebar', sender: extensionPage, onDisconnect: { addListener: vi.fn() } }
    onConnect(port)
    await port.onDisconnect.addListener.mock.calls[0]![0]()
    expect(holds('SAVED')).toBe(JSON.stringify({ id: 'SAVED', js: [{ code: 'savedCode()' }] }))
  })
})
