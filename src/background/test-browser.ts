/**
 * A stubbed `browser` for tests that load the real src/background/index.ts.
 *
 * What it adds over the stub in sender.test.ts is a way to simulate the event
 * page being suspended: `boot()` throws away every module-level variable by
 * resetting the module registry and importing index.ts again, while the fake
 * `storage.session` and `storage.local` keep their contents, which is what the
 * browser does across a suspension. Anything that must survive has to be in
 * those two stores, because nothing else is carried over.
 *
 * Calls that tests assert on are recorded in `calls`; listeners that index.ts
 * registers are kept in `listeners` and replaced on every boot.
 */

import { vi } from 'vitest'

/** Captured before a test installs fake timers, so `boot()` can still wait. */
const realSetTimeout = globalThis.setTimeout

export type Listener = (...args: any[]) => any

export const ORIGIN = 'moz-extension://abc-123/'
export const extensionPage = { url: `${ORIGIN}src/sidebar/index.html`, id: 'wa@test' }

/** A storage area whose contents outlive `boot()`. */
function area(data: Map<string, unknown>) {
  return {
    get: async (keys?: string | string[] | null) => {
      const out: Record<string, unknown> = {}
      const wanted = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys]
      for (const key of wanted) if (data.has(key)) out[key] = structuredClone(data.get(key))
      return out
    },
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value))
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key)
    },
  }
}

export interface Harness {
  /** Contents of storage.session and storage.local; they survive `boot()`. */
  session: Map<string, unknown>
  local: Map<string, unknown>
  /** What `userScripts.getScripts` reports; changed by register, update and unregister. */
  userScriptsHeld: Map<string, any>
  /** The content script registration, or null. */
  contentScriptHeld: any
  /** Origins `permissions.getAll` reports as granted. */
  origins: string[]
  /** The URL `tabs.get` reports for each tab id; `tabs.query` lists these tabs. */
  tabUrls: Map<number, string>
  /** The window each tab is in; a tab not listed is in window 1. */
  tabWindows: Map<number, number>
  /** Tabs that `tabs.get` reports as being in a private window. */
  privateTabs: Set<number>
  /** The container of each tab; a tab not listed is in 'firefox-default'. */
  tabContainers: Map<number, string>
  calls: {
    insertCSS: { tabId: number; css: string }[]
    removeCSS: { tabId: number; css: string }[]
    unregister: string[]
    /** Every change to the registered user scripts and content script, in order. */
    registry: string[]
    setBadgeText: { tabId?: number | undefined; text: string | null }[]
    sendMessage: { tabId: number; message: any }[]
    /** Messages the background broadcast with `runtime.sendMessage`. */
    runtimeMessages: any[]
  }
  /** Listeners registered by the most recent boot, keyed by API path. */
  listeners: Map<string, Listener>
  /** Reports whether the userScripts permission is held. Defaults to false. */
  hasUserScripts: boolean
  /** Loads index.ts with fresh module state, as after a suspension. */
  boot(): Promise<void>
  onMessage(message: unknown, sender?: unknown): Promise<any>
  /** Replaces what the content script answers to `tabs.sendMessage`. */
  contentReply: (message: any) => unknown
}

