/**
 * A generation answered with a question instead of code: the schema, both
 * adapters, and the rule that a repair must produce code. The Anthropic SDK is
 * replaced by a recorder and `fetch` is replaced for the OpenAI-compatible
 * adapter, so no network call is made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserMock } from '../test-support/browser-mock'
import type { Provider } from '@shared/types'
import { toGenerationResult } from '@shared/generation-result'
import { formatGeneration } from '@shared/format-code'
import { GENERATION_SCHEMA, ProviderError, type GenerateRequest, type UsageListener } from './types'

let bodies: any[] = []
let reply: any

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      create: async (body: unknown) => {
        bodies.push(body)
        return reply
      },
      stream: (body: unknown) => {
        bodies.push(body)
        return {
          on: () => {},
          finalMessage: async () => reply,
        }
      },
    }
    models = { retrieve: async () => ({}) }
    constructor() {}
  }
  return { default: Anthropic }
})

const anthropic = { id: 'a1', label: 'Anthropic', type: 'anthropic', generateModel: 'gen-model', reviewModel: 'rev-model', supportsVision: false } as unknown as Provider
const compatible = { id: 'o1', label: 'Remote', type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', generateModel: 'g', reviewModel: 'r', supportsVision: false } as unknown as Provider

const QUESTION = { question: 'How are sponsored videos marked on this page?', wantsExample: true }
const asked = {
  name: '', kind: 'css', requestedWorld: 'USER_SCRIPT', worldReason: '', capabilities: [],
  code: '', rationale: { targets: '', approach: '', assumptions: [] }, intent: '', config: [],
  clarification: QUESTION,
}
const written = { ...asked, name: 'Hide ads', code: 'a { display: none }', intent: 'Hide ads', clarification: { question: '', wantsExample: false } }

const anthropicReply = (payload: object) => ({
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 11, output_tokens: 5 },
})
const completion = (payload: object) => ({
  choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 4 },
})

const request: GenerateRequest = {
  context: {
    url: 'https://example.com/',
    target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '<div></div>', computedStyles: {}, matchedRules: [] },
    ancestors: [],
    customProperties: {},
  } as any,
  instruction: 'hide the sponsored videos',
  history: [],
}
const repair: GenerateRequest = {
  ...request,
  repair: { intent: 'hide ads', previousCode: 'a{}', previousRationale: { targets: '', approach: '', assumptions: [] }, brokenReason: 'x' },
}

async function anthropicAdapter(listener?: UsageListener) {
  const { createAnthropicProvider } = await import('./anthropic')
  return createAnthropicProvider(anthropic, listener)
}
async function compatibleAdapter(listener?: UsageListener) {
  const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
  return createOpenAiCompatibleProvider(compatible, listener)
}
function stubFetch(payload: object) {
  ;(globalThis as any).fetch = vi.fn(async () => new Response(JSON.stringify(payload)))
}

beforeEach(async () => {
  resetBrowserMock()
  bodies = []
  const storage = await import('../storage')
  await storage.setCredential('a1', { kind: 'api_key', value: 'sk-x' })
  await storage.setCredential('o1', { kind: 'api_key', value: 'sk-o' })
})

describe('the generation schema', () => {
  it('has a required clarification object with a question and a flag, and nothing else', () => {
    const field = GENERATION_SCHEMA.properties.clarification
    expect(GENERATION_SCHEMA.required).toContain('clarification')
    expect(field.type).toBe('object')
    expect(Object.keys(field.properties)).toEqual(['question', 'wantsExample'])
    expect(field.properties.question.type).toBe('string')
    expect(field.properties.wantsExample.type).toBe('boolean')
    expect(field.required).toEqual(['question', 'wantsExample'])
    expect(field.additionalProperties).toBe(false)
  })

  it('stays within what strict structured output accepts', () => {
    // Every property is required, no object allows extra keys, and nothing uses oneOf or anyOf.
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false)
        expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort())
      }
      expect(node.oneOf).toBeUndefined()
      expect(node.anyOf).toBeUndefined()
      for (const value of Object.values(node)) walk(value)
    }
    walk(GENERATION_SCHEMA)
  })
})

describe('toGenerationResult', () => {
  it('keeps a question and discards everything else the model returned with it', () => {
    const result = toGenerationResult({ ...asked, code: 'alert(1)', kind: 'js' })
    expect(result.clarification).toEqual(QUESTION)
    expect(result.code).toBe('')
  })

  it('treats an empty question as no question', () => {
    const result = toGenerationResult(written)
    expect(result.clarification).toBeUndefined()
    expect(result.code).toBe('a { display: none }')
  })

  it('trims the question and treats a missing flag as false', () => {
    const result = toGenerationResult({ ...asked, clarification: { question: '  Which one?  ' } })
    expect(result.clarification).toEqual({ question: 'Which one?', wantsExample: false })
  })

  it('leaves empty code alone when the formatter runs', () => {
    expect(formatGeneration(toGenerationResult(asked)).code).toBe('')
  })
})

describe('the Anthropic adapter', () => {
  it('sends the schema and returns a question from generate', async () => {
    reply = anthropicReply(asked)
    const result = await (await anthropicAdapter()).generate(request)
    expect(result.clarification).toEqual(QUESTION)
    expect(result.code).toBe('')
    expect(bodies[0].output_config.format.schema.required).toContain('clarification')
  })

  it('returns a question from generateStream and still reports usage', async () => {
    reply = anthropicReply(asked)
    const calls: unknown[] = []
    const adapter = await anthropicAdapter((call) => calls.push(call))
    const result = await adapter.generateStream!(request, () => {})
    expect(result.clarification).toEqual(QUESTION)
    expect(calls).toEqual([{ model: 'gen-model', usage: { inputTokens: 11, outputTokens: 5 } }])
  })

  it('returns code with no clarification when the question is empty', async () => {
    reply = anthropicReply(written)
    const result = await (await anthropicAdapter()).generate(request)
    expect(result.clarification).toBeUndefined()
    expect(result.code).toBe('a { display: none }')
  })

  it('refuses a question as the answer to a repair', async () => {
    reply = anthropicReply(asked)
    const adapter = await anthropicAdapter()
    for (const call of [() => adapter.generate(repair), () => adapter.generateStream!(repair, () => {})]) {
      const error = await call().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).kind).toBe('bad-response')
    }
  })
})

describe('the OpenAI-compatible adapter', () => {
  it('sends the schema and returns a question from generate', async () => {
    stubFetch(completion(asked))
    const result = await (await compatibleAdapter()).generate(request)
    expect(result.clarification).toEqual(QUESTION)
    expect(result.code).toBe('')
    const body = JSON.parse(((globalThis as any).fetch as any).mock.calls[0][1].body)
    expect(body.response_format.json_schema.schema.required).toContain('clarification')
  })

  it('refuses a question as the answer to a repair', async () => {
    stubFetch(completion(asked))
    const error = await (await compatibleAdapter()).generate(repair).catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('bad-response')
  })
})
