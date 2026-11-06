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

/** Every object passed to `storage.local.set`. */
const localWrites: Record<string, unknown>[] = []
/** What `storage.local.get` returns. */
const localStored: Record<string, unknown> = {}
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
  permissions: { request: async () => true, remove: async () => true, contains: async () => true },
  tabs: { update: async () => {}, reload: async () => {}, create: async () => {} },
  storage: {
    local: {
      get: async (key: string) => (key in localStored ? { [key]: localStored[key] } : {}),
      set: async (items: Record<string, unknown>) => {
        localWrites.push(items)
      },
    },
  },
}

const { Flow } = await import('./flow.svelte')
const { BackgroundError } = await import('./messaging.svelte')
const { setBoundTab } = await import('@shared/panel-binding')
const { reviewKey } = await import('./preview-gate')
const transcriptModule = await import('./transcript')

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

/**
 * Marks a flow's JavaScript as read by the second model with a verdict of
 * match, which the preview requires (issue 55). The review is stored the way
 * reviewForPreview stores it, without a model call.
 */
function reviewedForRun(flow: InstanceType<typeof Flow>) {
  flow.result = { ...jsResultBase, code: flow.draft?.code ?? 'x' } as any
  ;(flow as any).previewReview = {
    static: [],
    undeclaredCapabilities: [],
    passed: true,
    model: { verdict: 'match', explanation: '' },
    approvalToken: 'preview-token',
  }
  ;(flow as any).previewReviewFor = reviewKey(flow.result as any, flow.intent)
}
const jsResultBase = {
  name: 'n',
  kind: 'js',
  world: 'USER_SCRIPT',
  requestedWorld: 'USER_SCRIPT',
  worldReason: '',
  capabilities: [],
  config: [],
  rationale: { targets: '', approach: '', assumptions: [] },
  intent: 'i',
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
  config: [],
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
    reviewedForRun(flow)
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

  it('clears a running JavaScript preview when the tab closes', async () => {
    const flow = flowAtApprove()
    flow.draft = { ...saved, kind: 'js' }
    flow.jsRan = true
    flow.tabClosed(1)
    // The background restores the saved script it paused for the preview.
    expect(calls.filter((c) => c.type === 'clear-preview-js').map((c) => c.id)).toEqual(['OLD'])
    expect(flow.jsRan).toBe(false)
  })

  it('sends no preview clear when the tab closes and no script ran', () => {
    const flow = flowAtApprove()
    flow.tabClosed(1)
    expect(calls.some((c) => c.type === 'clear-preview-js')).toBe(false)
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
  name: string
  request: any
  disconnected: boolean
  emit: (message: any) => void
}
const ports: FakePort[] = []
const realConnect = (globalThis as any).browser.runtime.connect

/** Stands in for the `wa-generate` port: the test decides what it answers. */
function fakeConnect(info?: { name: string }) {
  const listeners: ((message: any) => void)[] = []
  const port: FakePort & Record<string, any> = {
    name: info?.name ?? '',
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
    config: [],
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

describe('the record that the all-sites grant is held for a run (#134)', () => {
  const grantWrites = () => localWrites.filter((w) => 'wa-capture-grant-held' in w).map((w) => w['wa-capture-grant-held'])
  beforeEach(() => {
    localWrites.length = 0
  })

  it('is written when the grant is requested', async () => {
    const flow = flowAtRefining()
    await flow.chooseScreenshotRegion()
    expect(grantWrites()).toEqual([true])
  })

  it('is cleared when the grant is refused', async () => {
    const flow = flowAtRefining()
    ;(globalThis as any).browser.permissions.request = async () => false
    await flow.chooseScreenshotRegion()
    ;(globalThis as any).browser.permissions.request = async () => true
    expect(grantWrites()).toEqual([true, false])
  })

  it('is cleared when the run hands the grant back', async () => {
    const flow = flowAtRefining()
    await flow.chooseScreenshotRegion()
    flow.cancelScreenshot()
    expect(grantWrites()).toEqual([true, false])
  })

  it('control: a flow that never asked for the grant writes nothing', () => {
    // Shows the writes above come from the request, not from creating a flow.
    flowAtRefining()
    expect(grantWrites()).toEqual([])
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
  it('says it once, from the card, when the script permission is refused', async () => {
    const flow = flowAtRefining()
    flow.draft = { ...saved, kind: 'js' }
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    reviewedForRun(flow)
    ;(globalThis as any).browser.permissions.request = async () => false
    await flow.runJs()
    ;(globalThis as any).browser.permissions.request = async () => true
    const error = flow.error as any
    // The card appends " Your description is kept." when this is true, so the
    // message must not say it as well. Control: before the change the message
    // itself ended with "and your description is kept".
    expect(error.descriptionKept).toBe(true)
    expect(error.message).not.toMatch(/description is kept/)
  })

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

  it('reports whether the event was accepted, which gates showing the panel tab (#128)', async () => {
    const flow = await flowWaitingForPick()
    expect(flow.receive(elementPicked, fromOtherTab)).toBe(false)
    expect(flow.receive(elementPicked, {})).toBe(false)
    expect(flow.receive({ type: 'picking-cancelled' } as any, fromOtherTab)).toBe(false)
    expect(flow.receive(elementPicked, fromRunTab)).toBe(true)
  })

  it('reports an event as not accepted when no run is waiting for the page (#128)', () => {
    const flow = newFlow()
    expect(flow.step).toBe('list')
    expect(flow.receive({ type: 'picking-cancelled' } as any, fromRunTab)).toBe(false)
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

  it('ignores every kind of event from the run tab when no run is waiting for one', () => {
    /*
     * Reverting the awaitingPageEvent gate in receive alone does not fail this
     * test, and cannot: each case in the switch already checks the step or
     * flag it needs, so the gate is a second check with no behaviour of its
     * own. The test therefore covers the contract (no event changes a flow
     * that is not waiting) and was measured by removing the gate together with
     * the per-case checks, which does fail it.
     */
    const events = [
      elementPicked,
      { type: 'element-referenced', element: { selector: 'a.b' } },
      { type: 'region-selected', rect: crop, viewportWidth: 800, clipped: false },
      { type: 'element-hovered', target: targetInfo },
      { type: 'picking-cancelled' },
    ] as any[]

    for (const make of [newFlow, flowAtRefining]) {
      for (const event of events) {
        const flow = make()
        const step = flow.step
        const picked = flow.picked
        flow.receive(event, fromRunTab)
        expect(flow.step).toBe(step)
        expect(flow.picked).toBe(picked)
        expect(flow.references).toEqual([])
        expect(flow.hover).toBeNull()
      }
    }
    expect(calls.some((c) => c.type === 'capture-region')).toBe(false)
  })
})

describe('restoring the saved scope depth', () => {
  const deep = { ...saved, scopeDepth: 2 }
  const handlerWithScope = (m: any) => {
    if (m.type === 'context-for-anchor') return { ok: true, data: found }
    if (m.type === 'set-lock-scope') return { ok: true, data: { count: 4, container: 'ul.list' } }
    return { ok: true, data: null }
  }

  it.each([
    ['editIntent', (f: InstanceType<typeof Flow>) => f.editIntent(deep)],
    ['editWithAi', (f: InstanceType<typeof Flow>) => f.editWithAi(deep)],
  ])('%s takes the count and the container from the page', async (_name, run) => {
    const flow = newFlow()
    handler = handlerWithScope
    await run(flow)
    // The page was asked to apply the depth, so the lock outline matches it.
    expect(calls.filter((c) => c.type === 'set-lock-scope').map((c) => c.depth)).toEqual([2])
    expect(flow.scopeDepth).toBe(2)
    expect(flow.scopeCount).toBe(4)
    expect(flow.scopeContainer).toBe('ul.list')
  })

  it('repair asks the page to apply the depth before it generates', async () => {
    const flow = newFlow()
    // The repair call fails, which resets the flow, so only the messages sent
    // are checked here.
    handler = (m) => (m.type === 'repair' ? failure('network') : handlerWithScope(m))
    await flow.repair(deep, 'broken')
    const types = calls.map((c) => c.type)
    expect(calls.filter((c) => c.type === 'set-lock-scope').map((c) => c.depth)).toEqual([2])
    expect(types.indexOf('set-lock-scope')).toBeLessThan(types.indexOf('repair'))
  })
})

describe('regenerating after a script has run', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  const jsResult = () => ({ ...cssResult('A1'), kind: 'js', world: 'USER_SCRIPT' }) as any

  it('does nothing while the ran script is still on the page', async () => {
    const flow = flowAtRefining()
    flow.result = jsResult()
    flow.jsRan = true
    flow.followUp = 'make it bigger'
    await flow.regenerate()
    expect(ports.length).toBe(0)
    expect(flow.step).toBe('refining')
    expect(flow.followUp).toBe('make it bigger')
    expect(flow.history).toEqual([])
  })

  it('still regenerates a script that has not run', async () => {
    // The control for the test above: the refusal depends on jsRan, so the
    // same call with it false has to reach the model.
    const flow = flowAtRefining()
    flow.result = jsResult()
    flow.followUp = 'make it bigger'
    void flow.regenerate()
    await nextPort(1)
  })
})

describe('opening Change with AI', () => {
  it('starts with an empty history, so the first exchange is not repeated', async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
    await flow.editWithAi(saved)
    expect(flow.step).toBe('refining')
    // The stored pair is already the instruction and the result on screen.
    expect(flow.history).toEqual([])
    expect(flow.instruction).toBe('old intent')
    expect(flow.result?.rationale.approach).toBe('a')
  })
})

describe('including the drawn region', () => {
  it('sends the scroll offset the region was drawn at with the capture', async () => {
    const flow = newFlow()
    await flow.startPicking()
    flow.receive(
      {
        type: 'element-picked',
        context,
        anchor,
        crop,
        cropClipped: false,
        cropDrawn: true,
        target: targetInfo,
        tree: [],
        viewportWidth: 800,
        scrolledTo: { x: 0, y: 340 },
      } as any,
      fromRunTab,
    )
    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    const capture = calls.find((c) => c.type === 'capture-region')
    // The background needs this to move the rectangle by the distance the page
    // has scrolled since; without it the old viewport numbers are cropped.
    expect(capture?.scrolledTo).toEqual({ x: 0, y: 340 })
    // The background refuses the capture unless the run's tab still shows this
    // address (#135).
    expect(capture?.url).toBe(URL_)
  })

  it('records that the area was moved so the preview can say so (#119)', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: true, scrolledTo: { x: 0, y: 340 } } as any
    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false, moved: true } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    expect(flow.shotMoved).toBe(true)

    // Control: a reply that is not marked as moved clears it.
    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    expect(flow.shotMoved).toBe(false)
  })
})

describe('a screenshot that was made smaller (#37)', () => {
  it('records both sizes so the preview can say so, and clears them for an image that was not reduced and when the shot is dropped', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: true } as any
    const reduced = { from: { width: 3000, height: 2000 }, to: { width: 1568, height: 1045 } }
    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false, reduced } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    expect(flow.shotReduced).toEqual(reduced)

    // Control: the next reply has no reduction and the note goes.
    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    expect(flow.shotReduced).toBeNull()

    handler = (m) =>
      m.type === 'capture-region'
        ? { ok: true, data: { dataUrl: 'data:', rect: crop, clipped: false, reduced } }
        : { ok: true, data: null }
    await flow.includePickedRegion()
    expect(flow.shotReduced).toEqual(reduced)
    flow.cancelScreenshot()
    expect(flow.shotReduced).toBeNull()
  })
})

describe('cancelling while the preview is applied', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  /** Holds the first preview-css request until the test lets it through. */
  function holdPreview() {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    handler = async (m) => {
      // The CSS check runs before the preview, so it has to answer for the preview to be reached.
      if (m.type === 'analyse-css') {
        return { ok: true, data: { static: [], undeclaredCapabilities: [], pendingUrls: [], passed: true } }
      }
      if (m.type === 'preview-css' && m.css === '/* A2 */') await gate
      return { ok: true, data: null }
    }
    return release
  }
  const previews = () =>
    calls.filter((c) => c.type === 'preview-css' || c.type === 'clear-preview-css')

  it('returns to the previous result and puts its CSS back on the page', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const release = holdPreview()
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A2') })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.type === 'preview-css' && c.css === '/* A2 */')).toBe(true),
    )

    flow.cancelGenerating()
    // Control: before the fix the marker was already cleared here, so Cancel
    // discarded the run and the step was 'list'.
    expect(flow.step).toBe('refining')
    expect(flow.result?.rationale.approach).toBe('A1')
    expect(flow.followUp).toBe('second')

    release()
    await run
    // The late CSS is removed, then the previous result's CSS is applied.
    const last = previews().slice(-2)
    expect(last.map((c) => c.type)).toEqual(['clear-preview-css', 'preview-css'])
    expect(last[1].css).toBe('/* A1 */')
    expect(flow.result?.rationale.approach).toBe('A1')
    expect(flow.step).toBe('refining')
  })

  it('removes the late CSS of a first generation that was cancelled', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const release = holdPreview()
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A2') })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.type === 'preview-css' && c.css === '/* A2 */')).toBe(true),
    )
    flow.cancelGenerating()
    await vi.waitFor(() => expect(flow.step).toBe('list'))

    release()
    await run
    // The last request is a removal, so nothing from the cancelled attempt stays.
    expect(previews().at(-1)?.type).toBe('clear-preview-css')
    expect(previews().filter((c) => c.type === 'preview-css')).toHaveLength(1)
  })
})

