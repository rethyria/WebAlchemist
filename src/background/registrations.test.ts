/**
 * Re-registering scripts when the event page starts (#91).
 *
 * The page starts again after every 30-second idle period. These tests count
 * the changes made to the registered user scripts and to the content script
 * during a start, because a registration removed and added again leaves a gap in
 * which a loading page gets neither.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, cssTransform, type Harness } from './test-browser'

const js = (over: Record<string, unknown> = {}) =>
  cssTransform({
    id: 'script-1',
    kind: 'js',
    world: 'USER_SCRIPT',
    code: 'document.title = "x"',
    match: 'example.com/*',
    ...over,
  })

let h: Harness
beforeEach(() => {
  h = createHarness()
  h.hasUserScripts = true
})

/** Boots once to register what is stored, then clears the record of calls. */
async function registeredThenWoken() {
  await h.boot()
  h.calls.registry.length = 0
  h.calls.unregister.length = 0
  await h.boot() // the next wake of the page
}

describe('user scripts at start-up', () => {
  it('changes nothing when every registration already matches storage', async () => {
    h.local.set('transforms', [js(), js({ id: 'script-2', match: 'example.org/*' })])
    await registeredThenWoken()
    expect(h.calls.registry).toEqual([])
    expect(h.userScriptsHeld.size).toBe(2)
  })

  it('updates only the registration whose code changed', async () => {
    h.local.set('transforms', [js(), js({ id: 'script-2', match: 'example.org/*' })])
    await h.boot()
    h.calls.registry.length = 0
    h.local.set('transforms', [js({ code: 'document.title = "y"' }), js({ id: 'script-2', match: 'example.org/*' })])
    await h.boot()
    expect(h.calls.registry).toEqual(['update:script-1'])
  })

  it('adds a missing registration and removes one for a deleted transform', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    h.userScriptsHeld.delete('script-1')
    h.userScriptsHeld.set('deleted', { id: 'deleted', matches: [], js: [] })
    h.calls.registry.length = 0
    await h.boot()
    expect(h.calls.registry).toEqual(['register:script-1', 'unregister:deleted'])
  })

  it('removes the registration of a transform that is disabled', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    h.local.set('transforms', [js({ enabled: false })])
    h.calls.registry.length = 0
    await h.boot()
    expect(h.calls.registry).toEqual(['unregister:script-1'])
  })

  it('keeps the registration of a script being previewed', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    await h.onMessage({
      type: 'preview-js',
      tabId: 5,
      transform: { ...js({ id: 'draft' }), world: 'USER_SCRIPT' },
    })
    expect(h.userScriptsHeld.has('draft')).toBe(true)
    await h.boot()
    expect(h.userScriptsHeld.has('draft')).toBe(true)
  })
})

describe('the content script at start-up', () => {
  beforeEach(() => {
    h.origins = ['https://example.com/*']
  })

  it('is registered when it is missing', async () => {
    await h.boot()
    expect(h.calls.registry).toEqual(['unregister-content', 'register-content'])
  })

  it('is left alone when it already matches the granted origins', async () => {
    await h.boot()
    h.calls.registry.length = 0
    await h.boot()
    expect(h.calls.registry).toEqual([])
  })

  it('is replaced when a granted origin was added', async () => {
    await h.boot()
    h.calls.registry.length = 0
    h.origins = ['https://example.com/*', 'https://example.org/*']
    await h.boot()
    expect(h.calls.registry).toEqual(['unregister-content', 'register-content'])
    expect(h.contentScriptHeld.matches).toHaveLength(2)
  })
})
