import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Provider, type Settings } from '@shared/types'
import { addProviderWithKey, storeKey, withoutProvider } from './provider-add'

const provider = { id: 'new', label: 'New', type: 'anthropic' } as unknown as Provider
const existing = { id: 'old', label: 'Old', type: 'anthropic' } as unknown as Provider

describe('storing a key', () => {
  it('does not fail when the key is stored and the status read fails afterwards', async () => {
    const sent: string[] = []
    const call = (async (message: { type: string }) => {
      sent.push(message.type)
      if (message.type === 'get-credential-statuses') throw new Error('locked in between')
      return undefined
    }) as Parameters<typeof storeKey>[0]

    await expect(storeKey(call, 'p', 'sk')).resolves.toBeNull()
    expect(sent).toEqual(['set-credential', 'get-credential-statuses'])
  })

  // Control: a failure of set-credential itself is still an error, and the
  // status read is not attempted after it.
  it('fails when set-credential fails', async () => {
    const sent: string[] = []
    const call = (async (message: { type: string }) => {
      sent.push(message.type)
      if (message.type === 'set-credential') throw new Error('refused')
      return []
    }) as Parameters<typeof storeKey>[0]

    await expect(storeKey(call, 'p', 'sk')).rejects.toThrow('refused')
    expect(sent).toEqual(['set-credential'])
  })

  it('returns the statuses when both calls succeed', async () => {
    const call = (async (message: { type: string }) =>
      message.type === 'get-credential-statuses' ? [{ providerId: 'p', configured: true }] : undefined) as Parameters<typeof storeKey>[0]
    await expect(storeKey(call, 'p', 'sk')).resolves.toEqual([{ providerId: 'p', configured: true }])
  })
})

describe('adding a provider with its key', () => {
  function deps(overrides: { setKey?: () => Promise<void>; stored: () => Settings }) {
    const saved: Settings[] = []
    return {
      saved,
      deps: {
        current: () => ({ ...DEFAULT_SETTINGS, providers: [existing], activeProviderId: 'old' }),
        readSettings: async () => overrides.stored(),
        save: async (s: Settings) => {
          saved.push(s)
        },
        setKey: overrides.setKey ?? (async () => undefined),
      },
    }
  }

  it('removes only the new provider when the key cannot be stored, keeping a change saved elsewhere meanwhile', async () => {
    const elsewhere: Settings = {
      ...DEFAULT_SETTINGS,
      providers: [existing, provider],
      activeProviderId: 'old',
      aiJsKillSwitch: true, // saved from the sidebar after the page loaded
    }
    const { saved, deps: d } = deps({
      stored: () => elsewhere,
      setKey: async () => {
        throw new Error('refused')
      },
    })

    await expect(addProviderWithKey(d, provider, 'sk')).rejects.toThrow('refused')

    expect(saved).toHaveLength(2)
    // The rollback keeps the kill switch set elsewhere. Writing back the
    // snapshot taken before the add would have turned it off again.
    expect(saved[1]?.aiJsKillSwitch).toBe(true)
    expect(saved[1]?.providers.map((p) => p.id)).toEqual(['old'])
  })

  // Control: when the key is stored nothing is rolled back.
  it('saves once and keeps the provider when the key is stored', async () => {
    const { saved, deps: d } = deps({ stored: () => DEFAULT_SETTINGS })
    await addProviderWithKey(d, provider, 'sk')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.providers.map((p) => p.id)).toEqual(['old', 'new'])
  })

  it('repairs the active provider when the removed one was active', () => {
    const settings = { ...DEFAULT_SETTINGS, providers: [existing, provider], activeProviderId: 'new' }
    expect(withoutProvider(settings, 'new').activeProviderId).toBe('old')
    expect(withoutProvider({ ...settings, providers: [provider] }, 'new').activeProviderId).toBeNull()
  })
})
