/**
 * Side questions over the `wa-ask` port, against the real index.ts.
 *
 * An OpenAI-compatible provider on a loopback address needs no credential, and
 * `fetch` is replaced, so no network call is made. The checks are the guards a
 * generation has (private windows, excluded sites, extension pages only), usage
 * recording under the transform id, the cut on the length of the answer, and
 * the abort when the sidebar closes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_WINDOW_MESSAGE } from './private-window'
import { createHarness, extensionPage, type Harness } from './test-browser'

const BASE = 'http://localhost:11434/v1'
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

let h: Harness
let requests: { body: any; signal: AbortSignal | undefined }[]
let reply: () => Promise<Response>

const completion = (answer: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ answer }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 6 },
    }),
  )

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  h = createHarness()
  requests = []
  reply = async () => completion('Because CSS cannot read text.')
  h.tabUrls.set(1, 'https://news.example/')
  h.tabUrls.set(2, 'https://login.bank.example/')
  h.local.set('settings', {
    providers: [
      {
        id: 'local',
        label: 'Local',
        type: 'openai-compatible',
        baseUrl: BASE,
        generateModel: 'm',
        reviewModel: 'm',
        supportsVision: false,
      },
    ],
    activeProviderId: 'local',
  })
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(init.body as string), signal: init.signal as AbortSignal | undefined })
    return new Promise<Response>((resolve, rejectFetch) => {
      ;(init.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
        rejectFetch(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      )
      void reply().then(resolve)
    })
  })
  h.contentReply = (m) => (m.type === 'ping' ? true : undefined)
  await h.boot()
})
afterEach(() => vi.unstubAllGlobals())

const context = {
  url: 'https://news.example/',
  target: { selector: 'div', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
}

const question = (over: Record<string, unknown> = {}) => ({
  tabId: 1,
  transformId: 'draft-1',
  context,
  instruction: 'hide it',
  history: [],
  draft: { code: 'x', rationale: { targets: 't', approach: 'a', assumptions: [] } },
  exchanges: [],
  question: 'Why CSS?',
  ...over,
})

/** A port with the given name that records what the background posts to it. */
function port(name = 'wa-ask', sender: unknown = extensionPage) {
  let onMessage: (message: unknown) => void = () => {}
  let onDrop: () => void = () => {}
  let closed = false
  let disconnected = false
  const posted: any[] = []
  return {
    name,
    sender,
    disconnect: () => {
      disconnected = true
    },
    postMessage: (message: unknown) => {
      if (closed) throw new Error('Attempt to postMessage on disconnected port')
      posted.push(message)
    },
    onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
    onDisconnect: { addListener: (l: () => void) => (onDrop = l) },
    posted,
    send: (message: unknown) => onMessage(message),
    drop: () => {
      closed = true
      onDrop()
    },
    get disconnected() {
      return disconnected
    },
  }
}

async function ask(message: unknown, p = port()) {
  h.listeners.get('browser.runtime.onConnect')!(p)
  p.send(message)
  await settle()
  return p
}

describe('a question over the port', () => {
  it('posts sent and then the answer, and sends the question as a JSON string', async () => {
    const p = await ask(question())
    expect(p.posted.map((m) => m.type)).toEqual(['sent', 'done'])
    expect(p.posted[1].result).toEqual({ answer: 'Because CSS cannot read text.' })
    const last = requests[0]!.body.messages.at(-1).content as string
    expect(last).toContain(JSON.stringify('Why CSS?'))
  })

  it('records the usage under the transform id and returns it with the answer', async () => {
    const p = await ask(question())
    const usage = h.local.get('usage') as any
    expect(usage.transforms['draft-1']).toMatchObject({ calls: 1, inputTokens: 30, outputTokens: 6 })
    expect(p.posted[1].usage.usage).toEqual({ inputTokens: 30, outputTokens: 6 })
  })

  it('cuts an answer longer than 6000 characters', async () => {
    reply = async () => completion('a'.repeat(9000))
    const p = await ask(question())
    expect(p.posted[1].result.answer).toHaveLength(6000)
  })

  it('control: an answer of exactly 6000 characters is not changed', async () => {
    reply = async () => completion('b'.repeat(6000))
    const p = await ask(question())
    expect(p.posted[1].result.answer).toBe('b'.repeat(6000))
  })

  it('posts an error with the refusal kind when the provider refuses', async () => {
    reply = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] }))
    const p = await ask(question())
    expect(p.posted.at(-1).type).toBe('error')
    expect(p.posted.at(-1).error.kind).toBe('refusal')
  })
})

describe('the guards of a generation apply', () => {
  it('refuses a private window with the plain message and sends nothing', async () => {
    h.privateTabs.add(1)
    const p = await ask(question())
    expect(p.posted).toEqual([{ type: 'error', error: { message: PRIVATE_WINDOW_MESSAGE } }])
    expect(requests).toEqual([])
  })

  it('refuses an excluded site and sends nothing', async () => {
    await h.onMessage({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const p = await ask(question({ tabId: 2, context: { ...context, url: 'https://login.bank.example/' } }))
    expect(p.posted.at(-1).type).toBe('error')
    expect(p.posted.at(-1).error.message).toContain('login.bank.example')
    expect(requests).toEqual([])
  })

  it('control: the same question on a site that is not excluded is answered', async () => {
    await h.onMessage({ type: 'set-excluded-sites', sites: ['bank.example'] })
    const p = await ask(question())
    expect(p.posted.map((m) => m.type)).toEqual(['sent', 'done'])
  })

  it('closes a port opened by a page that is not an extension page', async () => {
    const p = port('wa-ask', { url: 'https://evil.example/' })
    h.listeners.get('browser.runtime.onConnect')!(p)
    expect(p.disconnected).toBe(true)
    p.send(question())
    await settle()
    expect(requests).toEqual([])
  })
})

describe('a question whose sidebar closes', () => {
  it('aborts the request, posts nothing more and does not abort another panel', async () => {
    let release: () => void = () => {}
    reply = () => new Promise<Response>((resolve) => (release = () => resolve(completion('late'))))
    const first = port()
    const second = port()
    h.listeners.get('browser.runtime.onConnect')!(first)
    h.listeners.get('browser.runtime.onConnect')!(second)
    first.send(question())
    second.send(question())
    await settle()
    expect(requests).toHaveLength(2)
    first.drop()
    expect(requests[0]!.signal!.aborted).toBe(true)
    expect(requests[1]!.signal!.aborted).toBe(false)
    release()
    await settle()
    expect(first.posted.map((m) => m.type)).toEqual(['sent'])
  })
})
