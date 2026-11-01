/**
 * Flow state-machine behaviour that does not need a browser.
 *
 * `browser` and the background are replaced: every message the flow sends is
 * recorded in `calls` and answered by `handler`. Nothing here makes a model
 * call or touches a page, so what these tests cover is the flow's own state,
 * not what the background or the page does with the messages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (message: any) => any
let handler: Handler = () => ({ ok: true, data: null })
const calls: any[] = []

;(globalThis as any).browser = {
  runtime: {
    sendMessage: async (message: any) => {
      calls.push(message)
      return handler(message)
    },
    connect: () => {
      throw new Error('no port in test')
    },
    getURL: (path: string) => path,
  },
  permissions: { request: async () => true, remove: async () => true },
  tabs: { update: async () => {}, reload: async () => {}, create: async () => {} },
  storage: { session: { set: async () => {} } },
}

const { Flow } = await import('./flow.svelte')
const { BackgroundError } = await import('./messaging.svelte')

const URL_ = 'https://www.example.com/'
const anchor = { tag: 'div', classes: [], path: 'html>body>div', landmarks: [], selector: 'div.x' }
const context = {
  url: URL_,
  target: { selector: 'div.x', tag: 'div', outerHTMLExcerpt: '', computedStyles: {}, matchedRules: [] },
  ancestors: [],
  customProperties: {},
}
const crop = { x: 0, y: 0, width: 1, height: 1 }
const targetInfo = { breadcrumb: ['div.x'], width: 1, height: 1, drawing: false }
const found = {
  context,
  anchor,
  crop,
  cropClipped: false,
  target: targetInfo,
  viewportWidth: 800,
  tree: [],
}
const saved = {
  id: 'OLD',
  name: 'Old',
  enabled: false,
  order: 5,
  match: '*.example.com/*',
  kind: 'css',
  origin: 'ai',
  capabilities: [],
  intent: 'old intent',
  rationale: { targets: '', approach: 'a', assumptions: [] },
  anchor,
  code: 'div{}',
  createdAt: 1,
  updatedAt: 1,
} as any

const failure = (kind: string, extra: object = {}) => ({
  ok: false,
  error: { message: 'failed', kind, ...extra },
})

function newFlow() {
  const flow = new Flow(() => {})
  flow.bindTab(1, URL_)
  return flow
}

/** The sender of an event from the tab the flows in these tests are bound to. */
const fromRunTab = { tab: { id: 1 } }

function pick(flow: InstanceType<typeof Flow>, selector = 'p.new') {
  flow.receive(
    {
      type: 'element-picked',
      context,
      anchor: { ...anchor, selector },
      crop,
      cropClipped: false,
      cropDrawn: false,
      target: targetInfo,
      tree: [],
      viewportWidth: 800,
    } as any,
    fromRunTab,
  )
}

const suspendCalls = () => calls.filter((c) => c.type === 'suspend-transform')

beforeEach(() => {
  calls.length = 0
  handler = () => ({ ok: true, data: null })
})