describe('a late preview cleanup after a new run started (#110)', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  async function cancelledFirstRun(release: { fn: () => void }) {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const gate = new Promise<void>((resolve) => (release.fn = resolve))
    handler = async (m) => {
      // The CSS check runs before the preview, so it has to answer for the preview to be reached.
      if (m.type === 'analyse-css') {
        return { ok: true, data: { static: [], undeclaredCapabilities: [], pendingUrls: [], passed: true } }
      }
      if (m.type === 'preview-css' && m.css === '/* A */') await gate
      return { ok: true, data: null }
    }
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A') })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.type === 'preview-css' && c.css === '/* A */')).toBe(true),
    )
    flow.cancelGenerating()
    await vi.waitFor(() => expect(flow.step).toBe('list'))
    return { flow, run }
  }

  it('leaves the newer run its preview', async () => {
    const release = { fn: () => {} }
    const { flow, run } = await cancelledFirstRun(release)

    // A quick second run on the same tab, which previews before the first
    // run's held request returns.
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'second'
    flow.step = 'describing'
    const second = flow.generate()
    ;(await nextPort(2)).emit({ type: 'done', result: cssResult('B') })
    await second
    expect(calls.some((c) => c.type === 'preview-css' && c.css === '/* B */')).toBe(true)
    const before = calls.length

    release.fn()
    await run
    // Nothing is sent for the cancelled run after the second run's preview.
    expect(calls.slice(before).filter((c) => c.type === 'clear-preview-css')).toEqual([])
    expect(flow.step).toBe('refining')
  })

  it('still removes the late CSS when no new run started (control)', async () => {
    const release = { fn: () => {} }
    const { run } = await cancelledFirstRun(release)
    const before = calls.length
    release.fn()
    await run
    expect(calls.slice(before).filter((c) => c.type === 'clear-preview-css')).toHaveLength(1)
  })
})

describe('a re-pick from Edit description', () => {
  const describing = async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor' ? { ok: true, data: found } : { ok: true, data: null }
    await flow.editIntent(saved)
    return flow
  }
  const withPermission = (request: () => Promise<boolean>) => {
    const api = (globalThis as any).browser.permissions
    const before = api.request
    api.request = request
    return () => (api.request = before)
  }

  it('returns to the description when the permission request throws', async () => {
    const flow = await describing()
    const restore = withPermission(async () => {
      throw new Error('request failed')
    })
    try {
      await flow.startPicking()
    } finally {
      restore()
    }
    // Control: with the held element recorded after the request, the catch
    // found nothing to return to and discarded the run (step 'list').
    expect(flow.step).toBe('describing')
    expect(flow.draft?.id).toBe('OLD')
    expect(flow.picked?.anchor.selector).toBe('div.x')
  })

  it('leaves nothing held when the permission is refused', async () => {
    const flow = await describing()
    const restore = withPermission(async () => false)
    try {
      await flow.startPicking()
    } finally {
      restore()
    }
    expect(flow.step).toBe('describing')
    expect(flow.picked).not.toBeNull()
    // A later cancel with no pick open must not return from a pick that never started.
    await flow.cancelPicking()
    expect(flow.step).toBe('list')
  })

  it('keeps the tree when the page has no element to expand', async () => {
    const flow = await describing()
    flow.tree = [{ label: 'row' }] as any
    handler = (m) => (m.type === 'expand-node' ? { ok: true, data: null } : { ok: true, data: null })
    await flow.expand({ up: 0, down: [0] } as any)
    expect(flow.tree).toEqual([{ label: 'row' }])
  })
})

describe('a JavaScript preview that is answered after the run ended (#98)', () => {
  function flowWithDraft() {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    reviewedForRun(flow)
    return flow
  }

  /** A preview-js reply that the test releases when it chooses. */
  function holdPreviewReply() {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    handler = async (m) => {
      if (m.type === 'preview-js') await gate
      return { ok: true, data: null }
    }
    return release
  }

  it('clears the preview when the run was discarded before the reply', async () => {
    const flow = flowWithDraft()
    const release = holdPreviewReply()
    const run = flow.runJs()
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'preview-js')).toBe(true))
    await flow.discard()
    expect(calls.some((c) => c.type === 'clear-preview-js')).toBe(false)
    release()
    await run
    expect(calls.filter((c) => c.type === 'clear-preview-js').map((c) => c.id)).toEqual(['OLD'])
    expect(flow.jsRan).toBe(false)
  })

  it('clears the preview when the tab closed before the reply', async () => {
    const flow = flowWithDraft()
    const release = holdPreviewReply()
    const run = flow.runJs()
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'preview-js')).toBe(true))
    flow.tabClosed(1)
    release()
    await run
    expect(calls.filter((c) => c.type === 'clear-preview-js').map((c) => c.id)).toEqual(['OLD'])
  })

  it('records the run and sends no clear when the reply arrives while the run is current (control)', async () => {
    const flow = flowWithDraft()
    handler = () => ({ ok: true, data: null })
    await flow.runJs()
    expect(flow.jsRan).toBe(true)
    expect(calls.some((c) => c.type === 'clear-preview-js')).toBe(false)
  })
})

describe('reload and try again with a script that has run (#114)', () => {
  function flowWithRunScript() {
    const flow = flowAtApprove()
    flow.draft = { ...saved, kind: 'js' }
    flow.jsRan = true
    flow.step = 'refining'
    return flow
  }
  const reloads: number[] = []
  const realReload = (globalThis as any).browser.tabs.reload
  beforeEach(() => {
    reloads.length = 0
    ;(globalThis as any).browser.tabs.reload = async (id: number) => void reloads.push(id)
  })
  afterEach(() => {
    ;(globalThis as any).browser.tabs.reload = realReload
  })

  it('does nothing when the follow-up is empty', async () => {
    const flow = flowWithRunScript()
    flow.followUp = '   '
    await flow.reloadAndRetry()
    expect(reloads).toEqual([])
    expect(calls.some((c) => c.type === 'clear-preview-js')).toBe(false)
    expect(flow.jsRan).toBe(true)
  })

  it('clears the preview, reloads and regenerates when there is a follow-up (control)', async () => {
    const flow = flowWithRunScript()
    flow.followUp = 'make it smaller'
    const generate = vi.spyOn(flow, 'generate').mockResolvedValue(undefined)
    await flow.reloadAndRetry()
    expect(reloads).toEqual([1])
    expect(calls.filter((c) => c.type === 'clear-preview-js').map((c) => c.id)).toEqual(['OLD'])
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

describe('a repair or regeneration of a transform restricted to a container (#127)', () => {
  const restricted = { ...saved, enabled: true, cookieStoreId: 'firefox-container-3' }
  const generated = {
    name: 'New',
    kind: 'css',
    code: 'div { color: red }',
    capabilities: [],
    config: [],
    rationale: { targets: 't', approach: 'a', assumptions: [] },
  }
  const savedCall = () => calls.filter((c) => c.type === 'save-transform').at(-1)

  async function repairAndSave(from: typeof saved) {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair' || m.type === 'generate') {
        return { ok: true, data: { result: generated } }
      }
      return { ok: true, data: null }
    }
    await flow.repair(from, 'broken')
    expect(flow.step).toBe('refining')
    return flow
  }

  it('keeps the restriction in the record that is saved after a repair', async () => {
    const flow = await repairAndSave(restricted)
    await flow.save()
    expect(savedCall()?.transform.cookieStoreId).toBe('firefox-container-3')
    expect(savedCall()?.transform.code).toBe('div { color: red }')
  })

  // Control: a transform with no restriction is saved with none, so the field
  // above comes from the transform that was repaired.
  it('control: a repair of an unrestricted transform saves no restriction', async () => {
    const flow = await repairAndSave({ ...restricted, cookieStoreId: undefined })
    await flow.save()
    expect(savedCall()?.transform).not.toHaveProperty('cookieStoreId')
  })
})

describe('the review is given what the user typed (#52)', () => {
  it('sends the description and every follow-up verbatim, not the model intent', async () => {
    const flow = flowAtApprove()
    flow.history = [
      { role: 'user', content: 'first description' },
      { role: 'assistant', content: 'model approach text' },
    ]
    flow.instruction = 'the follow-up as typed'
    handler = () => ({ ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } })

    await flow.toReview()

    const sent = calls.filter((c) => c.type === 'review').at(-1)
    expect(sent.instructions).toEqual([
      { text: 'first description', source: 'typed' },
      { text: 'the follow-up as typed', source: 'typed' },
    ])
    expect(sent.intent).toBe('edited intent')
  })
})

describe('the description of an imported transform (#56)', () => {
  const importedJs = { ...saved, kind: 'js', origin: 'imported', code: '', intent: 'IMPORTED INTENT' }
  const handlerFor = (m: any) => {
    if (m.type === 'context-for-anchor') return { ok: true, data: found }
    if (m.type === 'analyse' || m.type === 'review') {
      return { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    }
    return { ok: true, data: null }
  }
  const lastReview = () => calls.filter((c) => c.type === 'review').at(-1)
  const jsOut = { ...jsResult, code: 'document.body.remove()' }

  it('labels an unchanged imported description as imported for the reviewer', async () => {
    const flow = newFlow()
    handler = handlerFor
    await flow.editIntent(importedJs)
    flow.result = jsOut
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'IMPORTED INTENT', source: 'imported-description' }])
  })

  it('counts the description as the user\'s once it was changed, and says where it started', async () => {
    const flow = newFlow()
    handler = handlerFor
    await flow.editIntent(importedJs)
    flow.result = jsOut
    flow.instruction = 'IMPORTED INTENT, only the banner'
    await flow.toReview()
    expect(lastReview().instructions).toEqual([
      { text: 'IMPORTED INTENT, only the banner', source: 'imported-description-edited' },
    ])
  })

  it('control: the same flow for a transform the user saved is a saved description, not an imported one', async () => {
    const flow = newFlow()
    handler = handlerFor
    await flow.editIntent({ ...importedJs, origin: 'ai' })
    flow.result = jsOut
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'IMPORTED INTENT', source: 'saved-description' }])
  })

  it('shows the description before anything is sent when Repair is chosen', async () => {
    const flow = newFlow()
    handler = handlerFor
    await flow.repair(importedJs, 'broken')
    expect(flow.step).toBe('describing')
    expect(flow.instruction).toBe('IMPORTED INTENT')
    expect(calls.some((c) => c.type === 'repair')).toBe(false)
  })

  it('control: Repair of a transform the user saved still starts the repair at once', async () => {
    const flow = newFlow()
    handler = (m: any) =>
      m.type === 'repair' ? { ok: true, data: { result: jsOut } } : handlerFor(m)
    await flow.repair({ ...importedJs, origin: 'ai', code: 'x()' }, 'broken')
    expect(calls.some((c) => c.type === 'repair')).toBe(true)
  })

  describe('what the generator is sent', () => {
    beforeEach(() => {
      ports.length = 0
      ;(globalThis as any).browser.runtime.connect = fakeConnect
    })
    afterEach(() => {
      ;(globalThis as any).browser.runtime.connect = realConnect
    })

    it('marks an unchanged imported description', async () => {
      const flow = newFlow()
      handler = handlerFor
      await flow.editIntent(importedJs)
      void flow.generate()
      const port = await nextPort(1)
      expect(port.request.instruction).toBe('IMPORTED INTENT')
      expect(port.request.instructionImported).toBe(true)
    })

    it('does not mark a description the user changed', async () => {
      const flow = newFlow()
      handler = handlerFor
      await flow.editIntent(importedJs)
      flow.instruction = 'IMPORTED INTENT, only the banner'
      void flow.generate()
      const port = await nextPort(1)
      expect(port.request.instructionImported).toBe(false)
    })

    it('does not mark the description of a transform the user saved (control)', async () => {
      const flow = newFlow()
      handler = handlerFor
      await flow.editIntent({ ...importedJs, origin: 'ai' })
      void flow.generate()
      const port = await nextPort(1)
      expect(port.request.instructionImported).toBe(false)
    })
  })
})

