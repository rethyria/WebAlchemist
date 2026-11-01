/**
 * Usage of a generation that is aborted after the request was sent (#71).
 *
 * The Anthropic SDK is replaced by a stream that throws from finalMessage(),
 * as an aborted stream does, and `fetch` is replaced for the OpenAI-compatible
 * adapter. No network call is made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserMock } from '../test-support/browser-mock'
import type { Provider } from '@shared/types'
import type { UsageListener } from './types'

let partial: unknown
let failure: Error | undefined

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      stream: () => ({
        on: () => {},
        get currentMessage() {
          return partial
        },
        finalMessage: async () => {
          if (failure) throw failure
          return { content: [{ type: 'text', text: '{"name":"n","kind":"css"}' }], stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 9 } }
        },
      }),
    }
    models = { retrieve: async () => ({}) }
    constructor() {}
  }
  return { default: Anthropic }
})

const anthropic = { id: 'a1', label: 'Anthropic', type: 'anthropic', generateModel: 'm', reviewModel: 'm', supportsVision: false } as unknown as Provider
const compatible = { id: 'o1', label: 'Remote', type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', generateModel: 'g', reviewModel: 'g', supportsVision: false } as unknown as Provider
const context = {
  url: 'https://example.com/',
  target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
} as any
const request = { context, instruction: 'x', history: [] }

function collect() {
  const calls: Parameters<UsageListener>[0][] = []
  return { calls, listener: ((call) => calls.push(call)) as UsageListener }
}

beforeEach(async () => {
  resetBrowserMock()
  partial = undefined
  failure = undefined
  const storage = await import('../storage')
  await storage.setCredential('a1', { kind: 'api_key', value: 'sk-x' })
  await storage.setCredential('o1', { kind: 'api_key', value: 'sk-o' })
})

describe('an aborted Anthropic stream', () => {
  it('reports the tokens counted before the abort', async () => {
    failure = new Error('aborted')
    partial = { usage: { input_tokens: 40, output_tokens: 3 } }
    const { createAnthropicProvider } = await import('./anthropic')
    const { calls, listener } = collect()
    const adapter = await createAnthropicProvider(anthropic, listener)
    await expect(adapter.generateStream!(request, () => {})).rejects.toBeTruthy()
    expect(calls).toEqual([{ model: 'm', usage: { inputTokens: 40, outputTokens: 3 } }])
  })

  it('reports nothing when the abort came before any message event', async () => {
    failure = new Error('aborted')
    const { createAnthropicProvider } = await import('./anthropic')
    const { calls, listener } = collect()
    const adapter = await createAnthropicProvider(anthropic, listener)
    await expect(adapter.generateStream!(request, () => {})).rejects.toBeTruthy()
    expect(calls).toEqual([])
  })

  it('control: a stream that completes is reported once', async () => {
    const { createAnthropicProvider } = await import('./anthropic')
    const { calls, listener } = collect()
    const adapter = await createAnthropicProvider(anthropic, listener)
    await adapter.generateStream!(request, () => {})
    expect(calls).toEqual([{ model: 'm', usage: { inputTokens: 7, outputTokens: 9 } }])
  })
})

describe('an aborted OpenAI-compatible request', () => {
  it('records unknown usage when the abort ends the request after it was sent', async () => {
    const controller = new AbortController()
    ;(globalThis as any).fetch = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
    const { calls, listener } = collect()
    const adapter = await createOpenAiCompatibleProvider(compatible, listener)
    await expect(adapter.generate({ ...request, signal: controller.signal })).rejects.toBeTruthy()
    expect(calls).toEqual([{ model: 'g', usage: null }])
  })

  it('records unknown usage when the abort comes while the body is being read', async () => {
    const controller = new AbortController()
    ;(globalThis as any).fetch = vi.fn(async () => {
      const response = new Response('{}')
      response.json = async () => {
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      }
      return response
    })
    const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
    const { calls, listener } = collect()
    const adapter = await createOpenAiCompatibleProvider(compatible, listener)
    await expect(adapter.generate({ ...request, signal: controller.signal })).rejects.toBeTruthy()
    expect(calls).toEqual([{ model: 'g', usage: null }])
  })

  it('control: a network failure with no abort records nothing', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => {
      throw new TypeError('failed to fetch')
    })
    const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
    const { calls, listener } = collect()
    const adapter = await createOpenAiCompatibleProvider(compatible, listener)
    await expect(adapter.generate({ ...request, signal: new AbortController().signal })).rejects.toBeTruthy()
    expect(calls).toEqual([])
  })
})
