/**
 * Earlier versions of a transform and restoring one (#120).
 *
 * Loads the real background against a stubbed `browser` and sends the same
 * messages the panel and the editor send. Before #120 a save replaced the
 * record and no version was kept, so every test here that reads versions fails
 * on the earlier code.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { sourceLabel } from '@shared/versions'
import { MAX_VERSIONS } from './storage'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const css = cssTransform({ id: 'c1', code: 'a { color: red }' })
const js = cssTransform({
  id: 'j1',
  kind: 'js',
  origin: 'ai',
  world: 'USER_SCRIPT',
  code: 'document.title = "one"',
})

let h: Harness
async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}
/** The token the editor gets from approve-code before it saves or restores JavaScript. */
async function approval(fields: any): Promise<{ approvalToken?: string }> {
  if (fields.kind !== undefined && fields.kind !== 'js') return {}
  const { approvalToken } = await ask({
    type: 'approve-code',
    code: fields.code,
    declaredCapabilities: fields.capabilities,
    ...(fields.world ? { world: fields.world } : {}),
    transformId: fields.id,
    match: fields.match,
  })
  return { approvalToken }
}
const save = async (transform: any, source?: string) =>
  ask({
    type: 'save-transform',
    transform,
    tabId: TAB,
    ...(source ? { source } : {}),
    ...(transform.kind === 'js' ? await approval(transform) : {}),
  })
/** Restores as the editor does: approves the version's own fields, then restores. */
async function restore(id: string, versionId: string, tabId?: number) {
  const version = (await versions(id)).find((v: any) => v.id === versionId)
  const current = stored(id)
  return ask({
    type: 'restore-transform-version',
    id,
    versionId,
    ...(tabId === undefined ? {} : { tabId }),
    ...(current?.kind === 'js' && version ? await approval({ ...version, id }) : {}),
  })
}
const versions = (id: string) => ask({ type: 'get-transform-versions', id })
const stored = (id: string) => (h.local.get('transforms') as any[]).find((t) => t.id === id)

beforeEach(async () => {
  h = createHarness()
  h.hasUserScripts = true
  h.local.set('transforms', [css, js])
  h.local.set('settings', { ...DEFAULT_SETTINGS })
  h.tabUrls.set(TAB, 'https://example.com/')
  await h.boot()
})

describe('keeping versions', () => {
  it('keeps the code a repair replaced, with what produced it and when it was saved', async () => {
    await save({ ...css, code: 'a { color: green }' }, 'generation')
    await save({ ...css, code: 'a { color: blue }' }, 'repair')
    const kept = await versions('c1')
    // Newest first: the generated version that the repair replaced, then the original.
    expect(kept.map((v: any) => v.code)).toEqual(['a { color: green }', 'a { color: red }'])
    expect(kept[0].producedBy).toBe('generation')
    expect(kept[0].savedAt).toBeGreaterThan(0)
    expect(stored('c1').producedBy).toBe('repair')
  })

  it('keeps the rationale, match, capabilities and world of the replaced version', async () => {
    await save({ ...js, code: 'document.title = "two"', match: 'other.example/*', capabilities: ['storage'] })
    const [v] = await versions('j1')
    expect(v).toMatchObject({
      code: 'document.title = "one"',
      match: 'example.com/*',
      capabilities: [],
      world: 'USER_SCRIPT',
      rationale: js.rationale,
    })
  })

  it('keeps no version for a save that changes none of the versioned fields (control)', async () => {
    await save({ ...css, name: 'Renamed' })
    expect(await versions('c1')).toEqual([])
    expect(stored('c1').name).toBe('Renamed')
  })

  it('keeps no version for the first save of a new transform (control)', async () => {
    await save(cssTransform({ id: 'new', code: 'p { margin: 0 }' }))
    expect(await versions('new')).toEqual([])
  })

  it('keeps the last five versions and drops the oldest', async () => {
    for (let n = 1; n <= MAX_VERSIONS + 2; n++) await save({ ...css, code: `a { order: ${n} }` })
    const kept = await versions('c1')
    expect(kept).toHaveLength(MAX_VERSIONS)
    // Eight states existed in total: the original and seven saves. Six earlier
    // ones were replaced, and the oldest two of them, the original and
    // order 1, are gone.
    expect(kept.map((v: any) => v.code)).toEqual([6, 5, 4, 3, 2].map((n) => `a { order: ${n} }`))
    expect(kept.some((v: any) => v.code === 'a { color: red }')).toBe(false)
  })

  it('removes the versions when the transform is deleted', async () => {
    await save({ ...css, code: 'a { color: green }' })
    expect(await versions('c1')).toHaveLength(1)
    await ask({ type: 'delete-transform', id: 'c1' })
    expect(await versions('c1')).toEqual([])
  })

  it('does not lose a version when two saves run at once', async () => {
    await Promise.all([
      save({ ...css, code: 'a { order: 1 }' }),
      save({ ...css, code: 'a { order: 2 }' }),
    ])
    // The original and the first of the two saves were both replaced.
    expect(await versions('c1')).toHaveLength(2)
  })
})

