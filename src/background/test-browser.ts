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

import type { ApprovalVerdict } from './approvals'
import { approvedPreviewMessage, type PreviewMessageInput } from './test-support/preview-approval'
import { vi } from 'vitest'
import { originCovers } from '@shared/site-access'

/** Captured before a test installs fake timers, so `boot()` can still wait. */
const realSetTimeout = globalThis.setTimeout

/** An array when it has entries, otherwise null, as Firefox stores match lists. */
function nonEmptyOrNull(list: string[] | null | undefined): string[] | null {
  return list && list.length > 0 ? list : null
}

export type Listener = (...args: any[]) => any

export const ORIGIN = 'moz-extension://abc-123/'
export const extensionPage = { url: `${ORIGIN}src/sidebar/index.html`, id: 'wa@test' }

/** A storage area whose contents outlive `boot()`. */
function area(
  data: Map<string, unknown>,
  path: string,
  gates: Map<string, Promise<void>>,
  gateExceptKeys: Map<string, string[]>,
) {
  /** Waits for a gate set with `hold(`${path}.set`)` or `.get`, `.remove`. */
  const gated = async (method: string) => {
    await gates.get(`${path}.${method}`)
  }
  return {
    get: async (keys?: string | string[] | null) => {
      const out: Record<string, unknown> = {}
      const wanted = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys]
      for (const key of wanted) if (data.has(key)) out[key] = structuredClone(data.get(key))
      return out
    },
    set: async (items: Record<string, unknown>) => {
      // A write whose keys are all in the hold's `exceptKeys` is not held.
      const except = gateExceptKeys.get(`${path}.set`)
      if (!except || !Object.keys(items).every((key) => except.includes(key))) await gated('set')
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
  /** The content script registrations by id. */
  contentScriptsHeld: Map<string, any>
  /** Makes `registerContentScripts` reject a registration for which this returns true. */
  rejectContentScript: (script: any) => boolean
  /** Origins `permissions.getAll` reports as granted. */
  origins: string[]
  /** The URL `tabs.get` reports for each tab id; `tabs.query` lists these tabs. */
  tabUrls: Map<number, string>
  /** The window each tab is in; a tab not listed is in window 1. */
  tabWindows: Map<number, number>
  /** Tabs that `tabs.get` reports as being in a private window. */
  privateTabs: Set<number>
  /** Tabs that `tabs.get` rejects for, as it does for a tab that has closed. */
  closedTabs: Set<number>
  /** Tabs that `tabs.get` reports as not being the active tab of their window. */
  inactiveTabs: Set<number>
  /** The picture `tabs.captureVisibleTab` returns, as a data address. */
  captureVisibleTab: (windowId: number, options: unknown) => Promise<string>
  /** When true `tabs.get` leaves out cookieStoreId, as Firefox does without the cookies permission. */
  cookiesWithheld: boolean
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
    /** Ids of tabs passed to `tabs.reload`. */
    reload: number[]
    /** Messages the background broadcast with `runtime.sendMessage`. */
    runtimeMessages: any[]
    /** Number of calls to `sidebarAction.open`. */
    sidebarOpen: number
    /** Addresses passed to `tabs.create`. */
    tabsCreate: string[]
    /** Ids passed to `tabs.update`. */
    tabsUpdate: number[]
  }
  /** The operating system `runtime.getPlatformInfo` reports. Defaults to 'linux'. */
  os: string
  /** Listeners registered by the most recent boot, keyed by API path. */
  listeners: Map<string, Listener>
  /** Reports whether the userScripts permission is held. Defaults to false. */
  hasUserScripts: boolean
  /** Whether the `<all_urls>` origin grant is held; `permissions.remove` clears it. */
  allUrlsGranted: boolean
  /** Permission sets passed to `permissions.remove`. */
  permissionsRemoved: unknown[]
  /**
   * Completes a preview-js message with the expected address (the tab's own)
   * and the token of a recorded review whose verdict is match. Fields the
   * message already has are kept.
   */
  approvedPreview(message: PreviewMessageInput, verdict?: ApprovalVerdict): Promise<any>
  /** Loads index.ts with fresh module state, as after a suspension. */
  boot(): Promise<void>
  onMessage(message: unknown, sender?: unknown): Promise<any>
  /** Replaces what the content script answers to `tabs.sendMessage`. */
  contentReply: (message: any) => unknown
  /**
   * Makes the next calls to the stubbed API at `path` (for example
   * `browser.userScripts.getScripts`) wait until the returned function is
   * called. Lets a test place a second event between two steps of one handler.
   * With `firstCallOnly` only the first call waits and later calls go through.
   * With `exceptKeys`, a storage `set` whose keys are all listed is not held.
   */
  hold(path: string, options?: { firstCallOnly?: boolean; exceptKeys?: string[] }): () => void
}

