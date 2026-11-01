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
/** What the stubbed tabs API does; reset before each test. */
const tabHooks = {
  reload: async (_tabId: number): Promise<void> => {},
  replyFor: (_message: any): unknown => undefined,
  tab: (tabId: number): any => ({ id: tabId, active: true, windowId: 3, url: 'https://www.example.com/' }),
}
const captureCalls: { windowId: number; options: unknown }[] = []
const sentToTabs: { tabId: number; message: any }[] = []
let stored: any[] = []

/**
 * An in-memory storage.session. The background keeps the ids of previewed
 * scripts there so they survive a suspension, and clears them from there, so a
 * stub that forgets what it is given would leave nothing to clear.
 */
const session = new Map<string, unknown>()
const sessionArea = {
  get: async (keys?: string | string[] | null) => {
    const names = keys == null ? [...session.keys()] : typeof keys === 'string' ? [keys] : keys
    return Object.fromEntries(names.filter((k) => session.has(k)).map((k) => [k, session.get(k)]))
  },
  set: async (items: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(items)) session.set(k, v)
  },
  remove: async (keys: string | string[]) => {
    for (const k of typeof keys === 'string' ? [keys] : keys) session.delete(k)
  },
}

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
    session: sessionArea,
  },
  // The background refuses messages and ports that do not come from an
  // extension page (#68), which it decides by comparing the sender's url with
  // runtime.getURL(''), so the stub has to answer that call.
  runtime: { getURL: (path: string) => `moz-extension://abc/${path}` },
  tabs: {
    reload: async (tabId: number) => tabHooks.reload(tabId),
    sendMessage: async (tabId: number, message: unknown) => {
      sentToTabs.push({ tabId, message })
      return tabHooks.replyFor(message)
    },
    get: async (tabId: number) => tabHooks.tab(tabId),
    captureVisibleTab: async (windowId: number, options: unknown) => {
      captureCalls.push({ windowId, options })
      return 'data:image/png;base64,AAAA'
    },
  },
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
  // The palette is chosen from the colour scheme, which the background reads
  // with matchMedia; the test environment has none.
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  await import('./index')
  onMessage = listeners.get('browser.runtime.onMessage')!
  onConnect = listeners.get('browser.runtime.onConnect')!
})

// Code that passes static analysis, since registering and previewing run it.
const SAVED_CODE = "document.querySelector('aside').style.display = 'none'"
const DRAFT_CODE = "document.querySelector('nav').style.display = 'none'"

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
  code: SAVED_CODE,
  createdAt: 1,
  updatedAt: 1,
}
const extensionPage = { url: 'moz-extension://abc/src/sidebar/index.html', id: 'wa@test' }
const holds = (id: string) => JSON.stringify(registered.get(id) ?? null)

const previewJs = (code = DRAFT_CODE) =>
  onMessage(
    { type: 'preview-js', tabId: 1, transform: { ...saved, code } },
    extensionPage,
  )

beforeEach(async () => {
  // Leaves no preview from an earlier test in the background's own state.
  await onMessage({ type: 'clear-preview-js', id: 'SAVED' }, extensionPage)
  session.clear()
  registered.clear()
  stored = [saved]
  tabHooks.reload = async () => {}
  tabHooks.replyFor = () => undefined
  tabHooks.tab = (tabId) => ({ id: tabId, active: true, windowId: 3, url: 'https://www.example.com/' })
  captureCalls.length = 0
  sentToTabs.length = 0
  registered.set('SAVED', { id: 'SAVED', js: [{ code: SAVED_CODE }] })
})

describe('preview-js and clear-preview-js', () => {
  it('pauses the saved script while the preview is registered', async () => {
    expect(await previewJs()).toMatchObject({ ok: true })
    expect(registered.has('SAVED')).toBe(false)
    expect(holds('preview-SAVED')).toContain(DRAFT_CODE)
  })

  it('registers the saved script again when the preview is cleared', async () => {
    await previewJs()
    expect(await onMessage({ type: 'clear-preview-js', id: 'SAVED' }, extensionPage)).toMatchObject({
      ok: true,
    })
    expect(registered.has('preview-SAVED')).toBe(false)
    expect(holds('SAVED')).toContain(SAVED_CODE)
    expect(holds('SAVED')).not.toContain(DRAFT_CODE)
  })

  it('registers the saved script again when the sidebar closes with a preview running', async () => {
    await previewJs()
    expect(registered.has('SAVED')).toBe(false)

    const port = { name: 'wa-sidebar', sender: extensionPage, onDisconnect: { addListener: vi.fn() } }
    onConnect(port)
    // The handler does not return its promise, so wait for its effect.
    port.onDisconnect.addListener.mock.calls[0]![0]()
    await vi.waitFor(() => expect(registered.has('preview-SAVED')).toBe(false))
    await vi.waitFor(() => expect(holds('SAVED')).toContain(SAVED_CODE))
  })

  it('removes the preview and restores the saved script when the reload fails', async () => {
    tabHooks.reload = async () => {
      throw new Error('tab gone')
    }
    expect(await previewJs()).toMatchObject({ ok: false })
    expect(registered.has('preview-SAVED')).toBe(false)
    expect(holds('SAVED')).toContain(SAVED_CODE)
    // The id is no longer stored, so a later sidebar close has nothing to clear.
    expect([...session.values()].flat()).not.toContain('SAVED')
  })

  it('keeps the preview registered when the reload succeeds (control)', async () => {
    expect(await previewJs()).toMatchObject({ ok: true })
    expect(holds('preview-SAVED')).toContain(DRAFT_CODE)
    expect(session.get('wa-preview-scripts')).toEqual(['SAVED'])
  })

  it('leaves the saved script running when no preview was started', async () => {
    // Control for the two tests above: a close with nothing to clear must not
    // change the saved registration, so a restore there is not just
    // re-registering on every disconnect.
    const port = { name: 'wa-sidebar', sender: extensionPage, onDisconnect: { addListener: vi.fn() } }
    onConnect(port)
    await port.onDisconnect.addListener.mock.calls[0]![0]()
    expect(holds('SAVED')).toBe(JSON.stringify({ id: 'SAVED', js: [{ code: SAVED_CODE }] }))
  })
})

