/**
 * The code of a generation or a repair is laid out for reading where it leaves
 * the provider, so that the text that is analysed, reviewed and approved is the
 * text that the user sees and that runs.
 *
 * These load the real index.ts with an OpenAI-compatible provider on a loopback
 * address and a replaced `fetch`. No network call is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, extensionPage, type Harness } from './test-browser'

const ONE_LINE_JS = "const a=document.querySelector('h1');if(a){a.textContent='x'}"
const FORMATTED_JS = "const a = document.querySelector('h1');\nif (a) {\n  a.textContent = 'x'\n}"
const ONE_LINE_CSS = 'h1{color:red;margin:0}'
const FORMATTED_CSS = 'h1 {\n  color: red;\n  margin: 0\n}'

let h: Harness
let bodies: string[]
let generated: { kind: 'css' | 'js'; code: string }

const answer = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))

const context = { url: 'https://e.example/', target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] }, ancestors: [], customProperties: {} }

beforeEach(async () => {
  bodies = []
  generated = { kind: 'js', code: ONE_LINE_JS }
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = String(init.body)
    bodies.push(body)
    // The review request carries the system prompt of the reviewer.
    if (body.includes('reviewing JavaScript')) return answer({ verdict: 'match', explanation: 'ok' })
    return answer({
      name: 'n', kind: generated.kind, requestedWorld: 'USER_SCRIPT', worldReason: '', capabilities: [],
      code: generated.code, rationale: { targets: '', approach: '', assumptions: [] }, intent: 'i', config: [],
    })
  })
  h = createHarness()
  h.hasUserScripts = true
  h.origins = ['*://e.example/*']
  h.tabUrls.set(1, 'https://e.example/page')
  h.local.set('settings', {
    ...DEFAULT_SETTINGS,
    providers: [{ id: 'l', label: 'L', type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', generateModel: 'm', reviewModel: 'm', supportsVision: false }],
    activeProviderId: 'l',
  })
  h.local.set('transforms', [cssTransform({ id: 'a', match: 'e.example/*', code: 'a{}' })])
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
})
afterEach(() => vi.unstubAllGlobals())

/** Runs a generation over a port and returns the `done` message. */
async function generateOverPort(): Promise<any> {
  let onMessage: (message: unknown) => void = () => {}
  const posted: any[] = []
  const port = {
    name: 'wa-generate',
    sender: extensionPage,
    disconnect: () => {},
    postMessage: (message: unknown) => void posted.push(message),
    onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
    onDisconnect: { addListener: () => {} },
  }
  h.listeners.get('browser.runtime.onConnect')!(port)
  onMessage({ tabId: 1, context, instruction: 'x', history: [] })
  await vi.waitFor(() => expect(posted.some((m) => m.type === 'done' || m.type === 'error')).toBe(true))
  return posted.find((m) => m.type === 'done')
}

describe('generated code', () => {
  it('arrives on several lines for JavaScript', async () => {
    const done = await generateOverPort()
    expect(done.result.code).toBe(FORMATTED_JS)
  })

  it('arrives on several lines for CSS', async () => {
    generated = { kind: 'css', code: ONE_LINE_CSS }
    const done = await generateOverPort()
    expect(done.result.code).toBe(FORMATTED_CSS)
  })

  it('is the text that the review request and the approval receive', async () => {
    const done = await generateOverPort()
    const code: string = done.result.code
    const common = { code, declaredCapabilities: [], world: 'USER_SCRIPT' }

    const analysed = await h.onMessage({ type: 'analyse', ...common })
    expect(analysed.ok).toBe(true)

    const reviewed = await h.onMessage({
      type: 'review', code, intent: 'i', instructions: [{ text: 'x', source: 'typed' }],
      declaredCapabilities: [], transformId: undefined, match: 'e.example/*',
    })
    expect(reviewed.ok).toBe(true)
    const reviewRequest = bodies.find((b) => b.includes('reviewing JavaScript'))!
    // The code sits in the request as a JSON string, so the line breaks are escaped twice.
    expect(reviewRequest).toContain(JSON.stringify(FORMATTED_JS).slice(1, -1))
    expect(reviewRequest).not.toContain(ONE_LINE_JS)
  })
})

describe('repaired code', () => {
  it('arrives on several lines', async () => {
    const reply = await h.onMessage({ type: 'repair', transformId: 'a', context, brokenReason: 'x', tabId: 1 })
    expect(reply.ok).toBe(true)
    expect(reply.data.result.code).toBe(FORMATTED_JS)
  })
})
