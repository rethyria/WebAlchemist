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
  // A preview is registered for the page of the tab it runs in, so the tab has one.
  h.tabUrls.set(3, 'https://example.com/')
  h.tabUrls.set(5, 'https://example.com/')
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
    await h.onMessage(await h.approvedPreview({
      type: 'preview-js',
      tabId: 5,
      transform: { ...js({ id: 'draft' }), world: 'USER_SCRIPT' },
    }))
    expect(h.userScriptsHeld.has('preview-draft')).toBe(true)
    await h.boot()
    expect(h.userScriptsHeld.has('preview-draft')).toBe(true)
  })
})

describe('a saved script whose edit is being previewed, at start-up', () => {
  it('stays paused while the preview stays registered', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
    await h.onMessage(await h.approvedPreview({
      type: 'preview-js',
      tabId: 5,
      transform: { ...js({ code: 'document.title = "draft"' }), world: 'USER_SCRIPT' },
    }))
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
    await h.boot()
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(true)
  })

  it('is registered again when the preview is cleared after the start-up', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    await h.onMessage(await h.approvedPreview({
      type: 'preview-js',
      tabId: 5,
      transform: { ...js({ code: 'document.title = "draft"' }), world: 'USER_SCRIPT' },
    }))
    await h.boot()
    await h.onMessage({ type: 'clear-preview-js', id: 'script-1' })
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(false)
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
  })
})

describe('the pages a JavaScript preview is registered for (#55)', () => {
  const draft = () => ({ ...js({ id: 'draft', match: '*.example.com/*' }), world: 'USER_SCRIPT' })

  it('is the page of the tab and no other page of the site', async () => {
    h.tabUrls.set(3, 'https://www.example.com/shop/item?id=4')
    await h.boot()
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    const matches: string[] = h.userScriptsHeld.get('preview-draft').matches
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.startsWith('https://www.example.com/shop/item'))).toBe(true)
  })

  it('is not taken from the address in the message', async () => {
    h.tabUrls.set(3, 'https://www.example.com/a')
    await h.boot()
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    // The only wildcard is the query suffix the registry adds to every path.
    const matches: string[] = h.userScriptsHeld.get('preview-draft').matches
    expect(matches.every((m) => m.replace(/\?\*$/, '').startsWith('https://www.example.com/a') && !m.replace(/\?\*$/, '').includes('*'))).toBe(true)
  })

  it('refuses a tab whose page cannot be written as an exact pattern', async () => {
    h.tabUrls.set(3, 'about:blank')
    await h.boot()
    const reply = await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    expect(reply.ok).toBe(false)
    expect(reply.error.message).toMatch(/cannot be previewed/)
    expect(h.userScriptsHeld.has('preview-draft')).toBe(false)
  })

  it('control: the same transform, once saved, is registered for its whole pattern', async () => {
    h.local.set('transforms', [{ ...draft(), id: 'draft' }])
    await h.boot()
    const matches: string[] = h.userScriptsHeld.get('draft').matches
    expect(matches.some((m) => m.includes('*.example.com'))).toBe(true)
  })
})

describe('the content script at start-up', () => {
  const A = 'https://example.com/*'
  const B = 'https://example.org/*'
  const id = (origin: string) => `wa-content:${origin}`
  beforeEach(() => {
    h.origins = [A]
  })

  it('is registered when it is missing, without removing anything first', async () => {
    await h.boot()
    expect(h.calls.registry).toEqual([`register-content:${id(A)}`])
  })

  it('is left alone when it already matches the granted origins', async () => {
    await h.boot()
    h.calls.registry.length = 0
    await h.boot()
    expect(h.calls.registry).toEqual([])
  })

  it('adds only the registration for a granted origin that was added', async () => {
    await h.boot()
    h.calls.registry.length = 0
    h.origins = [A, B]
    await h.boot()
    expect(h.calls.registry).toEqual([`register-content:${id(B)}`])
    expect([...h.contentScriptsHeld.keys()].sort()).toEqual([id(A), id(B)])
  })

  it('removes only the registration for an origin that is no longer granted', async () => {
    h.origins = [A, B]
    await h.boot()
    h.calls.registry.length = 0
    h.origins = [A]
    await h.boot()
    expect(h.calls.registry).toEqual([`unregister-content:${id(B)}`])
  })

  it('replaces the single registration that earlier versions made', async () => {
    h.contentScriptsHeld.set('wa-content', { id: 'wa-content', matches: [A], js: ['src/content/index.js'] })
    await h.boot()
    expect([...h.contentScriptsHeld.keys()]).toEqual([id(A)])
  })
})

describe('one origin that cannot be registered (#96)', () => {
  const good1 = 'https://example.com/*'
  const bad = 'https://*.[::1]/*'
  const good2 = 'https://example.org/*'

  it('does not stop the other origins from being registered', async () => {
    h.origins = [good1, bad, good2]
    h.rejectContentScript = (script) => script.matches.includes(bad)
    await h.boot()
    expect([...h.contentScriptsHeld.keys()].sort()).toEqual([`wa-content:${good1}`, `wa-content:${good2}`])
  })

  it('records the origin that was rejected', async () => {
    h.origins = [good1, bad, good2]
    h.rejectContentScript = (script) => script.matches.includes(bad)
    await h.boot()
    expect(h.session.get('wa-content-failed-origins')).toEqual([bad])
  })

  it('control: with every origin accepted all three are registered and none is recorded', async () => {
    // Shows the missing registration above comes from the rejected origin and
    // not from the stub dropping registrations.
    h.origins = [good1, bad, good2]
    await h.boot()
    expect(h.contentScriptsHeld.size).toBe(3)
    expect(h.session.get('wa-content-failed-origins')).toEqual([])
  })

  it('tries the rejected origin again on the next start', async () => {
    h.origins = [good1, bad]
    h.rejectContentScript = (script) => script.matches.includes(bad)
    await h.boot()
    h.rejectContentScript = () => false
    await h.boot()
    expect(h.contentScriptsHeld.size).toBe(2)
    expect(h.session.get('wa-content-failed-origins')).toEqual([])
  })
})

