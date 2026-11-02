/**
 * Follow-up checks for settings: approval of restored code with settings, the
 * reason sent with a repair, the merge of values inside the storage queue, the
 * share export, and CSS custom properties.
 */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keysInCustomProperties } from '@shared/config'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ConfigField } from '@shared/types'
import { configProblem, reasonForRepair } from './code-gate'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const word: ConfigField = { key: 'word', label: 'Word', type: 'text', default: 'a' }
let h: Harness
const stored = (id: string) => (h.local.get('transforms') as any[]).find((t) => t.id === id)
async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}
async function boot(transforms: object[], settings: object = DEFAULT_SETTINGS) {
  h = createHarness()
  h.hasUserScripts = true
  h.origins = ['*://e.example/*']
  h.tabUrls.set(TAB, 'https://e.example/page')
  h.local.set('settings', settings)
  h.local.set('transforms', transforms)
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
}

describe('approving restored JavaScript that has settings', () => {
  const restored = () =>
    cssTransform({
      id: 'r1', kind: 'js', origin: 'imported', enabled: false, world: 'USER_SCRIPT', match: 'e.example/*',
      code: "document.title = CONFIG.word", configFields: [word], awaitsApproval: true,
    })
  const approve = (withFields: boolean) =>
    ask({
      type: 'approve-code', code: "document.title = CONFIG.word", declaredCapabilities: [], world: 'USER_SCRIPT',
      transformId: 'r1', match: 'e.example/*', ...(withFields ? { configFields: [word] } : {}),
    })

  it('works when the approval carries the stored fields', async () => {
    await boot([restored()])
    const { approvalToken } = await approve(true)
    await ask({ type: 'set-enabled', id: 'r1', enabled: true, tabId: TAB, approvalToken })
    expect(stored('r1').enabled).toBe(true)
  })

  it('control: an approval without the fields is refused, so the fields are what makes it work', async () => {
    await boot([restored()])
    const reply = await h.onMessage({ type: 'approve-code', code: "document.title = CONFIG.word", declaredCapabilities: [], transformId: 'r1', match: 'e.example/*' })
    expect(reply.ok).toBe(false)
  })

  it('an inline edit of such code is analysed and approved with the fields', async () => {
    await boot([restored()])
    const code = "document.title = CONFIG.word + '!'"
    const analysis = await ask({ type: 'analyse', code, declaredCapabilities: [], configFields: [word] })
    expect(analysis.passed).toBe(true)
    const { approvalToken } = await ask({ type: 'approve-code', code, declaredCapabilities: [], transformId: 'r1', match: 'e.example/*', configFields: [word] })
    await ask({ type: 'save-transform', transform: { ...stored('r1'), code }, approvalToken, tabId: TAB })
    expect(stored('r1').code).toBe(code)
  })

  it('the sidebar sends the stored fields in all three messages', () => {
    const source = readFileSync(new URL('../sidebar/App.svelte', import.meta.url), 'utf8')
    for (const type of ["type: 'approve-code',\n          code: transform.code", "type: 'analyse',\n        code,", "type: 'approve-code',\n          code,"]) {
      const at = source.indexOf(type)
      expect(at, type).toBeGreaterThan(-1)
      expect(source.slice(at, at + 260)).toContain('configFields: transform.configFields')
    }
  })
})

