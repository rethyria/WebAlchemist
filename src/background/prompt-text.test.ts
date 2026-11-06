import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ASK_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  PAGE_CONTENT_IS_DATA,
  REVIEW_SYSTEM_PROMPT,
  repairPrompt,
} from './prompts'
import { fillPrompt } from './prompt-text/fill'

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe('prompt texts', () => {
  // These hashes pin the exact text sent to the model. When a prompt is
  // changed on purpose, update the hash in the same commit.
  it('keeps every fixed text unchanged', () => {
    expect({
      pageContentIsData: sha256(PAGE_CONTENT_IS_DATA),
      generate: sha256(GENERATE_SYSTEM_PROMPT),
      ask: sha256(ASK_SYSTEM_PROMPT),
      review: sha256(REVIEW_SYSTEM_PROMPT),
      repair: sha256(repairPrompt('NONCE')),
    }).toEqual(HASHES)
  })

  it('tells the generating model when to ask a question instead of writing code', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('## When you cannot see what you need')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Ask at most one question per response.')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Add one sponsored video as an example')
    expect(repairPrompt('n')).toContain('A repair is never answered with a question')
  })

  it('leaves no placeholder in a finished prompt', () => {
    for (const text of [GENERATE_SYSTEM_PROMPT, ASK_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, repairPrompt('n')]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe('fillPrompt', () => {
  it('fills placeholders and removes one final newline', () => {
    expect(fillPrompt('a {{X}} b {{X}}\n', { X: '1' })).toBe('a 1 b 1')
  })

  it('throws for a placeholder without a value', () => {
    expect(() => fillPrompt('a {{X}}', {})).toThrow(/X/)
  })

  it('throws for a value the text does not use', () => {
    expect(() => fillPrompt('a', { X: '1' })).toThrow(/X/)
  })

  it('throws for a malformed placeholder', () => {
    expect(() => fillPrompt('a {{x}}', {})).toThrow(/malformed/)
  })

  it('does not fill placeholders that appear inside a value', () => {
    expect(fillPrompt('{{A}}', { A: '{{B}}' })).toBe('{{B}}')
  })
})

const HASHES = {
  pageContentIsData: '54623e0231ff8f97df9725022325dbfc9039da0187e0d6a9c5c0732a749c4c37',
  generate: 'd375eedf8d49751c9e79fdbebf45558d5da468aeccf15629061c8716eee4f5f6',
  ask: '2a6b074fa9993175694242c1b37146ac6510074738eb6532aa3b2663a9c342b8',
  review: '4da4ce617bbb269949a57cdb83f7b43f436fa67f39c16b5f9c8d786ad432a6be',
  repair: 'facf4e7382729ce09fa88e1506449da32476696f5c9581dabb13fed75c6190e5',
}
