import { describe, expect, it } from 'vitest'
import type { Provider, SettingsChange } from '@shared/types'
import { addProviderWithKey, storeKey } from './provider-add'

const provider = { id: 'new', label: 'New', type: 'anthropic' } as unknown as Provider

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
  function deps(setKey: () => Promise<void> = async () => undefined) {
    const changes: SettingsChange[] = []
    return {
      changes,
      deps: {
        change: async (c: SettingsChange) => {
          changes.push(c)
        },
        setKey,
      },
    }
  }

  // The page sends changes and never a whole settings object, so there is no
  // copy of the loaded settings that it could write back over a change made
  // elsewhere (the review finding for #74).
  it('sends one add and then removes only the new provider when the key cannot be stored', async () => {
    const { changes, deps: d } = deps(async () => {
      throw new Error('refused')
    })

    await expect(addProviderWithKey(d, provider, 'sk')).rejects.toThrow('refused')

    expect(changes).toEqual([
      { kind: 'add-provider', provider },
      { kind: 'remove-provider', providerId: 'new' },
    ])
  })

  // Control: when the key is stored nothing is rolled back.
  it('sends only the add when the key is stored', async () => {
    const { changes, deps: d } = deps()
    await addProviderWithKey(d, provider, 'sk')
    expect(changes).toEqual([{ kind: 'add-provider', provider }])
  })

  it('does not store a key when the add is refused', async () => {
    let keyStored = false
    const d = {
      change: async () => {
        throw new Error('duplicate')
      },
      setKey: async () => {
        keyStored = true
      },
    }
    await expect(addProviderWithKey(d, provider, 'sk')).rejects.toThrow('duplicate')
    expect(keyStored).toBe(false)
  })
})