describe('the reason that is sent with a repair', () => {
  const css = (): any => ({
    ...cssTransform({ id: 'a', match: 'https://site.example/*', code: 'body { background-image: image-set(var(--setting-pic) 1x) }' }),
    configFields: [{ key: 'pic', label: 'Picture', type: 'text', default: '/logo.png' }],
    configValues: { pic: '/u/alice-private-name/avatar.png' },
  })

  it('replaces a reason that names a value by the reason for the defaults', () => {
    const record = css()
    const settings: any = { ...DEFAULT_SETTINGS }
    // A reason that holds no value is passed on as it is (control).
    const sent = reasonForRepair(record, 'x', settings, 'https://site.example/')
    expect(sent).toBe('x')
    const leaky = reasonForRepair(record, 'It loads /u/alice-private-name/avatar.png', settings, 'https://site.example/')
    expect(leaky).not.toContain('alice-private-name')
  })

  it('never puts a value in the request to the model, whatever the sidebar sends', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const requests: string[] = []
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      requests.push(String(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: 'n', kind: 'css', requestedWorld: 'USER_SCRIPT', worldReason: '', capabilities: [], code: 'a{}', rationale: { targets: '', approach: '', assumptions: [] }, intent: 'i', config: [] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    })
    await boot([css()], { ...DEFAULT_SETTINGS, providers: [{ id: 'l', label: 'L', type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', generateModel: 'm', reviewModel: 'm', supportsVision: false }], activeProviderId: 'l' })
    const context = { url: 'https://site.example/', target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] }, ancestors: [], customProperties: {} }
    const reply = await h.onMessage({ type: 'repair', transformId: 'a', context, brokenReason: 'It loads /u/alice-private-name/avatar.png', tabId: TAB })
    expect(reply.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).not.toContain('alice-private-name')
    vi.unstubAllGlobals()
  })

  it('also covers the reason that the code gate gives for the stored record', async () => {
    const { blockedStates } = await import('./code-gate')
    const record = css()
    const state = blockedStates([record], { ...DEFAULT_SETTINGS }, 'https://site.example/')[0]
    expect(state?.brokenReason).toContain('alice-private-name')
    const sent = reasonForRepair(record, state!.brokenReason!, { ...DEFAULT_SETTINGS }, 'https://site.example/')
    expect(sent).not.toContain('alice-private-name')
  })
})

describe('values saved from two forms', () => {
  const fields: ConfigField[] = [
    { key: 'a', label: 'A', type: 'text', default: 'x' },
    { key: 'b', label: 'B', type: 'text', default: 'y' },
  ]
  it('keeps both edits when two saves overlap', async () => {
    await boot([cssTransform({ id: 'c1', code: 'a{}', configFields: fields })])
    await Promise.all([
      ask({ type: 'set-config-values', id: 'c1', values: { a: '1' } }),
      ask({ type: 'set-config-values', id: 'c1', values: { b: '2' } }),
    ])
    expect(stored('c1').configValues).toEqual({ a: '1', b: '2' })
  })

  it('keeps an edit that a save does not mention', async () => {
    await boot([cssTransform({ id: 'c1', code: 'a{}', configFields: fields, configValues: { a: 'other form' } })])
    await ask({ type: 'set-config-values', id: 'c1', values: { b: '2' }, reset: [] })
    expect(stored('c1').configValues).toEqual({ a: 'other form', b: '2' })
  })
})

describe('the share export', () => {
  it('leaves out the approved CSS addresses, which can be built from a value', async () => {
    await boot([cssTransform({ id: 'c1', code: 'a{}', approvedCssUrls: ['https://cdn.example/alice.png'] })])
    const share = await ask({ type: 'export-transforms' })
    expect(JSON.stringify(share)).not.toContain('alice.png')
    const backup = await ask({ type: 'export-transforms', mode: 'backup' })
    expect(JSON.stringify(backup)).toContain('alice.png')
  })
})

describe('a text setting in a CSS custom property', () => {
  const t = (code: string, type: ConfigField['type'] = 'text') => ({
    kind: 'css' as const, code,
    configFields: [type === 'text' ? word : { key: 'word', label: 'W', type: 'colour' as const, default: '#ffffff' }],
  })
  it('finds the references inside custom property declarations', () => {
    expect(keysInCustomProperties('a { --x: var(--setting-word); color: var(--setting-other) }')).toEqual(['word'])
    expect(keysInCustomProperties('a { --x : calc(1px + var(--setting-word)) }')).toEqual(['word'])
    expect(keysInCustomProperties('a { --x: 1; content: var(--setting-word) }')).toEqual([])
  })
  it('is refused for text', () => {
    expect(configProblem(t('a { --x: var(--setting-word) }'))).toMatch(/custom property/)
    expect(configProblem(t('a { margin: 0; --img: image-set(var(--setting-word) 1x) }'))).toMatch(/custom property/)
  })
  it('control: allowed in a normal property, and a colour is allowed in a custom property', () => {
    expect(configProblem(t('a { content: var(--setting-word) }'))).toBeNull()
    expect(configProblem(t('a { --x: var(--setting-word) }', 'colour'))).toBeNull()
  })
  it('keeps the CSS out of a save', async () => {
    await boot([])
    const reply = await h.onMessage({ type: 'save-transform', transform: cssTransform({ id: 'n', code: 'a { --x: var(--setting-word) }', configFields: [word] }), tabId: TAB })
    expect(reply.ok).toBe(false)
  })
})

afterEach(() => vi.unstubAllGlobals())