describe('a follow-up on an imported transform (#56)', () => {
  const importedWithCode = {
    ...saved,
    kind: 'js',
    origin: 'imported',
    code: 'document.body.remove()',
    intent: 'IMPORTED INTENT',
    rationale: { targets: '', approach: 'FILE APPROACH', assumptions: [] },
  }
  const handlerFor = (m: any) => {
    if (m.type === 'context-for-anchor') return { ok: true, data: found }
    if (m.type === 'analyse' || m.type === 'review') {
      return { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    }
    return { ok: true, data: null }
  }
  const lastReview = () => calls.filter((c) => c.type === 'review').at(-1)

  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
    handler = handlerFor
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  describe('Change with AI', () => {
    it('keeps the description and the file rationale out of the history and sends the description fenced', async () => {
      const flow = newFlow()
      await flow.editWithAi(importedWithCode)
      flow.followUp = 'make it blue'
      const run = flow.regenerate()
      const port = await nextPort(1)
      expect(port.request.instruction).toBe('make it blue')
      expect(port.request.history).toEqual([])
      expect(port.request.importedDescription).toBe('IMPORTED INTENT')
      expect(JSON.stringify(port.request)).not.toContain('FILE APPROACH')
      port.emit({ type: 'done', result: { ...cssResult('MODEL APPROACH'), kind: 'js', code: 'x()' } })
      await run

      // The next turn still carries the description, and the history now holds
      // only what the user typed and what the model answered.
      flow.followUp = 'and bigger'
      const next = flow.regenerate()
      const second = await nextPort(2)
      expect(second.request.importedDescription).toBe('IMPORTED INTENT')
      expect(second.request.history).toEqual([
        { role: 'user', content: 'make it blue' },
        { role: 'assistant', content: 'MODEL APPROACH' },
      ])
      second.emit({ type: 'done', result: cssResult('A3') })
      await next
    })

    it('labels the description as imported for the review, in both the instructions and the intent', async () => {
      const flow = newFlow()
      await flow.editWithAi(importedWithCode)
      await flow.toReview()
      expect(lastReview().intentImported).toBe(true)

      flow.followUp = 'make it blue'
      const run = flow.regenerate()
      const port = await nextPort(1)
      flow.result = { ...jsResultBase, code: 'x()' } as any
      await flow.toReview()
      expect(lastReview().instructions).toEqual([
        { text: 'IMPORTED INTENT', source: 'imported-description' },
        { text: 'make it blue', source: 'typed' },
      ])
      port.emit({ type: 'done', result: { ...cssResult('M'), kind: 'js', code: 'x()' } })
      await run
      // The generator wrote the intent now, so it is no longer called imported.
      await flow.toReview()
      expect(lastReview().intentImported).toBeUndefined()
    })

    it('sends an unchanged saved description fenced and not the stored rationale (#149)', async () => {
      const flow = newFlow()
      await flow.editWithAi({ ...importedWithCode, origin: 'ai' })
      flow.followUp = 'make it blue'
      const run = flow.regenerate()
      const port = await nextPort(1)
      expect(port.request.history).toEqual([])
      expect(port.request.savedDescription).toBe('IMPORTED INTENT')
      expect(port.request.importedDescription).toBeUndefined()
      expect(JSON.stringify(port.request)).not.toContain('FILE APPROACH')
      port.emit({ type: 'done', result: cssResult('MODEL APPROACH') })
      await run

      // The next turn still carries the description, and the history holds what
      // the user typed and what the model answered.
      flow.followUp = 'and bigger'
      const next = flow.regenerate()
      const second = await nextPort(2)
      expect(second.request.savedDescription).toBe('IMPORTED INTENT')
      expect(second.request.history).toEqual([
        { role: 'user', content: 'make it blue' },
        { role: 'assistant', content: 'MODEL APPROACH' },
      ])
      second.emit({ type: 'done', result: cssResult('A3') })
      await next
    })

    it('labels the saved description as saved in the review, not as typed', async () => {
      const flow = newFlow()
      await flow.editWithAi({ ...importedWithCode, origin: 'ai' })
      flow.followUp = 'make it blue'
      const run = flow.regenerate()
      ;(await nextPort(1)).emit({ type: 'done', result: { ...cssResult('A2'), kind: 'js', code: 'x()' } })
      await run
      flow.result = { ...jsResultBase, code: 'x()' } as any
      await flow.toReview()
      expect(lastReview().instructions).toEqual([
        { text: 'IMPORTED INTENT', source: 'saved-description' },
        { text: 'make it blue', source: 'typed' },
      ])
    })

    it('control: a saved description the user changed is theirs and keeps its turns in the history', async () => {
      const flow = newFlow()
      await flow.editWithAi({ ...importedWithCode, origin: 'ai' })
      flow.instruction = 'IMPORTED INTENT, but smaller'
      flow.followUp = 'make it blue'
      void flow.regenerate()
      const port = await nextPort(1)
      expect(port.request.savedDescription).toBeUndefined()
      expect(port.request.history).toEqual([
        { role: 'user', content: 'IMPORTED INTENT, but smaller' },
        { role: 'assistant', content: 'FILE APPROACH' },
      ])
    })

    it('puts the history back when the follow-up fails, so the description is still sent next time', async () => {
      const flow = newFlow()
      await flow.editWithAi(importedWithCode)
      flow.followUp = 'make it blue'
      const failing = flow.regenerate()
      ;(await nextPort(1)).emit({ type: 'error', error: { message: 'failed', kind: 'network' } })
      await failing
      const again = flow.retry()
      const port = await nextPort(2)
      expect(port.request.importedDescription).toBe('IMPORTED INTENT')
      expect(port.request.history).toEqual([])
      port.emit({ type: 'done', result: cssResult('A2') })
      await again
    })
  })

  describe('Edit description, sent unchanged', () => {
    const importedJs = { ...saved, kind: 'js', origin: 'imported', code: '', intent: 'IMPORTED INTENT' }

    it('keeps the description out of the history on the follow-up and sends it fenced', async () => {
      const flow = newFlow()
      await flow.editIntent(importedJs)
      const first = flow.generate()
      const port1 = await nextPort(1)
      expect(port1.request.instructionImported).toBe(true)
      port1.emit({ type: 'done', result: cssResult('A1') })
      await first

      flow.followUp = 'only the banner'
      const run = flow.regenerate()
      const port = await nextPort(2)
      expect(port.request.instruction).toBe('only the banner')
      expect(port.request.instructionImported).toBe(false)
      expect(port.request.importedDescription).toBe('IMPORTED INTENT')
      expect(port.request.history).toEqual([])
      port.emit({ type: 'done', result: cssResult('A2') })
      await run

      flow.result = { ...jsResultBase, code: 'x()' } as any
      await flow.toReview()
      expect(lastReview().instructions).toEqual([
        { text: 'IMPORTED INTENT', source: 'imported-description' },
        { text: 'only the banner', source: 'typed' },
      ])
    })

    it('sends an unchanged saved description fenced on the first run (#149)', async () => {
      const flow = newFlow()
      await flow.editIntent({ ...importedJs, origin: 'ai' })
      const first = flow.generate()
      const port = await nextPort(1)
      expect(port.request.instructionSaved).toBe(true)
      expect(port.request.instructionImported).toBe(false)
      port.emit({ type: 'done', result: cssResult('A1') })
      await first
    })

    it('control: an edited saved description is sent as the user instruction on the first run (#149)', async () => {
      const flow = newFlow()
      await flow.editIntent({ ...importedJs, origin: 'ai' })
      flow.instruction = 'IMPORTED INTENT, only the banner'
      const first = flow.generate()
      const port = await nextPort(1)
      expect(port.request.instructionSaved).toBe(false)
      expect(port.request.instruction).toBe('IMPORTED INTENT, only the banner')
      port.emit({ type: 'done', result: cssResult('A1') })
      await first
    })

    it('control: a description the user changed is theirs and goes into the history', async () => {
      const flow = newFlow()
      await flow.editIntent(importedJs)
      flow.instruction = 'IMPORTED INTENT, only the banner'
      const first = flow.generate()
      ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A1') })
      await first

      flow.followUp = 'smaller'
      void flow.regenerate()
      const port = await nextPort(2)
      expect(port.request.importedDescription).toBeUndefined()
      expect(port.request.history).toEqual([
        { role: 'user', content: 'IMPORTED INTENT, only the banner' },
        { role: 'assistant', content: 'A1' },
      ])
    })
  })
})

describe('the review is told where a pre-filled instruction came from (#52)', () => {
  const repaired = {
    ...jsResult,
    code: 'document.body.remove()',
    intent: 'new model intent',
  }
  const reviewHandler = (m: any) => {
    if (m.type === 'context-for-anchor') return { ok: true, data: found }
    if (m.type === 'repair') return { ok: true, data: { result: repaired } }
    if (m.type === 'analyse' || m.type === 'review') {
      return { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    }
    return { ok: true, data: null }
  }
  const lastReview = () => calls.filter((c) => c.type === 'review').at(-1)

  it('marks the stored intent as a saved description after Repair', async () => {
    const flow = newFlow()
    handler = reviewHandler
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED INTENT' }, 'broken')
    expect(flow.step).toBe('refining')
    await flow.toReview()
    expect(lastReview().instructions).toEqual([
      { text: 'STORED INTENT', source: 'saved-description' },
    ])
  })

  it('keeps it marked after a follow-up moves it into the history', async () => {
    const flow = newFlow()
    handler = reviewHandler
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED INTENT' }, 'broken')
    flow.history = [{ role: 'user', content: 'STORED INTENT' }]
    flow.instruction = 'make it smaller'
    await flow.toReview()
    expect(lastReview().instructions).toEqual([
      { text: 'STORED INTENT', source: 'saved-description' },
      { text: 'make it smaller', source: 'typed' },
    ])
  })

  it('marks Edit description text the user changed as edited, and unchanged text as saved', async () => {
    const flow = newFlow()
    handler = reviewHandler
    await flow.editIntent({ ...saved, kind: 'js', intent: 'STORED INTENT' })
    flow.result = jsResult
    flow.instruction = 'STORED INTENT, but smaller'
    await flow.toReview()
    expect(lastReview().instructions).toEqual([
      { text: 'STORED INTENT, but smaller', source: 'saved-description-edited' },
    ])
    flow.instruction = 'STORED INTENT'
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'STORED INTENT', source: 'saved-description' }])
  })

  it('keeps the mark through a re-pick inside Edit description', async () => {
    const flow = newFlow()
    handler = reviewHandler
    await flow.editIntent({ ...saved, kind: 'js', intent: 'STORED INTENT' })
    await flow.startPicking()
    pick(flow)
    flow.result = jsResult
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'STORED INTENT', source: 'saved-description' }])
  })

  it('control: a first description typed on a new pick is typed', async () => {
    const flow = newFlow()
    handler = reviewHandler
    flow.picked = { ...found, cropDrawn: false } as any
    flow.result = jsResult
    flow.instruction = 'hide the banner'
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'hide the banner', source: 'typed' }])
  })

  it('control: a new pick after a repair does not inherit the mark', async () => {
    const flow = newFlow()
    handler = reviewHandler
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED INTENT' }, 'broken')
    await flow.discard()
    await flow.startPicking()
    pick(flow)
    flow.instruction = 'STORED INTENT'
    flow.result = jsResult
    await flow.toReview()
    expect(lastReview().instructions).toEqual([{ text: 'STORED INTENT', source: 'typed' }])
  })
})

describe('the review is told whether the user edited the intent (#52)', () => {
  const lastReview = () => calls.filter((c) => c.type === 'review').at(-1)
  const handlers = (m: any) => {
    if (m.type === 'review') return { ok: true, data: { static: [], undeclaredCapabilities: [], passed: true } }
    return { ok: true, data: null }
  }

  it('flags an intent that differs from the one the model returned', async () => {
    const flow = flowAtApprove()
    flow.intentBaseline = 'model intent'
    flow.intent = 'edited intent'
    handler = handlers
    await flow.toReview()
    expect(lastReview().intentEditedByUser).toBe(true)
  })

  it('control: does not flag an intent left as the model returned it', async () => {
    const flow = flowAtApprove()
    flow.intentBaseline = 'model intent'
    flow.intent = 'model intent'
    handler = handlers
    await flow.toReview()
    expect(lastReview().intentEditedByUser).toBe(false)
  })

  it('control: does not flag a stored intent after Repair, which differs from the new result', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return { ok: true, data: { result: { ...jsResult, intent: 'new model intent' } } }
      return handlers(m)
    }
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED' }, 'broken')
    await flow.toReview()
    expect(lastReview().intent).toBe('STORED')
    expect(lastReview().intentEditedByUser).toBe(false)
  })
})

