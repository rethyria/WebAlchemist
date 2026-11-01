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

describe('the vault locking between the two requests', () => {
  /*
   * Another tab locks the vault after `vault-state` answered that it was
   * readable and before `get-credential-statuses` ran. The second request then
   * fails, and `load()` in the page has no catch, so the failure left the page
   * showing only its heading.
   */
  function lockedBetween() {
    const requested: string[] = []
    let stateReads = 0
    const call = (async (message: { type: string }) => {
      requested.push(message.type)
      if (message.type === 'vault-state') {
        stateReads += 1
        return stateReads === 1 ? { sealed: true, unlocked: true } : { sealed: true, unlocked: false }
      }
      throw new Error('Web Alchemist is locked.')
    }) as Parameters<typeof loadVaultAndStatuses>[0]
    return { call, requested }
  }

  it('returns no statuses and the state read again, instead of failing', async () => {
    const { call, requested } = lockedBetween()

    const loaded = await loadVaultAndStatuses(call)

    expect(loaded.statuses).toEqual([])
    expect(loaded.vault).toEqual({ sealed: true, unlocked: false })
    expect(requested).toEqual(['vault-state', 'get-credential-statuses', 'vault-state'])
  })

  // The control is the existing test that an unlocked vault returns its
  // statuses and reads the state once: the second read happens only on failure.
  it('control: a successful statuses request does not read the state a second time', async () => {
    const { call, requested } = fakeCall({ sealed: true, unlocked: true })

    await loadVaultAndStatuses(call)

    expect(requested.filter((type) => type === 'vault-state')).toHaveLength(1)
  })
})

describe('the statuses request failing while the vault is not locked', () => {
  /*
   * Corrupt sealed data: the vault state says unlocked, and reading the map
   * fails when it is decrypted. Showing no keys and no message made this look
   * like a vault with nothing stored.
   */
  function failing(second: { sealed: boolean; unlocked: boolean }) {
    let reads = 0
    return (async (message: { type: string }) => {
      if (message.type === 'vault-state') {
        reads += 1
        return reads === 1 ? { sealed: true, unlocked: true } : second
      }
      throw new Error('The stored credentials could not be decrypted.')
    }) as Parameters<typeof loadVaultAndStatuses>[0]
  }

  it('returns the error when the state read again still says unlocked', async () => {
    const loaded = await loadVaultAndStatuses(failing({ sealed: true, unlocked: true }))

    expect(loaded.error).toBe('The stored credentials could not be decrypted.')
    expect(loaded.statuses).toEqual([])
  })

  // Control: the same failure with a state that now says locked has an
  // explanation, so no error is returned. This is the existing lock case.
  it('control: returns no error when the state read again says locked', async () => {
    const loaded = await loadVaultAndStatuses(failing({ sealed: true, unlocked: false }))

    expect(loaded.error).toBeUndefined()
  })

  it('control: a successful load has no error', async () => {
    const { call } = fakeCall({ sealed: true, unlocked: true })
    expect((await loadVaultAndStatuses(call)).error).toBeUndefined()
  })
})
