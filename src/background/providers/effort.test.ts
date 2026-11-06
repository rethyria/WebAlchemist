/**
 * The reasoning effort setting of a provider, as it reaches the request of
 * each adapter. The Anthropic SDK is replaced by a recorder and `fetch` is
 * replaced for the OpenAI-compatible adapter, so no network call is made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBrowserMock } from '../test-support/browser-mock'
import type { Provider } from '@shared/types'
import { askEffortFor, type EffortChoice } from '@shared/effort'
import type { AskRequest } from './types'

let bodies: any[] = []
let answer: object = {}
const reply = () => ({
  content: [{ type: 'text', text: JSON.stringify(answer) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
})

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = {
      create: async (body: unknown) => {
        bodies.push(body)
        return reply()
      },
      stream: (body: unknown) => {
        bodies.push(body)
        return { on: () => {}, finalMessage: async () => reply() }
      },
    }
    models = { retrieve: async () => ({}) }
    constructor() {}
  }
  return { default: Anthropic }
})

const withEffort = (type: Provider['type'], brew?: EffortChoice, review?: EffortChoice) =>
  ({
    id: type === 'anthropic' ? 'a1' : 'o1',
    label: 'P',
    type,
    ...(type === 'anthropic' ? {} : { baseUrl: 'https://api.example.com/v1' }),
    generateModel: 'g',
    reviewModel: 'r',
    supportsVision: false,
    ...(brew ? { brewEffort: brew } : {}),
    ...(review ? { reviewEffort: review } : {}),
  }) as unknown as Provider

const context = {
  url: 'https://example.com/',
  target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
}
const generateRequest = { context, instruction: 'x', history: [] } as any
const repairRequest = {
  context,
  instruction: 'x',
  history: [],
  repair: { intent: 'i', previousCode: 'c', previousRationale: { targets: '', approach: '', assumptions: [] }, brokenReason: 'gone' },
} as any
const askRequest = {
  context,
  instruction: 'x',
  history: [],
  draft: { code: 'c', rationale: { targets: '', approach: '', assumptions: [] } },
  exchanges: [],
  question: 'Why?',
} as unknown as AskRequest

const generation = {
  name: 'n',
  kind: 'css',
  capabilities: [],
  code: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  intent: 'i',
}
const review = { verdict: 'pass', summary: 's', concerns: [] }

async function anthropic(provider: Provider) {
  const { createAnthropicProvider } = await import('./anthropic')
  return createAnthropicProvider(provider)
}
async function compatible(provider: Provider) {
  const { createOpenAiCompatibleProvider } = await import('./openai-compatible')
  return createOpenAiCompatibleProvider(provider)
}

const completion = (content: object) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }))

function stubFetch(responses: (() => Response)[]) {
  const sent: any[] = []
  let at = 0
  ;(globalThis as any).fetch = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    const make = responses[Math.min(at, responses.length - 1)] as () => Response
    at += 1
    return make()
  })
  return sent
}

beforeEach(async () => {
  resetBrowserMock()
  bodies = []
  answer = generation
  const storage = await import('../storage')
  await storage.setCredential('a1', { kind: 'api_key', value: 'sk-x' })
  await storage.setCredential('o1', { kind: 'api_key', value: 'sk-o' })
})

const CHOICES: { choice: EffortChoice; sent: string | undefined; side: string | undefined }[] = [
  { choice: 'low', sent: 'low', side: 'low' },
  { choice: 'medium', sent: 'medium', side: 'low' },
  { choice: 'high', sent: 'high', side: 'medium' },
  { choice: 'default', sent: undefined, side: undefined },
]

describe('the side-question effort', () => {
  it.each(CHOICES)('is $side one level below brewing at $choice', ({ choice, side }) => {
    expect(askEffortFor(choice)).toBe(side ?? 'default')
  })
})

describe('the Anthropic adapter', () => {
  describe.each(CHOICES)('with brewing $choice and the code check $choice', ({ choice, sent, side }) => {
    const adapter = () => anthropic(withEffort('anthropic', choice, choice))
    const effort = () => bodies[0].output_config.effort

    it('puts the level in output_config for a generation', async () => {
      await (await adapter()).generate(generateRequest)
      expect(effort()).toBe(sent)
      expect('effort' in bodies[0].output_config).toBe(sent !== undefined)
      expect(bodies[0].output_config.format.type).toBe('json_schema')
    })

    it('puts the level in output_config for a streamed generation', async () => {
      await (await adapter()).generateStream!(generateRequest, () => {})
      expect(effort()).toBe(sent)
    })

    it('puts the level in output_config for a repair', async () => {
      await (await adapter()).generate(repairRequest)
      expect(effort()).toBe(sent)
    })

    it('puts one level lower in output_config for a side question', async () => {
      answer = { answer: 'a' }
      await (await adapter()).ask(askRequest)
      expect(effort()).toBe(side)
      expect('effort' in bodies[0].output_config).toBe(side !== undefined)
    })

    it('puts the level in output_config for the code check', async () => {
      answer = review
      await (await adapter()).review({ code: 'x', intent: 'y' })
      expect(effort()).toBe(sent)
    })
  })

  it('uses the code check level for the check and the brewing level for the rest', async () => {
    const adapter = await anthropic(withEffort('anthropic', 'low', 'high'))
    await adapter.generate(generateRequest)
    answer = review
    await adapter.review({ code: 'x', intent: 'y' })
    expect(bodies.map((b) => b.output_config.effort)).toEqual(['low', 'high'])
  })

  it('treats a provider stored without the fields as brewing high and checking high', async () => {
    const adapter = await anthropic(withEffort('anthropic'))
    await adapter.generate(generateRequest)
    answer = { answer: 'a' }
    await adapter.ask(askRequest)
    answer = review
    await adapter.review({ code: 'x', intent: 'y' })
    expect(bodies.map((b) => b.output_config.effort)).toEqual(['high', 'medium', 'high'])
  })
})

describe('the OpenAI-compatible adapter', () => {
  describe.each(CHOICES)('with brewing $choice and the code check $choice', ({ choice, sent, side }) => {
    const adapter = () => compatible(withEffort('openai-compatible', choice, choice))

    it('sends reasoning_effort for a generation and a repair', async () => {
      const bodiesSent = stubFetch([() => completion(generation)])
      const a = await adapter()
      await a.generate(generateRequest)
      await a.generate(repairRequest)
      expect(bodiesSent.map((b) => b.reasoning_effort)).toEqual([sent, sent])
      expect(bodiesSent.every((b) => ('reasoning_effort' in b) === (sent !== undefined))).toBe(true)
    })

    it('sends one level lower for a side question', async () => {
      const bodiesSent = stubFetch([() => completion({ answer: 'a' })])
      await (await adapter()).ask(askRequest)
      expect(bodiesSent[0].reasoning_effort).toBe(side)
      expect('reasoning_effort' in bodiesSent[0]).toBe(side !== undefined)
    })

    it('sends the code check level for the code check', async () => {
      const bodiesSent = stubFetch([() => completion(review)])
      await (await adapter()).review({ code: 'x', intent: 'y' })
      expect(bodiesSent[0].reasoning_effort).toBe(sent)
    })
  })

  it('sends nothing for a provider stored without the fields', async () => {
    const bodiesSent = stubFetch([() => completion(review)])
    await (await compatible(withEffort('openai-compatible'))).review({ code: 'x', intent: 'y' })
    expect('reasoning_effort' in bodiesSent[0]).toBe(false)
  })

  describe('when the endpoint rejects reasoning_effort', () => {
    const rejection = (message: string) => () =>
      new Response(JSON.stringify({ error: { message } }), { status: 400 })

    it('sends the request once more without it', async () => {
      const sent = stubFetch([rejection("Unrecognized request argument supplied: reasoning_effort"), () => completion(review)])
      const result = await (await compatible(withEffort('openai-compatible', 'high', 'high'))).review({ code: 'x', intent: 'y' })
      expect(result).toEqual(review)
      expect(sent).toHaveLength(2)
      expect(sent[0].reasoning_effort).toBe('high')
      expect('reasoning_effort' in sent[1]).toBe(false)
      expect(sent[1].model).toBe(sent[0].model)
      expect(sent[1].messages).toEqual(sent[0].messages)
    })

    it('does not retry a 400 that does not name the field', async () => {
      const sent = stubFetch([rejection('max_tokens is too large')])
      const error = await (await compatible(withEffort('openai-compatible', 'high', 'high')))
        .review({ code: 'x', intent: 'y' })
        .catch((e: unknown) => e)
      expect((error as Error).message).toMatch(/400/)
      expect(sent).toHaveLength(1)
    })

    it('retries only once when the second request is rejected too', async () => {
      const sent = stubFetch([rejection('bad reasoning_effort')])
      await (await compatible(withEffort('openai-compatible', 'high', 'high')))
        .review({ code: 'x', intent: 'y' })
        .catch(() => undefined)
      expect(sent).toHaveLength(2)
    })

    it('does not retry when no level was sent', async () => {
      const sent = stubFetch([rejection('bad reasoning_effort')])
      await (await compatible(withEffort('openai-compatible', 'default', 'default')))
        .review({ code: 'x', intent: 'y' })
        .catch(() => undefined)
      expect(sent).toHaveLength(1)
    })
  })
})
