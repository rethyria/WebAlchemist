import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { radioTarget, tabStopIndex } from './radio-group'

describe('radioTarget', () => {
  it('moves forward with right and down, and back with left and up', () => {
    expect(radioTarget('ArrowRight', 1, 4)).toBe(2)
    expect(radioTarget('ArrowDown', 1, 4)).toBe(2)
    expect(radioTarget('ArrowLeft', 1, 4)).toBe(0)
    expect(radioTarget('ArrowUp', 1, 4)).toBe(0)
  })

  it('wraps at both ends', () => {
    expect(radioTarget('ArrowRight', 3, 4)).toBe(0)
    expect(radioTarget('ArrowLeft', 0, 4)).toBe(3)
  })

  it('jumps with Home and End', () => {
    expect(radioTarget('Home', 2, 4)).toBe(0)
    expect(radioTarget('End', 1, 4)).toBe(3)
  })

  it('ignores other keys and empty groups (control)', () => {
    expect(radioTarget('Tab', 1, 4)).toBeNull()
    expect(radioTarget(' ', 1, 4)).toBeNull()
    expect(radioTarget('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('tabStopIndex', () => {
  it('is the checked radio', () => {
    expect(tabStopIndex([false, false, true])).toBe(2)
  })

  it('is the first radio when none is checked, so the group can be entered', () => {
    expect(tabStopIndex([false, false, false])).toBe(0)
  })
})

describe('every radio group is wired', () => {
  // The components are not rendered in tests, so this reads the source: every
  // element with role="radiogroup" must use the action. Control: the same
  // check on a snippet without it fails.
  const groups = (source: string) =>
    [...source.matchAll(/<[a-z]+[^>]*role="radiogroup"[^>]*>/g)].map((match) => match[0])
  const wired = (tag: string) => tag.includes('use:radioGroup')

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.svelte') ? [path] : []
    })
  const root = new URL('..', import.meta.url).pathname

  it('finds the groups on the settings page, the sidebar and the editor', () => {
    const found = walk(root).flatMap((path) => groups(readFileSync(path, 'utf8')))
    expect(found.length).toBeGreaterThanOrEqual(7)
  })

  it('has no radiogroup without the action', () => {
    const missing = walk(root).filter((path) =>
      groups(readFileSync(path, 'utf8')).some((tag) => !wired(tag)),
    )
    expect(missing).toEqual([])
  })

  it('reports a group without the action (control)', () => {
    expect(wired('<div class="x" role="radiogroup" aria-label="A">')).toBe(false)
  })
})
