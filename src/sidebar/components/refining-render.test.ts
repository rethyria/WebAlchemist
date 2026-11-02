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
      transcript: [],
      asking: false,
      askingQuestion: null,
      askPartial: '',
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
      sentAddress: 'https://www.example.com/shop',
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

/** The paragraphs of the transcript, in order, with their classes. */
function bubbleList(body: string): { classes: string; text: string }[] {
  const container = body.match(/<div class="bubbles[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? ''
  return [...container.matchAll(/<p class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({
    classes: (m[1] as string).replace(/\s*svelte-\w+/g, '').trim(),
    text: (m[2] as string).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }))
}

const conversation = [
  { kind: 'request', text: 'make it red' },
  { kind: 'result', text: 'Colours it red.' },
  { kind: 'question', text: 'Why CSS?' },
  { kind: 'answer', text: 'It is enough for a colour.' },
  { kind: 'request', text: 'now blue' },
  { kind: 'result', text: 'Colours it blue.' },
  { kind: 'question', text: 'Is that fast?' },
  { kind: 'answer', text: 'Yes.' },
]

describe('the Refining step with side questions', () => {
  it('labels the box for questions and for changes and shows Ask beside Regenerate', () => {
    const body = html({ followUp: 'x' })
    const text = visibleText(body)
    expect(text).toContain('Ask a question, or say what to change')
    expect(body).toMatch(/<button[^>]*class="ask[^"]* ready[^"]*"[^>]*>\s*Ask\s*<\/button>/)
    expect(body).toMatch(/<button[^>]*class="regenerate[^"]* ready[^"]*"[^>]*>\s*Regenerate\s*<\/button>/)
    expect(body).toMatch(/class="pair[^"]*"/)
  })

  it('disables Ask and Regenerate while the box is empty', () => {
    const body = html()
    expect(body).toMatch(/<button[^>]*class="ask[^"]*"[^>]*disabled/)
    expect(body).toMatch(/<button[^>]*class="regenerate[^"]*"[^>]*disabled/)
  })

  it('shows Stop in place of Ask and disables Regenerate while an answer arrives', () => {
    const body = html({ asking: true, askingQuestion: 'Why?', askPartial: 'Part', followUp: '' })
    expect(body).toMatch(/<button[^>]*class="ask[^"]* ready[^"]*"[^>]*>\s*Stop\s*<\/button>/)
    expect(body).not.toMatch(/>\s*Ask\s*<\/button>/)
    expect(body).toMatch(/<button[^>]*class="regenerate[^"]*"[^>]*disabled/)
  })

  it('keeps Ask beside the reload button after JavaScript has run', () => {
    const body = html({ jsRan: true, followUp: 'x' })
    expect(body).toMatch(/>\s*Ask\s*<\/button>/)
    expect(body).toContain('Reload page and try again')
    expect(body).not.toContain('>Regenerate<')
  })

  it('lists the conversation in the order it happened, with the prefixes on the side bubbles', () => {
    const list = bubbleList(html({ transcript: conversation, intent: 'now blue' }))
    const texts = list.map((b) => b.text).filter((t) => !t.startsWith('Questions and answers'))
    expect(texts).toEqual([
      'make it red',
      'Colours it red.',
      'Question: Why CSS?',
      'Answer: It is enough for a colour.',
      'now blue',
      'Sets the title.',
      'Question: Is that fast?',
      'Answer: Yes.',
    ])
    const side = list.filter((b) => b.classes.split(' ').includes('side'))
    expect(side.map((b) => b.classes.split(' ')[1])).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(list.filter((b) => !b.classes.split(' ').includes('side') && b.classes.includes('bubble'))).toHaveLength(4)
  })

  it('shows the note about questions once, after the first answer', () => {
    const list = bubbleList(html({ transcript: conversation, intent: 'now blue' }))
    const notes = list.filter((b) => b.classes === 'side-note')
    expect(notes).toHaveLength(1)
    expect(notes[0]!.text).toBe(
      'Questions and answers are not sent to the model that makes the change. Type the change you want and press Regenerate.',
    )
    const at = list.findIndex((b) => b.classes === 'side-note')
    expect(list[at - 1]!.text).toBe('Answer: It is enough for a colour.')
  })

  it('shows no note and no side bubble when nothing was asked (control)', () => {
    const body = html()
    expect(body).not.toContain('Questions and answers are not sent')
    expect(body).not.toContain('Question:')
  })

  it('renders an answer as literal text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)> **bold** [link](https://evil.example)'
    const body = html({
      transcript: [
        { kind: 'request', text: 'r' },
        { kind: 'result', text: 'a' },
        { kind: 'question', text: '<b>q</b>' },
        { kind: 'answer', text: hostile },
      ],
    })
    expect(body).not.toContain('<img')
    expect(body).not.toContain('<b>q</b>')
    expect(body).not.toContain('<a ')
    expect(body).toContain('&lt;img src=x onerror=alert(1)>')
    expect(body).toContain('**bold** [link](https://evil.example)')
  })

  it('shows the unfinished answer and the question that is being answered', () => {
    const list = bubbleList(html({ asking: true, askingQuestion: 'Why?', askPartial: 'Because it' }))
    expect(list.map((b) => b.text)).toContain('Question: Why?')
    expect(list.map((b) => b.text)).toContain('Answer: Because it')
  })

  it('shows a waiting line before any of the answer has arrived', () => {
    const body = html({ asking: true, askingQuestion: 'Why?', askPartial: '' })
    expect(visibleText(body)).toContain('Waiting for the answer…')
  })

  it('shows the limit note and disables Ask when the limit is reached', () => {
    const body = html({ askLimitReached: true, followUp: 'one more' })
    expect(visibleText(body)).toContain('The limit of 20 questions has been reached for this draft.')
    expect(body).toMatch(/<button[^>]*class="ask[^"]*"[^>]*disabled/)
    // Regenerate still works at the limit.
    expect(body).toMatch(/<button[^>]*class="regenerate[^"]* ready[^"]*"/)
  })

  it('keeps the visible text of a fresh Refining step short', () => {
    expect(visibleText(html()).length).toBeLessThan(560)
  })
})