describe('the address that is shown is the address that is sent (#65)', () => {
  /** Replaces the port so the request the flow posts can be read. */
  function capturePort() {
    const posted: any[] = []
    ;(globalThis as any).browser.runtime.connect = () => {
      const listeners: ((m: object) => void)[] = []
      return {
        onMessage: { addListener: (fn: (m: object) => void) => listeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        postMessage: (message: any) => {
          posted.push(message)
          queueMicrotask(() => listeners.forEach((fn) => fn({ type: 'error', error: { message: 'stop' } })))
        },
        disconnect: () => {},
      }
    }
    return posted
  }
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = () => {
      throw new Error('no port in test')
    }
  })

  const picked = { ...context, url: 'https://shop.example/cart' }
  const recaptured = { ...context, url: 'https://shop.example/cart?step=2' }

  it('sends the address captured at pick time, not the one read at send time', async () => {
    const posted = capturePort()
    const flow = newFlow()
    flow.picked = { ...found, context: picked, cropDrawn: false } as any
    flow.instruction = 'hide the banner'
    handler = (m) => (m.type === 'recapture' ? { ok: true, data: recaptured } : { ok: true, data: null })
    await flow.generate()
    expect(posted).toHaveLength(1)
    expect(posted[0].context.url).toBe('https://shop.example/cart')
  })

  it('control: the other parts of the context are still the freshly captured ones', async () => {
    const posted = capturePort()
    const flow = newFlow()
    flow.picked = { ...found, context: picked, cropDrawn: false } as any
    flow.instruction = 'hide the banner'
    handler = (m) =>
      m.type === 'recapture'
        ? { ok: true, data: { ...recaptured, target: { ...context.target, selector: 'div.live' } } }
        : { ok: true, data: null }
    await flow.generate()
    expect(posted[0].context.target.selector).toBe('div.live')
  })

  it('exposes the pinned address for the panels that show it', async () => {
    const flow = newFlow()
    expect(flow.sentAddress).toBe('')
    flow.picked = { ...found, context: picked, cropDrawn: false } as any
    expect(flow.sentAddress).toBe('https://shop.example/cart')
  })

  it('has an address to show after Repair, and it is the one the repair message carried', async () => {
    const flow = newFlow()
    const repairContext = { ...context, url: 'https://shop.example/repair' }
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: { ...found, context: repairContext } }
      if (m.type === 'repair') return failure('network')
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    const sent = calls.find((c) => c.type === 'repair')
    expect(sent.context.url).toBe('https://shop.example/repair')
  })
})

/* -------------------------------------------------------------------- */
/* Excluded sites and the sensitive-page warning (#131)                  */
/* -------------------------------------------------------------------- */

describe('picking on an excluded site', () => {
  const requests: unknown[] = []
  const realRequest = (globalThis as any).browser.permissions.request
  beforeEach(() => {
    requests.length = 0
    ;(globalThis as any).browser.permissions.request = async (p: unknown) => {
      requests.push(p)
      return true
    }
  })
  afterEach(() => {
    ;(globalThis as any).browser.permissions.request = realRequest
  })

  it('shows a message and requests no permission and starts nothing', async () => {
    const flow = newFlow()
    flow.excludedSites = ['example.com']
    await flow.startPicking()
    expect(requests).toEqual([])
    expect(calls.filter((c) => c.type === 'start-picking')).toEqual([])
    expect(flow.step).toBe('list')
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect((flow.error as any).message).toContain('www.example.com')
  })

  it('refuses writing by hand as well', async () => {
    const flow = newFlow()
    flow.excludedSites = ['example.com']
    await flow.startPicking('author')
    expect(requests).toEqual([])
  })

  it('requests the permission and starts picking on a host that is not excluded (control)', async () => {
    const flow = newFlow()
    flow.excludedSites = ['other.test']
    await flow.startPicking()
    expect(requests).toHaveLength(1)
    expect(calls.filter((c) => c.type === 'start-picking')).toHaveLength(1)
  })

  it('picks again once the host is removed from the list', async () => {
    const flow = newFlow()
    flow.excludedSites = ['example.com']
    await flow.startPicking()
    expect(requests).toEqual([])
    flow.dismissError()
    flow.excludedSites = []
    await flow.startPicking()
    expect(requests).toHaveLength(1)
  })
})

describe('generating on a page with password or payment fields', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  const withSensitiveFields = (present: boolean) => {
    handler = (m) => (m.type === 'page-has-sensitive-fields' ? { ok: true, data: present } : { ok: true, data: null })
  }
  function flowAtDescribing() {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'make it red'
    flow.step = 'describing'
    return flow
  }

  it('warns and sends nothing until the user confirms', async () => {
    withSensitiveFields(true)
    const flow = flowAtDescribing()
    await flow.generate()
    expect(ports).toHaveLength(0)
    expect(flow.error).toMatchObject({ kind: 'sensitive-page' })
    // The description is kept while the user decides.
    expect(flow.step).toBe('describing')
    expect(flow.instruction).toBe('make it red')
  })

  it('sends the request after the user confirms', async () => {
    withSensitiveFields(true)
    const flow = flowAtDescribing()
    await flow.generate()
    const confirm = flow.retry()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'stop here', kind: 'network' } })
    await confirm
    expect(ports).toHaveLength(1)
  })

  it('does not ask again for the same page once confirmed', async () => {
    withSensitiveFields(true)
    const flow = flowAtDescribing()
    await flow.generate()
    const confirm = flow.retry()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'stop here', kind: 'network' } })
    await confirm
    flow.dismissError()
    const second = flow.generate()
    ;(await nextPort(2)).emit({ type: 'error', error: { message: 'stop here', kind: 'network' } })
    await second
    expect(ports).toHaveLength(2)
  })

  it('sends nothing when the user cancels', async () => {
    withSensitiveFields(true)
    const flow = flowAtDescribing()
    await flow.generate()
    flow.dismissError()
    expect(flow.error).toBeNull()
    expect(ports).toHaveLength(0)
  })

  it('generates with no warning on a page without such fields (control)', async () => {
    withSensitiveFields(false)
    const flow = flowAtDescribing()
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'error', error: { message: 'stop here', kind: 'network' } })
    await run
    expect(ports).toHaveLength(1)
    expect(flow.error).not.toMatchObject({ kind: 'sensitive-page' })
  })

  it('asks the page, not the extracted context', async () => {
    withSensitiveFields(true)
    const flow = flowAtDescribing()
    await flow.generate()
    const asked = calls.filter((c) => c.type === 'page-has-sensitive-fields')
    expect(asked).toEqual([{ type: 'page-has-sensitive-fields', tabId: 1 }])
  })

  it('warns before a repair sends the page, and sends nothing', async () => {
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'page-has-sensitive-fields') return { ok: true, data: true }
      return { ok: true, data: null }
    }
    const flow = newFlow()
    await flow.repair(saved, 'broken')
    expect(calls.filter((c) => c.type === 'repair')).toEqual([])
    expect(flow.error).toMatchObject({ kind: 'sensitive-page' })
    expect(flow.step).toBe('list')
  })
})

describe('ending a run that has a preview request in flight (#110, #98)', () => {
  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  const gateOf = () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    return { gate, open }
  }
  const previews = () => calls.filter((c) => c.type === 'preview-css' || c.type === 'clear-preview-css')

  it('removes the late CSS when a refinement is cancelled and then discarded', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'second'
    const held = gateOf()
    handler = async (m) => {
      // The CSS check runs before the preview, so it has to answer for the preview to be reached.
      if (m.type === 'analyse-css') {
        return { ok: true, data: { static: [], undeclaredCapabilities: [], pendingUrls: [], passed: true } }
      }
      if (m.type === 'preview-css' && m.css === '/* A2 */') await held.gate
      return { ok: true, data: null }
    }
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A2') })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.type === 'preview-css' && c.css === '/* A2 */')).toBe(true),
    )

    // Two steps of the generation counter and no new run in between. Before
    // #110 was fixed this left the late CSS in the page.
    flow.cancelGenerating()
    await flow.discard()
    held.open()
    await run

    expect(flow.step).toBe('list')
    expect(previews().at(-1)?.type).toBe('clear-preview-css')
    // The previous result's CSS was not put back after the discard.
    expect(previews().filter((c) => c.type === 'preview-css' && c.css === '/* A1 */')).toEqual([])
  })

  it('removes CSS whose reply lands while a discard is still clearing the page', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const css = gateOf()
    const lock = gateOf()
    handler = async (m) => {
      // The CSS check runs before the preview, so it has to answer for the preview to be reached.
      if (m.type === 'analyse-css') {
        return { ok: true, data: { static: [], undeclaredCapabilities: [], pendingUrls: [], passed: true } }
      }
      if (m.type === 'preview-css') await css.gate
      if (m.type === 'clear-lock') await lock.gate
      return { ok: true, data: null }
    }
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A') })
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'preview-css')).toBe(true))

    const discarding = flow.discard()
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'clear-lock')).toBe(true))
    // The reply lands while discard() is waiting for the lock to clear.
    css.open()
    await run
    lock.open()
    await discarding

    expect(flow.step).toBe('list')
    expect(previews().at(-1)?.type).toBe('clear-preview-css')
  })

  it('clears a script whose preview reply lands while a discard is still clearing the page', async () => {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    reviewedForRun(flow)
    const reply = gateOf()
    const lock = gateOf()
    handler = async (m) => {
      if (m.type === 'preview-js') await reply.gate
      if (m.type === 'clear-lock') await lock.gate
      return { ok: true, data: null }
    }
    const run = flow.runJs()
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'preview-js')).toBe(true))

    const discarding = flow.discard()
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'clear-lock')).toBe(true))
    reply.open()
    await run
    lock.open()
    await discarding

    expect(calls.filter((c) => c.type === 'clear-preview-js').map((c) => c.id)).toEqual(['OLD'])
    expect(flow.jsRan).toBe(false)
  })

  it('leaves a script that ran alone while its run is current (control)', async () => {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.analysis = { static: [], undeclaredCapabilities: [], passed: true } as any
    reviewedForRun(flow)
    handler = async () => ({ ok: true, data: null })
    await flow.runJs()
    expect(flow.jsRan).toBe(true)
    expect(calls.filter((c) => c.type === 'clear-preview-js')).toEqual([])
  })
})

describe('saving while the all-sites screenshot grant is held (#134)', () => {
  const order: string[] = []
  const api = (globalThis as any).browser.permissions
  const real = { ...api }
  let originRecorded = true
  beforeEach(() => {
    order.length = 0
    originRecorded = true
    api.request = async (p: any) => (order.push(`request:${(p.origins ?? p.permissions).join()}`), true)
    api.remove = async (p: any) => (order.push(`remove:${p.origins.join()}`), true)
    api.contains = async (p: any) => (order.push(`contains:${p.origins.join()}`), originRecorded)
  })
  afterEach(() => Object.assign(api, real))

  function flowAtSave(keep: boolean, grantTaken = true) {
    const flow = newFlow()
    flow.captureGrantTaken = grantTaken
    flow.draft = { ...saved, kind: 'css', id: 'NEW' }
    flow.matchPattern = '*.example.com/*'
    flow.keepScreenshotPermission = keep
    return flow
  }

  it('removes <all_urls> and then requests the site, both before the first await', () => {
    const flow = flowAtSave(false)
    void flow.save()
    // Read with no await since save() was called: the gesture is still live only
    // if both calls were already made.
    expect(order).toEqual(['remove:<all_urls>', 'request:*://*.example.com/*'])
  })

  it('removes nothing when the panel did not record taking the grant (#134)', () => {
    // A grant the user gave outside the panel has no record, and a save must
    // not take it away. The site request is still made.
    const flow = flowAtSave(false, false)
    void flow.save()
    expect(order).toEqual(['request:*://*.example.com/*'])
  })

  it('reads the record from storage.local when the panel starts (#134)', async () => {
    const flow = newFlow()
    localStored['wa-capture-grant-held'] = true
    await flow.loadCaptureGrantRecord()
    expect(flow.captureGrantTaken).toBe(true)
    delete localStored['wa-capture-grant-held']
    await flow.loadCaptureGrantRecord()
    expect(flow.captureGrantTaken).toBe(false)
  })

  it('clears the record after the save removed the grant (#134)', async () => {
    const flow = flowAtSave(false)
    await flow.save()
    expect(flow.captureGrantTaken).toBe(false)
    expect(localWrites.at(-1)).toEqual({ 'wa-capture-grant-held': false })
  })

  it('checks that the site was recorded and saves when it was', async () => {
    const flow = flowAtSave(false)
    await flow.save()
    expect(order).toContain('contains:*://*.example.com/*')
    expect(calls.some((c) => c.type === 'save-transform')).toBe(true)
  })

  it('reports the permission as missing and saves nothing when the site was not recorded', async () => {
    originRecorded = false
    const flow = flowAtSave(false)
    await flow.save()
    expect(flow.permissionDenied).toBe(true)
    expect(calls.some((c) => c.type === 'save-transform')).toBe(false)
  })

  it('removes nothing and does not check when the grant is kept on purpose (control)', async () => {
    const flow = flowAtSave(true)
    await flow.save()
    expect(order).toEqual(['request:*://*.example.com/*'])
    expect(calls.some((c) => c.type === 'save-transform')).toBe(true)
  })
})

