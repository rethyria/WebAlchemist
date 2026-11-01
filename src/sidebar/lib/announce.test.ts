import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ProgressStage } from './flow.svelte'
import { EN_CATALOGUE } from '@shared/catalogue'
import { brokenAnnouncement, generationAnnouncement, reviewAnnouncement } from './announce'
import type { ModelReview, ReviewResult, StaticFinding } from '@shared/types'

const finding = (severity: 'block' | 'warn'): StaticFinding =>
  ({ severity, api: 'fetch', line: 1, explanation: 'x' }) as StaticFinding

const review = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  static: [],
  undeclaredCapabilities: [],
  passed: true,
  ...over,
})

describe('generationAnnouncement', () => {
  const stages: ProgressStage[] = ['context', 'sent', 'thinking', 'streaming', 'analysis', 'preview']

  it('has one distinct sentence per stage', () => {
    expect(new Set(stages.map(generationAnnouncement)).size).toBe(stages.length)
  })

  it('does not change with streamed content, because it takes only the stage', () => {
    // Control: the checklist text in Generating.svelte does contain counts, so
    // it is the unsuitable thing to put in a live region.
    expect(generationAnnouncement('streaming')).not.toMatch(/\d/)
    const source = readFileSync(new URL('../components/Generating.svelte', import.meta.url), 'utf8')
    expect(EN_CATALOGUE.generatingStepWritingLines.message).toMatch(/lines so far/)
    expect(source).toMatch(/generatingStepWritingLines/)
    expect(source.match(/role="status"[^>]*>[^<]*/)?.[0]).not.toMatch(/generatingStep|thinkingChars|code/)
  })
})

describe('reviewAnnouncement', () => {
  it('says the review is running while it has not arrived', () => {
    expect(reviewAnnouncement(null, 'js')).toBe('Reviewing the code.')
  })

  it('differs between waiting and the result, so the arrival is a change', () => {
    expect(reviewAnnouncement(review(), 'js')).not.toBe(reviewAnnouncement(null, 'js'))
  })

  it('counts blocking problems and warnings', () => {
    expect(reviewAnnouncement(review({ static: [finding('block')] }), 'js')).toBe(
      'Review finished. One problem stops this from being saved.',
    )
    expect(
      reviewAnnouncement(review({ static: [finding('block'), finding('block'), finding('warn')] }), 'js'),
    ).toBe('Review finished. 2 problems stop this from being saved. One warning.')
  })

  it('reports a model disagreement for JavaScript only', () => {
    const disagree = review({ model: { verdict: 'mismatch', explanation: 'x' } as ModelReview })
    expect(reviewAnnouncement(disagree, 'js')).toMatch(/disagrees/)
    expect(reviewAnnouncement(disagree, 'css')).not.toMatch(/disagrees/)
  })

  it('says no problems were found for a clean review, and that CSS is not model reviewed', () => {
    expect(reviewAnnouncement(review(), 'js')).toBe('Review finished. No problems found.')
    expect(reviewAnnouncement(review(), 'css')).toMatch(/not sent for model review/)
  })
})

describe('brokenAnnouncement', () => {
  it('is empty for none, so a cleared banner clears the region', () => {
    expect(brokenAnnouncement(0)).toBe('')
  })

  it('names the count with the right plural', () => {
    expect(brokenAnnouncement(1)).toBe('1 transform stopped working.')
    expect(brokenAnnouncement(3)).toBe('3 transforms stopped working.')
  })
})

describe('regions are persistent', () => {
  // A live region added to the page together with its text is often not read
  // out; the region has to exist first. These are outside any {#if}.
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  it('Reviewing and the list place the region outside a conditional', () => {
    expect(read('../components/Reviewing.svelte')).toMatch(/<\/header>\s*<!--[^>]*-->\s*<p class="sr-only" role="status">/)
    expect(read('../App.svelte')).toMatch(/<p class="sr-only" role="status">\{brokenAnnouncement/)
  })
})
