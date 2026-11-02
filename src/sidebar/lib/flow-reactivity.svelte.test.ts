/**
 * Regression test for #154: the Run button never appeared after a review that
 * returned a match. The panel reads the preview gate through a `$derived`, so
 * this test reads it through one too. A direct read of the getter after the
 * review finished passed even with the bug, because a getter read outside a
 * reactive context is recomputed on every call.
 */

import { describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'

;(globalThis as any).browser = {
  runtime: {
    sendMessage: async (message: any) => ({
      ok: true,
      data: message.type === 'review' ? review : null,
    }),
    connect: () => {
      throw new Error('no port in test')
    },
    getURL: (path: string) => path,
  },
  permissions: { request: async () => true, remove: async () => true, contains: async () => true },
  tabs: { update: async () => {}, reload: async () => {}, create: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {} } },
}

const review = {
  static: [],
  undeclaredCapabilities: [],
  passed: true,
  model: { verdict: 'match', explanation: 'It does what was asked.' },
  approvalToken: 'review-token',
}
const clean = { static: [], undeclaredCapabilities: [], passed: true }

const { Flow } = await import('./flow.svelte')

describe('the preview gate seen through reactivity (#154)', () => {
  it('becomes true in a derived value when the review returns a match', async () => {
    const flow = new Flow(() => {})
    flow.bindTab(1, 'https://www.example.com/')
    flow.draft = {
      id: 'OLD',
      name: 'Old',
      enabled: false,
      order: 5,
      match: '*.example.com/*',
      kind: 'js',
      origin: 'ai',
      capabilities: [],
      intent: 'i',
      rationale: { targets: '', approach: 'a', assumptions: [] },
      code: 'x',
      createdAt: 1,
    } as any
    flow.result = {
      name: 'n',
      kind: 'js',
      world: 'USER_SCRIPT',
      requestedWorld: 'USER_SCRIPT',
      worldReason: '',
      capabilities: [],
      rationale: { targets: '', approach: '', assumptions: [] },
      intent: 'i',
      code: 'x',
    } as any
    flow.analysis = clean as any

    let allowed: () => boolean = () => false
    const cleanup = $effect.root(() => {
      const value = $derived(flow.jsPreviewAllowed)
      allowed = () => value
    })
    flushSync()
    expect(allowed()).toBe(false)

    await flow.reviewForPreview()
    flushSync()
    expect(allowed()).toBe(true)
    cleanup()
  })

  it('becomes true in a derived value after an automatic review of a new result', async () => {
    const flow = new Flow(() => {})
    flow.bindTab(1, 'https://www.example.com/')
    flow.picked = {
      context: {
        url: 'https://www.example.com/',
        target: { selector: 'p', tag: 'p', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
        ancestors: [],
        customProperties: {},
      },
      anchor: { tag: 'p', classes: [], path: 'html>body>p', landmarks: [], selector: 'p' },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      cropClipped: false,
      cropDrawn: false,
      target: { breadcrumb: ['p'], width: 1, height: 1, drawing: false },
      tree: [],
    } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    let allowed: () => boolean = () => false
    const cleanup = $effect.root(() => {
      const value = $derived(flow.jsPreviewAllowed)
      allowed = () => value
    })
    flushSync()
    const original = (globalThis as any).browser.runtime.connect
    ;(globalThis as any).browser.runtime.connect = () => {
      const listeners: ((m: any) => void)[] = []
      const port = {
        onMessage: { addListener: (l: any) => listeners.push(l) },
        onDisconnect: { addListener: () => {} },
        postMessage: () => {
          queueMicrotask(() =>
            listeners.forEach((l) =>
              l({
                type: 'done',
                result: {
                  name: 'n',
                  kind: 'js',
                  world: 'USER_SCRIPT',
                  capabilities: [],
                  code: 'x',
                  rationale: { targets: '', approach: '', assumptions: [] },
                  intent: 'i',
                },
              }),
            ),
          )
        },
        disconnect: () => {},
      }
      return port
    }
    ;(globalThis as any).browser.runtime.sendMessage = async (message: any) => ({
      ok: true,
      data: message.type === 'review' ? review : message.type === 'analyse' ? clean : null,
    })
    try {
      await flow.generate()
      await vi.waitFor(() => expect(flow.previewReviewing).toBe(false))
      flushSync()
      expect(allowed()).toBe(true)
    } finally {
      ;(globalThis as any).browser.runtime.connect = original
      cleanup()
    }
  })
})