export function createHarness(): Harness {
  const gates = new Map<string, Promise<void>>()
  const onceOnly = new Set<string>()
  const gateExceptKeys = new Map<string, string[]>()
  const h: Harness = {
    session: new Map(),
    local: new Map(),
    tabUrls: new Map(),
    userScriptsHeld: new Map(),
    contentScriptsHeld: new Map(),
    rejectContentScript: () => false,
    origins: [],
    tabWindows: new Map(),
    privateTabs: new Set(),
    closedTabs: new Set(),
    inactiveTabs: new Set(),
    captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    cookiesWithheld: false,
    tabContainers: new Map(),
    calls: { insertCSS: [], removeCSS: [], unregister: [], registry: [], setBadgeText: [], sendMessage: [], reload: [], runtimeMessages: [], sidebarOpen: 0, tabsCreate: [], tabsUpdate: [] },
    os: 'linux',
    listeners: new Map(),
    hasUserScripts: false,
    allUrlsGranted: false,
    permissionsRemoved: [],
    contentReply: () => undefined,
    hold: (path, options) => {
      let release: () => void = () => {}
      gates.set(path, new Promise<void>((resolve) => (release = resolve)))
      if (options?.firstCallOnly) onceOnly.add(path)
      if (options?.exceptKeys) gateExceptKeys.set(path, options.exceptKeys)
      return () => {
        gates.delete(path)
        onceOnly.delete(path)
        gateExceptKeys.delete(path)
        release()
      }
    },
    boot: async () => {},
    approvedPreview: async (message, verdict) =>
      approvedPreviewMessage(h.session, message, h.tabUrls.get(message.tabId), verdict),
    onMessage: async (message, sender = extensionPage) =>
      h.listeners.get('browser.runtime.onMessage')!(message, sender),
  }

  const overrides: Record<string, unknown> = {
    'browser.runtime.getURL': (path: string) => ORIGIN + path,
    'browser.runtime.id': 'wa@test',
    'browser.runtime.getPlatformInfo': async () => ({ os: h.os, arch: 'x86-64' }),
    'browser.sidebarAction.open': async () => {
      h.calls.sidebarOpen += 1
    },
    'browser.tabs.create': async (o: { url: string }) => {
      h.calls.tabsCreate.push(o.url)
      return { id: 500 }
    },
    'browser.tabs.update': async (id: number) => {
      h.calls.tabsUpdate.push(id)
      return { id }
    },
    'browser.permissions.getAll': async () => ({ origins: h.origins, permissions: [] }),
    'browser.permissions.contains': async (p?: { origins?: string[] }) => {
      if (p?.origins?.includes('<all_urls>')) return h.allUrlsGranted
      return p?.origins
        ? p.origins.every((o) => h.origins.some((held) => originCovers(held, o)))
        : h.hasUserScripts
    },
    'browser.permissions.remove': async (p: { origins?: string[] }) => {
      h.permissionsRemoved.push(structuredClone(p))
      if (p.origins?.includes('<all_urls>')) h.allUrlsGranted = false
      return true
    },
    'browser.userScripts.unregister': async (filter?: { ids?: string[] }) => {
      const ids = filter?.ids ?? [...h.userScriptsHeld.keys()]
      h.calls.registry.push(filter?.ids ? `unregister:${ids.join(',')}` : 'unregister:all')
      h.calls.unregister.push(...ids)
      for (const id of ids) h.userScriptsHeld.delete(id)
    },
    'browser.userScripts.register': async (scripts: { id: string }[]) => {
      for (const script of scripts) {
        h.calls.registry.push(`register:${script.id}`)
        h.userScriptsHeld.set(script.id, {
          ...structuredClone(script),
          excludeMatches: nonEmptyOrNull((script as any).excludeMatches),
        })
      }
    },
    'browser.userScripts.update': async (scripts: { id: string }[]) => {
      for (const script of scripts) {
        h.calls.registry.push(`update:${script.id}`)
        // Firefox merges an update into the held registration: a key that is
        // missing or an empty list keeps the old value, except that an empty
        // `excludeMatches` list is stored as null (ExtensionUserScripts.sys.mjs).
        const old = h.userScriptsHeld.get(script.id) as any
        const merged = { ...(old ?? {}), ...structuredClone(script) } as any
        const given = (script as any).excludeMatches
        merged.excludeMatches = nonEmptyOrNull(given ?? old?.excludeMatches)
        h.userScriptsHeld.set(script.id, merged)
      }
    },
    'browser.userScripts.configureWorld': async () => {},
    'browser.userScripts.getScripts': async (filter?: { ids?: string[] }) =>
      [...h.userScriptsHeld.values()].filter((s) => !filter?.ids || filter.ids.includes(s.id)),
    'browser.scripting.getRegisteredContentScripts': async (filter?: { ids?: string[] }) =>
      [...h.contentScriptsHeld.values()]
        .filter((s) => !filter?.ids || filter.ids.includes(s.id))
        .map((s) => structuredClone(s)),
    'browser.scripting.unregisterContentScripts': async (filter?: { ids?: string[] }) => {
      const ids = filter?.ids ?? [...h.contentScriptsHeld.keys()]
      h.calls.registry.push(`unregister-content:${ids.join(',')}`)
      for (const id of ids) h.contentScriptsHeld.delete(id)
    },
    'browser.scripting.registerContentScripts': async (scripts: any[]) => {
      for (const script of scripts) {
        if (h.rejectContentScript(script)) throw new Error('Invalid match pattern')
        if (h.contentScriptsHeld.has(script.id)) throw new Error('Duplicate script ID')
        h.calls.registry.push(`register-content:${script.id}`)
        h.contentScriptsHeld.set(script.id, structuredClone(script))
      }
    },
    'browser.runtime.sendMessage': async (message: unknown) => {
      h.calls.runtimeMessages.push(message)
    },
    'browser.tabs.get': async (id: number) => {
      if (h.closedTabs.has(id)) throw new Error(`Invalid tab ID: ${id}`)
      return {
        id,
        url: h.tabUrls.get(id),
        windowId: h.tabWindows.get(id) ?? 1,
        active: !h.inactiveTabs.has(id),
        incognito: h.privateTabs.has(id),
        ...(h.cookiesWithheld
          ? {}
          : { cookieStoreId: h.tabContainers.get(id) ?? 'firefox-default' }),
      }
    },
    'browser.tabs.captureVisibleTab': (windowId: number, options: unknown) => h.captureVisibleTab(windowId, options),
    'browser.tabs.query': async () => [...h.tabUrls].map(([id, url]) => ({ id, url })),
    'browser.tabs.reload': async (tabId: number) => {
      h.calls.reload.push(tabId)
    },
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
    'browser.storage.local': area(h.local, 'browser.storage.local', gates, gateExceptKeys),
    'browser.storage.session': area(h.session, 'browser.storage.session', gates, gateExceptKeys),
  }

  /** Any unlisted property is another stub; `addListener` records its function. */
  function stub(path: string): any {
    if (path in overrides) {
      const real = overrides[path]
      if (typeof real !== 'function') return real
      // Looked up at call time, so a gate set after boot still applies.
      return (...args: unknown[]) => {
        const gate = gates.get(path)
        if (gate && onceOnly.delete(path)) gates.delete(path)
        const call = () => (real as (...a: unknown[]) => unknown)(...args)
        // Unchanged for an ungated call: some of these stubs are synchronous.
        return gate ? gate.then(call) : call()
      }
    }
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
