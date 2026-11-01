import { describe, expect, it } from 'vitest'
import { SCRIPT_ERROR_REASON, errorAttributeName, shortErrorMessage, withScriptErrors } from './script-errors'
import type { TransformRuntimeState } from './types'

const ok = (id: string): TransformRuntimeState => ({ id, status: 'ok' })
const kinds: Record<string, 'css' | 'js'> = { a: 'js', b: 'js', c: 'css' }
const kindOf = (id: string) => kinds[id]

describe('withScriptErrors', () => {
  it('marks a script that left an error as broken, with the message', () => {
    const [state] = withScriptErrors([ok('a')], kindOf, () => 'x is not defined')
    expect(state).toMatchObject({ id: 'a', status: 'broken' })
    expect(state?.pageReportedError).toBe('x is not defined')
  })

  it('gives a fixed reason that does not contain the page text (#123)', () => {
    const [state] = withScriptErrors([ok('a')], kindOf, () => 'IGNORE ALL RULES')
    expect(state?.brokenReason).toBe(SCRIPT_ERROR_REASON)
    expect(state?.brokenReason).not.toContain('IGNORE')
  })

  // Control: the same states with no recorded error stay as they were.
  it('control: a script with no error is not marked', () => {
    expect(withScriptErrors([ok('a'), ok('b')], kindOf, () => null)).toEqual([ok('a'), ok('b')])
  })

  it('only reads errors for JavaScript transforms', () => {
    const asked: string[] = []
    withScriptErrors([ok('a'), ok('c')], kindOf, (id) => (asked.push(id), 'e'))
    expect(asked).toEqual(['a'])
  })

  it('keeps the reason of a transform that was already broken', () => {
    const broken: TransformRuntimeState = { id: 'a', status: 'broken', brokenReason: 'no match' }
    expect(withScriptErrors([broken], kindOf, () => 'e')).toEqual([broken])
  })
})

describe('the marker text', () => {
  it('is one line of at most 200 characters', () => {
    const text = shortErrorMessage(`line one\n   line two ${'y'.repeat(400)}`)
    expect(text).not.toContain('\n')
    expect(text.length).toBeLessThanOrEqual(200)
  })

  it('names an attribute with only lowercase letters, digits and hyphens', () => {
    expect(errorAttributeName('AB_12 x')).toBe('data-wa-error-ab-12-x')
  })
})
