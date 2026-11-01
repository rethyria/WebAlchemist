/**
 * The runtime guard (#139), run here against stand-in objects. What Firefox
 * does with the same code is measured by test/runtime-guard/probe.mjs; these
 * tests check what the generated source does with the objects it is given:
 * which names it hides for which capabilities, that a declared capability is
 * left alone, that it cannot be undone from the code that follows it, and that
 * it stops the transform when a definition fails.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Capability } from '@shared/types'
import { guardedWindowNames, runtimeGuardSource } from './runtime-guard'

const MARKER = 'data-wa-error-test'

/** Stand-ins for the objects the guard defines properties on. */
function world(options: { frozenWindow?: boolean } = {}) {
  const timerCalls: unknown[][] = []
  const win: Record<string, unknown> = {
    setTimeout: function (this: unknown, ...args: unknown[]) {
      timerCalls.push([this, ...args])
      return 1
    },
    setInterval: () => 2,
  }
  for (const name of [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection',
    'webkitRTCPeerConnection', 'open', 'Worker', 'SharedWorker', 'importScripts', 'eval', 'Function',
    'indexedDB', 'localStorage', 'sessionStorage', 'caches', 'cookieStore', 'wrappedJSObject', 'frames',
    'FontFace',
  ]) {
    win[name] = `real ${name}`
  }
  if (options.frozenWindow) Object.freeze(win)

  const navigatorPrototype = { sendBeacon: () => true, serviceWorker: 'real serviceWorker', storage: 'real storage' }
  const navigator = Object.create(navigatorPrototype)
  const documentPrototype = {}
  Object.defineProperty(documentPrototype, 'cookie', { value: 'a=1', configurable: true, writable: true })
  const attributes = new Map<string, string>()
  const doc = Object.create(documentPrototype)
  doc.documentElement = { setAttribute: (name: string, value: string) => attributes.set(name, value) }
  const frames = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement', 'HTMLEmbedElement'].map(
    (name) => {
      const ctor = function () {} as unknown as { prototype: object }
      ctor.prototype = {}
      Object.defineProperty(ctor.prototype, 'contentWindow', { value: 'frame window', configurable: true })
      Object.defineProperty(ctor.prototype, 'contentDocument', { value: 'frame document', configurable: true })
      return [name, ctor] as const
    },
  )
  // The page's Function.prototype as the world sees it: an object whose
  // `constructor` builds code. A plain object stands in, because defining on the
  // real Function.prototype would break the test process.
  const pageFunctionPrototype = { constructor: 'page Function' }
  const eventTarget = function () {} as unknown as object
  Object.setPrototypeOf(eventTarget, pageFunctionPrototype)

  // Objects that the page owns and that carry the Xray waiver, and the helpers
  // of the sandbox, as plain stand-ins with a readable `wrappedJSObject`.
  const waivable = (name: string) => ({ name, wrappedJSObject: `page ${name}` })
  Object.defineProperty(navigatorPrototype, 'wrappedJSObject', { value: 'page Navigator.prototype', configurable: true })
  Object.defineProperty(documentPrototype, 'wrappedJSObject', { value: 'page Document.prototype', configurable: true })
  Object.defineProperty(doc, 'wrappedJSObject', { value: 'page document', configurable: true })
  Object.defineProperty(navigator, 'wrappedJSObject', { value: 'page navigator', configurable: true })
  const location = waivable('location')
  const history = waivable('history')
  const makePrototype = (name: string) => {
    const prototype: Record<string, unknown> = { wrappedJSObject: `page ${name}.prototype` }
    if (name === 'BaseAudioContext') prototype.audioWorklet = 'real audioWorklet'
    if (name === 'HTMLFormElement') {
      prototype.submit = () => 'submitted'
      prototype.requestSubmit = () => 'submitted'
    }
    return { prototype }
  }
  const prototypes = {
    Node: makePrototype('Node'),
    Element: makePrototype('Element'),
    HTMLElement: makePrototype('HTMLElement'),
    Location: makePrototype('Location'),
    History: makePrototype('History'),
    BaseAudioContext: makePrototype('BaseAudioContext'),
    HTMLFormElement: makePrototype('HTMLFormElement'),
  }
  Object.defineProperty(eventTarget, 'prototype', { value: { wrappedJSObject: 'page EventTarget.prototype' } })
  const sandbox: Record<string, unknown> = {}
  for (const name of ['exportFunction', 'cloneInto', 'createObjectIn', 'importFunction', 'Components']) {
    sandbox[name] = `real ${name}`
  }

  const run = (capabilities: Capability[]) => {
    const source = runtimeGuardSource(capabilities, MARKER)
    new Function(
      'window', 'navigator', 'Navigator', 'document', 'Document', 'EventTarget',
      'HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement', 'HTMLEmbedElement',
      'location', 'history', 'globalThis', 'Node', 'Element', 'HTMLElement', 'Location', 'History',
      'BaseAudioContext', 'HTMLFormElement',
      source,
    )(
      win, navigator, { prototype: navigatorPrototype }, doc, { prototype: documentPrototype }, eventTarget,
      ...frames.map(([, ctor]) => ctor),
      location, history, sandbox, prototypes.Node, prototypes.Element, prototypes.HTMLElement,
      prototypes.Location, prototypes.History, prototypes.BaseAudioContext, prototypes.HTMLFormElement,
    )
  }
  return {
    win, navigator, doc, attributes, timerCalls, pageFunctionPrototype, frames, run, navigatorPrototype,
    documentPrototype, location, history, prototypes, sandbox, eventTarget,
  }
}

