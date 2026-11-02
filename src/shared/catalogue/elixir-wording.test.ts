/**
 * The product calls a saved CSS or JavaScript change to a website an elixir.
 * The word "transform" stays in code, storage keys, message types and file
 * formats, but must not appear in text that a user reads.
 */

import { describe, expect, it } from 'vitest'
import { EN_CATALOGUE } from './index'

describe('the message catalogue', () => {
  it('never shows the old noun to the user', () => {
    const offenders = Object.entries(EN_CATALOGUE)
      .filter(([, entry]) => /\btransforms?\b/i.test(entry.message))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('uses the right article before elixir', () => {
    const offenders = Object.entries(EN_CATALOGUE)
      .filter(([, entry]) => /\ba elixir\b/i.test(entry.message))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })

  it('says what the extension does in the add-on description without the new noun', () => {
    expect(EN_CATALOGUE.extensionDescription.message).toMatch(/CSS or JavaScript/)
  })
})
