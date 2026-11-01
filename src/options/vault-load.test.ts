import { describe, expect, it } from 'vitest'
import { loadVaultAndStatuses } from './vault-load'

/** A stand-in for the page's message call that records what was requested. */
function fakeCall(state: { sealed: boolean; unlocked: boolean }) {
  const requested: string[] = []
  const call = (async (message: { type: string }) => {
    requested.push(message.type)
    if (message.type === 'vault-state') return state
    if (message.type === 'get-credential-statuses') {
      // What the background does while the vault is sealed and locked.
      if (state.sealed && !state.unlocked) throw new Error('Web Alchemist is locked.')
      return [{ providerId: 'p1', configured: true, kind: 'api_key' }]
    }
    throw new Error(`unexpected ${message.type}`)
  }) as Parameters<typeof loadVaultAndStatuses>[0]
  return { call, requested }
}

describe('loading the settings page state', () => {
  it('reports a sealed, locked vault as such and does not request the statuses', async () => {
    const { call, requested } = fakeCall({ sealed: true, unlocked: false })

    const loaded = await loadVaultAndStatuses(call)

    expect(loaded.vault).toEqual({ sealed: true, unlocked: false })
    expect(loaded.statuses).toEqual([])
    expect(requested).toEqual(['vault-state'])
  })

  it('asks for the vault state before anything else', async () => {
    const { call, requested } = fakeCall({ sealed: true, unlocked: true })

    await loadVaultAndStatuses(call)

    expect(requested[0]).toBe('vault-state')
  })

  // The controls: when the credentials can be read, the statuses are requested
  // and returned, so the skip above is caused by the locked state.
  it('control: an unlocked vault returns its statuses', async () => {
    const { call, requested } = fakeCall({ sealed: true, unlocked: true })

    const loaded = await loadVaultAndStatuses(call)

    expect(requested).toEqual(['vault-state', 'get-credential-statuses'])
    expect(loaded.statuses).toHaveLength(1)
  })

  it('control: an unsealed vault returns its statuses', async () => {
    const { call, requested } = fakeCall({ sealed: false, unlocked: true })

    const loaded = await loadVaultAndStatuses(call)

    expect(requested).toEqual(['vault-state', 'get-credential-statuses'])
    expect(loaded.statuses).toHaveLength(1)
  })
})