describe('a preview that starts while the registrations are being rebuilt (#91)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const draft = () => ({
    ...cssTransform({ id: 'draft', kind: 'js', code: 'document.title = "x"' }),
    world: 'USER_SCRIPT',
  })

  /**
   * Saving settings rebuilds the registrations. The rebuild's first
   * getScripts call is held, which is the point between it reading the
   * previewed ids and listing what the browser holds, and a preview starts
   * there.
   */
  async function previewDuringRebuild() {
    await h.boot()
    const settings = (await h.onMessage({ type: 'get-settings' })).data
    const release = h.hold('browser.userScripts.getScripts', { firstCallOnly: true })
    const rebuilt = h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: settings.accent } } })
    await settle()
    const previewed = h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    await settle()
    release()
    await Promise.all([rebuilt, previewed])
    await settle()
  }

  it('is still registered afterwards', async () => {
    await previewDuringRebuild()
    expect(h.userScriptsHeld.has('preview-draft')).toBe(true)
    expect(h.session.get('wa-preview-scripts')).toEqual(['draft'])
  })

  it('control: a preview started after the rebuild is registered too', async () => {
    // Shows the stub registers and keeps a preview when nothing overlaps, so
    // the test above is about the overlap.
    await h.boot()
    const settings = (await h.onMessage({ type: 'get-settings' })).data
    await h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: settings.accent } } })
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    expect(h.userScriptsHeld.has('preview-draft')).toBe(true)
  })
})

describe('a preview that ends while the registrations are being rebuilt (#91)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  const draft = () => ({ ...js(), code: 'document.title = "draft"' })

  /** Starts a preview of the saved script, then ends it while a rebuild is held. */
  async function endDuringRebuild(end: () => Promise<unknown>) {
    h.local.set('transforms', [js()])
    await h.boot()
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(true)
    const settings = (await h.onMessage({ type: 'get-settings' })).data
    const release = h.hold('browser.userScripts.getScripts', { firstCallOnly: true })
    const rebuilt = h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: settings.accent } } })
    await settle()
    const ended = end()
    await settle()
    release()
    await Promise.all([rebuilt, ended])
    await settle()
  }

  it('keeps the restored saved script registered after clear-preview-js', async () => {
    await endDuringRebuild(() => h.onMessage({ type: 'clear-preview-js', id: 'script-1' }))
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(false)
    expect(h.session.get('wa-preview-scripts') ?? []).toEqual([])
  })

  it('control: clear-preview-js with no rebuild running restores the saved script', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    await h.onMessage({ type: 'clear-preview-js', id: 'script-1' })
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
  })
})

describe('a delete that overlaps a rebuild (#91)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('leaves the deleted script unregistered', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    const settings = (await h.onMessage({ type: 'get-settings' })).data
    // The rebuild has to register the script, so it is missing from the
    // browser, and the rebuild is held at that registration: it has already
    // read the script from storage by then.
    h.userScriptsHeld.delete('script-1')
    const release = h.hold('browser.userScripts.register')
    const rebuilt = h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: settings.accent } } })
    await settle()
    const deleted = h.onMessage({ type: 'delete-transform', id: 'script-1' })
    await settle()
    release()
    await Promise.all([rebuilt, deleted])
    await settle()
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
  })

  it('control: without a rebuild running the delete unregisters the script', async () => {
    h.local.set('transforms', [js()])
    await h.boot()
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
    await h.onMessage({ type: 'delete-transform', id: 'script-1' })
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
  })
})

describe('enabling or saving a script that has a preview (#150)', () => {
  const draft = () => ({ ...js(), code: 'document.title = "draft"' })

  /** The saved script is stored and off, and a preview of it is running. */
  async function previewing(enabled: boolean) {
    h.local.set('transforms', [js({ enabled })])
    await h.boot()
    await h.onMessage(await h.approvedPreview({ type: 'preview-js', tabId: 3, transform: draft() }))
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(true)
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
  }

  it('does not register the saved script when set-enabled turns it on', async () => {
    await previewing(false)
    await h.onMessage({ type: 'set-enabled', id: 'script-1', enabled: true, tabId: 3 })
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(true)
  })

  it('does not register the saved script when reapply-everywhere saves it', async () => {
    await previewing(true)
    await h.onMessage({ type: 'reapply-everywhere', id: 'script-1' })
    expect(h.userScriptsHeld.has('script-1')).toBe(false)
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(true)
  })

  it('control: with no preview running both handlers register the saved script', async () => {
    h.local.set('transforms', [js({ enabled: false })])
    await h.boot()
    await h.onMessage({ type: 'set-enabled', id: 'script-1', enabled: true, tabId: 3 })
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
    h.userScriptsHeld.delete('script-1')
    await h.onMessage({ type: 'reapply-everywhere', id: 'script-1' })
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
  })

  it('registers the saved script again when the preview ends', async () => {
    await previewing(false)
    await h.onMessage({ type: 'set-enabled', id: 'script-1', enabled: true, tabId: 3 })
    await h.onMessage({ type: 'clear-preview-js', id: 'script-1' })
    expect(h.userScriptsHeld.has('script-1')).toBe(true)
    expect(h.userScriptsHeld.has('preview-script-1')).toBe(false)
  })
})