describe('a model the account may not use (#125)', () => {
  const repairWith = async (kind: string) => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return failure(kind)
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    return flow
  }

  it('shows its own card kind with the provider message', async () => {
    const flow = await repairWith('model-not-permitted')
    expect(flow.error).toMatchObject({ kind: 'model-not-permitted', message: 'failed' })
  })

  it('offers no retry, so nothing repeats on its own', async () => {
    const flow = await repairWith('model-not-permitted')
    expect(flow.canRetry).toBe(false)
  })

  it('still offers a retry for an ordinary failure (control)', async () => {
    const flow = await repairWith('network')
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.canRetry).toBe(true)
  })

  it('is not shown as a retired model', async () => {
    const flow = await repairWith('model-not-permitted')
    expect(flow.error?.kind).not.toBe('model-unavailable')
  })
})

describe('saving for a site on the excluded list (#131)', () => {
  const requested: string[] = []
  const api = (globalThis as any).browser.permissions
  const real = { ...api }
  beforeEach(() => {
    requested.length = 0
    api.request = async (p: any) => (requested.push((p.origins ?? p.permissions).join()), true)
  })
  afterEach(() => Object.assign(api, real))

  function flowFor(pattern: string, excluded: string[]) {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'css', id: 'NEW' }
    flow.matchPattern = pattern
    flow.excludedSites = excluded
    return flow
  }

  it('does not ask for a parent-domain pattern that covers an excluded host', async () => {
    const flow = flowFor('*.example.com/*', ['www.example.com'])
    await flow.save()
    expect(requested).toEqual([])
    expect(calls.some((c) => c.type === 'save-transform')).toBe(false)
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.error?.message).toContain('www.example.com')
  })

  it('does not ask for the excluded host itself', async () => {
    const flow = flowFor('www.example.com/*', ['example.com'])
    await flow.save()
    expect(requested).toEqual([])
  })

  it('asks as before when another site is excluded (control)', async () => {
    const flow = flowFor('*.example.com/*', ['other.test'])
    await flow.save()
    expect(requested).toEqual(['*://*.example.com/*'])
    expect(calls.some((c) => c.type === 'save-transform')).toBe(true)
  })

  it('refuses before anything is awaited, so no gesture is spent (control for the order)', () => {
    const flow = flowFor('*.example.com/*', ['www.example.com'])
    void flow.save()
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
  })
})

describe('screenshots in a panel that is bound to a page tab (#128)', () => {
  afterEach(() => setBoundTab(null))

  /** A run that reaches Describing, with a model that supports images. */
  async function describingWithVisionModel() {
    handler = (m) =>
      m.type === 'get-vision-support' ? { ok: true, data: true } : { ok: true, data: null }
    const flow = newFlow()
    await flow.startPicking()
    pick(flow)
    expect(flow.step).toBe('describing')
    // checkVisionSupport is not awaited by the step change.
    await vi.waitFor(() => expect(calls.some((c) => c.type === 'get-vision-support')).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    return flow
  }

  it('does not offer a screenshot when the panel is bound, even if the model supports images', async () => {
    setBoundTab(5)
    const flow = await describingWithVisionModel()
    expect(flow.visionSupported).toBe(false)
  })

  it('offers a screenshot in the docked sidebar for the same model (control)', async () => {
    const flow = await describingWithVisionModel()
    expect(flow.visionSupported).toBe(true)
  })
})

describe('the world a script runs in (issue 53)', () => {
  const review = { static: [], undeclaredCapabilities: [], passed: true }

  it('reviews and approves in the isolated world when the model asked for MAIN', async () => {
    const flow = flowAtApprove()
    flow.result = { ...jsResult, requestedWorld: 'MAIN', worldReason: 'needs a page global' }
    handler = (m) => ({ ok: true, data: m.type === 'review' ? review : null })
    await flow.toReview()
    const sent = calls.filter((c) => c.type === 'review')
    expect(sent.map((c) => c.world)).toEqual(['USER_SCRIPT'])
  })

  it('asks for a new review in MAIN when the user allows it, so the token is for that world', async () => {
    const flow = flowAtApprove()
    flow.result = { ...jsResult, requestedWorld: 'MAIN', worldReason: 'r' }
    handler = (m) => ({ ok: true, data: m.type === 'review' ? review : null })
    await flow.toReview()
    await flow.setWorld('MAIN')
    expect(calls.filter((c) => c.type === 'review').map((c) => c.world)).toEqual(['USER_SCRIPT', 'MAIN'])
    expect(flow.result?.world).toBe('MAIN')
  })

  it('goes back to the isolated world when the user withdraws the approval', async () => {
    const flow = flowAtApprove()
    handler = (m) => ({ ok: true, data: m.type === 'review' ? review : null })
    await flow.setWorld('MAIN')
    await flow.setWorld('USER_SCRIPT')
    expect(calls.filter((c) => c.type === 'review').map((c) => c.world)).toEqual(['MAIN', 'USER_SCRIPT'])
  })

  it('control: choosing the world it already has sends no new review', async () => {
    const flow = flowAtApprove()
    await flow.setWorld('USER_SCRIPT')
    expect(calls.filter((c) => c.type === 'review')).toEqual([])
  })

  it('keeps a stored MAIN transform as MAIN when it is opened for an AI edit', async () => {
    const flow = newFlow()
    handler = (m) =>
      m.type === 'context-for-anchor'
        ? { ok: true, data: found }
        : { ok: true, data: m.type === 'analyse' ? review : null }
    await flow.editWithAi({ ...saved, kind: 'js', world: 'MAIN', code: 'x' })
    expect(flow.result?.world).toBe('MAIN')
  })
})

describe('running JavaScript only after the model review (issue 55)', () => {
  const clean = { static: [], undeclaredCapabilities: [], passed: true }
  const verdict = (v: string) => ({
    ...clean,
    model: { verdict: v, explanation: 'why' },
    approvalToken: 'review-token',
  })

  function flowWithUnreviewedScript() {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.result = { ...jsResultBase, code: 'x' } as any
    flow.analysis = clean as any
    return flow
  }
  const previews = () => calls.filter((c) => c.type === 'preview-js')

  it('does not register the preview before the review has run', async () => {
    const flow = flowWithUnreviewedScript()
    await flow.runJs()
    expect(previews()).toEqual([])
    expect(flow.jsRan).toBe(false)
  })

  it('reviews with the draft id and pattern, and then registers the preview', async () => {
    const flow = flowWithUnreviewedScript()
    handler = (m) => ({ ok: true, data: m.type === 'review' ? verdict('match') : null })
    await flow.reviewForPreview()
    expect(calls.find((c) => c.type === 'review')).toMatchObject({ transformId: 'OLD', match: '*.example.com/*' })
    expect(flow.jsPreviewAllowed).toBe(true)
    await flow.runJs()
    expect(previews().length).toBe(1)
    expect(flow.jsRan).toBe(true)
  })

  it('sends the review token and the address the tab was at with the preview (#55)', async () => {
    const flow = flowWithUnreviewedScript()
    ;(flow as any).url = 'https://www.example.com/page?x=1'
    handler = (m) => ({ ok: true, data: m.type === 'review' ? verdict('match') : null })
    await flow.reviewForPreview()
    await flow.runJs()
    expect(previews()[0]).toMatchObject({
      approvalToken: 'review-token',
      expectedUrl: 'https://www.example.com/page?x=1',
    })
  })

  it('does not register a preview when the review came back without a token (#55)', async () => {
    const flow = flowWithUnreviewedScript()
    handler = (m) => ({
      ok: true,
      data: m.type === 'review' ? { ...verdict('match'), approvalToken: undefined } : null,
    })
    await flow.reviewForPreview()
    await flow.runJs()
    expect(previews()).toEqual([])
    expect(flow.jsRan).toBe(false)
  })

  it.each(['mismatch', 'uncertain'])('does not register the preview after a verdict of %s', async (v) => {
    const flow = flowWithUnreviewedScript()
    handler = (m) => ({ ok: true, data: m.type === 'review' ? verdict(v) : null })
    await flow.reviewForPreview()
    await flow.runJs()
    expect(previews()).toEqual([])
  })

  it('stops counting a review once the intent changes', async () => {
    const flow = flowWithUnreviewedScript()
    handler = (m) => ({ ok: true, data: m.type === 'review' ? verdict('match') : null })
    await flow.reviewForPreview()
    flow.intent = 'something else'
    expect(flow.jsPreviewAllowed).toBe(false)
    await flow.runJs()
    expect(previews()).toEqual([])
  })

  it('does not review code that the local analysis rejected', async () => {
    const flow = flowWithUnreviewedScript()
    flow.analysis = { ...clean, passed: false } as any
    await flow.reviewForPreview()
    expect(calls.some((c) => c.type === 'review')).toBe(false)
  })
})

describe('saving from the approval panel (issue 64)', () => {
  const review = {
    static: [],
    undeclaredCapabilities: [],
    passed: true,
    model: { verdict: 'match', explanation: '' },
    approvalToken: 'tok',
  }
  const saves = () => calls.filter((c) => c.type === 'save-transform')

  async function atPanel() {
    const flow = flowAtApprove()
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    handler = (m) => ({ ok: true, data: m.type === 'review' ? review : null })
    await flow.toReview()
    return flow
  }

  it('does not save before the panel has reported that it was shown', async () => {
    const flow = await atPanel()
    expect(flow.reviewShown).toBe(false)
    await flow.save()
    expect(saves()).toEqual([])
  })

  it('saves with the review token once the panel has been shown', async () => {
    const flow = await atPanel()
    flow.markReviewShown()
    await flow.save()
    expect(saves().map((c) => c.approvalToken)).toEqual(['tok'])
  })

  it('needs the panel shown again after a new review, such as a change of world', async () => {
    const flow = await atPanel()
    flow.markReviewShown()
    await flow.setWorld('MAIN')
    expect(flow.reviewShown).toBe(false)
    await flow.save()
    expect(saves()).toEqual([])
  })

  it('is not marked as shown while the review has not arrived', () => {
    const flow = flowAtApprove()
    flow.step = 'reviewing'
    flow.markReviewShown()
    expect(flow.reviewShown).toBe(false)
  })
})

describe('a request the provider refused (#153)', () => {
  const clean = { static: [], undeclaredCapabilities: [], passed: true }

  async function refusedReview() {
    const flow = flowAtApprove()
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    handler = (m) => (m.type === 'review' ? failure('refusal') : { ok: true, data: null })
    await flow.toReview()
    return flow
  }

  async function refusedGeneration(kind: string) {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return failure(kind)
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    return flow
  }

  it('shows a refused review with its own message and no retry', async () => {
    const flow = await refusedReview()
    expect(flow.error).toMatchObject({ kind: 'refused', subject: 'review' })
    expect(flow.error?.message).toContain('declined to review this code')
    expect(flow.error?.message).toContain('cannot be saved without a review')
    expect(flow.canRetry).toBe(false)
  })

  it('shows a refused generation with its own message and no retry', async () => {
    const flow = await refusedGeneration('refusal')
    expect(flow.error).toMatchObject({ kind: 'refused', subject: 'generation' })
    expect(flow.error?.message).toContain('declined to write a change for this page')
    expect(flow.canRetry).toBe(false)
  })

  it('shows a refused review of the preview the same way', async () => {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.result = { ...jsResultBase, code: 'x' } as any
    flow.analysis = clean as any
    handler = (m) => (m.type === 'review' ? failure('refusal') : { ok: true, data: null })
    await flow.reviewForPreview()
    expect(flow.error).toMatchObject({ kind: 'refused', subject: 'review' })
    expect(flow.canRetry).toBe(false)
  })

  it('leaves no approval token after a refused review, and the save stays refused', async () => {
    const flow = await refusedReview()
    expect(flow.review).toBeNull()
    flow.markReviewShown()
    await flow.save()
    // Nothing in the flow holds a token to send. The background then refuses a
    // JavaScript save without one (mayBeSaved in approvals.test.ts).
    const sent = calls.filter((c) => c.type === 'save-transform')
    expect(sent.every((c) => c.approvalToken === undefined)).toBe(true)
  })

  it('still shows the retry card for a network error on a review (control)', async () => {
    const flow = flowAtApprove()
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    handler = (m) => (m.type === 'review' ? failure('network') : { ok: true, data: null })
    await flow.toReview()
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.canRetry).toBe(true)
  })

  it('still shows the retry card for a network error on a generation (control)', async () => {
    const flow = await refusedGeneration('network')
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.canRetry).toBe(true)
  })
})

