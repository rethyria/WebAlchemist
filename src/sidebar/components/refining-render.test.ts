/**
 * The Refining step's rendered text for JavaScript (#155), checked by rendering
 * the real component to HTML with Svelte's server renderer. It covers what the
 * template prints and where it prints it, not how it looks.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Refining from './Refining.svelte'

const jsResult = {
  name: 'Hide banner',
  kind: 'js',
  world: 'USER_SCRIPT',
  requestedWorld: 'USER_SCRIPT',
  worldReason: '',
  capabilities: [],
  code: 'document.title = "CODE-MARKER"',
  rationale: { targets: 'The page title', approach: 'Sets the title.', assumptions: ['it exists'] },
  intent: 'Change the title',
} as any

const passed = { static: [], undeclaredCapabilities: [], passed: true } as any

function html(over: Record<string, unknown> = {}) {
  const noop = () => {}
  return render(Refining as any, {
    props: {
      result: jsResult,
      analysis: passed,
      intent: 'Change the title',
      history: [],
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
      sentAddress: 'https://www.example.com/shop',
      onfollowup: noop,
      onaddreference: noop,
      onremovereference: noop,
      onscreenshot: noop,
      onregenerate: noop,
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

/** The text a reader sees without opening anything: details bodies and comments are dropped. */
function visibleText(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<details[^>]*>([\s\S]*?)<\/details>/g, (_all, inner: string) => inner.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The text inside every details element, bodies and summaries together. */
function insideDetails(body: string): string {
  return [...body.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)].map((m) => m[1]).join(' ')
}

const blocking = {
  static: [{ severity: 'block', line: 3, api: 'eval', explanation: 'Runs text as code.' }],
  undeclaredCapabilities: [],
  passed: false,
} as any

describe('the Refining step for JavaScript that has not run', () => {
  const body = html()
  const folded = insideDetails(body)

  it('puts the informational notices inside details elements', () => {
    expect(folded).toContain('Unlike CSS, a script cannot be applied')
    expect(folded).toContain('Nothing is stored.')
    expect(folded).toContain('A second model checks the code before it runs on the page.')
    expect(folded).toContain('Page address sent to your AI provider.')
    expect(folded).toContain('Address sent: https://www.example.com/shop')
  })

  it('keeps the description and the actions outside the details elements', () => {
    const text = visibleText(body)
    expect(text).toContain('Change the title')
    expect(text).toContain('Sets the title.')
    expect(text).toContain('Discard')
    expect(text).toContain('Check the code')
    expect(text).not.toContain('Read the code first')
  })

  it('keeps the explanatory text a small part of what is visible', () => {
    const text = visibleText(body)
    expect(text.length).toBeLessThan(500)
  })

  it('shows the checking label and the progress line while the review runs', () => {
    const running = html({ previewReviewing: true })
    expect(visibleText(running)).toContain('A second model is checking the code.')
    expect(visibleText(running)).toContain('Checking the code…')
  })
})

describe('the Refining step when something blocks the run', () => {
  it('shows a disagreeing review outside the details elements', () => {
    const review = { ...passed, model: { verdict: 'mismatch', explanation: 'It also reads cookies.' } }
    const body = html({ previewReview: review })
    expect(visibleText(body)).toContain('It also reads cookies.')
    expect(insideDetails(body)).not.toContain('It also reads cookies.')
  })

  it('shows a rejected scan of the review outside the details elements', () => {
    const body = html({ previewReview: { ...passed, passed: false, model: { verdict: 'match', explanation: '' } } })
    expect(visibleText(body)).toContain('The code scan rejected this code')
  })

  it('shows the findings of a blocked analysis outside the details elements', () => {
    const body = html({ analysis: blocking })
    expect(visibleText(body)).toContain('Runs text as code.')
    expect(insideDetails(body)).not.toContain('Runs text as code.')
  })

  it('shows the reload notice after the script ran', () => {
    const body = html({ jsRan: true })
    expect(visibleText(body)).toContain('Changing this needs a page reload')
  })
})
