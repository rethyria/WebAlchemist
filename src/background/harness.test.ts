/**
 * The path check at the top of the harness wrapper (#95).
 *
 * The wrapper source is run with a stub `location`, so no page or browser is
 * involved. The transform code increments a counter, and a transform that the
 * guard stops never increments it.
 */

import { describe, expect, it } from 'vitest'
import { matchesUrl } from '@shared/match'
import { wrapTransform } from './harness'
import { cssTransform } from './test-browser'

/** Runs the wrapper for `match` on `url` and returns how many times the code ran. */
function runsOn(match: string, url: string): number {
  const transform = {
    ...cssTransform({ id: 'j', kind: 'js', match, code: 'ran()' }),
    anchor: { tag: 'body', classes: [], path: 'body', landmarks: [], selector: 'body' },
  }
  const { pathname, search } = new URL(url)
  let count = 0
  new Function(
    'location',
    'document',
    'requestAnimationFrame',
    'MutationObserver',
    'ran',
    wrapTransform(transform as never),
  )(
    { pathname, search },
    { querySelector: () => null, body: null },
    () => {},
    class {
      observe() {}
    },
    () => count++,
  )
  return count
}

describe('the wrapper agrees with the CSS side on which pages it runs on', () => {
  const cases: [string, string][] = [
    // A wildcard in the pattern matches across the start of the query in a
    // browser pattern, so the script is registered on a page where the CSS
    // does not apply.
    ['example.com/a*b', 'https://example.com/a?x=b'],
    ['example.com/a*b', 'https://example.com/axb'],
    ['example.com/a*b', 'https://example.com/axb?x=1'],
    ['example.com/docs*', 'https://example.com/docs/intro?x=1'],
    ['example.com/search?q=*', 'https://example.com/search/?q=abc'],
    ['example.com/search?q=*', 'https://example.com/search?q=abc'],
    ['example.com/search?q=*', 'https://example.com/search?p=abc'],
    ['example.com/watch', 'https://example.com/watch/'],
    ['example.com/watch', 'https://example.com/other'],
  ]
  for (const [match, url] of cases) {
    it(`${match} on ${url}`, () => {
      expect(runsOn(match, url) > 0).toBe(matchesUrl(match, url))
    })
  }

  it('control: the first case is one on which the CSS side does not match', () => {
    // Shows the table includes a page where the script must not run, so the
    // agreement above is not satisfied by both sides always saying yes.
    expect(matchesUrl('example.com/a*b', 'https://example.com/a?x=b')).toBe(false)
    expect(runsOn('example.com/axb', 'https://example.com/axb')).toBe(1)
  })
})