describe('which names are hidden for which capabilities', () => {
  it('hides every network, storage and cookie name when nothing is declared', () => {
    const names = guardedWindowNames([])
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'localStorage', 'sessionStorage', 'caches', 'cookieStore', 'open', 'Worker', 'SharedWorker', 'importScripts', 'eval', 'Function', 'wrappedJSObject', 'frames']) {
      expect(names).toContain(name)
    }
  })

  it('leaves the network names when network is declared, and nothing else', () => {
    const names = guardedWindowNames(['network'])
    expect(names).not.toContain('fetch')
    expect(names).not.toContain('WebSocket')
    expect(names).toContain('localStorage')
    expect(names).toContain('cookieStore')
  })

  it('leaves the storage names when storage is declared and the cookie names when cookies is declared', () => {
    expect(guardedWindowNames(['storage'])).not.toContain('indexedDB')
    expect(guardedWindowNames(['cookies'])).not.toContain('cookieStore')
    expect(guardedWindowNames(['storage'])).toContain('fetch')
  })

  // Nothing declares a capability for these, so every set of capabilities hides them.
  it('hides the page window, the frames, and the code-running names whatever is declared', () => {
    const all = guardedWindowNames(['network', 'storage', 'cookies'])
    for (const name of ['wrappedJSObject', 'frames', 'open', 'Worker', 'SharedWorker', 'importScripts', 'eval', 'Function']) {
      expect(all).toContain(name)
    }
  })
})

