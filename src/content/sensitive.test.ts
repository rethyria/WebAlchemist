/**
 * The password and payment field check (#131).
 *
 * The test environment has no DOM and no declared DOM library, so the page is a
 * stand-in that answers the two selectors the check uses from a list of inputs.
 * Whether the selectors themselves match real markup is not tested here.
 */

import { describe, expect, it } from 'vitest'
import { isPaymentAutocomplete, pageHasSensitiveFields } from './sensitive'

interface FakeInput {
  type?: string
  autocomplete?: string
}

function page(inputs: FakeInput[]): ParentNode {
  const asElement = (i: FakeInput) => ({
    getAttribute: (name: string) => (name === 'autocomplete' ? (i.autocomplete ?? null) : null),
  })
  return {
    querySelector: (selector: string) =>
      selector.startsWith('input[type="password"') &&
      inputs.some((i) => (i.type ?? '').toLowerCase() === 'password')
        ? {}
        : null,
    querySelectorAll: (selector: string) =>
      selector === 'input[autocomplete]'
        ? inputs.filter((i) => i.autocomplete !== undefined).map(asElement)
        : [],
  } as unknown as ParentNode
}

describe('pageHasSensitiveFields', () => {
  it('is true for a password field', () => {
    expect(pageHasSensitiveFields(page([{ type: 'password' }]))).toBe(true)
  })
  it('is true for a payment field named by its autocomplete value', () => {
    for (const value of ['cc-number', 'cc-csc', 'cc-exp', 'cc-name', 'billing cc-number']) {
      expect(pageHasSensitiveFields(page([{ type: 'text', autocomplete: value }]))).toBe(true)
    }
  })
  it('is false for the same inputs without such a field (control)', () => {
    const inputs = [{ type: 'text' }, { type: 'email', autocomplete: 'email' }, { autocomplete: 'name' }]
    expect(pageHasSensitiveFields(page(inputs))).toBe(false)
  })
  it('is false for a page with no inputs', () => {
    expect(pageHasSensitiveFields(page([]))).toBe(false)
  })
})

describe('isPaymentAutocomplete', () => {
  it('matches tokens that start with cc-, in any case, and nothing else', () => {
    expect(isPaymentAutocomplete('CC-Number')).toBe(true)
    expect(isPaymentAutocomplete('section-a shipping cc-exp')).toBe(true)
    expect(isPaymentAutocomplete('accc-number')).toBe(false)
    expect(isPaymentAutocomplete('off')).toBe(false)
    expect(isPaymentAutocomplete(null)).toBe(false)
  })
})