describe('leaving a run that started from a saved transform', () => {
  it('drops the old draft when a repair fails, so a new pick does not save over it', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return failure('network')
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    expect(flow.step).toBe('list')
    expect(flow.error).not.toBeNull()
    // Checked here, before startPicking: its own guard clears a stale draft,
    // so asserting only after it passed even with the repair fix reverted.
    expect(flow.draft).toBeNull()
    expect(flow.matchPattern).toBe('')

    await flow.startPicking()
    pick(flow)
    expect(flow.step).toBe('describing')
    expect(flow.draft?.id).not.toBe('OLD')
    expect(flow.draft).toBeNull()
  })

  it('puts the saved transform back when an AI edit fails', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      // The CSS check runs before the preview, so it has to answer for the preview to be reached.
      if (m.type === 'analyse-css') {
        return { ok: true, data: { static: [], undeclaredCapabilities: [], pendingUrls: [], passed: true } }
      }
      if (m.type === 'preview-css') return failure('network')
      return { ok: true, data: null }
    }
    await flow.editWithAi(saved)
    expect(suspendCalls().map((c) => c.id)).toEqual(['OLD', null])
    expect(flow.suspendedId).toBeNull()
    expect(flow.draft).toBeNull()
    expect(flow.step).toBe('list')
    expect(flow.error).not.toBeNull()
  })

  it('returns to Edit description with the edit intact when the re-pick is cancelled', async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
    await flow.editIntent(saved)
    expect(flow.step).toBe('describing')
    expect(flow.suspendedId).toBe('OLD')
    flow.instruction = 'edited text'

    await flow.startPicking()
    expect(flow.step).toBe('picking')
    await flow.cancelPicking()

    expect(flow.step).toBe('describing')
    expect(flow.draft?.id).toBe('OLD')
    expect(flow.instruction).toBe('edited text')
    expect(flow.picked?.anchor.selector).toBe('div.x')
    // The saved transform stays off the page: the edit is still open.
    expect(flow.suspendedId).toBe('OLD')
    expect(suspendCalls().map((c) => c.id)).toEqual(['OLD'])
  })

  it('does the same when the re-pick is cancelled from the page with Esc', async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
    await flow.editIntent(saved)
    flow.instruction = 'edited text'
    await flow.startPicking()
    flow.receive({ type: 'picking-cancelled' } as any, fromRunTab)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flow.step).toBe('describing')
    expect(flow.suspendedId).toBe('OLD')
    expect(flow.draft?.id).toBe('OLD')
    expect(flow.instruction).toBe('edited text')
    expect(flow.picked?.anchor.selector).toBe('div.x')
    expect(suspendCalls().map((c) => c.id)).toEqual(['OLD'])
  })

  it('returns to the description when starting the re-pick fails', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'start-picking') return failure('network')
      return { ok: true, data: null }
    }
    await flow.editIntent(saved)
    await flow.startPicking()
    expect(flow.step).toBe('describing')
    expect(flow.draft?.id).toBe('OLD')
    expect(flow.suspendedId).toBe('OLD')
    expect(flow.picked).not.toBeNull()
    expect(flow.error).not.toBeNull()
  })

  it('still discards the run when a first pick fails to start', async () => {
    const flow = newFlow()
    flow.draft = saved
    flow.suspendedId = 'OLD'
    handler = (m) => (m.type === 'start-picking' ? failure('network') : { ok: true, data: null })
    await flow.startPicking()
    expect(flow.step).toBe('list')
    expect(flow.draft).toBeNull()
    expect(flow.suspendedId).toBeNull()
    expect(flow.error).not.toBeNull()
  })

  it('still discards the run when a first pick is cancelled', async () => {
    const flow = newFlow()
    await flow.startPicking()
    await flow.cancelPicking()
    expect(flow.step).toBe('list')
    expect(flow.picked).toBeNull()
  })

  it('keeps the draft when Change re-picks inside Edit description', async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
    await flow.editIntent(saved)
    await flow.startPicking()
    pick(flow)
    expect(flow.step).toBe('describing')
    expect(flow.draft?.id).toBe('OLD')
    expect(flow.suspendedId).toBe('OLD')
  })

  it('clears a stale draft when a new pick starts from the list', async () => {
    // The second guard: even if some path returns to the list without a
    // discard, starting a new pick must not inherit the old draft.
    const flow = newFlow()
    flow.draft = saved
    flow.matchPattern = saved.match
    flow.suspendedId = 'OLD'
    await flow.startPicking()
    expect(flow.draft).toBeNull()
    expect(flow.matchPattern).toBe('')
    expect(flow.suspendedId).toBeNull()
    expect(suspendCalls().map((c) => c.id)).toEqual([null])
  })
})

