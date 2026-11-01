/**
 * The harness records the last error of a JavaScript transform (#123), and
 * its path check agrees with the CSS side (#95). The wrapped code is run here
 * against a small fake document and a stub location.
 */

import { describe, expect, it, vi } from 'vitest'
import { matchesUrl } from '@shared/match'
import { errorAttributeName } from '@shared/script-errors'
import { cssTransform } from './test-browser'
import { wrapTransform } from './harness'
import type { Transform } from '@shared/types'

/**
 * Runs the wrapped code against a fake document. `again` runs the transform a
 * second time the way a page mutation does, through the observer and the
 * animation frame callback. `touched` lists every attribute call, in order.
 */
function run(code: string, attributes = new Map<string, string>(), again = 0) {
  const transform = cssTransform({ id: 'abc-1', kind: 'js', code }) as unknown as Transform
  const touched: string[] = []
  const documentElement = {
    setAttribute: (name: string, value: string) => {
      touched.push(`set:${name}`)
      attributes.set(name, value)
    },
    removeAttribute: (name: string) => {
      touched.push(`remove:${name}`)
      attributes.delete(name)
    },
  }
  const fakeDocument = { documentElement, querySelector: () => null, body: {} as unknown }
  let mutated: () => void = () => {}
  let frame: () => void = () => {}
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    new Function('location', 'document', 'requestAnimationFrame', 'MutationObserver', 'console', wrapTransform(transform, TOKEN))(
      { pathname: '/', search: '' },
      fakeDocument,
      (callback: () => void) => {
        frame = callback
      },
      class {
        constructor(callback: () => void) {
          mutated = callback
        }
        observe() {}
      },
      console,
    )
    for (let i = 0; i < again; i += 1) {
      mutated()
      frame()
    }
  } finally {
    consoleError.mockRestore()
  }
  return Object.assign(attributes, { touched })
}

const TOKEN = 'a1b2c3'
const NAME = errorAttributeName(TOKEN)
describe('the error marker', () => {
  it('holds the message of a script that throws', () => {
    expect(run('throw new Error("boom")').get(NAME)).toBe('boom')
  })

  // Control: the same wrapper around code that does not throw records nothing,
  // so the marker above comes from the error and not from the wrapper.
  it('control: a script that does not throw leaves no marker', () => {
    expect(run('1 + 1').has(NAME)).toBe(false)
  })

  it('clears the marker this script wrote when a later run succeeds', () => {
    // The first run throws and the second does not: the code counts its runs
    // on the fake document.
    const code = 'document.runs = (document.runs || 0) + 1; if (document.runs === 1) throw new Error("first")'
    const result = run(code, new Map(), 1)
    expect(result.has(NAME)).toBe(false)
    expect(result.touched).toEqual([`set:${NAME}`, `remove:${NAME}`])
  })

  it('does not touch the attribute after a run that succeeded and wrote nothing', () => {
    expect(run('1 + 1', new Map(), 2).touched).toEqual([])
  })

  // Control: the check above reads the calls made, so it can fail. A script
  // that throws on every run does write each time.
  it('control: a script that throws is seen writing the attribute', () => {
    expect(run('throw new Error("x")', new Map(), 1).touched).toEqual([`set:${NAME}`, `set:${NAME}`])
  })

  it('does not remove a marker it did not write', () => {
    const attributes = new Map([[NAME, 'forged by the page']])
    expect(run('1 + 1', attributes).has(NAME)).toBe(true)
  })

  it('does not put the transform id in the attribute name', () => {
    expect(wrapTransform(cssTransform({ id: 'abc-1', kind: 'js' }) as unknown as Transform, TOKEN)).not.toContain('abc-1')
  })

  it('caps a long message', () => {
    expect(run('throw new Error("x".repeat(5000))').get(NAME)).toHaveLength(500)
  })

  it('clears an earlier error when the code returns early', () => {
    const code = 'document.runs = (document.runs || 0) + 1; if (document.runs > 1) return; throw new Error("first")'
    expect(run(code, new Map(), 1).has(NAME)).toBe(false)
  })

  // Control: the same early return with a throw before it still records the
  // error, so the test above is not passing because errors are never recorded.
  it('control: a throw before an early return is recorded', () => {
    expect(run('if (true) { throw new Error("boom") }\nreturn', new Map()).get(NAME)).toBe('boom')
  })

  it('is not affected by code that declares a name the wrapper uses', () => {
    const code =
      'document.runs = (document.runs || 0) + 1; const ERROR_ATTRIBUTE = "other"; let SCOPES = 1; const NAME = 2; if (document.runs === 1) throw new Error("boom")'
    expect(run(code, new Map(), 1).has(NAME)).toBe(false)
    expect(run('const ERROR_ATTRIBUTE = "other"; throw new Error("boom")').get(NAME)).toBe('boom')
  })
})

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
    wrapTransform(transform as never, 'a1b2c3'),
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