describe('the guard run against stand-in objects', () => {
  // Control for everything below: before the guard runs, each name reads.
  it('control: every name is readable before the guard runs', () => {
    const w = world()
    expect(w.win.fetch).toBe('real fetch')
    expect(w.win.localStorage).toBe('real localStorage')
    expect(w.doc.cookie).toBe('a=1')
    expect(w.navigator.sendBeacon()).toBe(true)
    expect(w.pageFunctionPrototype.constructor).toBe('page Function')
  })

  it('refuses reads and writes of every name when nothing is declared', () => {
    const w = world()
    w.run([])
    for (const name of guardedWindowNames([])) {
      expect(() => w.win[name], name).toThrow()
      expect(() => {
        w.win[name] = 1
      }, name).toThrow()
    }
    expect(() => w.navigator.sendBeacon).toThrow()
    expect(() => w.navigatorPrototype.sendBeacon).toThrow()
    expect(() => w.navigator.serviceWorker).toThrow()
    expect(() => w.doc.cookie).toThrow()
    expect(() => w.documentPrototype && (w.documentPrototype as { cookie: string }).cookie).toThrow()
    expect(() => w.pageFunctionPrototype.constructor).toThrow()
    for (const [, ctor] of w.frames) {
      expect(() => (ctor.prototype as { contentWindow: unknown }).contentWindow).toThrow()
      expect(() => (ctor.prototype as { contentDocument: unknown }).contentDocument).toThrow()
    }
  })

  it('leaves what network declares, and still hides storage, cookies and the beacon-free names', () => {
    const w = world()
    w.run(['network'])
    expect(w.win.fetch).toBe('real fetch')
    expect(w.win.WebSocket).toBe('real WebSocket')
    expect(w.navigator.sendBeacon()).toBe(true)
    expect(() => w.win.localStorage).toThrow()
    expect(() => w.doc.cookie).toThrow()
    expect(() => w.win.open).toThrow()
  })

  it('leaves what storage and cookies declare, and hides the network', () => {
    const w = world()
    w.run(['storage', 'cookies'])
    expect(w.win.localStorage).toBe('real localStorage')
    expect(w.win.indexedDB).toBe('real indexedDB')
    expect(w.win.cookieStore).toBe('real cookieStore')
    expect(w.doc.cookie).toBe('a=1')
    expect(() => w.win.fetch).toThrow()
    expect(() => w.navigator.sendBeacon).toThrow()
  })

  it('control: the waiver, the sandbox helpers, the audio worklet, the form methods and navigator.storage read before the guard runs', () => {
    const w = world()
    expect(w.doc.wrappedJSObject).toBe('page document')
    expect(w.location.wrappedJSObject).toBe('page location')
    expect(w.prototypes.Node.prototype.wrappedJSObject).toBe('page Node.prototype')
    expect(w.sandbox.exportFunction).toBe('real exportFunction')
    expect(w.prototypes.BaseAudioContext.prototype.audioWorklet).toBe('real audioWorklet')
    expect(typeof w.prototypes.HTMLFormElement.prototype.submit).toBe('function')
    expect(w.navigator.storage).toBe('real storage')
  })

  it('hides wrappedJSObject on the document, the navigator, the location, the history and the prototypes, whatever is declared', () => {
    const w = world()
    w.run(['network', 'storage', 'cookies'])
    for (const object of [
      w.doc, w.navigator, w.location, w.history, w.navigatorPrototype, w.documentPrototype,
      w.prototypes.Node.prototype, w.prototypes.Element.prototype, w.prototypes.HTMLElement.prototype,
      w.prototypes.Location.prototype, w.prototypes.History.prototype,
    ]) {
      expect(() => (object as { wrappedJSObject: unknown }).wrappedJSObject).toThrow()
    }
  })

  it('hides the sandbox helpers and the audio worklet whatever is declared', () => {
    const w = world()
    w.run(['network', 'storage', 'cookies'])
    for (const name of ['exportFunction', 'cloneInto', 'createObjectIn', 'importFunction', 'Components']) {
      expect(() => w.sandbox[name], name).toThrow()
    }
    expect(() => w.prototypes.BaseAudioContext.prototype.audioWorklet).toThrow()
  })

  it('hides navigator.storage and the form submit methods unless storage or network is declared', () => {
    const none = world()
    none.run([])
    expect(() => none.navigator.storage).toThrow()
    expect(() => none.prototypes.HTMLFormElement.prototype.submit).toThrow()
    expect(() => none.prototypes.HTMLFormElement.prototype.requestSubmit).toThrow()
    expect(() => none.win.FontFace).toThrow()
    const declared = world()
    declared.run(['network', 'storage'])
    expect(declared.navigator.storage).toBe('real storage')
    expect(typeof declared.prototypes.HTMLFormElement.prototype.submit).toBe('function')
    expect(declared.win.FontFace).toBe('real FontFace')
    const networkOnly = world()
    networkOnly.run(['network'])
    expect(() => networkOnly.navigator.storage).toThrow()
    const storageOnly = world()
    storageOnly.run(['storage'])
    expect(storageOnly.navigator.storage).toBe('real storage')
    expect(() => storageOnly.prototypes.HTMLFormElement.prototype.submit).toThrow()
  })

  it('cannot be undone by the code that runs after it', () => {
    const w = world()
    w.run([])
    expect(() => Object.defineProperty(w.win, 'fetch', { value: 1 })).toThrow(TypeError)
    expect(() => {
      delete w.win.fetch
    }).toThrow(TypeError)
  })

  it('refuses a timer given a string and passes a function and its arguments through', () => {
    const w = world()
    w.run([])
    const setTimeoutNow = w.win.setTimeout as (handler: unknown, ...rest: unknown[]) => unknown
    expect(() => setTimeoutNow('alert(1)', 0)).toThrow()
    expect(w.timerCalls).toEqual([])
    const handler = () => {}
    expect(setTimeoutNow(handler, 5, 'x', 'y')).toBe(1)
    // The callback receives the window as `this`, as it does without the guard.
    expect(w.timerCalls).toEqual([[w.win, handler, 5, 'x', 'y']])
    expect(() => (w.win.setInterval as (h: unknown) => unknown)('alert(1)')).toThrow()
  })

  // The transform must not run with a feature that was meant to be hidden.
  it('throws, and writes the marker, when a definition fails', () => {
    const w = world({ frozenWindow: true })
    expect(() => w.run([])).toThrow(/could not restrict/)
    expect(w.attributes.get(MARKER)).toMatch(/could not restrict: .*fetch/)
  })

  it('control: the same guard on a window that can be defined on does not throw or write the marker', () => {
    const w = world()
    expect(() => w.run([])).not.toThrow()
    expect(w.attributes.has(MARKER)).toBe(false)
  })
})
