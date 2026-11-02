/**
 * The model can ask for the MAIN world and cannot get it (issue 53).
 *
 * `fetch` is replaced, so no model call is made. Each assertion on the adapter
 * has a control with the same response where the field is absent, so a pass
 * cannot be explained by the stub returning something else.
 */

import { resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toGenerationResult } from '@shared/generation-result'
import type { Provider } from '@shared/types'
import { MAIN_WORLD_RISKS, worldState } from '@shared/world'
import * as storage from './storage'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible'
import { GENERATION_SCHEMA } from './providers/types'
import { GENERATE_SYSTEM_PROMPT } from './prompts'

const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
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

function answerWith(output: object) {
  ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), {
        status: 200,
      }),
  )
}

beforeEach(() => resetBrowserMock())

describe('a generation that asks for MAIN', () => {
  it('keeps the request and its reason and leaves the world isolated', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    answerWith({ ...base, requestedWorld: 'MAIN', worldReason: ' Needs window.appState. ' })
    const adapter = await createOpenAiCompatibleProvider(provider)
    const result = await adapter.generate(request)
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('MAIN')
    expect(result.worldReason).toBe('Needs window.appState.')
  })

  it('ignores a world field the model sets itself', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    answerWith({ ...base, world: 'MAIN' })
    const adapter = await createOpenAiCompatibleProvider(provider)
    const result = await adapter.generate(request)
    expect(result.world).toBe('USER_SCRIPT')
    expect(result.requestedWorld).toBe('USER_SCRIPT')
  })

  it('control: a request for USER_SCRIPT is reported as no request', async () => {
    await storage.setCredential('p1', { kind: 'api_key', value: 'sk-x' })
    answerWith({ ...base, requestedWorld: 'USER_SCRIPT', worldReason: '' })
    const adapter = await createOpenAiCompatibleProvider(provider)
    const result = await adapter.generate(request)
    expect(worldState(result).requestPending).toBe(false)
  })
})

describe('toGenerationResult', () => {
  it('drops a MAIN request for CSS, which has no world', () => {
    const result = toGenerationResult({ ...base, kind: 'css', requestedWorld: 'MAIN', worldReason: 'x' })
    expect(result.requestedWorld).toBe('USER_SCRIPT')
    expect(result.worldReason).toBe('')
  })

  it('treats a value that is not one of the two worlds as no request', () => {
    expect(toGenerationResult({ ...base, requestedWorld: 'ISOLATED' }).requestedWorld).toBe('USER_SCRIPT')
  })
})

describe('the model-facing contract', () => {
  it('asks for requestedWorld and worldReason and no longer for world', () => {
    expect(Object.keys(GENERATION_SCHEMA.properties)).toEqual(
      expect.arrayContaining(['requestedWorld', 'worldReason']),
    )
    expect(Object.keys(GENERATION_SCHEMA.properties)).not.toContain('world')
    expect(GENERATION_SCHEMA.required).toEqual(expect.arrayContaining(['requestedWorld', 'worldReason']))
  })

  it('tells the model a request does not take effect on its own', () => {
    expect(GENERATE_SYSTEM_PROMPT).toMatch(/only a request/)
  })
})

describe('the approval panel state', () => {
  const js = { kind: 'js' as const, world: 'USER_SCRIPT' as const, requestedWorld: 'MAIN' as const, worldReason: 'r' }

  it('reports a pending request while the world is still isolated', () => {
    expect(worldState(js)).toMatchObject({ world: 'USER_SCRIPT', requestPending: true, showRisks: true })
  })

  it('reports MAIN as in use once the user has approved it', () => {
    expect(worldState({ ...js, world: 'MAIN' })).toMatchObject({ runsInMain: true, requestPending: false, showRisks: true })
  })

  it('shows a stored MAIN transform as MAIN', () => {
    expect(worldState({ kind: 'js', world: 'MAIN', requestedWorld: 'MAIN', worldReason: '' }).runsInMain).toBe(true)
  })

  it('control: an isolated transform with no request shows no risk warning', () => {
    expect(worldState({ ...js, requestedWorld: 'USER_SCRIPT' }).showRisks).toBe(false)
  })

  it('names the four risks the user listed, and the fifth about settings', () => {
    const text = MAIN_WORLD_RISKS.join(' ')
    expect(text).toMatch(/page can change this code/)
    expect(text).toMatch(/read what the page keeps in memory/)
    expect(text).toMatch(/safety check cannot see/)
    expect(text).toMatch(/image requests/)
  })

  it('also says that the page can read the settings values', () => {
    expect(MAIN_WORLD_RISKS.join(' ')).toMatch(/page can read this elixir's settings values/)
  })
})