describe('the code check starts by itself for new JavaScript', () => {
  const jsOut = { ...jsResult, code: 'document.body.remove()' }
  const passed = { static: [], undeclaredCapabilities: [], passed: true }
  const reviews = () => calls.filter((c) => c.type === 'review')
  let analysis: any
  let reviewAnswer: any

  beforeEach(() => {
    ports.length = 0
    analysis = passed
    reviewAnswer = {
      ...passed,
      model: { verdict: 'match', explanation: '' },
      approvalToken: 'review-token',
    }
    ;(globalThis as any).browser.runtime.connect = fakeConnect
    handler = (m: any) => {
      if (m.type === 'analyse') return { ok: true, data: analysis }
      if (m.type === 'review') return { ok: true, data: reviewAnswer }
      return { ok: true, data: null }
    }
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  async function firstGeneration() {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: jsOut })
    await run
    return flow
  }

  it('reviews the code after the first generation', async () => {
    const flow = await firstGeneration()
    expect(flow.step).toBe('refining')
    await vi.waitFor(() => expect(flow.jsPreviewAllowed).toBe(true))
    expect(reviews().length).toBe(1)
  })

  it('reviews the code after a refinement', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.result = cssResult('A1')
    flow.step = 'refining'
    flow.followUp = 'second'
    const run = flow.regenerate()
    ;(await nextPort(1)).emit({ type: 'done', result: jsOut })
    await run
    await vi.waitFor(() => expect(flow.jsPreviewAllowed).toBe(true))
    expect(reviews().length).toBe(1)
  })

  it('reviews the code after a repair', async () => {
    const flow = newFlow()
    handler = (m: any) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return { ok: true, data: { result: jsOut } }
      if (m.type === 'analyse') return { ok: true, data: analysis }
      if (m.type === 'review') return { ok: true, data: reviewAnswer }
      return { ok: true, data: null }
    }
    await flow.repair({ ...saved, kind: 'js' }, 'broken')
    await vi.waitFor(() => expect(flow.jsPreviewAllowed).toBe(true))
    expect(reviews().length).toBe(1)
  })

  it('does not review when the analysis failed', async () => {
    analysis = { ...passed, passed: false }
    const flow = await firstGeneration()
    expect(flow.step).toBe('refining')
    expect(reviews()).toEqual([])
    expect(flow.previewReviewing).toBe(false)
  })

  it('does not review CSS', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    handler = (m: any) => ({ ok: true, data: m.type === 'analyse' ? passed : null })
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: cssResult('A') })
    await run
    expect(reviews()).toEqual([])
  })

  it('does not review a flow that is set up without a new result, as when a session is restored', async () => {
    const flow = newFlow()
    flow.draft = { ...saved, kind: 'js' }
    flow.result = jsOut
    flow.analysis = passed as any
    flow.step = 'refining'
    await Promise.resolve()
    expect(reviews()).toEqual([])
    expect(flow.jsPreviewAllowed).toBe(false)
  })

  it('does not send a second review for a key that already has one, and offers it again after an intent edit', async () => {
    const flow = await firstGeneration()
    await vi.waitFor(() => expect(flow.jsPreviewAllowed).toBe(true))
    await flow.reviewForPreview()
    expect(reviews().length).toBe(1)
    flow.intent = 'something else'
    expect(flow.jsPreviewAllowed).toBe(false)
    await flow.reviewForPreview()
    expect(reviews().length).toBe(2)
  })

  it('does not send a second review while one is in progress', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    handler = (m: any) => {
      if (m.type === 'analyse') return gate.then(() => ({ ok: true, data: passed })) as any
      return { ok: true, data: reviewAnswer }
    }
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const run = flow.generate()
    ;(await nextPort(1)).emit({ type: 'done', result: jsOut })
    release()
    await run
    void flow.reviewForPreview()
    await vi.waitFor(() => expect(flow.jsPreviewAllowed).toBe(true))
    expect(reviews().length).toBe(1)
  })

  it('keeps the explanation of a verdict other than match and does not retry', async () => {
    reviewAnswer = { ...reviewAnswer, model: { verdict: 'mismatch', explanation: 'It removes more.' } }
    const flow = await firstGeneration()
    await vi.waitFor(() => expect(flow.currentPreviewReview).not.toBeNull())
    expect(flow.currentPreviewReview?.model?.explanation).toBe('It removes more.')
    expect(flow.jsPreviewAllowed).toBe(false)
    expect(reviews().length).toBe(1)
  })

  it('shows the error card with a retry when the request fails', async () => {
    handler = (m: any) => {
      if (m.type === 'analyse') return { ok: true, data: passed }
      if (m.type === 'review') return failure('network')
      return { ok: true, data: null }
    }
    const flow = await firstGeneration()
    await vi.waitFor(() => expect(flow.error).not.toBeNull())
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.canRetry).toBe(true)
  })

  it('ignores an automatic review that returns after a discard', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    handler = (m: any) => {
      if (m.type === 'analyse') return { ok: true, data: passed }
      if (m.type === 'review') return gate.then(() => ({ ok: true, data: reviewAnswer })) as any
      return { ok: true, data: null }
    }
    const flow = await firstGeneration()
    await vi.waitFor(() => expect(flow.previewReviewing).toBe(true))
    await flow.discard()
    release()
    await vi.waitFor(() => expect(flow.previewReviewing).toBe(false))
    expect(flow.currentPreviewReview).toBeNull()
    expect(flow.error).toBeNull()
  })
})

/* -------------------------------------------------------------------- */
/* Side questions while refining                                         */
/* -------------------------------------------------------------------- */