describe('context-for-anchor (#104)', () => {
  const anchor = { tag: 'div', classes: [], path: 'html>body>div', landmarks: [], selector: 'div.x' }

  it('sends the overlay palette with the request, so a page with no earlier pick can draw the outline', async () => {
    await onMessage({ type: 'context-for-anchor', tabId: 7, anchor }, extensionPage)
    const sent = sentToTabs.find((m) => m.message.type === 'context-for-anchor')
    expect(sent?.tabId).toBe(7)
    expect(sent?.message.anchor).toEqual(anchor)
    expect(sent?.message.palette).toMatchObject({ line: expect.any(String), labelText: expect.any(String) })
  })

  it('does not attach a palette to messages that never needed one (control)', async () => {
    await onMessage({ type: 'recapture', tabId: 7 }, extensionPage)
    const sent = sentToTabs.find((m) => m.message.type === 'recapture')
    expect(sent?.message).toEqual({ type: 'recapture' })
  })
})

describe('capture-region (#135, #119)', () => {
  const rect = { x: 10, y: 20, width: 100, height: 50 }
  const request = (extra: object = {}) =>
    onMessage(
      {
        type: 'capture-region',
        tabId: 5,
        rect,
        viewportWidth: 800,
        url: 'https://www.example.com/',
        ...extra,
      },
      extensionPage,
    )

  beforeAll(() => {
    // The crop runs in the browser's image APIs, which the test environment
    // does not have. The stubs only have to let the code reach its end.
    vi.stubGlobal('fetch', async () => ({ blob: async () => ({}) }))
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1600, height: 1200 }))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage() {} }
        }
        async convertToBlob() {
          return {}
        }
      },
    )
    vi.stubGlobal(
      'FileReader',
      class {
        onload: () => void = () => {}
        result = 'data:image/png;base64,CROP'
        readAsDataURL() {
          this.onload()
        }
      },
    )
  })

  it('captures the window of the run tab when it is active and unchanged (control)', async () => {
    const reply = (await request()) as any
    expect(reply.ok).toBe(true)
    expect(captureCalls).toEqual([{ windowId: 3, options: { format: 'png' } }])
  })

  it('refuses when the run tab is not the active tab, and captures nothing', async () => {
    tabHooks.tab = (tabId) => ({ id: tabId, active: false, windowId: 3, url: 'https://www.example.com/' })
    const reply = (await request()) as any
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/not the tab in front/)
    expect(captureCalls).toEqual([])
  })

  it('refuses when the run tab has moved to another address, and captures nothing', async () => {
    tabHooks.tab = (tabId) => ({ id: tabId, active: true, windowId: 3, url: 'https://other.example.org/' })
    const reply = (await request()) as any
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/another address/)
    expect(captureCalls).toEqual([])
  })

  it('refuses when the run tab is gone', async () => {
    tabHooks.tab = () => {
      throw new Error('no such tab')
    }
    expect(((await request()) as any).ok).toBe(false)
    expect(captureCalls).toEqual([])
  })

  describe('after the page scrolled', () => {
    const drawnAt = { scrolledTo: { x: 0, y: 0 } }
    const now = { x: 0, y: 5, width: 800, height: 600, devicePixelRatio: 2 }

    it('captures when the width and pixel ratio are the same as when the area was drawn (control)', async () => {
      tabHooks.replyFor = (m) => (m.type === 'get-viewport' ? now : undefined)
      expect(((await request({ ...drawnAt, devicePixelRatio: 2 })) as any).ok).toBe(true)
      expect(captureCalls).toHaveLength(1)
    })

    it('says the area was moved when the page scrolled, and not when it did not (#119)', async () => {
      tabHooks.replyFor = (m) => (m.type === 'get-viewport' ? now : undefined)
      const scrolled = (await request({ ...drawnAt, devicePixelRatio: 2 })) as any
      expect(scrolled.data.moved).toBe(true)

      // Control: the same request with the page at the offset it was drawn at.
      tabHooks.replyFor = (m) => (m.type === 'get-viewport' ? { ...now, y: 0 } : undefined)
      const unmoved = (await request({ ...drawnAt, devicePixelRatio: 2 })) as any
      expect(unmoved.data.moved).toBe(false)
    })

    it('refuses when the viewport width changed', async () => {
      tabHooks.replyFor = (m) => (m.type === 'get-viewport' ? { ...now, width: 600 } : undefined)
      const reply = (await request({ ...drawnAt, devicePixelRatio: 2 })) as any
      expect(reply.ok).toBe(false)
      expect(reply.error.message).toMatch(/size or zoom changed/)
      expect(captureCalls).toEqual([])
    })

    it('refuses when the pixel ratio changed', async () => {
      tabHooks.replyFor = (m) => (m.type === 'get-viewport' ? { ...now, devicePixelRatio: 1 } : undefined)
      expect(((await request({ ...drawnAt, devicePixelRatio: 2 })) as any).ok).toBe(false)
      expect(captureCalls).toEqual([])
    })
  })
})