describe('restoring a version', () => {
  it('puts the earlier code back, and keeps the replaced code as a version', async () => {
    await save({ ...css, code: 'a { color: blue }' }, 'repair')
    const [original] = await versions('c1')
    await restore('c1', original.id, TAB)
    expect(stored('c1').code).toBe('a { color: red }')
    const kept = await versions('c1')
    expect(kept[0].code).toBe('a { color: blue }')
    expect(kept[0].producedBy).toBe('repair')
  })

  it('applies the restored CSS to the open tab', async () => {
    await save({ ...css, code: 'a { color: blue }' })
    const [original] = await versions('c1')
    h.calls.insertCSS.length = 0
    await restore('c1', original.id, TAB)
    expect(h.calls.insertCSS.at(-1)?.css).toContain('a { color: red }')
  })

  it('restores a JavaScript version that passes the analysis, and registers it (control)', async () => {
    await save({ ...js, code: 'document.title = "two"' })
    const [original] = await versions('j1')
    await restore('j1', original.id)
    expect(stored('j1').code).toBe('document.title = "one"')
    expect(JSON.stringify(h.userScriptsHeld.get('j1'))).toContain('document.title = \\"one\\"')
  })

  it('refuses a JavaScript version restored with no approval token, and registers nothing (#120)', async () => {
    await save({ ...js, code: 'document.title = "two"' })
    const [original] = await versions('j1')
    const registryBefore = h.calls.registry.length
    await expect(
      ask({ type: 'restore-transform-version', id: 'j1', versionId: original.id }),
    ).rejects.toThrow(/not approved/)
    expect(stored('j1').code).toBe('document.title = "two"')
    expect(h.calls.registry).toHaveLength(registryBefore)
    // Control: the same restore with the token the editor obtains succeeds.
    await restore('j1', original.id)
    expect(stored('j1').code).toBe('document.title = "one"')
  })

  it('refuses a JavaScript version restored with a token for other code (#120)', async () => {
    await save({ ...js, code: 'document.title = "two"' })
    const [original] = await versions('j1')
    const other = await approval({ ...js, code: 'document.title = "three"' })
    await expect(
      ask({ type: 'restore-transform-version', id: 'j1', versionId: original.id, ...other }),
    ).rejects.toThrow(/not approved/)
    expect(stored('j1').code).toBe('document.title = "two"')
  })

  it('runs the CSS check on a restored CSS version (#120, #50)', async () => {
    await save({ ...css, code: 'a { color: blue }' })
    const [original] = await versions('c1')
    // The stored version is rewritten to a rule that loads an address nobody approved.
    const history = h.local.get('wa-transform-history') as Record<string, any[]>
    history['c1']!.find((v) => v.id === original.id)!.code = 'a { background: url(https://evil.example/t) }'
    h.local.set('wa-transform-history', history)
    await expect(restore('c1', original.id, TAB)).rejects.toThrow(/makes the browser load/)
    expect(stored('c1').code).toBe('a { color: blue }')
  })

  it('refuses a JavaScript version that fails the analysis now, and registers nothing', async () => {
    await save({ ...js, code: 'document.title = "two"' })
    // A version saved under rules that have since changed: code that the
    // analysis blocks today.
    const history = h.local.get('wa-transform-history') as Record<string, any[]>
    history['j1']![0].code = 'eval("1 + 1")'
    h.local.set('wa-transform-history', history)
    const before = JSON.stringify(h.userScriptsHeld.get('j1'))
    const registryBefore = h.calls.registry.length

    await expect(
      ask({ type: 'restore-transform-version', id: 'j1', versionId: history['j1']![0].id }),
    ).rejects.toThrow(/did not pass the safety check/)
    expect(stored('j1').code).toBe('document.title = "two"')
    expect(JSON.stringify(h.userScriptsHeld.get('j1'))).toBe(before)
    expect(h.calls.registry).toHaveLength(registryBefore)
    // Nothing was added to the history by the refused restore.
    expect(await versions('j1')).toHaveLength(1)
  })

  it('refuses a version that is not kept', async () => {
    await expect(ask({ type: 'restore-transform-version', id: 'c1', versionId: 'nope' })).rejects.toThrow(
      /no longer kept/,
    )
  })
})

describe('version labels', () => {
  it('names each source, and says when none was recorded', () => {
    expect(sourceLabel('generation')).toBe('Generated by the model')
    expect(sourceLabel('repair')).toBe('Repaired by the model')
    expect(sourceLabel('ai-edit')).toBe('Changed by the model')
    expect(sourceLabel('hand-edit')).toBe('Edited by hand')
    expect(sourceLabel(undefined)).toBe('Source not recorded')
  })
})
