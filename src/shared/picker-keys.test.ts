import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { forwardedAction, moveFrom, pickerActionFor, type KeyLike } from './picker-keys'

const press = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  fromButtonLike: false,
  ...extra,
})

describe('pickerActionFor', () => {
  it('maps the six keys the Picking panel lists', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].map(pickerActionFor)).toEqual([
      'parent',
      'child',
      'previous',
      'next',
      'confirm',
      'cancel',
    ])
  })

  it('ignores other keys, including Tab and inherited object property names', () => {
    expect(pickerActionFor('Tab')).toBeNull()
    expect(pickerActionFor('a')).toBeNull()
    expect(pickerActionFor('constructor')).toBeNull()
  })
})

describe('forwardedAction and a held key (#118)', () => {
  it('does not forward Enter while it repeats', () => {
    expect(forwardedAction(press('Enter', { repeat: true }))).toBeNull()
  })

  it('forwards the first Enter (control)', () => {
    expect(forwardedAction(press('Enter', { repeat: false }))).toBe('confirm')
    expect(forwardedAction(press('Enter'))).toBe('confirm')
  })

  it('still forwards a repeating arrow key, which moves one step for each repeat', () => {
    expect(forwardedAction(press('ArrowDown', { repeat: true }))).toBe('child')
  })
})

describe('forwardedAction', () => {
  it('forwards a plain arrow key', () => {
    expect(forwardedAction(press('ArrowDown'))).toBe('child')
  })

  it('leaves a key with a modifier to the browser (control: the same key without it is forwarded)', () => {
    expect(forwardedAction(press('ArrowLeft', { altKey: true }))).toBeNull()
    expect(forwardedAction(press('ArrowLeft', { ctrlKey: true }))).toBeNull()
    expect(forwardedAction(press('Escape', { metaKey: true }))).toBeNull()
    expect(forwardedAction(press('ArrowLeft'))).toBe('previous')
  })

  it('does not forward Enter from a focused button, which would also activate the button', () => {
    expect(forwardedAction(press('Enter', { fromButtonLike: true }))).toBeNull()
    expect(forwardedAction(press('Enter'))).toBe('confirm')
  })

  it('still forwards Escape from a focused button', () => {
    expect(forwardedAction(press('Escape', { fromButtonLike: true }))).toBe('cancel')
  })
})

describe('moveFrom', () => {
  interface N {
    name: string
    parentElement: N | null
    firstElementChild: N | null
    previousElementSibling: N | null
    nextElementSibling: N | null
  }
  const node = (name: string): N => ({
    name,
    parentElement: null,
    firstElementChild: null,
    previousElementSibling: null,
    nextElementSibling: null,
  })
  const body = node('body')
  const a = node('a')
  const b = node('b')
  body.firstElementChild = a
  a.parentElement = body
  b.parentElement = body
  a.nextElementSibling = b
  b.previousElementSibling = a

  it('moves along each edge of the tree', () => {
    expect(moveFrom('child', body)).toBe(a)
    expect(moveFrom('next', a)).toBe(b)
    expect(moveFrom('previous', b)).toBe(a)
    expect(moveFrom('parent', b)).toBe(body)
  })

  it('returns null where there is no neighbour, so the selection stays', () => {
    expect(moveFrom('parent', body)).toBeNull()
    expect(moveFrom('previous', a)).toBeNull()
    expect(moveFrom('child', null)).toBeNull()
  })

  it('returns null for actions that are not movements', () => {
    expect(moveFrom('confirm', a)).toBeNull()
    expect(moveFrom('cancel', a)).toBeNull()
  })
})

// The components are not rendered in tests, so these checks read the source.
// Control: a component that does not forward keys fails the same check.
describe('wiring', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const forwards = (source: string) =>
    source.includes('<svelte:window onkeydown={onwindowkeydown}') && source.includes('forwardedAction(')

  it('the Picking panel forwards keys from the sidebar window', () => {
    expect(forwards(read('../sidebar/components/Picking.svelte'))).toBe(true)
  })

  it('a panel that does not forward keys fails the check (control)', () => {
    expect(forwards(read('../sidebar/components/Saving.svelte'))).toBe(false)
  })

  it('the content script seeds the current element from the body when picking starts', () => {
    expect(read('../content/index.ts')).toMatch(/seedsBody\(pickMode\) && document\.body\) \{\s*setCurrent\(document\.body\)/)
  })
})