describe('failures that must leave the Generating step', () => {
  it('returns to the list when Edit description cannot find the element', async () => {
    const flow = newFlow()
    // The default handler answers every message with null, which is the
    // "element not found" answer for context-for-anchor.
    await flow.editIntent(saved)
    expect(flow.step).toBe('list')
    expect(flow.error).not.toBeNull()
    expect(flow.draft).toBeNull()
    expect(flow.canRetry).toBe(true)
  })

  it('repeats Edit description, not a generation, on "Try again"', async () => {
    const flow = newFlow()
    let lookups = 0
    handler = (m) => {
      if (m.type !== 'context-for-anchor') return { ok: true, data: null }
      lookups += 1
      return { ok: true, data: lookups === 1 ? null : found }
    }
    await flow.editIntent(saved)
    await flow.retry()
    expect(lookups).toBe(2)
    expect(flow.step).toBe('describing')
  })
})

const jsResult = {
  name: 'n',
  kind: 'js',
  world: 'USER_SCRIPT',
  capabilities: [],
  code: 'x',
  rationale: { targets: '', approach: '', assumptions: [] },
  intent: 'model intent',
} as any

function flowAtApprove() {
  const flow = newFlow()
  flow.picked = { ...found, cropDrawn: false } as any
  flow.instruction = 'x'
  flow.result = jsResult
  flow.intent = 'edited intent'
  flow.step = 'saving'
  return flow
}

