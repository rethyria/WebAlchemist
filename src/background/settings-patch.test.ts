/**
 * Changes to one part of the settings, sent as messages to the real index.ts
 * (#74). The settings page used to send the whole settings object it had
 * loaded, so a change saved elsewhere since then was written over.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

let h: Harness
const stored = () => h.local.get('settings') as Settings

const provider = (id: string): Provider => ({
  id,
  label: id,
  type: 'anthropic',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
})

beforeEach(async () => {
  h = createHarness()
  await h.boot()
})

describe('adding a provider', () => {
  it('keeps a setting that changed after the page loaded', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider('old')], activeProviderId: 'old' })
    // The page loaded here. Then the sidebar turned the kill switch on.
    h.local.set('settings', { ...stored(), aiJsKillSwitch: true })

    const reply = await h.onMessage({ type: 'patch-settings', change: { kind: 'add-provider', provider: provider('new') } })

    expect(reply.ok).toBe(true)
    expect(stored().aiJsKillSwitch).toBe(true)
    expect(stored().providers.map((p) => p.id)).toEqual(['old', 'new'])
    expect(stored().activeProviderId).toBe('old')
    expect(reply.data).toEqual(stored())
  })

  // Control: the whole-object save the page used before does overwrite it,
  // which is what the test above would show without the change.
  it('is overwritten by a save of the whole settings object as loaded earlier', async () => {
    const loaded = { ...DEFAULT_SETTINGS, providers: [provider('old')], activeProviderId: 'old' }
    h.local.set('settings', { ...loaded, aiJsKillSwitch: true })
    await h.onMessage({
      type: 'save-settings',
      settings: { ...loaded, providers: [...loaded.providers, provider('new')] },
    })
    expect(stored().aiJsKillSwitch).toBe(false)
  })

  it('makes the new provider active when none is', async () => {
    await h.onMessage({ type: 'patch-settings', change: { kind: 'add-provider', provider: provider('first') } })
    expect(stored().activeProviderId).toBe('first')
  })

  it('refuses an id that exists and changes nothing', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider('a')], activeProviderId: 'a' })
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'add-provider', provider: { ...provider('a'), label: 'other' } },
    })
    expect(reply.ok).toBe(false)
    expect(stored().providers.map((p) => p.label)).toEqual(['a'])
  })

  it('keeps both providers when two adds are sent in the same moment, in 20 of 20 runs', async () => {
    for (let run = 0; run < 20; run += 1) {
      h.local.set('settings', { ...DEFAULT_SETTINGS })
      await Promise.all([
        h.onMessage({ type: 'patch-settings', change: { kind: 'add-provider', provider: provider('x') } }),
        h.onMessage({ type: 'patch-settings', change: { kind: 'add-provider', provider: provider('y') } }),
      ])
      expect(stored().providers.map((p) => p.id).sort()).toEqual(['x', 'y'])
    }
  })

  it('refuses a provider with an address the endpoint rules reject', async () => {
    const bad = { ...provider('bad'), type: 'openai-compatible' as const, baseUrl: 'http://example.com/v1' }
    const reply = await h.onMessage({ type: 'patch-settings', change: { kind: 'add-provider', provider: bad } })
    expect(reply.ok).toBe(false)
    expect(h.local.has('settings')).toBe(false)
  })
})

describe('removing a provider', () => {
  it('removes only that provider, repairs the active choice and keeps other settings', async () => {
    h.local.set('settings', {
      ...DEFAULT_SETTINGS,
      providers: [provider('a'), provider('b')],
      activeProviderId: 'a',
      aiJsKillSwitch: true,
    })
    await h.onMessage({ type: 'patch-settings', change: { kind: 'remove-provider', providerId: 'a' } })
    expect(stored().providers.map((p) => p.id)).toEqual(['b'])
    expect(stored().activeProviderId).toBe('b')
    expect(stored().aiJsKillSwitch).toBe(true)
  })

  it('leaves the active choice alone when another provider is removed', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider('a'), provider('b')], activeProviderId: 'a' })
    await h.onMessage({ type: 'patch-settings', change: { kind: 'remove-provider', providerId: 'b' } })
    expect(stored().activeProviderId).toBe('a')
  })
})

describe('setting top-level fields', () => {
  it('changes only the fields sent and keeps a setting changed elsewhere', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, aiJsKillSwitch: true })
    await h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: 'green' } } })
    expect(stored().accent).toBe('green')
    expect(stored().aiJsKillSwitch).toBe(true)
  })

  // Control: a second page's change to a different field is kept when the
  // first page sends its own. Whole-object saves of the two loaded copies lose one.
  it('keeps two changes to different fields sent in the same moment, in 20 of 20 runs', async () => {
    for (let run = 0; run < 20; run += 1) {
      h.local.set('settings', { ...DEFAULT_SETTINGS })
      await Promise.all([
        h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: 'green' } } }),
        h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { aiJsKillSwitch: true } } }),
      ])
      expect([stored().accent, stored().aiJsKillSwitch]).toEqual(['green', true])
    }
  })

  it('removes the registered AI scripts when the kill switch is turned on', async () => {
    h.hasUserScripts = true
    h.local.set('transforms', [
      {
        ...cssTransform({ id: 'script-1', kind: 'js', code: 'document.title = "x"', origin: 'ai' }),
        world: 'USER_SCRIPT',
      },
    ])
    await h.boot()
    // Control: the script is registered before the switch is turned on.
    expect([...h.userScriptsHeld.keys()]).toEqual(['script-1'])
    await h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { aiJsKillSwitch: true } } })
    expect(h.userScriptsHeld.size).toBe(0)
  })

  it('does not take providers from the message', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider('a')], activeProviderId: 'a' })
    await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'fields', fields: { providers: [], accent: 'green' } as never },
    })
    expect(stored().providers.map((p) => p.id)).toEqual(['a'])
    expect(stored().accent).toBe('green')
  })

  it('refuses an active provider that does not exist', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [provider('a')], activeProviderId: 'a' })
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'fields', fields: { activeProviderId: 'gone' } },
    })
    expect(reply.ok).toBe(false)
    expect(stored().activeProviderId).toBe('a')
  })

  it('refuses a vault lock period that is not a whole number of minutes', async () => {
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'fields', fields: { vaultIdleLockMinutes: 1.5 } },
    })
    expect(reply.ok).toBe(false)
  })
})

describe('changing one provider', () => {
  const two = () => ({
    ...DEFAULT_SETTINGS,
    providers: [{ ...provider('a'), price: { input: 1, output: 2 } }, provider('b')],
    activeProviderId: 'a',
  })

  it('sets models and keeps the other provider and a setting changed elsewhere', async () => {
    h.local.set('settings', { ...two(), aiJsKillSwitch: true })
    await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'b', set: { generateModel: 'big', supportsVision: true } },
    })
    expect(stored().providers[1]).toMatchObject({ generateModel: 'big', supportsVision: true, reviewModel: 'm' })
    expect(stored().providers[0]).toEqual(two().providers[0])
    expect(stored().aiJsKillSwitch).toBe(true)
  })

  it('removes the price with unset, and the control keeps it when nothing is unset', async () => {
    h.local.set('settings', two())
    await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'a', set: { reviewModel: 'r' } },
    })
    expect(stored().providers[0]?.price).toEqual({ input: 1, output: 2 })
    await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'a', unset: ['price'] },
    })
    expect('price' in stored().providers[0]!).toBe(false)
  })

  it('cannot change the id, type or address of a provider', async () => {
    h.local.set('settings', two())
    await h.onMessage({
      type: 'patch-settings',
      change: {
        kind: 'update-provider',
        providerId: 'a',
        set: { id: 'z', type: 'openai-compatible', baseUrl: 'https://evil.example/v1', label: 'x' } as never,
      },
    })
    expect(stored().providers[0]).toEqual(two().providers[0])
  })

  it('checks a changed OAuth endpoint with the endpoint rules', async () => {
    h.local.set('settings', two())
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: {
        kind: 'update-provider',
        providerId: 'b',
        set: { oauth: { authorizationEndpoint: 'http://a.example/auth', tokenEndpoint: 'https://a.example/t', clientId: 'c', scopes: [] } },
      },
    })
    expect(reply.ok).toBe(false)
    expect(stored().providers[1]?.oauth).toBeUndefined()
  })

  it('fails for a provider that was removed meanwhile', async () => {
    h.local.set('settings', two())
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'gone', set: { generateModel: 'x' } },
    })
    expect(reply.ok).toBe(false)
  })
})

describe('removing optional provider fields', () => {
  const stored2 = () => ({
    ...DEFAULT_SETTINGS,
    providers: [{ ...provider('a'), price: { input: 1, output: 2 } }],
    activeProviderId: 'a',
  })

  // The control is the allowed field in the same message shape: it is removed,
  // so the refusal below comes from the list and not from the message form.
  it('refuses to remove the id, type, address or label, and changes nothing', async () => {
    for (const field of ['id', 'type', 'baseUrl', 'label']) {
      h.local.set('settings', stored2())
      const reply = await h.onMessage({
        type: 'patch-settings',
        change: { kind: 'update-provider', providerId: 'a', unset: [field] as never },
      })
      expect(reply.ok, field).toBe(false)
      expect(stored(), field).toEqual(stored2())
    }
  })

  it('control: the same message removes the price when it names the price', async () => {
    h.local.set('settings', stored2())
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'a', unset: ['price'] },
    })
    expect(reply.ok).toBe(true)
    expect('price' in stored().providers[0]!).toBe(false)
    expect(stored().providers[0]?.id).toBe('a')
  })
})

describe('a stale active provider', () => {
  const stale = () => ({ ...DEFAULT_SETTINGS, providers: [provider('a')], activeProviderId: 'gone' })

  it('does not block an unrelated change such as the AI JavaScript kill switch', async () => {
    h.local.set('settings', stale())
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'fields', fields: { aiJsKillSwitch: true } },
    })
    expect(reply.ok).toBe(true)
    expect(stored().aiJsKillSwitch).toBe(true)
  })

  // Control: setting the active provider to one that does not exist is still refused.
  it('control: a change that sets a missing active provider is still refused', async () => {
    h.local.set('settings', stale())
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'fields', fields: { activeProviderId: 'also-gone' } },
    })
    expect(reply.ok).toBe(false)
    expect(stored().activeProviderId).toBe('gone')
  })
})

describe('saving the whole settings object', () => {
  // A change is queued behind earlier ones; a save that skipped the queue wrote
  // at once and was then overwritten by the change that was already running,
  // so the later message lost to the earlier one.
  it('runs after a change that was sent before it, in 20 of 20 runs', async () => {
    for (let run = 0; run < 20; run += 1) {
      h.local.set('settings', { ...DEFAULT_SETTINGS })
      await Promise.all([
        h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: 'green' } } }),
        h.onMessage({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, accent: 'blue' } }),
      ])
      expect(stored().accent).toBe('blue')
    }
  })

  // Control: the same two messages sent in the opposite order end with the
  // change, so the result above comes from the order and not from one of the
  // two messages always winning.
  it('control: the change wins when it is sent after the save', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS })
    await Promise.all([
      h.onMessage({ type: 'save-settings', settings: { ...DEFAULT_SETTINGS, accent: 'blue' } }),
      h.onMessage({ type: 'patch-settings', change: { kind: 'fields', fields: { accent: 'green' } } }),
    ])
    expect(stored().accent).toBe('green')
  })
})
