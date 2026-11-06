/**
 * The model's question in the Describing and Refining steps, checked by
 * rendering the real components to HTML with Svelte's server renderer. The
 * question is plain text, and the button that adds an example element is shown
 * next to it only when the model asked for an example.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Describing from './Describing.svelte'
import Refining from './Refining.svelte'

const QUESTION = 'Which <b>videos</b> are sponsored?'
const asked = (wantsExample: boolean) => ({ question: QUESTION, wantsExample })
const log = [
  { kind: 'replied', text: 'hide sponsored videos' },
  { kind: 'asked', text: QUESTION },
] as any

const noop = () => {}

function describing(over: Record<string, unknown> = {}) {
  return render(Describing as any, {
    props: {
      regionAvailable: false,
      target: { breadcrumb: ['div.x'], width: 1, height: 1, drawing: false },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      cropClipped: false,
      instruction: '',
      choosingRegion: false,
      shotPreview: null,
      shotClipped: false,
      shotMoved: false,
      shotReduced: null,
      visionSupported: false,
      sentAddress: 'https://www.example.com/',
      onchange: noop,
      onscreenshot: noop,
      onincluderegion: noop,
      onrepick: noop,
      tree: [],
      onretarget: noop,
      onpreview: noop,
      onexpand: noop,
      scopeDepth: 0,
      scopeCount: 1,
      scopeContainer: null,
      onscope: noop,
      oncancel: noop,
      ongenerate: noop,
      ...over,
    },
  }).body
}

function refining(over: Record<string, unknown> = {}) {
  return render(Refining as any, {
    props: {
      result: {
        name: 'n', kind: 'css', world: 'USER_SCRIPT', requestedWorld: 'USER_SCRIPT', worldReason: '', capabilities: [],
        code: 'a{}', rationale: { targets: 't', approach: 'Hides it.', assumptions: [] }, intent: 'i', config: [],
      },
      analysis: { static: [], undeclaredCapabilities: [], passed: true },
      intent: 'hide it',
      history: [],
      transcript: [],
      asking: false,
      askingQuestion: null,
      askPartial: '',
      reloading: false,
      askNotice: null,
      askLimitReached: false,
      questionLimit: 20,
      followUp: '',
      jsRan: false,
      references: [],
      awaitingReference: false,
      choosingRegion: false,
      shotPreview: null,
      shotClipped: false,
      shotMoved: false,
      shotReduced: null,
      visionSupported: false,
      sentAddress: 'https://www.example.com/',
      onfollowup: noop,
      onaddreference: noop,
      onremovereference: noop,
      onscreenshot: noop,
      onregenerate: noop,
      onask: noop,
      onstopask: noop,
      previewReview: null,
      previewReviewing: false,
      previewAllowed: false,
      onreviewfirst: noop,
      onrun: noop,
      onreload: noop,
      ondiscard: noop,
      onkeep: noop,
      ...over,
    },
  }).body
}

const buttons = (html: string) => (html.match(/class="add[^"]*"/g) ?? []).length
const prominent = (html: string) => (html.match(/class="add prominent/g) ?? []).length

describe('Describing after a question', () => {
  it('shows the question as plain text', () => {
    const html = describing({ clarification: asked(false), transcript: log })
    expect(html).toContain('Which &lt;b>videos&lt;/b> are sponsored?')
    expect(html).not.toContain('<b>videos</b>')
  })

  it('shows the add-an-element button only when an example was asked for', () => {
    expect(prominent(describing({ clarification: asked(true), transcript: log }))).toBe(1)
    expect(prominent(describing({ clarification: asked(false), transcript: log }))).toBe(0)
    expect(prominent(describing())).toBe(0)
  })
})

describe('Refining after a question', () => {
  it('shows the question as plain text', () => {
    const html = refining({ clarification: asked(false), transcript: log })
    expect(html).toContain('Which &lt;b>videos&lt;/b> are sponsored?')
    expect(html).not.toContain('<b>videos</b>')
  })

  it('shows one prominent button when an example was asked for, and the usual one otherwise', () => {
    const asking = refining({ clarification: asked(true), transcript: log })
    expect(prominent(asking)).toBe(1)
    expect(buttons(asking)).toBe(1)
    const plain = refining({ clarification: asked(false), transcript: log })
    expect(prominent(plain)).toBe(0)
    expect(buttons(plain)).toBe(1)
  })
})