describe('repeating a failed request', () => {
  afterEach(() => vi.useRealTimers())

  it('repeats the review, not a generation, when the countdown ends', async () => {
    vi.useFakeTimers()
    const flow = flowAtApprove()
    let reviews = 0
    handler = (m) => {
      if (m.type !== 'review') return { ok: true, data: null }
      reviews += 1
      return reviews === 1
        ? failure('rate-limit', { retryInSeconds: 2 })
        : { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    }
    await flow.toReview()
    expect(flow.error?.kind).toBe('rate-limited')

    const generate = vi.spyOn(flow, 'generate').mockResolvedValue(undefined)
    await vi.advanceTimersByTimeAsync(2100)

    expect(generate).not.toHaveBeenCalled()
    expect(reviews).toBe(2)
    expect(flow.error).toBeNull()
    expect(flow.review?.passed).toBe(true)
    // The text the user edited on the Confirm step is not replaced.
    expect(flow.intent).toBe('edited intent')
  })

  it('repeats the review when "Try again" is used after a plain failure', async () => {
    const flow = flowAtApprove()
    let reviews = 0
    handler = (m) => {
      if (m.type !== 'review') return { ok: true, data: null }
      reviews += 1
      return reviews === 1
        ? failure('network')
        : { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    }
    await flow.toReview()
    const generate = vi.spyOn(flow, 'generate').mockResolvedValue(undefined)
    expect(flow.canRetry).toBe(true)
    await flow.retry()
    expect(generate).not.toHaveBeenCalled()
    expect(reviews).toBe(2)
  })

  it('repeats a failed repair as a repair', async () => {
    const flow = newFlow()
    let repairs = 0
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') {
        repairs += 1
        return failure('network')
      }
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    await flow.retry()
    expect(repairs).toBe(2)
  })

  it('offers no retry for an error that has nothing to repeat', async () => {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    ;(globalThis as any).browser.permissions.request = async () => false
    await flow.runJs()
    ;(globalThis as any).browser.permissions.request = async () => true
    expect(flow.error?.kind).toBe('request-failed')
    expect(flow.canRetry).toBe(false)

    const generate = vi.spyOn(flow, 'generate').mockResolvedValue(undefined)
    await flow.retry()
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not count down when there is nothing to repeat', async () => {
    vi.useFakeTimers()
    const flow = newFlow()
    flow.fail(new BackgroundError('slow down', 'rate-limit', true, 3))
    expect(flow.error?.kind).toBe('rate-limited')
    expect((flow.error as any).retryInSeconds).toBeNull()
    expect(flow.canRetry).toBe(false)
  })

  it('repeats a failed list action given to fail()', async () => {
    const flow = newFlow()
    const again = vi.fn(async () => {})
    flow.fail(new Error('delete failed'), again)
    expect(flow.canRetry).toBe(true)
    await flow.retry()
    expect(again).toHaveBeenCalledTimes(1)
    expect(flow.canRetry).toBe(false)
  })
})

describe('resetting the flow', () => {
  afterEach(() => vi.useRealTimers())

  it('clears the error card and stops the rate-limit countdown', async () => {
    vi.useFakeTimers()
    const flow = flowAtApprove()
    handler = (m) =>
      m.type === 'review' ? failure('rate-limit', { retryInSeconds: 5 }) : { ok: true, data: null }
    await flow.toReview()
    expect(flow.error?.kind).toBe('rate-limited')

    await flow.discard()
    expect(flow.step).toBe('list')
    expect(flow.error).toBeNull()

    const reviewsBefore = calls.filter((c) => c.type === 'review').length
    await vi.advanceTimersByTimeAsync(6000)
    expect(flow.error).toBeNull()
    expect(calls.filter((c) => c.type === 'review').length).toBe(reviewsBefore)
  })

  it('clears a plain error card so no retry is offered for a run that is gone', async () => {
    const flow = flowAtApprove()
    handler = (m) => (m.type === 'review' ? failure('network') : { ok: true, data: null })
    await flow.toReview()
    expect(flow.error).not.toBeNull()
    await flow.discard()
    expect(flow.error).toBeNull()
    expect(flow.canRetry).toBe(false)
  })

  it('stops the countdown when the tab closes', async () => {
    vi.useFakeTimers()
    const flow = flowAtApprove()
    handler = (m) =>
      m.type === 'review' ? failure('rate-limit', { retryInSeconds: 5 }) : { ok: true, data: null }
    await flow.toReview()
    flow.tabClosed(1)
    expect(flow.error).toBeNull()
    await vi.advanceTimersByTimeAsync(6000)
    expect(calls.filter((c) => c.type === 'review').length).toBe(1)
  })
})


/* -------------------------------------------------------------------- */
/* Refinements                                                           */
/* -------------------------------------------------------------------- */

type FakePort = {
  request: any
  disconnected: boolean
  emit: (message: any) => void
}
const ports: FakePort[] = []
const realConnect = (globalThis as any).browser.runtime.connect

/** Stands in for the `wa-generate` port: the test decides what it answers. */
function fakeConnect() {
  const listeners: ((message: any) => void)[] = []
  const port: FakePort & Record<string, any> = {
    request: null,
    disconnected: false,
    emit: (message) => listeners.forEach((listener) => listener(message)),
    onMessage: { addListener: (listener: any) => listeners.push(listener) },
    onDisconnect: { addListener: () => {} },
    postMessage: (request: any) => {
      port.request = request
    },
    disconnect: () => {
      port.disconnected = true
    },
  }
  ports.push(port)
  return port
}

const cssResult = (approach: string) =>
  ({
    name: 'n',
    kind: 'css',
    capabilities: [],
    code: `/* ${approach} */`,
    rationale: { targets: '', approach, assumptions: [] },
    intent: 'model intent',
  }) as any

function flowAtRefining() {
  const flow = newFlow()
  flow.picked = { ...found, cropDrawn: false } as any
  flow.instruction = 'first'
  flow.result = cssResult('A1')
  flow.step = 'refining'
  return flow
}

/** Waits until the flow has opened its next port, then returns it. */
async function nextPort(count: number): Promise<FakePort> {
  await vi.waitFor(() => expect(ports.length).toBe(count))
  return ports[count - 1]!
}

describe('a refinement that does not complete', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  it('keeps the follow-up and the old conversation when the request fails', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'failed', kind: 'network' } })
    await run

    expect(flow.step).toBe('refining')
    expect(flow.followUp).toBe('second')
    expect(flow.instruction).toBe('first')
    expect(flow.history).toEqual([])
  })

  it('does not send an assistant turn for a request that was never answered', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const failing = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'failed', kind: 'network' } })
    await failing

    flow.followUp = 'third'
    const next = flow.regenerate()
    const port = await nextPort(2)
    expect(port.request.instruction).toBe('third')
    expect(port.request.history.map((turn: any) => turn.content)).toEqual(['first', 'A1'])
    port.emit({ type: 'done', result: cssResult('A3') })
    await next
    expect(flow.step).toBe('refining')
  })

  it('repeats the follow-up that failed when "Try again" is used', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const failing = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'failed', kind: 'network' } })
    await failing

    const again = flow.retry()
    const port = await nextPort(2)
    expect(port.request.instruction).toBe('second')
    expect(port.request.history.map((turn: any) => turn.content)).toEqual(['first', 'A1'])
    port.emit({ type: 'done', result: cssResult('A2') })
    await again
  })

  it('moves the exchange into the history once the refinement succeeds', async () => {
    // Guard against the fix undoing a refinement that worked.
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A2') })
    await run
    expect(flow.followUp).toBe('')
    expect(flow.instruction).toBe('second')
    expect(flow.history.map((turn) => turn.content)).toEqual(['first', 'A1'])
    expect(flow.result?.rationale.approach).toBe('A2')
  })

  it('returns to refining with the previous result and the follow-up when Cancel is used', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const run = flow.regenerate()
    const port = await nextPort(1)
    expect(flow.step).toBe('generating')

    flow.cancelGenerating()
    expect(port.disconnected).toBe(true)
    expect(flow.step).toBe('refining')
    expect(flow.result?.rationale.approach).toBe('A1')
    expect(flow.followUp).toBe('second')
    expect(flow.instruction).toBe('first')
    expect(flow.history).toEqual([])

    // An answer that still arrives must not replace the result on screen.
    port.emit({ type: 'done', result: cssResult('A2') })
    await Promise.race([run, new Promise((resolve) => setTimeout(resolve, 20))])
    expect(flow.result?.rationale.approach).toBe('A1')
    expect(flow.step).toBe('refining')
  })

  it('keeps the previous result when Cancel is used during the analysis', async () => {
    const flow = flowAtRefining()
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    handler = async (m) => {
      if (m.type !== 'analyse') return { ok: true, data: null }
      await gate
      return { ok: true, data: { static: [], undeclaredCapabilities: [], passed: false } }
    }
    flow.followUp = 'second'
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'done', result: { ...jsResult, code: 'new code' } })
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'analyse')).toBe(true))

    flow.cancelGenerating()
    release()
    await run
    expect(flow.step).toBe('refining')
    expect(flow.result?.rationale.approach).toBe('A1')
    expect(flow.analysis?.passed).toBe(true)
    expect(flow.draft).toBeNull()
  })

  it('still discards the run when the first generation is cancelled', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    void flow.generate()
    await nextPort(1)
    flow.cancelGenerating()
    await vi.waitFor(() => expect(flow.step).toBe('list'))
    expect(flow.picked).toBeNull()
  })
})

