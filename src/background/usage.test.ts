/**
 * Token usage and cost: reading it from both adapters, recording it, and
 * pricing it. Runs the real adapters, storage and recorder against the
 * in-memory browser mock with `fetch` replaced; no network call and no paid
 * model call is made. Response bodies follow the providers' documented shapes.
 */

import { resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { ANTHROPIC_MODELS, type Provider, type UsageReport } from '@shared/types'
import { costOf, describeUsage, listedPrice, monthOf, readUsage } from '@shared/usage'
import * as storage from './storage'
import { createAnthropicProvider } from './providers/anthropic'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible'
import { createProvider } from './providers'
import { createUsageRecorder } from './usage'
import { ProviderError, type UsageListener } from './providers/types'

const REVIEW = { code: 'x', intent: 'y' }
const VERDICT = '{"verdict":"match","explanation":""}'

const anthropic = {
  id: 'a1',
  label: 'Claude',
  type: 'anthropic',
  generateModel: 'claude-sonnet-5',
  reviewModel: 'claude-haiku-4-5',
  supportsVision: true,
} as Provider

const compatible = {
  id: 'o1',
  label: 'Local',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'local-model',
  reviewModel: 'local-model',
  supportsVision: false,
} as Provider

function respondJson(body: unknown, status = 200) {
  ;(globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const anthropicBody = (over: Record<string, unknown> = {}) => ({
  id: 'm',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: VERDICT }],
  usage: { input_tokens: 120, output_tokens: 30 },
  ...over,
})

const openAiBody = (over: Record<string, unknown> = {}) => ({
  choices: [{ message: { content: VERDICT } }],
  usage: { prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
  ...over,
})

function collect() {
  const calls: Parameters<UsageListener>[0][] = []
  return { calls, listener: ((call) => calls.push(call)) as UsageListener }
}

beforeEach(async () => {
  resetBrowserMock()
  await storage.saveCredentialFor(anthropic, { kind: 'api_key', value: 'sk-a' })
  await storage.saveCredentialFor(compatible, { kind: 'api_key', value: 'sk-o' })
})

describe('reading usage from a response', () => {
  it('reads Anthropic input_tokens and output_tokens from a review call, for the review model', async () => {
    respondJson(anthropicBody())
    const { calls, listener } = collect()
    await (await createAnthropicProvider(anthropic, listener)).review(REVIEW)
    expect(calls).toEqual([
      { model: 'claude-haiku-4-5', usage: { inputTokens: 120, outputTokens: 30 } },
    ])
  })

  it('reads prompt_tokens and completion_tokens from an OpenAI-compatible response', async () => {
    respondJson(openAiBody())
    const { calls, listener } = collect()
    await (await createOpenAiCompatibleProvider(compatible, listener)).review(REVIEW)
    expect(calls).toEqual([
      { model: 'local-model', usage: { inputTokens: 200, outputTokens: 50 } },
    ])
  })

  // Control for the two tests above: the same calls with no usage block must
  // report null, not zero, which is what the panel shows as "not reported".
  it('reports null when the response has no usage block, in both adapters', async () => {
    const a = collect()
    respondJson(anthropicBody({ usage: undefined }))
    await (await createAnthropicProvider(anthropic, a.listener)).review(REVIEW)
    expect(a.calls[0]?.usage).toBeNull()

    const o = collect()
    respondJson(openAiBody({ usage: undefined }))
    await (await createOpenAiCompatibleProvider(compatible, o.listener)).review(REVIEW)
    expect(o.calls[0]?.usage).toBeNull()
  })

  it('reports null when only one count is present or a count is not a number', () => {
    const fields = { input: 'prompt_tokens', output: 'completion_tokens' }
    expect(readUsage({ prompt_tokens: 5 }, fields)).toBeNull()
    expect(readUsage({ prompt_tokens: 5, completion_tokens: '7' }, fields)).toBeNull()
    expect(readUsage({ prompt_tokens: -1, completion_tokens: 7 }, fields)).toBeNull()
    expect(readUsage({ prompt_tokens: 0, completion_tokens: 0 }, fields)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    })
  })

  it('still reports a response that is then rejected, because it was billed', async () => {
    respondJson(anthropicBody({ stop_reason: 'refusal', content: [] }))
    const a = collect()
    const error = await (await createAnthropicProvider(anthropic, a.listener))
      .review(REVIEW)
      .catch((e: unknown) => e)
    expect((error as ProviderError).kind).toBe('refusal')
    expect(a.calls).toHaveLength(1)

    respondJson(openAiBody({ choices: [{ message: { content: 'not json' } }] }))
    const o = collect()
    const error2 = await (await createOpenAiCompatibleProvider(compatible, o.listener))
      .review(REVIEW)
      .catch((e: unknown) => e)
    expect((error2 as ProviderError).kind).toBe('bad-response')
    expect(o.calls).toHaveLength(1)
  })

  // Control: an HTTP error ran no inference, so nothing is reported.
  it('does not report a call that failed with an HTTP error', async () => {
    respondJson({ error: { message: 'Not Found' } }, 404)
    const o = collect()
    await (await createOpenAiCompatibleProvider(compatible, o.listener))
      .review(REVIEW)
      .catch(() => undefined)
    expect(o.calls).toEqual([])
  })

  it('reads usage from a streamed Anthropic response', async () => {
    const events = [
      ['message_start', { type: 'message_start', message: { ...anthropicBody({ content: [] }), usage: { input_tokens: 300, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"name":"n"}' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 77 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
    const sse = events.map(([name, data]) => `event: ${String(name)}\ndata: ${JSON.stringify(data)}\n\n`).join('')
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const { calls, listener } = collect()
    const adapter = await createAnthropicProvider(anthropic, listener)
    await adapter
      .generateStream!({ context: { url: 'u', ancestors: [], customProperties: {}, target: { selector: 's', tag: 'p', computedStyles: {}, matchedRules: [], outerHTMLExcerpt: '' } } as never, instruction: 'i', history: [] }, () => {})
      .catch(() => undefined)
    expect(calls).toEqual([
      { model: 'claude-sonnet-5', usage: { inputTokens: 300, outputTokens: 77 } },
    ])
  })
})

describe('pricing', () => {
  it('has a parsable price for every listed Anthropic model', () => {
    for (const model of ANTHROPIC_MODELS) {
      expect(listedPrice(model.id), model.id).not.toBeNull()
    }
    // Sonnet 5 is $2 / $10; it was listed at $3 / $15 until #152.
    expect(listedPrice('claude-sonnet-5')).toEqual({ input: 2, output: 10 })
    expect(listedPrice('claude-opus-5-5')).toEqual({ input: 4, output: 20 })
    expect(listedPrice('typed-by-hand')).toBeNull()
  })

  it('computes cost per million tokens', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 2_000_000 }, { input: 3, output: 15 })).toBe(33)
  })

  it('prices Anthropic from the list, and an OpenAI-compatible provider only from its own price', async () => {
    const a = createUsageRecorder()
    a.listener({ model: 'claude-haiku-4-5', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }, anthropic)
    expect((await a.settled())?.costUsd).toBe(6)

    // The control: the same tokens without a price give no cost, not zero.
    const o = createUsageRecorder()
    o.listener({ model: 'local-model', usage: { inputTokens: 1_000_000, outputTokens: 0 } }, compatible)
    expect((await o.settled())?.costUsd).toBeNull()

    const priced = createUsageRecorder()
    priced.listener(
      { model: 'local-model', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      { ...compatible, price: { input: 0.5, output: 1 } },
    )
    expect((await priced.settled())?.costUsd).toBe(0.5)
  })

  it('shows "not reported" for a call without usage and tokens for one with', () => {
    expect(describeUsage({ usage: null, costUsd: null })).toBe('Token usage: not reported')
    expect(describeUsage({ usage: { inputTokens: 1200, outputTokens: 30 }, costUsd: null })).toBe(
      '1,200 tokens in, 30 out',
    )
    expect(describeUsage({ usage: { inputTokens: 0, outputTokens: 0 }, costUsd: null })).toContain('0 tokens in')
  })
})

describe('recorded totals', () => {
  const at = Date.UTC(2026, 10, 15)

  it('makes a month total equal to the sum of the recorded calls', async () => {
    const calls = [
      { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.001 },
      { usage: { inputTokens: 250, outputTokens: 40 }, costUsd: 0.002 },
      { usage: { inputTokens: 5, outputTokens: 1 }, costUsd: 0.0005 },
    ]
    for (const call of calls) await storage.recordUsage({ providerId: 'a1', ...call, at })

    const total = (await storage.getUsage()).months['2026-11']?.['a1']
    expect(total).toMatchObject({ calls: 3, reportedCalls: 3, inputTokens: 355, outputTokens: 51, pricedCalls: 3 })
    expect(total?.costUsd).toBeCloseTo(0.0035, 10)
  })

  it('keeps providers, months and transforms apart', async () => {
    await storage.recordUsage({ providerId: 'a1', transformId: 't1', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: null, at })
    await storage.recordUsage({ providerId: 'o1', transformId: 't1', usage: { inputTokens: 2, outputTokens: 2 }, costUsd: null, at })
    await storage.recordUsage({ providerId: 'a1', transformId: 't2', usage: { inputTokens: 4, outputTokens: 4 }, costUsd: null, at: Date.UTC(2026, 11, 1) })

    const store = await storage.getUsage()
    expect(store.months['2026-11']?.['a1']?.inputTokens).toBe(1)
    expect(store.months['2026-11']?.['o1']?.inputTokens).toBe(2)
    expect(store.months['2026-12']?.['a1']?.inputTokens).toBe(4)
    expect(store.transforms['t1']).toMatchObject({ calls: 2, inputTokens: 3 })
    expect(store.transforms['t2']).toMatchObject({ calls: 1, inputTokens: 4 })
    expect(monthOf(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })

  it('counts a call with no usage as a call but adds no tokens', async () => {
    await storage.recordUsage({ providerId: 'o1', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: null, at })
    await storage.recordUsage({ providerId: 'o1', usage: null, costUsd: null, at })
    expect((await storage.getUsage()).months['2026-11']?.['o1']).toMatchObject({
      calls: 2,
      reportedCalls: 1,
      inputTokens: 10,
    })
  })

  // Control for the queue: recordings started together would read the same
  // starting store and lose additions without it (the mock delays every read).
  it('loses no call when recordings overlap', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.recordUsage({ providerId: 'a1', transformId: 't', usage: { inputTokens: 1, outputTokens: 2 }, costUsd: null, at }),
      ),
    )
    const store = await storage.getUsage()
    expect(store.months['2026-11']?.['a1']).toMatchObject({ calls: 20, inputTokens: 20, outputTokens: 40 })
    expect(store.transforms['t']?.calls).toBe(20)
  })
})

describe('the whole path from adapter to totals', () => {
  it('records a call made through the active provider and returns it for the panel', async () => {
    const settings = await storage.getSettings()
    await storage.saveSettings({ ...settings, providers: [compatible], activeProviderId: compatible.id })
    const recorder = createUsageRecorder('t9')
    respondJson(openAiBody())
    const adapter = await createProvider(compatible, (call) => recorder.listener(call, compatible))
    await adapter.review(REVIEW)

    const report = (await recorder.settled()) as UsageReport
    expect(report.usage).toEqual({ inputTokens: 200, outputTokens: 50 })
    expect(Object.values((await storage.getUsage()).transforms)[0]).toMatchObject({ calls: 1, inputTokens: 200 })

    // A response without usage reaches the panel as null and is still counted.
    const second = createUsageRecorder('t9')
    respondJson(openAiBody({ usage: undefined }))
    await (await createProvider(compatible, (call) => second.listener(call, compatible))).review(REVIEW)
    expect((await second.settled())?.usage).toBeNull()
    expect((await storage.getUsage()).transforms['t9']).toMatchObject({ calls: 2, reportedCalls: 1 })
  })

  it('refuses a stored price that is not a pair of non-negative numbers', async () => {
    const settings = await storage.getSettings()
    await expect(
      storage.saveSettings({ ...settings, providers: [{ ...compatible, price: { input: -1, output: 1 } }] }),
    ).rejects.toThrow(/price/)
  })
})
