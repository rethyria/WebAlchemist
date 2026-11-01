/**
 * Unknown-model and billing responses become their own error kinds, in both
 * adapters. Runs the real adapters with `fetch` replaced; no network call and
 * no paid model call is made. The response shapes are the ones the providers'
 * documentation describes, not recordings, so they show that the mapping works
 * for those shapes and not that a live provider sends exactly these.
 */

import { resetBrowserMock } from '../test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from '../storage'
import { createAnthropicProvider } from './anthropic'
import { createOpenAiCompatibleProvider } from './openai-compatible'
import { ProviderError } from './types'

const REVIEW = { code: 'x', intent: 'y' }

const anthropic = {
  id: 'a1',
  label: 'Claude',
  type: 'anthropic',
  generateModel: 'claude-opus-5',
  reviewModel: 'claude-opus-4-6',
  supportsVision: true,
} as Provider

const compatible = {
  id: 'o1',
  label: 'Local',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'gone-model',
  reviewModel: 'gone-model',
  supportsVision: false,
} as Provider

function respond(status: number, body: unknown) {
  ;(globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

async function failure(run: () => Promise<unknown>): Promise<ProviderError> {
  const error = await run().then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ProviderError)
  return error as ProviderError
}

beforeEach(async () => {
  resetBrowserMock()
  await storage.saveCredentialFor(anthropic, { kind: 'api_key', value: 'sk-a' })
  await storage.saveCredentialFor(compatible, { kind: 'api_key', value: 'sk-o' })
})

describe('Anthropic adapter', () => {
  const run = async () => (await createAnthropicProvider(anthropic)).review(REVIEW)

  it('maps 404 not_found_error naming the model to model-unavailable, with the model named', async () => {
    respond(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-opus-4-6' } })
    const error = await failure(run)
    expect(error.kind).toBe('model-unavailable')
    // The review call uses the review model, not the generate model.
    expect(error.message).toContain('Opus 4.6 (claude-opus-4-6)')
    expect(error.message).toContain('Choose another model in settings')
    expect(error.retryable).toBe(false)
  })

  it('maps a 404 saying the model does not exist or is not accessible to model-not-permitted, not a retired model', async () => {
    respond(404, {
      type: 'error',
      error: {
        type: 'not_found_error',
        message: 'The model `claude-opus-4-6` does not exist or you do not have access to it.',
      },
    })
    const error = await failure(run)
    expect(error.kind).toBe('model-not-permitted')
    expect(error.message).toContain('Opus 4.6 (claude-opus-4-6)')
    expect(error.message).toContain('not available to this account')
    expect(error.message).toContain('account')
    expect(error.message).not.toContain('Choose another model in settings.')
    expect(error.retryable).toBe(false)
  })

  it('maps a billing_error and the 400 low-balance wording to billing', async () => {
    respond(402, { type: 'error', error: { type: 'billing_error', message: 'Billing problem' } })
    expect((await failure(run)).kind).toBe('billing')

    respond(400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
    })
    expect((await failure(run)).kind).toBe('billing')
  })

  // Controls: the same statuses without the model or billing signal keep the
  // generic kind, so the mapping is not simply "any 404" or "any 400".
  it('keeps a 404 that does not name a model, and an ordinary 400, as unknown', async () => {
    respond(404, { type: 'error', error: { type: 'not_found_error', message: 'Not Found' } })
    expect((await failure(run)).kind).toBe('unknown')

    respond(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } })
    expect((await failure(run)).kind).toBe('unknown')
  })

  it('does not raise either kind for a normal response', async () => {
    respond(200, {
      id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"verdict":"match","explanation":""}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    await expect(run()).resolves.toMatchObject({ verdict: 'match' })
  })
})

describe('OpenAI-compatible adapter', () => {
  const run = async () => (await createOpenAiCompatibleProvider(compatible)).review(REVIEW)

  it('maps 404 with model_not_found, or model wording, to model-unavailable naming the model', async () => {
    respond(404, { error: { message: 'The model `gone-model` does not exist', code: 'model_not_found' } })
    const error = await failure(run)
    expect(error.kind).toBe('model-unavailable')
    expect(error.message).toContain('gone-model')

    respond(404, { error: "model 'gone-model' not found" })
    expect((await failure(run)).kind).toBe('model-unavailable')

    respond(404, { error: { message: 'No endpoints found for gone-model.' } })
    expect((await failure(run)).kind).toBe('model-unavailable')
  })

  it('maps the wording that the model does not exist or is not accessible to model-not-permitted, also with model_not_found', async () => {
    respond(404, {
      error: {
        message: 'The model `gone-model` does not exist or you do not have access to it.',
        code: 'model_not_found',
      },
    })
    const error = await failure(run)
    expect(error.kind).toBe('model-not-permitted')
    expect(error.message).toContain('gone-model')
    expect(error.message).toContain('not available to this account')
    expect(error.message).toContain('Local')
    expect(error.retryable).toBe(false)
  })

  it('maps the OpenRouter data policy 404 to model-not-permitted', async () => {
    respond(404, { error: { message: 'No endpoints found matching your data policy (Free model publication).' } })
    expect((await failure(run)).kind).toBe('model-not-permitted')
  })

  // Control: the retired-model wordings above still give model-unavailable, and
  // the same permission wording on another status is not a model error.
  it('keeps the retired-model message for the other 404 wordings', async () => {
    respond(404, { error: { message: 'No endpoints found for gone-model.' } })
    const error = await failure(run)
    expect(error.kind).toBe('model-unavailable')
    expect(error.message).toContain('Choose another model in settings.')

    respond(403, { error: { message: 'The model `x` does not exist or you do not have access to it.' } })
    expect((await failure(run)).kind).toBe('auth')
  })

  it('maps 402 and a 429 with insufficient_quota to billing, not rate-limit', async () => {
    respond(402, { error: { message: 'Insufficient credits' } })
    expect((await failure(run)).kind).toBe('billing')

    respond(429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } })
    expect((await failure(run)).kind).toBe('billing')
  })

  // Controls.
  it('keeps a 404 with no model wording, a plain 429 and a 404 with no body as before', async () => {
    respond(404, { error: { message: 'Not Found' } })
    expect((await failure(run)).kind).toBe('unknown')

    respond(404, '')
    expect((await failure(run)).kind).toBe('unknown')

    respond(429, { error: { message: 'Too many requests', code: 'rate_limit_exceeded' } })
    expect((await failure(run)).kind).toBe('rate-limit')
  })

  it('does not raise either kind for a normal response', async () => {
    respond(200, { choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }] })
    await expect(run()).resolves.toMatchObject({ verdict: 'match' })
  })
})
