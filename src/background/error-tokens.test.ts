/**
 * The random token in the error marker's name (#123), against the real
 * index.ts: the registered script holds it, and the health check hands the
 * same value to the content script.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 6
const PAGE = 'https://example.com/app'

const js = (id: string, over: Record<string, unknown> = {}) =>
  cssTransform({ id, kind: 'js', world: 'USER_SCRIPT', code: 'document.title = "x"', ...over })

/** The attribute name in the code of a registered script. */
function attributeIn(h: Harness, id: string): string {
  const code = h.userScriptsHeld.get(id).js[0].code as string
  return /data-wa-error-[a-z0-9-]+/.exec(code)![0]
}

let h: Harness
let checkMessage: any
beforeEach(() => {
  h = createHarness()
  h.hasUserScripts = true
  h.tabUrls.set(TAB, PAGE)
  checkMessage = undefined
  h.contentReply = (message) => {
    if (message.type === 'ping') return true
    checkMessage = message
    return { type: 'health-check-result', states: [] }
  }
})

describe('the error marker name of a registered script', () => {
  it('does not contain the transform id', async () => {
    h.local.set('transforms', [js('Secret-Id-7')])
    await h.boot()
    expect(attributeIn(h, 'Secret-Id-7')).not.toContain('secret')
  })

  // Two ids that differ only by case or punctuation used to be one attribute.
  it('differs between ids that differ only by case or punctuation', async () => {
    h.local.set('transforms', [js('Ab-1'), js('ab_1'), js('ab-1')])
    await h.boot()
    const names = new Set(['Ab-1', 'ab_1', 'ab-1'].map((id) => attributeIn(h, id)))
    expect(names.size).toBe(3)
  })

  it('stays the same when the page wakes and registers nothing new', async () => {
    h.local.set('transforms', [js('one')])
    await h.boot()
    const before = attributeIn(h, 'one')
    await h.boot()
    expect(attributeIn(h, 'one')).toBe(before)
  })

  it('is dropped from the session store when the registration is removed', async () => {
    h.local.set('transforms', [js('one'), js('two')])
    await h.boot()
    h.local.set('transforms', [js('one', { enabled: false }), js('two')])
    await h.boot()
    expect(Object.keys(h.session.get('wa-error-tokens') as object)).toEqual(['two'])
  })
})

describe('the health check message', () => {
  const commit = () =>
    h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url: PAGE })

  it('carries the token that is in the registered script, for a script only', async () => {
    h.local.set('transforms', [js('one'), cssTransform({ id: 'style' })])
    await h.boot()
    await commit()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const token = checkMessage.errorTokens.one as string
    expect(attributeIn(h, 'one')).toBe(`data-wa-error-${token}`)
    expect(Object.keys(checkMessage.errorTokens)).toEqual(['one'])
  })

  // Control: the assertion above reads a message the background really sent.
  it('control: the message is sent for the transforms on the page', async () => {
    h.local.set('transforms', [js('one')])
    await h.boot()
    await commit()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(checkMessage.type).toBe('run-health-check')
    expect(checkMessage.transforms.map((t: { id: string }) => t.id)).toEqual(['one'])
  })
})