export function createHarness(): Harness {
  const h: Harness = {
    session: new Map(),
    local: new Map(),
    tabUrls: new Map(),
    userScriptsHeld: new Map(),
    contentScriptHeld: null,
    origins: [],
    tabWindows: new Map(),
    privateTabs: new Set(),
    tabContainers: new Map(),
    calls: { insertCSS: [], removeCSS: [], unregister: [], registry: [], setBadgeText: [], sendMessage: [], runtimeMessages: [] },
    listeners: new Map(),
    hasUserScripts: false,
    contentReply: () => undefined,
    boot: async () => {},
    onMessage: async (message, sender = extensionPage) =>
      h.listeners.get('browser.runtime.onMessage')!(message, sender),
  }

  const overrides: Record<string, unknown> = {
    'browser.runtime.getURL': (path: string) => ORIGIN + path,
    'browser.runtime.id': 'wa@test',
    'browser.permissions.getAll': async () => ({ origins: h.origins, permissions: [] }),
    'browser.permissions.contains': async () => h.hasUserScripts,
    'browser.userScripts.unregister': async (filter?: { ids?: string[] }) => {
      const ids = filter?.ids ?? [...h.userScriptsHeld.keys()]
      h.calls.registry.push(filter?.ids ? `unregister:${ids.join(',')}` : 'unregister:all')
      h.calls.unregister.push(...ids)
      for (const id of ids) h.userScriptsHeld.delete(id)
    },
    'browser.userScripts.register': async (scripts: { id: string }[]) => {
      for (const script of scripts) {
        h.calls.registry.push(`register:${script.id}`)
        h.userScriptsHeld.set(script.id, structuredClone(script))
      }
    },
    'browser.userScripts.update': async (scripts: { id: string }[]) => {
      for (const script of scripts) {
        h.calls.registry.push(`update:${script.id}`)
        h.userScriptsHeld.set(script.id, structuredClone(script))
      }
    },
    'browser.userScripts.configureWorld': async () => {},
    'browser.userScripts.getScripts': async (filter?: { ids?: string[] }) =>
      [...h.userScriptsHeld.values()].filter((s) => !filter?.ids || filter.ids.includes(s.id)),
    'browser.scripting.getRegisteredContentScripts': async () =>
      h.contentScriptHeld ? [structuredClone(h.contentScriptHeld)] : [],
    'browser.scripting.unregisterContentScripts': async () => {
      h.calls.registry.push('unregister-content')
      h.contentScriptHeld = null
    },
    'browser.scripting.registerContentScripts': async (scripts: any[]) => {
      h.calls.registry.push('register-content')
      h.contentScriptHeld = structuredClone(scripts[0])
    },
    'browser.runtime.sendMessage': async (message: unknown) => {
      h.calls.runtimeMessages.push(message)
    },
    'browser.tabs.get': async (id: number) => ({
      id,
      url: h.tabUrls.get(id),
      windowId: h.tabWindows.get(id) ?? 1,
      incognito: h.privateTabs.has(id),
      cookieStoreId: h.tabContainers.get(id) ?? 'firefox-default',
    }),
    'browser.tabs.query': async () => [...h.tabUrls].map(([id, url]) => ({ id, url })),
    'browser.tabs.sendMessage': async (tabId: number, message: unknown) => {
      h.calls.sendMessage.push({ tabId, message })
      return h.contentReply(message)
    },
    'browser.scripting.insertCSS': async (o: { target: { tabId: number }; css: string }) => {
      h.calls.insertCSS.push({ tabId: o.target.tabId, css: o.css })
    },
    'browser.scripting.removeCSS': async (o: { target: { tabId: number }; css: string }) => {
      h.calls.removeCSS.push({ tabId: o.target.tabId, css: o.css })
    },
    'browser.action.setBadgeText': async (o: { tabId?: number; text: string | null }) => {
      h.calls.setBadgeText.push({ tabId: o.tabId, text: o.text })
    },
    'browser.storage.local': area(h.local),
    'browser.storage.session': area(h.session),
  }

  /** Any unlisted property is another stub; `addListener` records its function. */
  function stub(path: string): any {
    if (path in overrides) return overrides[path]
    const fn = () => Promise.resolve(undefined)
    return new Proxy(fn, {
      get(_target, prop: string) {
        if (prop === 'then') return undefined
        if (prop === 'addListener') return (l: Listener) => h.listeners.set(path, l)
        return stub(`${path}.${prop}`)
      },
      apply: () => Promise.resolve(undefined),
    })
  }

  h.boot = async () => {
    h.listeners = new Map()
    vi.resetModules()
    vi.stubGlobal('browser', new Proxy({}, { get: (_t, prop: string) => stub(`browser.${prop}`) }))
    await import('./index')
    // Start-up work (content script reconciliation) is fire-and-forget.
    await new Promise((resolve) => realSetTimeout(resolve, 0))
  }

  return h
}

/** A transform record that passes `isValidTransform`. */
export function cssTransform(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Dark',
    enabled: true,
    order: 0,
    match: 'example.com/*',
    kind: 'css',
    origin: 'user',
    capabilities: [],
    intent: '',
    rationale: { assumptions: [] },
    anchor: { tag: 'body', classes: [], path: 'body', landmarks: [], selector: 'body' },
    code: 'body { color: red }',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

/** A `runtime.Port` as the background sees one connecting from the sidebar. */
export function sidebarPort(windowId: number | null = 1) {
  let onDrop: () => void = () => {}
  return {
    name: windowId === null ? 'wa-sidebar' : `wa-sidebar:${windowId}`,
    sender: extensionPage,
    disconnect: () => {},
    postMessage: () => {},
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: (l: () => void) => (onDrop = l) },
    /** The sidebar closing its end. */
    drop: () => onDrop(),
  }
}
