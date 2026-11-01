/**
 * The harness records the last error of a JavaScript transform (#123). The
 * wrapped code is run here against a small fake document.
 */

import { describe, expect, it, vi } from 'vitest'
import { errorAttributeName } from '@shared/script-errors'
import { cssTransform } from './test-browser'
import { wrapTransform } from './harness'
import type { Transform } from '@shared/types'

function run(code: string, attributes = new Map<string, string>()) {
  const transform = cssTransform({ id: 'abc-1', kind: 'js', code }) as unknown as Transform
  const documentElement = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  }
  const fakeDocument = { documentElement, querySelector: () => null, body: null }
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    new Function('document', 'requestAnimationFrame', 'MutationObserver', 'console', wrapTransform(transform))(
      fakeDocument,
      () => {},
      class {
        observe() {}
      },
      console,
    )
  } finally {
    consoleError.mockRestore()
  }
  return attributes
}

const NAME = errorAttributeName('abc-1')

describe('the error marker', () => {
  it('holds the message of a script that throws', () => {
    expect(run('throw new Error("boom")').get(NAME)).toBe('boom')
  })

  // Control: the same wrapper around code that does not throw records nothing,
  // so the marker above comes from the error and not from the wrapper.
  it('control: a script that does not throw leaves no marker', () => {
    expect(run('1 + 1').has(NAME)).toBe(false)
  })

  it('control: a run that succeeds clears an earlier error', () => {
    const attributes = new Map([[NAME, 'old']])
    expect(run('1 + 1', attributes).has(NAME)).toBe(false)
  })

  it('caps a long message', () => {
    expect(run('throw new Error("x".repeat(5000))').get(NAME)).toHaveLength(500)
  })

  it('clears an earlier error when the code returns early', () => {
    const attributes = new Map([[NAME, 'old']])
    expect(run('if (true) return;\nthrow new Error("not reached")', attributes).has(NAME)).toBe(false)
  })

  // Control: the same early return with a throw before it still records the
  // error, so the test above is not passing because errors are never recorded.
  it('control: a throw before an early return is recorded', () => {
    expect(run('if (true) { throw new Error("boom") }\nreturn', new Map()).get(NAME)).toBe('boom')
  })

  it('is not affected by code that declares a name the wrapper uses', () => {
    const attributes = new Map([[NAME, 'old']])
    expect(run('const ERROR_ATTRIBUTE = "other"; let SCOPES = 1; const NAME = 2', attributes).has(NAME)).toBe(false)
    expect(run('const ERROR_ATTRIBUTE = "other"; throw new Error("boom")').get(NAME)).toBe('boom')
  })
})
