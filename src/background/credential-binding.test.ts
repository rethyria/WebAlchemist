/**
 * A stored key is sent only to the destination it was entered for. Runs the
 * real storage, vault and adapter code against the in-memory browser mock,
 * with `fetch` replaced; no network call is made.
 */

import { localArea, resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Provider } from '@shared/types'
import * as storage from './storage'
import { createOpenAiCompatibleProvider } from './providers/openai-compatible'
import { createAnthropicProvider } from './providers/anthropic'
import { ProviderError } from './providers/types'

const remote = (over: Partial<Provider> = {}): Provider =>
  ({
    id: 'p1',
    label: 'Remote',
    type: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    generateModel: 'm',
    reviewModel: 'm',
    supportsVision: false,
    ...over,
  }) as Provider

const anthropic = (): Provider => remote({ type: 'anthropic', baseUrl: undefined as never, label: 'Claude' })

const KEY = { kind: 'api_key' as const, value: 'sk-secret' }
const OK_BODY = JSON.stringify({
  choices: [{ message: { content: '{"verdict":"match","explanation":""}' } }],
})

function stubFetch() {
  const spy = vi.fn(async (_url: string, _init: RequestInit) => new Response(OK_BODY))
  ;(globalThis as unknown as { fetch: unknown }).fetch = spy
  return spy
}

/** Every request body and header the stub saw, as one string. */
function sentAnywhere(spy: ReturnType<typeof stubFetch>): string {
  return JSON.stringify(spy.mock.calls.map(([url, init]) => [url, init.headers, String(init.body)]))
}

beforeEach(() => {
  resetBrowserMock()
})

describe('reading a bound credential', () => {
  it('returns it for the destination it was saved for, ignoring path, case and default port', async () => {
    await storage.saveCredentialFor(remote(), KEY)

    const same = remote({ baseUrl: 'https://API.example.com:443/other/v2' })
    expect(await storage.readCredentialForRequest(same)).toMatchObject({ value: 'sk-secret' })
  })

  it('refuses it after the base URL moves to another origin', async () => {
    await storage.saveCredentialFor(remote(), KEY)

    await expect(
      storage.readCredentialForRequest(remote({ baseUrl: 'https://evil.example.net/v1' })),
    ).rejects.toBeInstanceOf(storage.CredentialOriginError)
  })

  it('refuses it after the provider type changes, even to an address that was valid before', async () => {
    await storage.saveCredentialFor(anthropic(), KEY)

    // The same id, now OpenAI-compatible and pointed at the Anthropic host.
    const changed = remote({ label: 'Claude', baseUrl: 'https://api.anthropic.com/v1' })
    await expect(storage.readCredentialForRequest(changed)).rejects.toBeInstanceOf(
      storage.CredentialOriginError,
    )
  })

  it('replaces a binding supplied by the caller with the provider’s own destination', async () => {
    await storage.saveCredentialFor(remote(), {
      ...KEY,
      boundTo: { type: 'openai-compatible', origin: 'https://evil.example.net' },
    })

    expect(await storage.readStoredCredential('p1')).toMatchObject({
      boundTo: { type: 'openai-compatible', origin: 'https://api.example.com' },
    })
  })

  it('returns null, not an error, when no credential exists', async () => {
    expect(await storage.readCredentialForRequest(remote())).toBeNull()
  })
})

describe('credentials stored before binding existed', () => {
  it('are bound to the provider’s destination on first read, and refused elsewhere afterwards', async () => {
    localArea.raw()['credentials'] = { p1: { ...KEY } }

    expect(await storage.readCredentialForRequest(remote())).toMatchObject({ value: 'sk-secret' })
    expect(await storage.readStoredCredential('p1')).toMatchObject({
      boundTo: { type: 'openai-compatible', origin: 'https://api.example.com' },
    })

    await expect(
      storage.readCredentialForRequest(remote({ baseUrl: 'https://evil.example.net/v1' })),
    ).rejects.toBeInstanceOf(storage.CredentialOriginError)
  })

  it('are bound inside a sealed vault as well', async () => {
    await storage.setCredential('p1', { ...KEY })
    await storage.enableVault('correct horse battery')

    await storage.readCredentialForRequest(remote())

    expect(await storage.readStoredCredential('p1')).toMatchObject({
      boundTo: { origin: 'https://api.example.com' },
    })
  })
})