describe('questions asked while refining', () => {
  const { transcriptBubbles } = transcriptModule
  const FORGED = 'QUESTION-MARKER-7f3a'
  const ANSWERED = 'ANSWER-MARKER-91bc'

  beforeEach(() => {
    ports.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  /** A first generation that went through the flow, so the transcript is the real one. */
  async function refining() {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    const run = flow.generate()
    ;(await nextPort(ports.length + 1)).emit({ type: 'done', result: cssResult('A1') })
    await run
    return flow
  }

  /** Asks a question and answers it from the fake port. */
  async function askAndAnswer(flow: InstanceType<typeof Flow>, question: string, answer: string) {
    flow.followUp = question
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    port.emit({ type: 'done', result: { answer } })
    await run
    return port
  }

  function bubbles(flow: InstanceType<typeof Flow>, pending = false) {
    return transcriptBubbles(
      flow.transcript,
      flow.instruction,
      flow.result!.rationale.approach,
      pending && flow.askingQuestion !== null
        ? { question: flow.askingQuestion, answer: flow.askPartial }
        : null,
    ).map((b) => `${b.side ?? b.role}:${b.text}`)
  }

  it('sends the question on its own port with the draft, the history and the earlier exchanges', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    flow.followUp = 'And on mobile?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    expect(port.name).toBe('wa-ask')
    expect(port.request.question).toBe('And on mobile?')
    expect(port.request.exchanges).toEqual([{ question: 'Why CSS?', answer: 'It is enough.' }])
    expect(port.request.draft.code).toBe('/* A1 */')
    expect(port.request.instruction).toBe('first')
    expect(port.request.history).toEqual([])
    port.emit({ type: 'done', result: { answer: 'Same.' } })
    await run
  })

  it('leaves the step, the result, the draft, the history and the review unchanged', async () => {
    const flow = await refining()
    const before = {
      step: flow.step,
      result: flow.result,
      draft: flow.draft,
      analysis: flow.analysis,
      history: [...flow.history],
      jsRan: flow.jsRan,
      previewReview: flow.currentPreviewReview,
      instruction: flow.instruction,
      previewedCss: flow.previewedCss,
    }
    const messagesBefore = calls.length
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    expect({
      step: flow.step,
      result: flow.result,
      draft: flow.draft,
      analysis: flow.analysis,
      history: [...flow.history],
      jsRan: flow.jsRan,
      previewReview: flow.currentPreviewReview,
      instruction: flow.instruction,
      previewedCss: flow.previewedCss,
    }).toEqual(before)
    // Nothing was asked of the page or the background besides reading the page.
    const sent = calls.slice(messagesBefore).map((c) => c.type)
    expect(sent.every((type) => type === 'recapture' || type === 'page-has-sensitive-fields')).toBe(true)
    expect(flow.exchanges).toEqual([{ question: 'Why CSS?', answer: 'It is enough.' }])
    expect(flow.followUp).toBe('')
  })

  it('does not put a question or an answer in a generation, a regeneration or a review', async () => {
    const flow = await refining()
    const firstPorts = ports.length
    await askAndAnswer(flow, `why ${FORGED}`, `because ${ANSWERED}`)

    flow.followUp = 'make it bigger'
    const run = flow.regenerate()
    const port = await nextPort(firstPorts + 2)
    expect(port.name).toBe('wa-generate')
    const wire = JSON.stringify(port.request)
    expect(wire).not.toContain(FORGED)
    expect(wire).not.toContain(ANSWERED)
    expect(port.request.history.map((turn: any) => turn.content)).toEqual(['first', 'A1'])
    port.emit({ type: 'done', result: cssResult('A2') })
    await run

    // The reviewer is given the typed requests only.
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    flow.result = { ...jsResultBase, code: 'x' } as any
    handler = (m) => ({ ok: true, data: m.type === 'review' ? { static: [], undeclaredCapabilities: [], passed: true } : null })
    await flow.toReview()
    const review = calls.filter((c) => c.type === 'review')
    expect(review.length).toBeGreaterThan(0)
    expect(JSON.stringify(review)).not.toContain(FORGED)
    expect(JSON.stringify(review)).not.toContain(ANSWERED)
    expect(review.at(-1).instructions.map((i: any) => i.text)).toEqual(['first', 'make it bigger'])
    // The exchanges stay available for later questions.
    expect(flow.exchanges).toHaveLength(1)
  })

  it('does not put a question in the request of a repair', async () => {
    const flow = await refining()
    await askAndAnswer(flow, `why ${FORGED}`, ANSWERED)
    await flow.discard()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      if (m.type === 'repair') return { ok: true, data: { result: cssResult('R') } }
      return { ok: true, data: null }
    }
    await flow.repair(saved, 'broken')
    const sent = JSON.stringify(calls.filter((c) => c.type === 'repair'))
    expect(sent).not.toContain(FORGED)
    expect(flow.exchanges).toEqual([])
  })

  it('puts the question back in the box and removes its bubble when the request fails', async () => {
    const flow = await refining()
    flow.followUp = 'Why CSS?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    expect(flow.asking).toBe(true)
    expect(bubbles(flow, true)).toContain('question:Why CSS?')
    expect(flow.followUp).toBe('')
    port.emit({ type: 'error', error: { message: 'down', kind: 'network', retryable: true } })
    await run
    expect(flow.asking).toBe(false)
    expect(flow.followUp).toBe('Why CSS?')
    expect(flow.exchanges).toEqual([])
    expect(bubbles(flow, true).some((b) => b.startsWith('question:'))).toBe(false)
    expect(flow.step).toBe('refining')
    expect(flow.error).toMatchObject({ kind: 'request-failed' })
    expect(flow.canRetry).toBe(false)
  })

  it('shows a refusal as a card for the question that does not end the run', async () => {
    const flow = await refining()
    flow.followUp = 'Why CSS?'
    const run = flow.ask()
    ;(await nextPort(ports.length + 1)).emit({ type: 'error', error: { message: 'x', kind: 'refusal', retryable: false } })
    await run
    expect(flow.error).toEqual({
      kind: 'refused',
      subject: 'question',
      message: 'The provider declined to answer this question.',
    })
    expect(flow.canRetry).toBe(false)
    expect(flow.step).toBe('refining')
    expect(flow.result).not.toBeNull()
    expect(flow.followUp).toBe('Why CSS?')
    flow.dismissError()
    expect(flow.error).toBeNull()
    expect(flow.step).toBe('refining')
  })

  it('asks for the confirmation a generation asks for on a page with a password field', async () => {
    const flow = await refining()
    const before = ports.length
    handler = (m) => ({ ok: true, data: m.type === 'page-has-sensitive-fields' ? true : null })
    flow.followUp = 'Why CSS?'
    await flow.ask()
    expect(ports.length).toBe(before)
    expect(flow.error).toMatchObject({ kind: 'sensitive-page' })
    expect(flow.followUp).toBe('Why CSS?')
    expect(flow.asking).toBe(false)

    const again = flow.retry()
    const port = await nextPort(before + 1)
    port.emit({ type: 'done', result: { answer: 'Because.' } })
    await again
    expect(flow.exchanges).toEqual([{ question: 'Why CSS?', answer: 'Because.' }])
  })

  it('refuses a twenty-first question and does not open a port', async () => {
    const flow = await refining()
    flow.exchanges = Array.from({ length: 19 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }))
    expect(flow.askLimitReached).toBe(false)
    await askAndAnswer(flow, 'the twentieth', 'ok')
    expect(flow.exchanges).toHaveLength(20)
    expect(flow.askLimitReached).toBe(true)

    const before = ports.length
    flow.followUp = 'the twenty-first'
    await flow.ask()
    expect(ports.length).toBe(before)
    expect(flow.followUp).toBe('the twenty-first')
  })

  it('does nothing before the first generation or with an empty box', async () => {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = 'first'
    flow.step = 'describing'
    flow.followUp = 'Why?'
    await flow.ask()
    expect(ports.length).toBe(0)

    const refined = await refining()
    const before = ports.length
    refined.followUp = '   '
    await refined.ask()
    expect(ports.length).toBe(before)
  })

  it('is cleared by a reset, a discard and a save, and ignores an answer that arrives later', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    expect(flow.exchanges).toHaveLength(1)
    flow.reset()
    expect(flow.exchanges).toEqual([])
    expect(flow.transcript).toEqual([])
    expect(flow.asking).toBe(false)

    const second = await refining()
    await askAndAnswer(second, 'Q', 'A')
    await second.discard()
    expect(second.exchanges).toEqual([])
    expect(second.transcript).toEqual([])

    const third = await refining()
    third.followUp = 'Pending'
    const run = third.ask()
    const port = await nextPort(ports.length + 1)
    third.reset()
    expect(port.disconnected).toBe(true)
    port.emit({ type: 'done', result: { answer: 'late' } })
    await Promise.race([run, new Promise((resolve) => setTimeout(resolve, 20))])
    expect(third.exchanges).toEqual([])
    expect(third.asking).toBe(false)
  })

  it('is cleared when the transform is saved', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    handler = (m) => ({ ok: true, data: m.type === 'save-transform' ? undefined : null })
    flow.toSaving()
    flow.draft = { ...saved, kind: 'css', id: 'NEW' }
    await flow.save()
    expect(flow.exchanges).toEqual([])
    expect(flow.transcript).toEqual([])
  })

  it('stops an answer that is arriving, drops the partial answer and restores the question', async () => {
    const flow = await refining()
    flow.followUp = 'Why CSS?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    port.emit({ type: 'sent' })
    port.emit({ type: 'chunk', text: '{"answer":"It is' })
    expect(flow.askPartial).toBe('It is')
    expect(bubbles(flow, true).at(-1)).toBe('answer:It is')

    flow.cancelAsk()
    expect(port.disconnected).toBe(true)
    expect(flow.asking).toBe(false)
    expect(flow.askPartial).toBe('')
    expect(flow.followUp).toBe('Why CSS?')
    expect(flow.exchanges).toEqual([])
    expect(flow.transcript.some((e) => e.kind === 'question' || e.kind === 'answer')).toBe(false)

    port.emit({ type: 'done', result: { answer: 'late' } })
    await Promise.race([run, new Promise((resolve) => setTimeout(resolve, 20))])
    expect(flow.exchanges).toEqual([])
    expect(flow.error).toBeNull()
  })

  it('disables Regenerate while an answer arrives and leaves it working afterwards', async () => {
    const flow = await refining()
    flow.followUp = 'Why CSS?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    const before = ports.length
    flow.followUp = 'make it bigger'
    await flow.regenerate()
    expect(ports.length).toBe(before)
    expect(flow.step).toBe('refining')
    port.emit({ type: 'done', result: { answer: 'Because.' } })
    await run
    expect(flow.followUp).toBe('make it bigger')
  })

  it('keeps the conversation in the order it happened across a regeneration', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    flow.followUp = 'second'
    const run = flow.regenerate()
    ;(await nextPort(ports.length + 1)).emit({ type: 'done', result: cssResult('A2') })
    await run
    await askAndAnswer(flow, 'Is that fast?', 'Yes.')
    expect(bubbles(flow)).toEqual([
      'user:first',
      'assistant:A1',
      'question:Why CSS?',
      'answer:It is enough.',
      'user:second',
      'assistant:A2',
      'question:Is that fast?',
      'answer:Yes.',
    ])
    expect(flow.history.map((turn) => turn.content)).toEqual(['first', 'A1'])
    expect(flow.exchanges.map((e) => e.question)).toEqual(['Why CSS?', 'Is that fast?'])
  })

  it('removes nothing from the conversation when a regeneration is cancelled or fails', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    const before = bubbles(flow)

    flow.followUp = 'second'
    const failing = flow.regenerate()
    ;(await nextPort(ports.length + 1)).emit({ type: 'error', error: { message: 'x', kind: 'network' } })
    await failing
    expect(bubbles(flow)).toEqual(before)

    flow.dismissError()
    flow.followUp = 'third'
    const cancelled = flow.regenerate()
    const port = await nextPort(ports.length + 1)
    flow.cancelGenerating()
    port.emit({ type: 'done', result: cssResult('A3') })
    await Promise.race([cancelled, new Promise((resolve) => setTimeout(resolve, 20))])
    expect(bubbles(flow)).toEqual(before)
    expect(flow.exchanges).toHaveLength(1)
  })

  it('spends the screenshot opt-in when Stop ends a question that carried it', async () => {
    const flow = await refining()
    flow.visionSupported = true
    flow.sendScreenshot = true
    ;(flow as any).shot = { dataUrl: 'data:image/png;base64,AAAA', rect: crop, clipped: false }
    flow.followUp = 'Why?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    expect(port.request.context.screenshot).toBeDefined()
    flow.cancelAsk()
    expect(flow.sendScreenshot).toBe(false)
    expect((flow as any).shot).toBeNull()
    expect(flow.asking).toBe(false)
    expect(flow.askPartial).toBe('')
    expect(flow.askingQuestion).toBeNull()
    // The promise of the stopped run never settles, and nothing else waits on it.
    await Promise.race([run, new Promise((resolve) => setTimeout(resolve, 20))])
    // A new question is allowed at once and does not carry the screenshot.
    flow.followUp = 'Again?'
    const next = flow.ask()
    const second = await nextPort(ports.length + 1)
    expect(second.request.context.screenshot).toBeUndefined()
    second.emit({ type: 'done', result: { answer: 'ok' } })
    await next
  })

  it('cuts the streamed answer at 6000 characters so the text on screen never shrinks', async () => {
    const flow = await refining()
    flow.followUp = 'Why?'
    const run = flow.ask()
    const port = await nextPort(ports.length + 1)
    port.emit({ type: 'chunk', text: JSON.stringify({ answer: 'x'.repeat(7000) }).slice(0, -2) })
    expect(flow.askPartial).toHaveLength(6000)
    port.emit({ type: 'done', result: { answer: 'x'.repeat(6000) } })
    await run
    expect(flow.exchanges[0]!.answer).toHaveLength(6000)
  })

  it('does not start a question while the page is being reloaded for a new attempt', async () => {
    const flow = await refining()
    flow.result = { ...jsResultBase, code: 'x' } as any
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    flow.jsRan = true
    flow.followUp = 'change it'
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realReload = (globalThis as any).browser.tabs.reload
    ;(globalThis as any).browser.tabs.reload = () => gate
    try {
      const run = flow.reloadAndRetry()
      await vi.waitFor(() => expect(flow.reloading).toBe(true))
      const before = ports.length
      await flow.ask()
      expect(ports.length).toBe(before)
      expect(flow.asking).toBe(false)
      release()
      const port = await nextPort(before + 1)
      expect(port.name).toBe('wa-generate')
      expect(port.request.instruction).toBe('change it')
      port.emit({ type: 'done', result: cssResult('A2') })
      await run
      expect(flow.reloading).toBe(false)
    } finally {
      ;(globalThis as any).browser.tabs.reload = realReload
    }
  })

  describe('cards', () => {
    it('keeps a card for something else when a question fails, and shows the failure beside the box', async () => {
      const flow = await refining()
      flow.show({ kind: 'request-failed', message: 'The check failed.' }, async () => {})
      flow.followUp = 'Why?'
      const run = flow.ask()
      expect(flow.error).toMatchObject({ message: 'The check failed.' })
      expect(flow.canRetry).toBe(true)
      ;(await nextPort(ports.length + 1)).emit({ type: 'error', error: { message: 'Network down.', kind: 'network' } })
      await run
      expect(flow.error).toMatchObject({ message: 'The check failed.' })
      expect(flow.canRetry).toBe(true)
      expect(flow.askNotice).toBe('Network down.')
      expect(flow.followUp).toBe('Why?')
    })

    it('keeps a card that appeared while the answer was arriving, also for a refusal', async () => {
      const flow = await refining()
      flow.followUp = 'Why?'
      const run = flow.ask()
      const port = await nextPort(ports.length + 1)
      flow.show({ kind: 'refused', subject: 'review', message: 'Review declined.' })
      port.emit({ type: 'error', error: { message: 'x', kind: 'refusal' } })
      await run
      expect(flow.error).toMatchObject({ kind: 'refused', subject: 'review' })
      expect(flow.askNotice).toBe('The provider declined to answer this question.')
    })

    it('replaces the card of an earlier question when the next question starts, and clears the notice', async () => {
      const flow = await refining()
      flow.followUp = 'Why?'
      let run = flow.ask()
      ;(await nextPort(ports.length + 1)).emit({ type: 'error', error: { message: 'x', kind: 'refusal' } })
      await run
      expect(flow.error).toMatchObject({ subject: 'question' })
      flow.followUp = 'Why?'
      run = flow.ask()
      const port = await nextPort(ports.length + 1)
      expect(flow.error).toBeNull()
      port.emit({ type: 'done', result: { answer: 'ok' } })
      await run
      expect(flow.askNotice).toBeNull()
    })
  })

  it('restores the transcript length saved when the attempt began if the attempt is undone', async () => {
    const flow = await refining()
    await askAndAnswer(flow, 'Why CSS?', 'It is enough.')
    const length = flow.transcript.length
    flow.followUp = 'second'
    const run = flow.regenerate()
    const port = await nextPort(ports.length + 1)
    // Entries added while the attempt is running are taken back with it.
    flow.transcript = [...flow.transcript, { kind: 'request', text: 'stray' }, { kind: 'result', text: 'stray' }]
    port.emit({ type: 'error', error: { message: 'x', kind: 'network' } })
    await run
    expect(flow.transcript).toHaveLength(length)
  })

  it('shows what the screen showed before for a draft opened with Edit with AI', async () => {
    const flow = newFlow()
    handler = (m) => {
      if (m.type === 'context-for-anchor') return { ok: true, data: found }
      return { ok: true, data: null }
    }
    await flow.editWithAi(saved)
    expect(flow.step).toBe('refining')
    expect(bubbles(flow)).toEqual(['user:old intent', 'assistant:a'])
    await askAndAnswer(flow, 'Why?', 'Because.')
    expect(bubbles(flow)).toEqual(['user:old intent', 'assistant:a', 'question:Why?', 'answer:Because.'])
  })
})

