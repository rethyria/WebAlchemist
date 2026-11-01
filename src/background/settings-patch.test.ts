/**
 * Changes to one part of the settings, sent as messages to the real index.ts
 * (#74). The settings page used to send the whole settings object it had
 * loaded, so a change saved elsewhere since then was written over.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types'
import { createHarness, type Harness } from './test-browser'

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
