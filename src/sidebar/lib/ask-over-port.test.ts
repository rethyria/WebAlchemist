/**
 * The sidebar's side of the `wa-ask` port. The port is replaced by a fake that
 * the test answers, so nothing is sent to a background or a model.
 */

import { beforeEach, describe, expect, it } from 'vitest'

const ports: any[] = []
;(globalThis as any).browser = {
  runtime: {
    connect: (info: { name: string }) => {
      const listeners: ((message: any) => void)[] = []
      const dropListeners: (() => void)[] = []
      const port = {
        name: info.name,
        request: null as any,
        disconnected: false,
        emit: (message: any) => listeners.forEach((l) => l(message)),
        drop: () => dropListeners.forEach((l) => l()),
        onMessage: { addListener: (l: any) => listeners.push(l) },
        onDisconnect: { addListener: (l: any) => dropListeners.push(l) },
        postMessage: (request: any) => {
          port.request = request
        },
        disconnect: () => {
          port.disconnected = true
        },
      }
      ports.push(port)
      return port
    },
  },
}

const { askOverPort, BackgroundError } = await import('./messaging.svelte')

const request = {
  context: {},
  instruction: 'x',
  history: [],
  draft: { code: 'c', rationale: { targets: '', approach: '', assumptions: [] } },
  exchanges: [],
  question: 'Why?',
}

beforeEach(() => {
  ports.length = 0
})

describe('askOverPort', () => {
  it('opens a wa-ask port and posts the request on it', () => {
    askOverPort(request, { onSent: () => {}, onChunk: () => {} })
    expect(ports[0].name).toBe('wa-ask')
    expect(ports[0].request.question).toBe('Why?')
  })

  it('reports progress, then resolves with the result and closes the port', async () => {
    const seen: string[] = []
    const run = askOverPort(request, {
      onSent: () => seen.push('sent'),
      onChunk: (text) => seen.push(text),
      onUsage: () => seen.push('usage'),
    })
    ports[0].emit({ type: 'sent' })
    ports[0].emit({ type: 'chunk', text: '{"answer":"B' })
    ports[0].emit({ type: 'done', result: { answer: 'Because' }, usage: undefined })
    expect(await run.result).toEqual({ answer: 'Because' })
    expect(seen).toEqual(['sent', '{"answer":"B', 'usage'])
    expect(ports[0].disconnected).toBe(true)
  })

  it('rejects with the error kind from the background', async () => {
    const run = askOverPort(request, { onSent: () => {}, onChunk: () => {} })
    ports[0].emit({ type: 'error', error: { message: 'no', kind: 'refusal', retryable: false } })
    const error = await run.result.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackgroundError)
    expect((error as any).kind).toBe('refusal')
  })

  it('rejects when the connection drops before an answer', async () => {
    const run = askOverPort(request, { onSent: () => {}, onChunk: () => {} })
    ports[0].drop()
    await expect(run.result).rejects.toBeInstanceOf(BackgroundError)
  })

  it('disconnects the port when cancelled', () => {
    const run = askOverPort(request, { onSent: () => {}, onChunk: () => {} })
    run.cancel()
    expect(ports[0].disconnected).toBe(true)
  })
})
