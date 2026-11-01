import { describe, expect, it } from 'vitest'
import { editorOriginToRequest, permissionRequestsFor, requestAll } from './permissions'

type Request = browser.permissions.Permissions

/** Records when each request is issued and resolves each one on a later tick. */
function recorder(grant: (r: Request) => boolean = () => true) {
  const issued: Request[] = []
  const request = (r: Request) => {
    issued.push(r)
    return new Promise<boolean>((resolve) => setTimeout(() => resolve(grant(r)), 0))
  }
  return { issued, request }
}

describe('permissionRequestsFor', () => {
  it('asks for userScripts on its own when the kind is js', () => {
    const requests = permissionRequestsFor('js', '*://example.com/*')
    expect(requests).toEqual([
      { origins: ['*://example.com/*'] },
      { permissions: ['userScripts'] },
    ])
  })

  it('asks for userScripts even when no origin is needed', () => {
    expect(permissionRequestsFor('js', null)).toEqual([{ permissions: ['userScripts'] }])
  })

  // Control: css must not trigger the extra permission prompt.
  it('does not ask for userScripts when the kind is css', () => {
    expect(permissionRequestsFor('css', '*://example.com/*')).toEqual([
      { origins: ['*://example.com/*'] },
    ])
    expect(permissionRequestsFor('css', null)).toEqual([])
  })
})

describe('requestAll', () => {
  it('issues every request before the first one resolves', () => {
    const { issued, request } = recorder()
    void requestAll(request, permissionRequestsFor('js', '*://example.com/*'))
    // Checked synchronously: nothing has been awaited yet.
    expect(issued).toHaveLength(2)
  })

  // Control: the sequential form the editor must not use fails the same
  // assertion, so the test above can fail.
  it('is distinguishable from a sequential loop', async () => {
    const { issued, request } = recorder()
    const sequential = async (requests: Request[]) => {
      for (const one of requests) if (!(await request(one))) return false
      return true
    }
    void sequential(permissionRequestsFor('js', '*://example.com/*'))
    expect(issued).toHaveLength(1)
  })

  it('resolves false when any request is refused', async () => {
    const { request } = recorder((r) => !r.permissions)
    expect(await requestAll(request, permissionRequestsFor('js', '*://example.com/*'))).toBe(false)
  })

  it('resolves true when all are granted, and when there is nothing to request', async () => {
    const { request } = recorder()
    expect(await requestAll(request, permissionRequestsFor('js', '*://example.com/*'))).toBe(true)
    expect(await requestAll(request, [])).toBe(true)
  })
})

describe('editorOriginToRequest', () => {
  // Fails with the previous rule, which compared the pattern to the saved one
  // in create mode too and so returned null here.
  it('requests the origin when creating with the pattern unchanged', () => {
    expect(editorOriginToRequest(true, '*.example.com/*', '*.example.com/*')).toBe(
      '*://*.example.com/*',
    )
  })

  it('requests the origin when creating with a changed pattern', () => {
    expect(editorOriginToRequest(true, 'other.com/*', '*.example.com/*')).toBe('*://other.com/*')
  })

  // Controls: editing keeps the earlier behaviour.
  it('requests nothing when editing with the pattern unchanged', () => {
    expect(editorOriginToRequest(false, 'example.com/*', 'example.com/*')).toBeNull()
  })

  it('requests the origin when editing with a changed pattern', () => {
    expect(editorOriginToRequest(false, 'other.com/*', 'example.com/*')).toBe('*://other.com/*')
  })
})