describe('the settings of an elixir in the flow', () => {
  const fields = [
    { key: 'label', label: 'Label', type: 'text', default: 'd' },
    { key: 'size', label: 'Size', type: 'number', default: 3 },
  ]
  const withFields = { ...jsResult, code: 'document.title = CONFIG.label', config: fields }
  const passing = { static: [], undeclaredCapabilities: [], passed: true }
  const settingsHandler = (m: any) => {
    if (m.type === 'context-for-anchor') return { ok: true, data: found }
    if (m.type === 'repair') return { ok: true, data: { result: withFields } }
    if (m.type === 'analyse' || m.type === 'review') return { ok: true, data: passing }
    return { ok: true, data: null }
  }
  const last = (type: string) => calls.filter((c) => c.type === type).at(-1)

  it('puts the model fields in the draft and sends them with the analysis and the review', async () => {
    const flow = newFlow()
    handler = settingsHandler
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED' }, 'broken')
    expect(flow.draft?.configFields).toEqual(fields)
    expect(last('analyse').configFields).toEqual(fields)
    await flow.toReview()
    expect(last('review').configFields).toEqual(fields)
  })

  it('sends no settings for a result that has none', async () => {
    const flow = newFlow()
    handler = (m: any) => (m.type === 'repair' ? { ok: true, data: { result: jsResult } } : settingsHandler(m))
    await flow.repair({ ...saved, kind: 'js', intent: 'STORED' }, 'broken')
    expect(flow.draft).not.toHaveProperty('configFields')
    expect(last('analyse')).not.toHaveProperty('configFields')
    await flow.toReview()
    expect(last('review')).not.toHaveProperty('configFields')
  })

  it('sends the fields of the saved elixir when it is edited with AI, and the same fields with its review', async () => {
    const flow = newFlow()
    handler = settingsHandler
    await flow.editWithAi({ ...saved, kind: 'js', code: 'document.title = CONFIG.label', configFields: fields, configValues: { label: 'USERVALUE' } } as any)
    expect(flow.result?.config).toEqual(fields)
    expect(last('analyse').configFields).toEqual(fields)
    await flow.toReview()
    expect(last('review').configFields).toEqual(fields)
    expect(JSON.stringify(calls.filter((c) => c.type === 'review' || c.type === 'analyse'))).not.toContain('USERVALUE')
  })

  it('counts a change of fields as a different result for the review that a preview needs', () => {
    const a = { code: 'x', world: 'USER_SCRIPT', capabilities: [], config: fields } as any
    expect(reviewKey(a, 'i')).toBe(reviewKey({ ...a, config: fields.map((f) => ({ ...f })) }, 'i'))
    expect(reviewKey(a, 'i')).not.toBe(reviewKey({ ...a, config: [{ ...fields[0], default: 'changed' }] }, 'i'))
    expect(reviewKey(a, 'i')).not.toBe(reviewKey({ ...a, config: [] }, 'i'))
  })

  it('lists the values of a saved elixir that the new version does not keep, and none for a new elixir', async () => {
    const flow = newFlow()
    handler = settingsHandler
    const stored = { ...saved, kind: 'js', code: 'document.title = CONFIG.label', configFields: fields, configValues: { label: 'mine', size: 7 } } as any
    await flow.editWithAi(stored)
    expect(flow.configNotKept).toEqual([])
    // The new version drops the size setting and changes the type of the label.
    flow.result = { ...flow.result!, config: [{ key: 'label', label: 'Label', type: 'number', default: 1 }] } as any
    expect(flow.configNotKept).toEqual([
      { key: 'label', label: 'Label', reason: 'type' },
      { key: 'size', label: 'Size', reason: 'removed' },
    ])
    await flow.discard()
    expect(flow.storedConfig).toBeNull()
    expect(flow.configNotKept).toEqual([])
  })
})

/* -------------------------------------------------------------------- */
/* A question from the model instead of code                              */
/* -------------------------------------------------------------------- */

describe('a question from the model instead of code', () => {
  const QUESTION = 'How are sponsored videos marked on this page?'
  const ask = (wantsExample = false) => ({
    name: '',
    kind: 'css',
    capabilities: [],
    config: [],
    code: '',
    rationale: { targets: '', approach: '', assumptions: [] },
    intent: '',
    clarification: { question: QUESTION, wantsExample },
  }) as any
  const lastReview = () => calls.filter((c) => c.type === 'review').at(-1)
  const reviewable = { static: [], undeclaredCapabilities: [], passed: true }

  beforeEach(() => {
    ports.length = 0
    calls.length = 0
    ;(globalThis as any).browser.runtime.connect = fakeConnect
  })
  afterEach(() => {
    ;(globalThis as any).browser.runtime.connect = realConnect
  })

  function describing(text = 'hide sponsored videos') {
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.instruction = text
    flow.step = 'describing'
    return flow
  }

  /** Sends the instruction and has the fake port answer with `result`. */
  async function brew(flow: InstanceType<typeof Flow>, result: object, again = false) {
    const run = again ? flow.regenerate() : flow.generate()
    const port = await nextPort(ports.length + 1)
    port.emit({ type: 'done', result })
    await run
    return port
  }

  /** Asks for a review of a JavaScript result that the flow holds, and returns what was sent. */
  async function reviewOf(flow: InstanceType<typeof Flow>) {
    flow.draft = { ...saved, kind: 'js', id: 'OLD' }
    flow.result = { ...jsResultBase, code: 'x' } as any
    handler = (m) => ({ ok: true, data: m.type === 'review' ? reviewable : null })
    await flow.toReview()
    return lastReview()
  }

  it('is shown while describing, with nothing analysed, reviewed or previewed', async () => {
    handler = () => ({ ok: true, data: null })
    const flow = describing()
    await brew(flow, ask(true))

    expect(flow.step).toBe('describing')
    expect(flow.clarification).toEqual({ question: QUESTION, wantsExample: true })
    expect(flow.result).toBeNull()
    expect(flow.draft).toBeNull()
    expect(flow.instruction).toBe('')
    expect(flow.history).toEqual([])
    expect(calls.map((c) => c.type)).not.toContain('analyse')
    expect(calls.map((c) => c.type)).not.toContain('analyse-css')
    expect(calls.map((c) => c.type)).not.toContain('review')
    expect(transcriptModule.transcriptBubbles(flow.transcript, '', '').map((b) => [b.role, b.text])).toEqual([
      ['user', 'hide sponsored videos'],
      ['assistant', QUESTION],
    ])
  })

  it('is kept while refining, with the result and its history untouched', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'only the sponsored ones'
    await brew(flow, ask(), true)

    expect(flow.step).toBe('refining')
    expect(flow.clarification?.question).toBe(QUESTION)
    expect(flow.result?.code).toBe('/* A1 */')
    expect(flow.history).toEqual([])
    expect(flow.instruction).toBe('first')
    expect(flow.followUp).toBe('')
  })

  it('is sent with the answer as the typed instruction, and the question as an assistant turn', async () => {
    const flow = describing()
    await brew(flow, ask())

    flow.instruction = 'they have a Sponsored label'
    const port = await brew(flow, cssResult('A1'))
    expect(port.request.instruction).toBe('they have a Sponsored label')
    expect(port.request.instructionSaved).toBe(false)
    expect(port.request.history).toEqual([
      { role: 'user', content: 'hide sponsored videos' },
      { role: 'assistant', content: QUESTION },
    ])
    expect(flow.step).toBe('refining')
    expect(flow.clarification).toBeNull()
    expect(flow.history).toEqual(port.request.history)
  })

  it('gives the reviewer what the user typed and not the question', async () => {
    const flow = describing()
    await brew(flow, ask())
    flow.instruction = 'they have a Sponsored label'
    await brew(flow, cssResult('A1'))

    const sent = await reviewOf(flow)
    expect(sent.instructions).toEqual([
      { text: 'hide sponsored videos', source: 'typed' },
      { text: 'they have a Sponsored label', source: 'typed' },
    ])
    expect(JSON.stringify(sent)).not.toContain(QUESTION)
  })

  it('gives the reviewer the old result\'s instructions while a question about a change is open', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'only the sponsored ones'
    await brew(flow, ask(), true)
    const sent = await reviewOf(flow)
    expect(sent.instructions).toEqual([{ text: 'first', source: 'typed' }])
  })

  it('puts the earlier turns, the question and the answer in the next request while refining', async () => {
    const flow = flowAtRefining()
    flow.followUp = 'only the sponsored ones'
    await brew(flow, ask(), true)

    flow.followUp = 'the ones with a Sponsored label'
    const port = await brew(flow, cssResult('A2'), true)
    expect(port.request.instruction).toBe('the ones with a Sponsored label')
    expect(port.request.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'only the sponsored ones' },
      { role: 'assistant', content: QUESTION },
    ])

    const sent = await reviewOf(flow)
    expect(sent.instructions.map((i: any) => i.text)).toEqual([
      'first',
      'only the sponsored ones',
      'the ones with a Sponsored label',
    ])
    expect(JSON.stringify(sent)).not.toContain(QUESTION)
  })

  it('does not count a question as an attempt', async () => {
    const { attemptNumber } = await import('./attempt')
    const flow = describing()
    await brew(flow, ask())
    flow.instruction = 'the Sponsored label'
    await brew(flow, cssResult('A1'))
    expect(attemptNumber(flow.history.length - 2 * flow.questionPairs)).toBe(1)

    flow.followUp = 'bigger'
    await brew(flow, cssResult('A2'), true)
    expect(attemptNumber(flow.history.length - 2 * flow.questionPairs)).toBe(2)
  })

  it('keeps the question for the next request when the answer fails to brew', async () => {
    const flow = describing()
    await brew(flow, ask())
    flow.instruction = 'the Sponsored label'
    const failing = flow.generate()
    ;(await nextPort(ports.length + 1)).emit({ type: 'error', error: { message: 'failed', kind: 'network' } })
    await failing
    expect(flow.step).toBe('describing')
    expect(flow.instruction).toBe('the Sponsored label')

    const port = await brew(flow, cssResult('A1'))
    expect(port.request.history.map((turn: any) => turn.content)).toEqual(['hide sponsored videos', QUESTION])
  })

  it('records usage as for any brew', async () => {
    const flow = describing()
    const run = flow.generate()
    const port = await nextPort(ports.length + 1)
    port.emit({ type: 'done', result: ask(), usage: { inputTokens: 5, outputTokens: 2 } })
    await run
    expect(flow.lastUsage).toEqual({ inputTokens: 5, outputTokens: 2 })
  })

  describe('and a saved description sent unchanged', () => {
    function savedDescribing(imported: boolean) {
      const flow = describing('STORED INTENT')
      ;(flow as any).prefillInstruction('STORED INTENT', imported)
      return flow
    }

    it('keeps the saved description out of the turns, and the answer does not count as the saved one', async () => {
      const flow = savedDescribing(false)
      const first = await brew(flow, ask())
      expect(first.request.instructionSaved).toBe(true)
      expect(flow.history).toEqual([])

      flow.instruction = 'the Sponsored label'
      const port = await brew(flow, cssResult('A1'))
      expect(port.request.instructionSaved).toBe(false)
      expect(port.request.savedDescription).toBe('STORED INTENT')
      expect(port.request.history).toEqual([])

      const sent = await reviewOf(flow)
      expect(sent.instructions).toEqual([
        { text: 'STORED INTENT', source: 'saved-description' },
        { text: 'the Sponsored label', source: 'typed' },
      ])
    })

    it('does the same for an imported description', async () => {
      const flow = savedDescribing(true)
      const first = await brew(flow, ask())
      expect(first.request.instructionImported).toBe(true)

      flow.instruction = 'the Sponsored label'
      const port = await brew(flow, cssResult('A1'))
      expect(port.request.instructionImported).toBe(false)
      expect(port.request.importedDescription).toBe('STORED INTENT')

      const sent = await reviewOf(flow)
      expect(sent.instructions).toEqual([
        { text: 'STORED INTENT', source: 'imported-description' },
        { text: 'the Sponsored label', source: 'typed' },
      ])
    })

    it('counts an edited description as the user\'s, and says where it started', async () => {
      const flow = savedDescribing(false)
      flow.instruction = 'STORED INTENT, only videos'
      await brew(flow, ask())

      flow.instruction = 'the Sponsored label'
      await brew(flow, cssResult('A1'))
      expect(flow.history[0]).toEqual({ role: 'user', content: 'STORED INTENT, only videos' })
      const sent = await reviewOf(flow)
      expect(sent.instructions).toEqual([
        { text: 'STORED INTENT, only videos', source: 'saved-description-edited' },
        { text: 'the Sponsored label', source: 'typed' },
      ])
    })
  })

  it('does not change what a later change request sends', async () => {
    const flow = describing()
    await brew(flow, ask())
    flow.instruction = 'the Sponsored label'
    await brew(flow, cssResult('A1'))

    flow.followUp = 'bigger'
    const port = await brew(flow, cssResult('A2'), true)
    expect(port.request.history.map((turn: any) => turn.content)).toEqual([
      'hide sponsored videos',
      QUESTION,
      'the Sponsored label',
      'A1',
    ])
  })
})

describe('adding an example element after a question', () => {
  it('is possible while describing', async () => {
    handler = () => ({ ok: true, data: null })
    calls.length = 0
    const flow = newFlow()
    flow.picked = { ...found, cropDrawn: false } as any
    flow.step = 'describing'
    await flow.addReference()
    expect(flow.awaitingReference).toBe(true)
    expect(calls.map((c) => c.type)).toContain('start-picking')
  })
})
