/**
 * The Anthropic adapter does not let the model choose the world (#53).
 *
 * The SDK is replaced by a recorder that answers with a fixed message, so no
 * network call is made. Both the one-shot path (generate) and the streaming
 * path (generateStream) are covered, each with a control whose response has a
 * request for USER_SCRIPT, so a pass cannot be explained by the stub ignoring
 * its input.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserMock } from '../test-support/browser-mock'
import type { Provider } from '@shared/types'

let answer: object = {}
const reply = () => ({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' })

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      create: async () => reply(),
      stream: () => ({ on: () => {}, finalMessage: async () => reply() }),
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

const base = {
  name: 'n',
  kind: 'js',
  capabilities: [],
  code: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  intent: 'i',
}
const request = {
  context: {
    url: 'https://example.com/',
    target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
    ancestors: [],
    customProperties: {},
  },
  instruction: 'x',
  history: [],
} as any

async function adapter() {
  const { createAnthropicProvider } = await import('./anthropic')
  return createAnthropicProvider(provider)
}

beforeEach(async () => {
  resetBrowserMock()
  const storage = await import('../storage')
  await storage.setCredential('a1', { kind: 'api_key', value: 'sk-x' })
})

describe('generate', () => {
  it('ignores a world field the model sets itself', async () => {
    answer = { ...base, world: 'MAIN' }
    const result = await (await adapter()).generate(request)
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('USER_SCRIPT')
  })

  it('keeps a request for MAIN as a request and leaves the world isolated', async () => {
    answer = { ...base, requestedWorld: 'MAIN', worldReason: 'Needs window.appState.' }
    const result = await (await adapter()).generate(request)
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('MAIN')
    expect(result.worldReason).toBe('Needs window.appState.')
  })

  it('control: a request for USER_SCRIPT is reported as no request', async () => {
    answer = { ...base, requestedWorld: 'USER_SCRIPT', worldReason: '' }
    const result = await (await adapter()).generate(request)
    expect(result.requestedWorld).toBe('USER_SCRIPT')
  })
})

describe('generateStream', () => {
  it('ignores a world field the model sets itself', async () => {
    answer = { ...base, world: 'MAIN' }
    const result = await (await adapter()).generateStream!(request, () => {})
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('USER_SCRIPT')
  })

  it('keeps a request for MAIN as a request and leaves the world isolated', async () => {
    answer = { ...base, requestedWorld: 'MAIN', worldReason: 'Needs window.appState.' }
    const result = await (await adapter()).generateStream!(request, () => {})
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('MAIN')
  })

  it('control: a request for USER_SCRIPT is reported as no request', async () => {
    answer = { ...base, requestedWorld: 'USER_SCRIPT', worldReason: '' }
    const result = await (await adapter()).generateStream!(request, () => {})
    expect(result.requestedWorld).toBe('USER_SCRIPT')
  })
})