describe('the adapters', () => {
  it('send the key to the origin it was entered for', async () => {
    await storage.saveCredentialFor(remote(), KEY)
    const spy = stubFetch()

    const adapter = await createOpenAiCompatibleProvider(remote())
    await adapter.review({ code: 'x', intent: 'y' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(sentAnywhere(spy)).toContain('sk-secret')
  })

  it('do not send the key anywhere after the base URL changes', async () => {
    await storage.saveCredentialFor(remote(), KEY)
    const spy = stubFetch()

    const adapter = await createOpenAiCompatibleProvider(remote({ baseUrl: 'https://evil.example.net/v1' }))
    const error = await adapter.review({ code: 'x', intent: 'y' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('no-credential')
    expect((error as ProviderError).message).toMatch(/enter it again/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('do not fall back to an unauthenticated request when the new address is loopback', async () => {
    await storage.saveCredentialFor(remote(), KEY)
    const spy = stubFetch()

    const adapter = await createOpenAiCompatibleProvider(remote({ baseUrl: 'http://127.0.0.1:1234/v1' }))
    const error = await adapter.review({ code: 'x', intent: 'y' }).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('no-credential')
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuse a key entered for an OpenAI-compatible provider once the provider becomes Anthropic', async () => {
    await storage.saveCredentialFor(remote(), KEY)

    const error = await createAnthropicProvider({ ...remote(), type: 'anthropic' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).kind).toBe('no-credential')
  })

  it('keep the binding when a sign-in token is refreshed', async () => {
    await storage.saveCredentialFor(remote(), {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'c',
    })
    const spy = vi.fn(async (url: string) =>
      url.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }))
        : new Response(OK_BODY),
    )
    ;(globalThis as unknown as { fetch: unknown }).fetch = spy

    await (await createOpenAiCompatibleProvider(remote())).review({ code: 'x', intent: 'y' })

    expect(await storage.readStoredCredential('p1')).toMatchObject({
      refreshToken: 'r2',
      boundTo: { origin: 'https://api.example.com' },
    })
  })
})

describe('credential status after the provider changes', () => {
  async function withProvider(provider: Provider) {
    const settings = await storage.getSettings()
    await storage.saveSettings({ ...settings, providers: [provider], activeProviderId: provider.id })
  }

  it('says the key must be entered again once the origin differs', async () => {
    await withProvider(remote())
    await storage.saveCredentialFor(remote(), KEY)
    await withProvider(remote({ baseUrl: 'https://evil.example.net/v1' }))

    const status = (await storage.getAllCredentialStatuses())[0]!
    expect(status).toMatchObject({ configured: true, kind: 'api_key', needsReentry: true })
    expect(await storage.getCredentialStatus('p1')).toMatchObject({ needsReentry: true })
  })

  // Control: the same statuses with no change of destination must not be flagged,
  // and neither must a path-only change or a key stored before bindings existed.
  it('does not flag a key whose destination is unchanged', async () => {
    await withProvider(remote())
    await storage.saveCredentialFor(remote(), KEY)
    await withProvider(remote({ baseUrl: 'https://API.example.com:443/v2' }))

    const status = (await storage.getAllCredentialStatuses())[0]!
    expect(status).toMatchObject({ configured: true })
    expect(status.needsReentry).toBeUndefined()
  })

  it('does not flag a stored key that has no binding yet', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)

    const status = (await storage.getAllCredentialStatuses())[0]!
    expect(status.needsReentry).toBeUndefined()
  })

  it('clears the flag after the key is entered again for the new destination', async () => {
    await withProvider(remote())
    await storage.saveCredentialFor(remote(), KEY)
    const moved = remote({ baseUrl: 'https://evil.example.net/v1' })
    await withProvider(moved)
    await storage.saveCredentialFor(moved, KEY)

    expect((await storage.getAllCredentialStatuses())[0]!.needsReentry).toBeUndefined()
  })
})

describe('binding keys stored before bindings existed, in one pass', () => {
  async function withProvider(provider: Provider) {
    const settings = await storage.getSettings()
    await storage.saveSettings({ ...settings, providers: [provider], activeProviderId: provider.id })
  }

  it('binds an unbound key to the settings as they are now, so a later edit is refused', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)

    await storage.bindStoredCredentials()
    expect(await storage.readStoredCredential('p1')).toMatchObject({
      boundTo: { type: 'openai-compatible', origin: 'https://api.example.com' },
    })

    // The edit after the pass is refused. Without the pass this read would
    // have bound the key to the edited address, which is the finding.
    await expect(
      storage.readCredentialForRequest(remote({ baseUrl: 'https://evil.example.net/v1' })),
    ).rejects.toBeInstanceOf(storage.CredentialOriginError)
  })

  // Control: with no pass, the first read after an edit binds the key to the
  // edited address. This is the behaviour the pass exists to shorten.
  it('without the pass, the first read after an edit binds the key to the edited address', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)

    const edited = remote({ baseUrl: 'https://evil.example.net/v1' })
    expect(await storage.readCredentialForRequest(edited)).toMatchObject({
      boundTo: { origin: 'https://evil.example.net' },
    })
  })

  it('leaves a bound key alone and skips a key whose provider is gone', async () => {
    await withProvider(remote())
    await storage.saveCredentialFor(remote(), KEY)
    await storage.setCredential('gone', KEY)
    const before = await storage.readStoredCredential('p1')

    await storage.bindStoredCredentials()

    expect(await storage.readStoredCredential('p1')).toEqual(before)
    expect((await storage.readStoredCredential('gone'))?.boundTo).toBeUndefined()
  })

  it('binds keys in a sealed vault when it is unlocked, not before', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)
    await storage.enableVault('correct horse battery')
    await storage.lockVault()
    await expect(storage.bindStoredCredentials()).rejects.toThrow()

    await storage.unlockVault('correct horse battery')

    expect(await storage.readStoredCredential('p1')).toMatchObject({
      boundTo: { origin: 'https://api.example.com' },
    })
  })
})