describe('changing the element from the describing step', () => {
  beforeEach(() => {
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
  })

  it('keeps the description that was typed', async () => {
    const flow = newFlow()
    await flow.startPicking()
    pick(flow)
    flow.instruction = 'make the heading larger'

    await flow.startPicking()
    expect(flow.step).toBe('picking')
    pick(flow, 'h1.other')
    expect(flow.step).toBe('describing')
    expect(flow.picked?.anchor.selector).toBe('h1.other')
    expect(flow.instruction).toBe('make the heading larger')
  })

  it('keeps the pre-filled intent in Edit description', async () => {
    const flow = newFlow()
    await flow.editIntent(saved)
    expect(flow.instruction).toBe('old intent')
    await flow.startPicking()
    pick(flow)
    expect(flow.instruction).toBe('old intent')
    expect(flow.draft?.id).toBe('OLD')
  })

  it('still starts with an empty description for a new pick from the list', async () => {
    const flow = newFlow()
    flow.instruction = 'left over'
    await flow.startPicking()
    pick(flow)
    expect(flow.instruction).toBe('')
  })
})

describe('a reference or region pick still running in the page', () => {
  const stops = () => calls.filter((c) => c.type === 'stop-picking')

  async function refiningWithReferencePick() {
    const flow = flowAtRefining()
    await flow.addReference()
    expect(flow.awaitingReference).toBe(true)
    calls.length = 0
    return flow
  }

  it('is stopped by Discard', async () => {
    const flow = await refiningWithReferencePick()
    await flow.discard()
    expect(stops()).toHaveLength(1)
    expect(flow.awaitingReference).toBe(false)
  })

  it('is stopped by Keep it', async () => {
    const flow = await refiningWithReferencePick()
    flow.toSaving()
    expect(stops()).toHaveLength(1)
    expect(flow.awaitingReference).toBe(false)
  })

  it('is stopped by Generate', async () => {
    const flow = await refiningWithReferencePick()
    flow.followUp = 'again'
    void flow.regenerate()
    expect(stops()).toHaveLength(1)
    expect(flow.awaitingReference).toBe(false)
    flow.reset()
  })

  it('is stopped for a screenshot region pick as well', async () => {
    const flow = flowAtRefining()
    await flow.chooseScreenshotRegion()
    expect(flow.choosingRegion).toBe(true)
    calls.length = 0
    await flow.discard()
    expect(stops()).toHaveLength(1)
    expect(flow.choosingRegion).toBe(false)
  })

  it('sends nothing when no such pick is active', async () => {
    const flow = flowAtRefining()
    await flow.discard()
    expect(stops()).toHaveLength(0)
  })
})

