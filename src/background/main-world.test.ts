/**
 * Who chose the MAIN world, and the one-time migration for transforms where
 * nothing records that the user did (issue 53).
 *
 * Loads the real background against a stubbed `browser`. Each refusal or reset
 * has a control in which the same input is left alone, so a pass cannot be
 * explained by the test sending something the handler ignores for another
 * reason.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const CODE = 'document.title = "x"'
const js = (over: Record<string, unknown> = {}) =>
  cssTransform({ id: 'j1', kind: 'js', origin: 'ai', world: 'USER_SCRIPT', code: CODE, match: 'example.com/*', ...over })

let h: Harness
async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}
async function tokenFor(t: any, code = t.code, world = t.world): Promise<string> {
  const { approvalToken } = await ask({
    type: 'approve-code',
    code,
    declaredCapabilities: t.capabilities ?? [],
    ...(world ? { world } : {}),
    transformId: t.id,
    match: t.match,
  })
  return approvalToken
}
const stored = (id: string) => (h.local.get('transforms') as any[]).find((t) => t.id === id)
const versions = (id: string) => ask({ type: 'get-transform-versions', id })

async function start(transforms: any[]) {
  h = createHarness()
  h.hasUserScripts = true
  h.local.set('transforms', transforms)
  h.local.set('settings', { ...DEFAULT_SETTINGS })
  h.tabUrls.set(TAB, 'https://example.com/')
  await h.boot()
}

describe('the record of the user approving MAIN', () => {
  beforeEach(() => start([js()]))

  it('is set when a save puts the code in MAIN with an approval for MAIN', async () => {
    const next = { ...js(), world: 'MAIN' }
    await ask({ type: 'save-transform', transform: next, tabId: TAB, approvalToken: await tokenFor(next) })
    expect(stored('j1')).toMatchObject({ world: 'MAIN', mainApprovedByUser: true })
  })

  it('is not set for a save in the isolated world (control)', async () => {
    const next = { ...js(), code: 'document.title = "y"' }
    await ask({ type: 'save-transform', transform: next, tabId: TAB, approvalToken: await tokenFor(next) })
    expect(stored('j1').mainApprovedByUser).toBeUndefined()
  })

  it('is not taken from the message', async () => {
    const forged = { ...js(), mainApprovedByUser: true }
    await ask({ type: 'save-transform', transform: forged, tabId: TAB, approvalToken: await tokenFor(forged) })
    expect(stored('j1').mainApprovedByUser).toBeUndefined()
  })

  it('is kept by a save that changes nothing about the code or the world', async () => {
    const next = { ...js(), world: 'MAIN' }
    await ask({ type: 'save-transform', transform: next, tabId: TAB, approvalToken: await tokenFor(next) })
    await ask({ type: 'save-transform', transform: { ...stored('j1'), name: 'Renamed' }, tabId: TAB })
    expect(stored('j1')).toMatchObject({ name: 'Renamed', world: 'MAIN', mainApprovedByUser: true })
  })

  it('is not set by a rename of a transform that is in MAIN without it', async () => {
    await start([js({ world: 'MAIN' })])
    await ask({ type: 'save-transform', transform: { ...stored('j1'), name: 'Renamed' }, tabId: TAB })
    expect(stored('j1').mainApprovedByUser).toBeUndefined()
  })

  it('is set again when a restored MAIN version is approved', async () => {
    const asMain = { ...js(), world: 'MAIN' }
    await ask({ type: 'save-transform', transform: asMain, tabId: TAB, approvalToken: await tokenFor(asMain) })
    const isolated = { ...stored('j1'), world: 'USER_SCRIPT' }
    await ask({ type: 'save-transform', transform: isolated, tabId: TAB, approvalToken: await tokenFor(isolated) })
    expect(stored('j1').mainApprovedByUser).toBeUndefined()
    const version = (await versions('j1')).find((v: any) => v.world === 'MAIN')
    await ask({
      type: 'restore-transform-version',
      id: 'j1',
      versionId: version.id,
      tabId: TAB,
      approvalToken: await tokenFor({ ...asMain, ...version, id: 'j1' }),
    })
    expect(stored('j1')).toMatchObject({ world: 'MAIN', mainApprovedByUser: true })
  })

  it('does not let a MAIN version be restored without an approval', async () => {
    const asMain = { ...js(), world: 'MAIN' }
    await ask({ type: 'save-transform', transform: asMain, tabId: TAB, approvalToken: await tokenFor(asMain) })
    const isolated = { ...stored('j1'), world: 'USER_SCRIPT' }
    await ask({ type: 'save-transform', transform: isolated, tabId: TAB, approvalToken: await tokenFor(isolated) })
    const version = (await versions('j1')).find((v: any) => v.world === 'MAIN')
    const reply = await h.onMessage({ type: 'restore-transform-version', id: 'j1', versionId: version.id, tabId: TAB })
    expect(reply.ok).toBe(false)
    expect(stored('j1').world).toBe('USER_SCRIPT')
  })
})

describe('the migration for transforms in MAIN with no record of the user', () => {
  const fromModel = () => js({ id: 'model', world: 'MAIN' })
  const fromUser = () => js({ id: 'user', world: 'MAIN', mainApprovedByUser: true })

  it('moves a transform in MAIN to the isolated world and marks it, at start-up', async () => {
    await start([fromModel()])
    expect(stored('model')).toMatchObject({ world: 'USER_SCRIPT', worldResetFromModel: true })
  })

  it('leaves a transform that the user put in MAIN (control)', async () => {
    await start([fromUser()])
    expect(stored('user')).toMatchObject({ world: 'MAIN', mainApprovedByUser: true })
    expect(stored('user').worldResetFromModel).toBeUndefined()
  })

  it('leaves isolated JavaScript and CSS alone (control)', async () => {
    await start([js({ id: 'iso' }), cssTransform({ id: 'style' })])
    expect(stored('iso').worldResetFromModel).toBeUndefined()
    expect(stored('style').worldResetFromModel).toBeUndefined()
  })

  it('registers the moved transform for the isolated world and the other one for MAIN', async () => {
    await start([fromModel(), fromUser()])
    expect(h.userScriptsHeld.get('model').world).toBe('USER_SCRIPT')
    expect(h.userScriptsHeld.get('user').world).toBe('MAIN')
  })

  it('keeps the MAIN state as a version, which restores only with an approval', async () => {
    await start([fromModel()])
    expect((await versions('model')).map((v: any) => v.world)).toEqual(['MAIN'])
  })

  it('runs on an update event when it has not run', async () => {
    await start([])
    h.local.delete('wa-world-reset-done')
    h.local.set('transforms', [fromModel()])
    await h.listeners.get('browser.runtime.onInstalled')!({ reason: 'update' })
    expect(stored('model')).toMatchObject({ world: 'USER_SCRIPT', worldResetFromModel: true })
  })

  it('does not run on other install events (control)', async () => {
    await start([])
    h.local.delete('wa-world-reset-done')
    h.local.set('transforms', [fromModel()])
    await h.listeners.get('browser.runtime.onInstalled')!({ reason: 'browser_update' })
    expect(stored('model').world).toBe('MAIN')
  })

  it('runs once: a transform in MAIN that appears later is left alone', async () => {
    await start([fromModel()])
    h.local.set('transforms', [...(h.local.get('transforms') as any[]), js({ id: 'late', world: 'MAIN' })])
    await h.listeners.get('browser.runtime.onInstalled')!({ reason: 'update' })
    await h.boot()
    expect(stored('late').world).toBe('MAIN')
  })

  it('clears the notice when the transform is saved in MAIN with an approval', async () => {
    await start([fromModel()])
    const next = { ...stored('model'), world: 'MAIN' }
    await ask({ type: 'save-transform', transform: next, tabId: TAB, approvalToken: await tokenFor(next) })
    expect(stored('model')).toMatchObject({ world: 'MAIN', mainApprovedByUser: true })
    expect(stored('model').worldResetFromModel).toBeUndefined()
  })
})
