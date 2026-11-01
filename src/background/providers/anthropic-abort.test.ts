/**
 * The abort signal reaches the Anthropic SDK call (#71).
 *
 * The SDK is replaced by a recorder, so these tests check what the adapter
 * passes to it and make no network call.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserMock } from '../test-support/browser-mock'
import type { Provider } from '@shared/types'

const seen: { method: string; options: unknown }[] = []
const message = { content: [{ type: 'text', text: '{"name":"n","kind":"css"}' }], stop_reason: 'end_turn' }

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      create: async (_body: unknown, options?: unknown) => {
        seen.push({ method: 'create', options })
        return message
      },
      stream: (_body: unknown, options?: unknown) => {
        seen.push({ method: 'stream', options })
        return { on: () => {}, finalMessage: async () => message }
      },
    }
    models = { retrieve: async () => ({}) }
    constructor() {}
  }
  return { default: Anthropic }
})

const provider = {
  id: 'a1',
  label: 'Anthropic',
  type: 'anthropic',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
} as unknown as Provider

const context = {
  url: 'https://example.com/',
  target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
} as any
const request = { context, instruction: 'x', history: [] }

beforeEach(async () => {
  resetBrowserMock()
  seen.length = 0
  const storage = await import('../storage')
  await storage.setCredential('a1', { kind: 'api_key', value: 'sk-x' })
})

describe('the Anthropic adapter', () => {
  it('passes the signal to the streaming call', async () => {
    const { createAnthropicProvider } = await import('./anthropic')
    const adapter = await createAnthropicProvider(provider)
    const controller = new AbortController()
    await adapter.generateStream!({ ...request, signal: controller.signal }, () => {})
    expect(seen).toEqual([{ method: 'stream', options: { signal: controller.signal } }])
  })

  it('passes the signal to the one-shot call', async () => {
    const { createAnthropicProvider } = await import('./anthropic')
    const adapter = await createAnthropicProvider(provider)
    const controller = new AbortController()
    await adapter.generate({ ...request, signal: controller.signal })
    expect(seen).toEqual([{ method: 'create', options: { signal: controller.signal } }])
  })

  it('control: a request with no signal passes no options', async () => {
    // Shows the recorder sees the second argument, so the two tests above
    // would fail if the adapter did not pass the signal.
    const { createAnthropicProvider } = await import('./anthropic')
    const adapter = await createAnthropicProvider(provider)
    await adapter.generate(request)
    expect(seen).toEqual([{ method: 'create', options: undefined }])
  })
})
