import { describe, expect, it } from 'vitest'
import type { ReviewResult } from '@shared/types'
import { jsPreviewGate, reviewKey } from './preview-gate'

const passed = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  static: [],
  undeclaredCapabilities: [],
  passed: true,
  ...over,
})
const matched = passed({ model: { verdict: 'match', explanation: '' } })

describe('jsPreviewGate', () => {
  it('allows a preview after the review matched and the analysis passed', () => {
    expect(jsPreviewGate(passed(), matched)).toEqual({ allowed: true })
  })

  it('refuses before any review has run', () => {
    expect(jsPreviewGate(passed(), null)).toEqual({ allowed: false, reason: 'not-reviewed' })
  })

  it('refuses a review that has no model verdict', () => {
    expect(jsPreviewGate(passed(), passed())).toEqual({ allowed: false, reason: 'not-reviewed' })
  })

  it.each(['mismatch', 'uncertain'] as const)('refuses a verdict of %s', (verdict) => {
    const review = passed({ model: { verdict, explanation: 'x' } })
    expect(jsPreviewGate(passed(), review)).toEqual({ allowed: false, reason: 'verdict' })
  })

  it('refuses when the local analysis did not pass, whatever the review said', () => {
    expect(jsPreviewGate(passed({ passed: false }), matched)).toEqual({ allowed: false, reason: 'analysis' })
    expect(jsPreviewGate(null, matched)).toEqual({ allowed: false, reason: 'analysis' })
  })

  it('refuses when the review itself reports a failed analysis', () => {
    const review = { ...matched, passed: false }
    expect(jsPreviewGate(passed(), review)).toEqual({ allowed: false, reason: 'not-reviewed' })
  })
})

describe('reviewKey', () => {
  const result = { code: 'a', world: 'USER_SCRIPT' as const, capabilities: [] }

  it('is the same for the same code, intent, world and capabilities', () => {
    expect(reviewKey(result, 'i')).toBe(reviewKey({ ...result }, 'i'))
  })

  it.each([
    ['code', { ...result, code: 'b' }, 'i'],
    ['world', { ...result, world: 'MAIN' as const }, 'i'],
    ['capabilities', { ...result, capabilities: ['network' as const] }, 'i'],
    ['intent', result, 'other'],
  ])('differs when the %s differs', (_name, changed, intent) => {
    expect(reviewKey(changed, intent)).not.toBe(reviewKey(result, 'i'))
  })
})