describe('Esc in the page during a screenshot region pick', () => {
  it('lets the screenshot button be used again', async () => {
    const flow = flowAtRefining()
    await flow.chooseScreenshotRegion()
    expect(flow.choosingRegion).toBe(true)
    flow.receive({ type: 'picking-cancelled' } as any, fromRunTab)
    expect(flow.choosingRegion).toBe(false)
    expect(flow.step).toBe('refining')
  })
})

describe('an error card left on the list when the page changes', () => {
  afterEach(() => vi.useRealTimers())

  it('is cleared, with its retry, when another tab is bound', () => {
    const flow = newFlow()
    const again = vi.fn(async () => {})
    flow.fail(new Error('delete failed'), again)
    expect(flow.canRetry).toBe(true)

    flow.bindTab(2, 'https://other.example/')
    expect(flow.error).toBeNull()
    expect(flow.canRetry).toBe(false)
  })

  it('is kept when the same tab is bound again', () => {
    // Control for the test above: binding the unchanged tab (the sidebar does
    // this on every tab event) must not clear a card that still applies.
    const flow = newFlow()
    flow.fail(new Error('delete failed'), vi.fn(async () => {}))
    flow.bindTab(1, URL_)
    expect(flow.error).not.toBeNull()
    expect(flow.canRetry).toBe(true)
  })

  it('is cleared when the bound page reloads, and stops the countdown', async () => {
    vi.useFakeTimers()
    const flow = newFlow()
    const again = vi.fn(async () => {})
    flow.fail(new BackgroundError('slow down', 'rate-limit', true, 3), again)
    expect(flow.error?.kind).toBe('rate-limited')

    flow.pageReloading(1)
    expect(flow.error).toBeNull()
    await vi.advanceTimersByTimeAsync(4000)
    expect(again).not.toHaveBeenCalled()
  })

  it('is kept when a different tab reloads', () => {
    const flow = newFlow()
    flow.fail(new Error('delete failed'), vi.fn(async () => {}))
    flow.pageReloading(9)
    expect(flow.error).not.toBeNull()
  })

  it('does not run its retry on a tab other than the one it came from', async () => {
    const flow = newFlow()
    const again = vi.fn(async () => {})
    flow.fail(new Error('delete failed'), again)
    // Reaches retry() without going through bindTab or pageReloading.
    ;(flow as any).tabId = 2
    await flow.retry()
    expect(again).not.toHaveBeenCalled()
  })

  it('runs its retry on the tab it came from', async () => {
    const flow = newFlow()
    const again = vi.fn(async () => {})
    flow.fail(new Error('delete failed'), again)
    await flow.retry()
    expect(again).toHaveBeenCalledTimes(1)
  })
})

