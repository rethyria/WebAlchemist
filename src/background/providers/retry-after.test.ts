import { describe, expect, it } from 'vitest'
import { retryAfterSeconds } from './retry-after'

const NOW = 1_700_000_000_000
const headers = (map: Record<string, string>) => ({
  get: (name: string) => map[name.toLowerCase()] ?? null,
})

describe('retry-after', () => {
  it('reads a delay in seconds', () => {
    expect(retryAfterSeconds(headers({ 'retry-after': '30' }), NOW)).toBe(30)
  })

  it('reads an HTTP date', () => {
    const when = new Date(NOW + 45_000).toUTCString()
    expect(retryAfterSeconds(headers({ 'retry-after': when }), NOW)).toBe(45)
  })

  /*
   * An HTTP-date cannot carry a fraction — `toUTCString` truncates to whole
   * seconds — so the rounding this checks only ever applies to the duration
   * headers below. Written against those instead of against a date that cannot
   * express the case.
   */
  it('rounds a partial second up, so the countdown never ends early', () => {
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '2400ms' }), NOW)).toBe(3)
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '2.2s' }), NOW)).toBe(3)
  })
})

/*
 * The case #35 names. `FlowError.retryInSeconds` was always 0, and a
 * zero-second countdown is worse than none — it claims to be waiting and is
 * not. Null and zero have to stay different answers.
 */
describe('no guidance produces no countdown', () => {
  it.each([
    ['no headers at all', null],
    ['no such header', headers({})],
    ['an empty value', headers({ 'retry-after': '' })],
    ['whitespace', headers({ 'retry-after': '   ' })],
    ['not a number or a date', headers({ 'retry-after': 'soon' })],
    ['zero', headers({ 'retry-after': '0' })],
    ['a date already in the past', headers({ 'retry-after': new Date(NOW - 5000).toUTCString() })],
    ['longer than an hour', headers({ 'retry-after': '7200' })],
  ])('%s', (_label, source) => {
    expect(retryAfterSeconds(source, NOW)).toBeNull()
  })

  /* The control: the same call shape with a usable value must not be null. */
  it('but a usable value is not null', () => {
    expect(retryAfterSeconds(headers({ 'retry-after': '12' }), NOW)).toBe(12)
  })
})

describe('the OpenAI-compatible fallbacks', () => {
  it('reads a duration with units', () => {
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '20s' }), NOW)).toBe(20)
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '1m30s' }), NOW)).toBe(90)
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '1500ms' }), NOW)).toBe(2)
  })

  it('reads a bare number as seconds', () => {
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '9' }), NOW)).toBe(9)
  })

  it('reads a millisecond epoch as a moment, not a duration', () => {
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset': String(NOW + 25_000) }), NOW)).toBe(25)
  })

  it('prefers retry-after when both are present', () => {
    const both = headers({ 'retry-after': '5', 'x-ratelimit-reset-requests': '600' })
    expect(retryAfterSeconds(both, NOW)).toBe(5)
  })

  it('prefers the request budget over the token budget', () => {
    const both = headers({
      'x-ratelimit-reset-requests': '8',
      'x-ratelimit-reset-tokens': '900',
    })
    expect(retryAfterSeconds(both, NOW)).toBe(8)
  })

  it('falls through to the token budget when the request one is unusable', () => {
    const both = headers({ 'x-ratelimit-reset-requests': 'nonsense', 'x-ratelimit-reset-tokens': '11s' })
    expect(retryAfterSeconds(both, NOW)).toBe(11)
  })
})

describe('the floor', () => {
  it('never reports less than a second, so a countdown has something to show', () => {
    expect(retryAfterSeconds(headers({ 'x-ratelimit-reset-requests': '100ms' }), NOW)).toBe(1)
  })
})
