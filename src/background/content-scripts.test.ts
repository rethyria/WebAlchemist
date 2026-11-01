import { beforeEach, describe, expect, it } from 'vitest'
import { reconcile } from './content-scripts'

/**
 * A fake of the browser calls reconcile() makes. `held` stands for the
 * permissions Firefox reports. Since #96 the content script is registered once
 * per origin, so the fake keeps registrations by id, and `registered` reads
 * back the origins they cover, or null when there are none.
 */
let held: string[]
let scripts: Map<string, { id: string; matches: string[] }>
let registered: string[] | null

function readBack(): void {
  const origins = [...scripts.values()].flatMap((script) => script.matches)
  registered = origins.length === 0 ? null : origins.sort()
}

beforeEach(() => {
  held = []
  scripts = new Map()
  registered = null
  ;(globalThis as unknown as { browser: unknown }).browser = {
    permissions: { getAll: async () => ({ origins: held }) },
    // reconcile() records origins Firefox refused in session storage (#96).
    storage: {
      session: { set: async () => {}, get: async () => ({}) },
      // The excluded-sites list is read at registration (#131); none is set here.
      local: { get: async () => ({}) },
    },
    scripting: {
      getRegisteredContentScripts: async () => [...scripts.values()],
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        for (const id of ids) scripts.delete(id)
        readBack()
      },
      registerContentScripts: async (list: { id: string; matches: string[] }[]) => {
        for (const script of list) scripts.set(script.id, script)
        readBack()
      },
    },
  }
})

describe('reconcile after access is removed (#122)', () => {
  it('registers the content script on a held origin', async () => {
    held = ['*://*.example.com/*', '*://other.com/*']
    await reconcile()
    expect(registered).toEqual(['*://*.example.com/*', '*://other.com/*'].sort())
  })

  it('drops the registration for an origin that is no longer held', async () => {
    held = ['*://*.example.com/*', '*://other.com/*']
    await reconcile()
    // What permissions.remove does to the answer of permissions.getAll.
    held = ['*://other.com/*']
    await reconcile()
    expect(registered).toEqual(['*://other.com/*'])
  })

  it('leaves nothing registered when the last origin is removed', async () => {
    held = ['*://other.com/*']
    await reconcile()
    held = []
    expect((await reconcile()).registered).toBe(0)
    expect(registered).toBeNull()
  })

  it('leaves an identical registration in place without registering again', async () => {
    held = ['*://other.com/*']
    await reconcile()
    let registerCalls = 0
    const scripting = (globalThis as unknown as { browser: { scripting: { registerContentScripts: unknown } } })
      .browser.scripting
    scripting.registerContentScripts = async () => {
      registerCalls++
    }
    await reconcile()
    expect(registerCalls).toBe(0)
    expect(registered).toEqual(['*://other.com/*'])
  })
})
