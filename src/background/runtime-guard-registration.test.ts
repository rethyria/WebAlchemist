/**
 * What is registered with the browser for a transform includes the runtime
 * guard (#139), except where the guard must not apply: the page's own world and
 * the CSP probe. The guard's behaviour is tested in runtime-guard.test.ts and
 * measured in test/runtime-guard; this checks that it reaches the registration.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { Transform } from '@shared/types'
import { analyseJavaScript, applyCapabilityPolicy } from '@safety/static-analysis'
import { runtimeGuardSource } from './runtime-guard'
import { scriptSourceFor, wrapTransform } from './harness'

const store = new Map<string, any>()
;(globalThis as unknown as { browser: unknown }).browser = {
  permissions: { contains: async () => true },
  storage: {
    session: { get: async () => ({}), set: async () => {} },
    local: { get: async () => ({ transforms: [], settings: {} }), set: async () => {} },
  },
  userScripts: {
    configureWorld: async () => {},
    getScripts: async (f: { ids: string[] }) => f.ids.filter((id) => store.has(id)).map((id) => store.get(id)),
    register: async (list: { id: string }[]) => list.forEach((r) => store.set(r.id, r)),
    update: async (list: { id: string }[]) => list.forEach((r) => store.set(r.id, r)),
    unregister: async (f: { ids?: string[] }) => (f.ids ? f.ids.forEach((id) => store.delete(id)) : store.clear()),
  },
}

const { registerTransform } = await import('./registry')

const CODE = "document.querySelector('aside').style.display = 'none'"
const transform = (over: Record<string, unknown> = {}) =>
  ({
    id: 'T1',
    name: 'T',
    enabled: true,
    order: 1,
    match: 'example.com/*',
    kind: 'js',
    origin: 'user',
    world: 'USER_SCRIPT',
    capabilities: [],
    intent: 'x',
    rationale: { targets: '', approach: '', assumptions: [] },
    anchor: { tag: 'div', classes: [], path: 'body>div', landmarks: [], selector: 'div' },
    code: CODE,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as unknown as Transform

const sources = (id: string): string[] => store.get(id).js.map((s: { code: string }) => s.code)

beforeEach(() => store.clear())

describe('the guard in the registered script', () => {
  it('comes first in the one source that is registered, and the transform follows it', async () => {
    await registerTransform(transform())
    const [first, ...rest] = sources('T1')
    const source = first as string
    expect(rest).toEqual([])
    expect(source.startsWith('(() => {')).toBe(true)
    expect(source.indexOf("Object.defineProperty(target, name")).toBeGreaterThan(-1)
    expect(source.indexOf("Object.defineProperty(target, name")).toBeLessThan(source.indexOf(CODE))
  })

  it('names the capabilities the transform declared, and no others', async () => {
    await registerTransform(transform({ capabilities: ['network'] }))
    const source = sources('T1')[0] as string
    expect(source).toContain('"localStorage"')
    expect(source).not.toContain('"fetch"')
  })

  // Control for the two tests above: a world that is not USER_SCRIPT has none.
  it('control: a script for the page world carries no guard', async () => {
    await registerTransform(transform({ world: 'MAIN', mainApprovedByUser: true }))
    expect(sources('T1')[0]).not.toContain('Object.defineProperty(target, name')
  })

  it('is left out of the CSP probe, which measures the CSP alone', async () => {
    await registerTransform(transform(), { skipAnalysis: true, unguarded: true })
    expect(sources('T1')[0]).not.toContain('Object.defineProperty(target, name')
  })

  // Skipping the analysis is not skipping the guard: only `unguarded` does that.
  it('control: a registration that skips the analysis but is not marked unguarded still has the guard', async () => {
    await registerTransform(transform(), { skipAnalysis: true })
    expect(sources('T1')[0]).toContain('Object.defineProperty(target, name')
  })
})

describe('the guard and the static analysis', () => {
  // The analysis is tested on wrapTransform. The guard is not part of its text,
  // which is why the guard can name the window; this pins that boundary.
  it('wrapTransform itself does not contain the guard', () => {
    expect(wrapTransform(transform(), 'a1b2c3')).not.toContain('Object.defineProperty(target, name')
  })

  it('the wrapper alone passes the analysis', () => {
    const outcome = applyCapabilityPolicy(analyseJavaScript(wrapTransform(transform(), 'a1b2c3')), [])
    expect(outcome.findings.filter((f) => f.severity === 'block')).toEqual([])
  })

  // Control: the guard is the kind of code the analysis refuses, so it could not
  // be part of the analysed text.
  it('control: the guard itself is refused by the analysis', () => {
    const outcome = applyCapabilityPolicy(analyseJavaScript(runtimeGuardSource([], 'data-wa-error-x')), [])
    expect(outcome.findings.some((f) => f.severity === 'block')).toBe(true)
  })

  it('scriptSourceFor joins the guard and the wrapper, or returns the wrapper alone', () => {
    const t = transform()
    expect(scriptSourceFor(t, 'a1b2c3', { guard: false })).toBe(wrapTransform(t, 'a1b2c3'))
    const guarded = scriptSourceFor(t, 'a1b2c3', { guard: true })
    expect(guarded.endsWith(wrapTransform(t, 'a1b2c3'))).toBe(true)
    expect(guarded.length).toBeGreaterThan(wrapTransform(t, 'a1b2c3').length)
  })
})
