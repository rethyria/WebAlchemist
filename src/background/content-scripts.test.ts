import { beforeEach, describe, expect, it } from 'vitest'
import { reconcile } from './content-scripts'

/**
 * A fake of the three browser calls reconcile() makes. `held` stands for the
 * permissions Firefox reports; `registered` stands for the content script
 * registration, which unregister and register change.
 */
let held: string[]
let registered: string[] | null

beforeEach(() => {
  held = []
  registered = null
  ;(globalThis as unknown as { browser: unknown }).browser = {
    permissions: { getAll: async () => ({ origins: held }) },
    scripting: {
      unregisterContentScripts: async () => {
        registered = null
      },
      registerContentScripts: async (list: { matches: string[] }[]) => {
        registered = list[0]?.matches ?? []
      },
    },
  }
})

describe('reconcile after access is removed (#122)', () => {
  it('registers the content script on a held origin', async () => {
    held = ['*://*.example.com/*', '*://other.com/*']
    await reconcile()
    expect(registered).toEqual(['*://*.example.com/*', '*://other.com/*'])
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
})
