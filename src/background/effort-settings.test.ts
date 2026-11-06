/**
 * Storage of the effort settings of a provider: the defaults that a provider
 * saved without them receives, and the validation of a change that sets them.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './test-browser'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types'

let h: Harness
const stored = () => h.local.get('settings') as Settings

/** A provider as an earlier version saved it, with no effort fields. */
const legacy = (id: string, type: Provider['type']) =>
  ({
    id,
    label: id,
    type,
    ...(type === 'openai-compatible' ? { baseUrl: 'https://api.example.com/v1' } : {}),
    generateModel: 'm',
    reviewModel: 'm',
    supportsVision: false,
  }) as unknown as Provider

beforeEach(async () => {
  h = createHarness()
  await h.boot()
})

async function load(): Promise<Settings> {
  const reply = await h.onMessage({ type: 'get-settings' })
  return reply.data as Settings
}

describe('migration of stored providers', () => {
  it('gives an Anthropic provider without the fields high for both', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [legacy('a', 'anthropic')], activeProviderId: 'a' })
    const [provider] = (await load()).providers
    expect(provider?.brewEffort).toBe('high')
    expect(provider?.reviewEffort).toBe('high')
  })

  it('gives an OpenAI-compatible provider without the fields the model default for both', async () => {
    h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [legacy('o', 'openai-compatible')], activeProviderId: 'o' })
    const [provider] = (await load()).providers
    expect(provider?.brewEffort).toBe('default')
    expect(provider?.reviewEffort).toBe('default')
  })

  it('keeps values that are set and replaces one that is not a choice', async () => {
    h.local.set('settings', {
      ...DEFAULT_SETTINGS,
      providers: [{ ...legacy('a', 'anthropic'), brewEffort: 'low', reviewEffort: 'max' }],
      activeProviderId: 'a',
    })
    const [provider] = (await load()).providers
    expect(provider?.brewEffort).toBe('low')
    expect(provider?.reviewEffort).toBe('high')
  })
})

describe('changing the effort', () => {
  const seed = () => h.local.set('settings', { ...DEFAULT_SETTINGS, providers: [legacy('a', 'anthropic')], activeProviderId: 'a' })

  it.each(['low', 'medium', 'high', 'default'])('stores %s', async (choice) => {
    seed()
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'a', set: { brewEffort: choice, reviewEffort: choice } },
    })
    expect(reply.ok).toBe(true)
    expect(stored().providers[0]?.brewEffort).toBe(choice)
    expect(stored().providers[0]?.reviewEffort).toBe(choice)
  })

  it.each(['max', 'xhigh', '', 5, null])('refuses %s and stores nothing', async (value) => {
    seed()
    const before = stored()
    const reply = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'update-provider', providerId: 'a', set: { brewEffort: value } },
    })
    expect(reply.ok).toBe(false)
    expect(stored()).toEqual(before)
  })

  it('refuses an added provider with an invalid effort and fills in a missing one', async () => {
    const bad = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'add-provider', provider: { ...legacy('b', 'anthropic'), reviewEffort: 'max' } },
    })
    expect(bad.ok).toBe(false)
    const good = await h.onMessage({
      type: 'patch-settings',
      change: { kind: 'add-provider', provider: legacy('c', 'anthropic') },
    })
    expect(good.ok).toBe(true)
    expect(stored().providers[0]?.brewEffort).toBe('high')
  })
})
