/**
 * Closing the sidebar during a generation (#71).
 *
 * These load the real index.ts with an OpenAI-compatible provider on a loopback
 * address, which needs no credential, and replace `fetch` with a request that
 * stays open until it is aborted. No network call is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, extensionPage, type Harness } from './test-browser'

const BASE = 'http://localhost:11434/v1'
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let h: Harness
let signals: AbortSignal[]
/** Resolves the open request with a model answer, as when nobody cancelled. */
let answer: () => void

const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })

beforeEach(async () => {
  h = createHarness()
  signals = []
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
  vi.stubGlobal(
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal as AbortSignal
        signals.push(signal)
        signal?.addEventListener('abort', () => reject(abortError()))
        answer = () =>
          resolve(
            new Response(
              JSON.stringify({ choices: [{ message: { content: '{"name":"n","kind":"css"}' } }] }),
            ),
          )
      }),
  )
  await h.boot()
})
afterEach(() => vi.unstubAllGlobals())

/** A `wa-generate` port that records what the background posts to it. */
function generatePort(options: { throwWhenClosed?: boolean } = {}) {
  let onMessage: (message: unknown) => void = () => {}
  let onDrop: () => void = () => {}
  let closed = false
  const posted: any[] = []
  return {
    name: 'wa-generate',
    sender: extensionPage,
    disconnect: () => {},
    postMessage: (message: unknown) => {
      if (closed && options.throwWhenClosed !== false) throw new Error('Attempt to postMessage on disconnected port')
      posted.push(message)
    },
    onMessage: { addListener: (l: (message: unknown) => void) => (onMessage = l) },
    onDisconnect: { addListener: (l: () => void) => (onDrop = l) },
    posted,
    send: (message: unknown) => onMessage(message),
    /** The sidebar closing its end. */
    drop: () => {
      closed = true
      onDrop()
    },
  }
}

async function start(port: ReturnType<typeof generatePort>) {
  h.listeners.get('browser.runtime.onConnect')!(port)
  port.send({ context: {}, instruction: 'x', history: [] })
  await settle()
}

describe('a generation whose sidebar closes', () => {
  it('aborts the request to the provider', async () => {
    const port = generatePort()
    await start(port)
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(false)
    port.drop()
    expect(signals[0]!.aborted).toBe(true)
  })

  it('posts nothing to the closed port and leaves no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      const port = generatePort()
      await start(port)
      const before = port.posted.length
      port.drop()
      await settle()
      expect(port.posted.length).toBe(before)
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('does not post a result that arrives after the port closed', async () => {
    // A provider that ignores the abort still finishes; the answer is dropped
    // instead of thrown at a closed port.
    const port = generatePort()
    await start(port)
    port.drop()
    answer()
    await settle()
    expect(port.posted.map((m) => m.type)).toEqual(['sent'])
  })

  it('control: with the port left open the same request completes and the result is posted', async () => {
    // Shows the abort and the silence above come from the disconnect and not
    // from the stub: the same request, answered, reaches the panel.
    const port = generatePort()
    await start(port)
    expect(signals[0]!.aborted).toBe(false)
    answer()
    await settle()
    expect(port.posted.map((m) => m.type)).toEqual(['sent', 'done'])
    expect(signals[0]!.aborted).toBe(false)
  })

  it('does not abort the request of another panel', async () => {
    const first = generatePort()
    const second = generatePort()
    await start(first)
    await start(second)
    first.drop()
    expect(signals[0]!.aborted).toBe(true)
    expect(signals[1]!.aborted).toBe(false)
  })
})
