import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { needsTabindex, returnedToList } from './focus'

const fake = (tag: string, tabindex = false) => ({
  hasAttribute: (name: string) => name === 'tabindex' && tabindex,
  matches: (selector: string) => selector.split(',').some((part) => part.trim().startsWith(tag)),
})

describe('needsTabindex', () => {
  it('is true for a heading or a container, which cannot take focus from a script', () => {
    expect(needsTabindex(fake('h1'))).toBe(true)
    expect(needsTabindex(fake('div'))).toBe(true)
  })

  it('is false for a field or a button, and for an element that already has a tabindex (control)', () => {
    expect(needsTabindex(fake('textarea'))).toBe(false)
    expect(needsTabindex(fake('button'))).toBe(false)
    expect(needsTabindex(fake('h1', true))).toBe(false)
  })
})

describe('returnedToList', () => {
  it('is true when a run ends', () => {
    expect(returnedToList('saving', 'list')).toBe(true)
    expect(returnedToList('picking', 'list')).toBe(true)
  })

  it('is false at start-up and while on the list (controls)', () => {
    expect(returnedToList(null, 'list')).toBe(false)
    expect(returnedToList('list', 'list')).toBe(false)
    expect(returnedToList('list', 'picking')).toBe(false)
  })
})

describe('every step moves the focus', () => {
  // The components are not rendered in tests, so this reads the source. A
  // step whose component does not call the focus action leaves a keyboard user
  // on a removed element. Control: the check run on a component that has no
  // focus move, and on the same source with the move removed, fails.
  const moves = (source: string) => source.includes('use:focusOnMount')
  const read = (name: string) =>
    readFileSync(new URL(`../components/${name}.svelte`, import.meta.url), 'utf8')

  const STEPS = ['Picking', 'Describing', 'Generating', 'Refining', 'Saving', 'Reviewing', 'Settings']

  it.each(STEPS)('%s moves the focus when it appears', (name) => {
    expect(moves(read(name))).toBe(true)
  })

  it('fails for a step without the move (control)', () => {
    expect(moves(read('TransformRow'))).toBe(false)
    expect(moves(read('Saving').replace('use:focusOnMount', ''))).toBe(false)
  })

  it('the list takes the focus when a run ends', () => {
    const app = readFileSync(new URL('../App.svelte', import.meta.url), 'utf8')
    expect(app).toContain('returnedToList(previousStep, step)')
    expect(app).toContain('data-list-focus')
  })
})
