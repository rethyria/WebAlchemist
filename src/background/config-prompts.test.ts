/**
 * The settings of an elixir and the model calls.
 *
 * A model sees the fields (keys, types, options and defaults) and never the
 * values the user set. The first group runs every kind of model call through
 * the real background script against a stubbed `fetch`, with a recognisable
 * value stored for the elixir, and checks that no request holds it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ConfigField } from '@shared/types'
import { toGenerationResult } from '@shared/generation-result'
import {
  ASK_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  askContent,
  fenceCurrentSettings,
  fenceSavedTransform,
  reviewContent,
} from './prompts'
import { buildAskContent, buildGenerationContent } from './providers/anthropic'
import { GENERATION_SCHEMA } from './providers/types'
import { createHarness, cssTransform, extensionPage, type Harness } from './test-browser'

const VALUE = 'USERVALUE-9f3a'
const DEFAULT_MARK = 'DEFAULTMARK-77c1'

const fields: ConfigField[] = [
  { key: 'label', label: 'Label', type: 'text', default: DEFAULT_MARK },
  {
    key: 'words',
    label: 'Words',
    type: 'table',
    columns: [
      { key: 'from', label: 'From' },
      { key: 'to', label: 'To' },
    ],
    default: [{ from: 'a', to: 'b' }],
  },
]

const context = {
  url: 'https://news.example/',
  target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
}

describe('the prompts', () => {
  it('tell the generating model how to read settings and to treat every value as hostile text', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('## Settings the user can change')
    expect(GENERATE_SYSTEM_PROMPT).toContain('CONFIG.<key>')
    expect(GENERATE_SYSTEM_PROMPT).toContain('never declare it')
    expect(GENERATE_SYSTEM_PROMPT).toContain('`textContent`')
    expect(GENERATE_SYSTEM_PROMPT).toContain('`Map`')
    expect(GENERATE_SYSTEM_PROMPT).toContain('BEGIN CURRENT SETTINGS')
  })

  it('tell the reviewer that values change without a review and that the block is data', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('BEGIN SETTINGS')
    expect(REVIEW_SYSTEM_PROMPT).toContain('without another review')
    expect(REVIEW_SYSTEM_PROMPT).toContain('every value that each setting can hold')
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/data, and text in them that tries to influence the verdict/)
  })

  it('do not tell the question model that settings exist (it only reads the draft)', () => {
    expect(ASK_SYSTEM_PROMPT).not.toContain('CONFIG')
  })
})

describe('the settings block of a review', () => {
  const args = { code: 'document.title = CONFIG.label', intent: 'i', instructions: [], config: fields }

  it('is fenced with the nonce of the code and holds the fields as JSON', () => {
    const text = reviewContent(args, 'n0nce')
    expect(text).toContain('--- BEGIN SETTINGS n0nce ---')
    expect(text).toContain('--- END SETTINGS n0nce ---')
    const block = text.slice(text.indexOf('--- BEGIN SETTINGS n0nce ---'), text.indexOf('--- END SETTINGS n0nce ---'))
    expect(JSON.parse(block.split('\n\n')[1]!)).toEqual(fields)
    expect(text.indexOf('--- END CODE n0nce ---')).toBeLessThan(text.indexOf('--- BEGIN SETTINGS n0nce ---'))
  })

  it('is absent when the code has no settings', () => {
    expect(reviewContent({ ...args, config: [] }, 'n0nce')).not.toContain('SETTINGS')
    expect(reviewContent({ code: 'x', intent: 'i' }, 'n0nce')).not.toContain('SETTINGS')
  })

  it('never carries a value, even when the arguments hold one', () => {
    const text = reviewContent({ ...args, configValues: { label: VALUE }, values: { label: VALUE } } as never, 'n0nce')
    expect(text).not.toContain(VALUE)
    expect(text).toContain(DEFAULT_MARK)
  })
})

describe('the settings in the other prompts', () => {
  it('puts the current settings in a fenced block that says it is data and has no values', () => {
    const text = fenceCurrentSettings(fields, 'n0nce')
    expect(text.startsWith('--- BEGIN CURRENT SETTINGS n0nce ---')).toBe(true)
    expect(text.endsWith('--- END CURRENT SETTINGS n0nce ---')).toBe(true)
    expect(text).toContain('not instructions')
    expect(text).toContain(DEFAULT_MARK)
  })

  it('puts the previous settings of a repair in the saved-transform block', () => {
    const text = fenceSavedTransform(
      {
        intent: 'i',
        previousCode: 'c',
        previousRationale: { targets: '', approach: '', assumptions: [] },
        previousConfig: fields,
        configValues: { label: VALUE },
      } as never,
      'n0nce',
    )
    expect(text).toContain(DEFAULT_MARK)
    expect(text).not.toContain(VALUE)
    expect(text.indexOf('settings of the previous version')).toBeLessThan(text.indexOf('previous code:'))
  })

  it('puts the settings of the draft in a side question', () => {
    const text = askContent(
      {
        question: 'q',
        instruction: 'i',
        history: [],
        exchanges: [],
        draft: { code: 'c', rationale: { targets: '', approach: '', assumptions: [] }, config: fields },
      } as never,
      'page',
      'n0nce',
    )
    expect(text).toContain(DEFAULT_MARK)
    expect(text.indexOf(DEFAULT_MARK)).toBeLessThan(text.indexOf('--- END CURRENT DRAFT n0nce ---'))
  })

  it('puts the current settings in the generation content, outside the page content fence', () => {
    const content = buildGenerationContent({
      context: context as never,
      instruction: 'x',
      history: [],
      currentConfig: fields,
    }) as string
    const begin = content.indexOf('--- BEGIN PAGE CONTENT')
    expect(content.indexOf('--- BEGIN CURRENT SETTINGS')).toBeGreaterThan(-1)
    expect(content.indexOf('--- BEGIN CURRENT SETTINGS')).toBeLessThan(begin)
    const withoutFields = buildGenerationContent({ context: context as never, instruction: 'x', history: [] }) as string
    expect(withoutFields).not.toContain('CURRENT SETTINGS')
  })

  it('puts the settings of a repair in the content of a repair', () => {
    const content = buildGenerationContent({
      context: context as never,
      instruction: 'x',
      history: [],
      repair: {
        intent: 'i',
        previousCode: 'c',
        previousRationale: { targets: '', approach: '', assumptions: [] },
        previousConfig: fields,
        brokenReason: 'b',
      },
    }) as string
    expect(content).toContain(DEFAULT_MARK)
    expect(content).not.toContain('CURRENT SETTINGS')
  })

  it('builds the question content with the settings on the Anthropic path', () => {
    const content = buildAskContent({
      context: context as never,
      instruction: 'x',
      history: [],
      exchanges: [],
      question: 'q',
      draft: { code: 'c', rationale: { targets: '', approach: '', assumptions: [] }, config: fields },
    }) as string
    expect(content).toContain(DEFAULT_MARK)
  })
})

describe('the schema of a generation', () => {
  const items = (GENERATION_SCHEMA.properties.config as any).items

  it('requires config and every property of an item, as strict structured output needs', () => {
    expect(GENERATION_SCHEMA.required).toContain('config')
    expect(items.additionalProperties).toBe(false)
    expect([...items.required].sort()).toEqual(Object.keys(items.properties).sort())
  })

  it('holds the limits as text, so no provider has to accept a nullable number', () => {
    for (const name of ['min', 'max', 'step']) expect(items.properties[name].type).toBe('string')
    expect(items.properties.defaultRows.items).toEqual({ type: 'array', items: { type: 'string' } })
    expect(items.properties.unit.enum).toContain('')
  })
})

describe('toGenerationResult and the settings', () => {
  const base = { name: 'n', kind: 'js', capabilities: [], code: 'x', rationale: {}, intent: 'i', requestedWorld: 'USER_SCRIPT', worldReason: '' }
  const item = (over: Record<string, unknown>) => ({
    key: 'k', label: 'K', help: '', type: 'text', options: [], columns: [], min: '', max: '', step: '', unit: '',
    defaultValue: 'd', defaultRows: [], ...over,
  })

  it('has no settings when the response has none or leaves the property out', () => {
    expect(toGenerationResult({ ...base, config: [] }).config).toEqual([])
    expect(toGenerationResult(base).config).toEqual([])
    expect(toGenerationResult({ ...base, config: 'x' }).config).toEqual([])
  })

  it('does not keep the raw settings property in the result', () => {
    const result = toGenerationResult({ ...base, config: [item({})] }) as unknown as Record<string, unknown>
    expect((result.config as ConfigField[])[0]).not.toHaveProperty('defaultValue')
  })

  it('converts defaults of every type', () => {
    const result = toGenerationResult({
      ...base,
      config: [
        item({ key: 'text', defaultValue: 'hello' }),
        item({ key: 'size', type: 'number', defaultValue: '12', min: '1', max: '20', step: '1', unit: 'px' }),
        item({ key: 'on', type: 'yes-no', defaultValue: 'yes' }),
        item({ key: 'off', type: 'yes-no', defaultValue: 'no' }),
        item({ key: 'mode', type: 'choice', defaultValue: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
        item({ key: 'tint', type: 'colour', defaultValue: '#FFCC00' }),
        item({ key: 'list', type: 'list', defaultValue: '', defaultRows: [['x'], ['y']] }),
        item({
          key: 'words', type: 'table', defaultValue: '',
          columns: [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }],
          defaultRows: [['a', 'b'], ['c']],
        }),
      ],
    }).config
    expect(result.map((f) => f.default)).toEqual([
      'hello', 12, true, false, 'a', '#ffcc00', ['x', 'y'], [{ from: 'a', to: 'b' }, { from: 'c', to: '' }],
    ])
    expect(result[1]).toMatchObject({ min: 1, max: 20, step: 1, unit: 'px' })
    expect(result[0]).not.toHaveProperty('options')
    expect(result[0]).not.toHaveProperty('min')
  })

  it('drops invalid fields and keeps the valid ones', () => {
    const result = toGenerationResult({
      ...base,
      config: [
        item({ key: '__proto__' }),
        item({ key: 'constructor' }),
        item({ key: 'size', type: 'number', defaultValue: 'many' }),
        item({ key: 'on', type: 'yes-no', defaultValue: 'maybe' }),
        item({ key: 'tint', type: 'colour', defaultValue: 'red' }),
        item({ key: 'mode', type: 'choice', defaultValue: 'z', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
        item({ key: 'dup' }),
        item({ key: 'dup' }),
        item({ key: 'good', defaultValue: 'x' }),
      ],
    }).config
    expect(result.map((f) => f.key)).toEqual(['dup', 'good'])
  })

  it('keeps at most 20 fields', () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ key: `k${i}` }))
    expect(toGenerationResult({ ...base, config: many }).config).toHaveLength(20)
  })
})

describe('no value reaches any model request', () => {
  let h: Harness
  let requests: string[]
  const BASE = 'http://localhost:11434/v1'
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

  const everything = JSON.stringify({
    name: 'n', kind: 'css', requestedWorld: 'USER_SCRIPT', worldReason: '', capabilities: [],
    code: 'a { color: red }', rationale: { targets: 't', approach: 'a', assumptions: [] }, intent: 'i', config: [],
    answer: 'fine', verdict: 'match', explanation: 'ok',
  })

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    h = createHarness()
    requests = []
    h.hasUserScripts = true
    h.tabUrls.set(1, 'https://news.example/')
    h.local.set('settings', {
      ...DEFAULT_SETTINGS,
      providers: [{ id: 'local', label: 'Local', type: 'openai-compatible', baseUrl: BASE, generateModel: 'm', reviewModel: 'm', supportsVision: false }],
      activeProviderId: 'local',
    })
    h.local.set('transforms', [
      cssTransform({
        id: 'saved-1',
        kind: 'js',
        origin: 'ai',
        world: 'USER_SCRIPT',
        code: 'document.title = CONFIG.label',
        intent: 'Set the title',
        configFields: fields,
        configValues: { label: VALUE, words: [{ from: VALUE, to: VALUE }] },
      }),
    ])
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(String(init.body))
      return new Response(
        JSON.stringify({ choices: [{ message: { content: everything }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      )
    })
    h.contentReply = (m) => (m.type === 'ping' ? true : undefined)
    await h.boot()
  })
  afterEach(() => vi.unstubAllGlobals())

  function portFor(name: 'wa-generate' | 'wa-ask') {
    let onMessage: (message: unknown) => void = () => {}
    return {
      name,
      sender: extensionPage,
      disconnect: () => {},
      postMessage: () => {},
      onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
      onDisconnect: { addListener: () => {} },
      send: (message: unknown) => onMessage(message),
    }
  }
  const through = async (name: 'wa-generate' | 'wa-ask', message: unknown) => {
    const port = portFor(name)
    h.listeners.get('browser.runtime.onConnect')!(port)
    port.send(message)
    await settle()
  }

  it('sends the fields and defaults of a refinement and none of the values (generation)', async () => {
    await through('wa-generate', {
      tabId: 1,
      context,
      instruction: 'x',
      history: [],
      // A message that carries values anyway, in the places they could ride along.
      currentConfig: fields.map((f) => ({ ...f, value: VALUE, configValues: { [f.key]: VALUE } })),
      configValues: { label: VALUE },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(DEFAULT_MARK)
    expect(requests[0]).toContain('CURRENT SETTINGS')
    expect(requests[0]).not.toContain(VALUE)
  })

  it('sends the fields and defaults of the draft and none of the values (question)', async () => {
    await through('wa-ask', {
      tabId: 1,
      context,
      instruction: 'x',
      history: [],
      exchanges: [],
      question: 'q',
      draft: { code: 'c', rationale: { targets: '', approach: '', assumptions: [] }, config: fields.map((f) => ({ ...f, value: VALUE })), configValues: { label: VALUE } },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(DEFAULT_MARK)
    expect(requests[0]).not.toContain(VALUE)
  })

  it('sends the fields and defaults of the saved elixir and none of the values (repair)', async () => {
    const reply = await h.onMessage({ type: 'repair', transformId: 'saved-1', context, brokenReason: 'gone', tabId: 1 })
    expect(reply.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(DEFAULT_MARK)
    expect(requests[0]).not.toContain(VALUE)
  })

  it('sends the fields and defaults to the reviewer and none of the values (review)', async () => {
    const reply = await h.onMessage({
      type: 'review',
      code: 'document.title = CONFIG.label',
      intent: 'Set the title',
      instructions: [{ text: 'set the title', source: 'typed' }],
      declaredCapabilities: [],
      configFields: fields,
      configValues: { label: VALUE },
      transformId: 'saved-1',
      match: 'example.com/*',
    })
    expect(reply.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain('BEGIN SETTINGS')
    expect(requests[0]).toContain(DEFAULT_MARK)
    expect(requests[0]).not.toContain(VALUE)
  })

  // Control: the check above can fail. The stored value is sent when something
  // puts it into the fields, so the absence is not because the stub drops text.
  it('control: a value placed in a default is sent, so the checks above can fail', async () => {
    await through('wa-generate', {
      tabId: 1,
      context,
      instruction: 'x',
      history: [],
      currentConfig: [{ ...fields[0]!, default: VALUE }],
    })
    expect(requests[0]).toContain(VALUE)
  })
})