describe('whether the error card says the description is kept', () => {
  it('says so for a failure on the refining step', () => {
    const flow = newFlow()
    flow.step = 'refining'
    flow.fail(new Error('failed'))
    expect((flow.error as any).descriptionKept).toBe(true)
  })

  it('does not say so for a failed repair, which leaves the run', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return failure('network')
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    expect(flow.step).toBe('list')
    expect((flow.error as any).descriptionKept).toBe(false)
  })

  it('does not say so for a failure on the list', () => {
    const flow = newFlow()
    flow.fail(new Error('delete failed'))
    expect((flow.error as any).descriptionKept).toBe(false)
  })
})

describe('events from the page', () => {
  const fromOtherTab = { tab: { id: 2 } }
  const elementPicked = {
    type: 'element-picked',
    context,
    anchor: { ...anchor, selector: 'p.other' },
    crop,
    cropClipped: false,
    cropDrawn: false,
    target: targetInfo,
    tree: [],
    viewportWidth: 800,
  } as any

  async function flowWaitingForPick() {
    const flow = newFlow()
    await flow.startPicking()
    expect(flow.step).toBe('picking')
    return flow
  }

  it('accepts a pick from the tab being worked on', async () => {
    const flow = await flowWaitingForPick()
    flow.receive(elementPicked, fromRunTab)
    expect(flow.step).toBe('describing')
    expect(flow.picked?.anchor.selector).toBe('p.other')
  })

  it('ignores the same pick from another tab', async () => {
    const flow = await flowWaitingForPick()
    flow.receive(elementPicked, fromOtherTab)
    expect(flow.step).toBe('picking')
    expect(flow.picked).toBeNull()
  })

  it('ignores a pick that carries no sender tab', async () => {
    const flow = await flowWaitingForPick()
    flow.receive(elementPicked, {})
    expect(flow.step).toBe('picking')
  })

  it('ignores a region from another tab and accepts one from the run tab', async () => {
    const flow = flowAtRefining()
    flow.choosingRegion = true
    const region = {
      type: 'region-selected',
      rect: { x: 0, y: 0, width: 5, height: 5 },
      viewportWidth: 800,
    } as any
    flow.receive(region, fromOtherTab)
    expect(flow.choosingRegion).toBe(true)
    expect(calls.some((c) => c.type === 'capture-region')).toBe(false)

    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: region.rect, clipped: false } }
        : { ok: true, data: null }
    flow.receive(region, fromRunTab)
    expect(flow.choosingRegion).toBe(false)
    expect(calls.some((c) => c.type === 'capture-region')).toBe(true)
  })

  it('ignores a reference from another tab', async () => {
    const flow = flowAtRefining()
    flow.awaitingReference = true
    const reference = { type: 'element-referenced', element: { selector: 'a.b' } } as any
    flow.receive(reference, fromOtherTab)
    expect(flow.awaitingReference).toBe(true)
    expect(flow.references).toEqual([])
    flow.receive(reference, fromRunTab)
    expect(flow.references).toHaveLength(1)
  })

  it('ignores an event from the run tab when no run is waiting for one', () => {
    const flow = newFlow()
    flow.receive(elementPicked, fromRunTab)
    expect(flow.step).toBe('list')
    expect(flow.picked).toBeNull()

    // On refining with no reference or region pick open, a pick is ignored too.
    const refining = flowAtRefining()
    refining.receive(elementPicked, fromRunTab)
    expect(refining.step).toBe('refining')
    expect(refining.picked?.anchor.selector).toBe('div.x')
  })
})