describe('after the binding pass has run', () => {
  async function withProvider(provider: Provider | null) {
    const settings = await storage.getSettings()
    await storage.saveSettings({
      ...settings,
      providers: provider ? [provider] : [],
      activeProviderId: provider?.id ?? null,
    })
  }

  // The pass skips a key whose provider is gone. Before the change, a provider
  // with that id added later got the key bound to its address on first read.
  it('refuses a key the pass skipped instead of binding it to a provider added later', async () => {
    await storage.setCredential('p1', KEY)
    await storage.bindStoredCredentials()
    await withProvider(remote({ baseUrl: 'https://later.example.net/v1' }))

    const error = await storage
      .readCredentialForRequest(remote({ baseUrl: 'https://later.example.net/v1' }))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(storage.CredentialOriginError)
    expect((error as Error).message).toMatch(/no recorded address/)
    expect((await storage.readStoredCredential('p1'))?.boundTo).toBeUndefined()
  })

  // Control: with no pass recorded the same read binds, which is the legacy
  // behaviour that is kept until the pass has run.
  it('still binds on first read while no pass has run', async () => {
    await storage.setCredential('p1', KEY)
    const found = await storage.readCredentialForRequest(remote())
    expect(found?.boundTo?.origin).toBe('https://api.example.com')
  })

  // Control: a bound key is not affected by the record.
  it('still returns a bound key', async () => {
    await storage.saveCredentialFor(remote(), KEY)
    await storage.bindStoredCredentials()
    expect(await storage.readCredentialForRequest(remote())).toMatchObject({ value: 'sk-secret' })
  })

  it('refuses the key in a request through the adapter and sends nothing', async () => {
    await storage.setCredential('p1', KEY)
    await storage.bindStoredCredentials()
    const spy = stubFetch()

    const adapter = await createOpenAiCompatibleProvider(remote())
    const error = await adapter.review({ code: 'x', intent: 'y' }).catch((e: unknown) => e)

    expect((error as ProviderError).kind).toBe('no-credential')
    expect(spy).not.toHaveBeenCalled()
  })

  it('reports an unbound key as needing to be entered again, and not before the pass', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)
    expect((await storage.getAllCredentialStatuses())[0]!.needsReentry).toBeUndefined()

    // A key whose provider was not configured when the pass ran stays unbound.
    await withProvider(null)
    await storage.bindStoredCredentials()
    await withProvider(remote())

    expect((await storage.getAllCredentialStatuses())[0]!).toMatchObject({ needsReentry: true })
    expect(await storage.getCredentialStatus('p1')).toMatchObject({ needsReentry: true })
  })

  it('records the pass even when there is nothing to bind', async () => {
    await storage.bindStoredCredentials()
    expect(localArea.raw()['credentialBindingPassDone']).toBe(true)
  })

  // Control for the two tests above: a pass that throws records nothing, so it
  // runs again at the next unlock.
  it('does not record a pass that failed on a locked vault', async () => {
    await withProvider(remote())
    await storage.setCredential('p1', KEY)
    await storage.enableVault('correct horse battery')
    await storage.lockVault()
    await expect(storage.bindStoredCredentials()).rejects.toThrow()
    expect(localArea.raw()['credentialBindingPassDone']).toBeUndefined()

    await storage.unlockVault('correct horse battery')
    expect(localArea.raw()['credentialBindingPassDone']).toBe(true)
  })
})
