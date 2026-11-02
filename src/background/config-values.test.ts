/**
 * Storage, export, import and the messages for the values of an elixir's
 * settings. The tests load the real background script and send the messages
 * the sidebar and the editor send.
 *
 * Safety properties checked here: a share never carries values, a save never
 * takes values from its caller, values are validated in the background, and a
 * value edit changes nothing but the values.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ConfigField } from '@shared/types'
import { PRIVATE_WINDOW_MESSAGE } from './private-window'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const PAGE = 'https://example.com/page'

const words: ConfigField = {
  key: 'words',
  label: 'Words',
  type: 'table',
  columns: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
  ],
  default: [{ from: 'a', to: 'b' }],
}
const size: ConfigField = { key: 'size', label: 'Size', type: 'number', default: 10, min: 1, max: 20, unit: 'px' }
const tint: ConfigField = { key: 'tint', label: 'Tint', type: 'colour', default: '#ffcc00' }

let h: Harness
const stored = (id: string) => (h.local.get('transforms') as any[]).find((t) => t.id === id)

async function ask(message: unknown): Promise<any> {
  const reply = await h.onMessage(message)
  if (!reply.ok) throw new Error(reply.error.message)
  return reply.data
}
async function fails(message: unknown): Promise<string> {
  const reply = await h.onMessage(message)
  expect(reply.ok).toBe(false)
  return reply.error.message
}

const js = (over: Record<string, unknown> = {}) =>
  cssTransform({
    id: 'j1',
    kind: 'js',
    name: 'Replace words',
    match: 'example.com/*',
    origin: 'ai',
    world: 'USER_SCRIPT',
    code: "document.title = 'x'",
    intent: 'Replace words',
    configFields: [words, size],
    ...over,
  })
const css = (over: Record<string, unknown> = {}) =>
  cssTransform({ id: 'c1', code: 'a { color: red }', configFields: [tint, size], ...over })

async function approvedSave(transform: any) {
  const { approvalToken } = await ask({
    type: 'approve-code',
    code: transform.code,
    declaredCapabilities: transform.capabilities,
    world: transform.world,
    transformId: transform.id,
    match: transform.match,
  })
  return ask({ type: 'save-transform', transform, tabId: TAB, approvalToken })
}

beforeEach(async () => {
  h = createHarness()
  h.hasUserScripts = true
  h.origins = ['*://example.com/*']
  h.tabUrls.set(TAB, PAGE)
  h.local.set('settings', DEFAULT_SETTINGS)
  h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
})
const boot = async (transforms: object[]) => {
  h.local.set('transforms', transforms)
  await h.boot()
}

describe('saving keeps the stored values', () => {
  it('ignores values sent by the caller', async () => {
    await boot([css()])
    await ask({ type: 'save-transform', transform: css({ configValues: { size: 15 } }), tabId: TAB })
    expect(stored('c1').configValues).toBeUndefined()
  })

  it('does not undo a value edit when a stale copy is saved', async () => {
    await boot([css()])
    const stale = stored('c1')
    await ask({ type: 'set-config-values', id: 'c1', values: { size: 15 } })
    await ask({ type: 'save-transform', transform: { ...stale, name: 'Renamed' }, tabId: TAB })
    expect(stored('c1')).toMatchObject({ name: 'Renamed', configValues: { size: 15 } })
  })

  it('keeps a value whose field survives and drops one whose field changed type or went away', async () => {
    await boot([css({ configValues: { size: 15, tint: '#00ff00' } })])
    const textSize: ConfigField = { key: 'size', label: 'Size', type: 'text', default: 'big' }
    await ask({ type: 'save-transform', transform: css({ configFields: [tint, textSize] }), tabId: TAB })
    expect(stored('c1').configValues).toEqual({ tint: '#00ff00' })
    await ask({ type: 'save-transform', transform: css({ configFields: [] }), tabId: TAB })
    expect(stored('c1').configValues).toBeUndefined()
  })

  it('refuses fields that do not pass validation', async () => {
    await boot([css()])
    const message = await fails({
      type: 'save-transform',
      transform: css({ configFields: [{ ...size, key: '__proto__' }] }),
      tabId: TAB,
    })
    expect(message).toContain('not valid')
    expect(stored('c1').configFields).toHaveLength(2)
  })
})

describe('versions', () => {
  it('records the fields with a version and none for a value edit', async () => {
    await boot([css()])
    await ask({ type: 'set-config-values', id: 'c1', values: { size: 15 } })
    expect(await ask({ type: 'get-transform-versions', id: 'c1' })).toHaveLength(0)
    await ask({ type: 'save-transform', transform: css({ configFields: [tint] }), tabId: TAB })
    const versions = await ask({ type: 'get-transform-versions', id: 'c1' })
    expect(versions).toHaveLength(1)
    expect(versions[0].configFields.map((f: ConfigField) => f.key)).toEqual(['tint', 'size'])
  })

  it('restores the fields with the code and reconciles the values to them', async () => {
    await boot([css()])
    await ask({ type: 'set-config-values', id: 'c1', values: { size: 15, tint: '#00ff00' } })
    await ask({ type: 'save-transform', transform: css({ configFields: [tint], code: 'a { color: blue }' }), tabId: TAB })
    expect(stored('c1').configValues).toEqual({ tint: '#00ff00' })
    const [version] = await ask({ type: 'get-transform-versions', id: 'c1' })
    await ask({ type: 'restore-transform-version', id: 'c1', versionId: version.id, tabId: TAB })
    expect(stored('c1').configFields.map((f: ConfigField) => f.key)).toEqual(['tint', 'size'])
    // The size value was dropped when its field went away, so the default applies.
    expect(stored('c1').configValues).toEqual({ tint: '#00ff00' })
  })
})

describe('set-config-values', () => {
  it('stores valid values and changes nothing else', async () => {
    await boot([js()])
    await approvedSave(js())
    const before = stored('j1')
    const result = await ask({
      type: 'set-config-values',
      id: 'j1',
      values: { words: [{ from: 'y', to: 'z' }] },
      tabId: TAB,
    })
    const after = stored('j1')
    expect(after.configValues).toEqual({ words: [{ from: 'y', to: 'z' }] })
    const { configValues: _v, updatedAt: _u, ...restAfter } = after
    const { configValues: _w, updatedAt: _x, ...restBefore } = before
    expect(restAfter).toEqual(restBefore)
    expect(result.transform.id).toBe('j1')
  })

  it('requires no approval token and records no version', async () => {
    await boot([js()])
    await approvedSave(js())
    const versionsBefore = (await ask({ type: 'get-transform-versions', id: 'j1' })).length
    await ask({ type: 'set-config-values', id: 'j1', values: { size: 12 } })
    expect((await ask({ type: 'get-transform-versions', id: 'j1' })).length).toBe(versionsBefore)
  })

  it.each([
    ['a value of the wrong type', { size: 'big' }],
    ['a number out of range', { size: 99 }],
    ['an unknown key', { nope: 'x' }],
    ['a row with an extra column', { words: [{ from: 'a', to: 'b', c: 'c' }] }],
    ['a cell that is too long', { words: [{ from: 'a'.repeat(501), to: '' }] }],
  ] as [string, Record<string, unknown>][])('refuses %s and stores nothing', async (_name, values) => {
    await boot([js()])
    await ask({ type: 'set-config-values', id: 'j1', values: { size: 12 } })
    await fails({ type: 'set-config-values', id: 'j1', values: { ...values, size: values.size ?? 15 } })
    expect(stored('j1').configValues).toEqual({ size: 12 })
  })

  it('refuses a message when one of its values is invalid, even if another is valid', async () => {
    await boot([css()])
    await fails({ type: 'set-config-values', id: 'c1', values: { size: 15, tint: 'red' } })
    expect(stored('c1').configValues).toBeUndefined()
  })

  it('resets a key to its default and refuses an unknown reset key', async () => {
    await boot([css({ configValues: { size: 15, tint: '#00ff00' } })])
    await ask({ type: 'set-config-values', id: 'c1', values: {}, reset: ['size'] })
    expect(stored('c1').configValues).toEqual({ tint: '#00ff00' })
    await fails({ type: 'set-config-values', id: 'c1', values: {}, reset: ['nope'] })
  })

  it('refuses an unknown id and a private window', async () => {
    await boot([css()])
    await fails({ type: 'set-config-values', id: 'missing', values: {} })
    h.privateTabs.add(TAB)
    expect(await fails({ type: 'set-config-values', id: 'c1', values: { size: 15 }, tabId: TAB })).toBe(PRIVATE_WINDOW_MESSAGE)
    expect(stored('c1').configValues).toBeUndefined()
  })

  it('refuses values over 64 KB in total', async () => {
    const list: ConfigField = { key: 'l', label: 'L', type: 'list', default: [] }
    const list2: ConfigField = { ...list, key: 'm' }
    await boot([css({ configFields: [list, list2] })])
    const big = Array(1000).fill('x'.repeat(40))
    await fails({ type: 'set-config-values', id: 'c1', values: { l: big, m: big } })
    expect(stored('c1').configValues).toBeUndefined()
  })

  it('says how many open tabs of a JavaScript elixir need a reload, and none for CSS', async () => {
    await boot([js(), css()])
    await approvedSave(js())
    const jsResult = await ask({ type: 'set-config-values', id: 'j1', values: { size: 12 }, tabId: TAB })
    expect(jsResult.reloadTabs).toBe(1)
    const cssResult = await ask({ type: 'set-config-values', id: 'c1', values: { size: 12 }, tabId: TAB })
    expect(cssResult.reloadTabs).toBe(0)
  })
})

describe('export', () => {
  const withValues = async () => {
    await boot([
      css({ configValues: { size: 15 } }),
      js({ id: 'j1', configValues: { words: [{ from: 'secret', to: 'word' }] } }),
    ])
  }

  it('keeps the fields of CSS and no values in a share', async () => {
    await withValues()
    const share = await ask({ type: 'export-transforms' })
    const record = share.transforms.find((t: any) => t.id === 'c1')
    expect(record.configFields).toHaveLength(2)
    expect(record.configValues).toBeUndefined()
    expect(JSON.stringify(share)).not.toContain('secret')
  })

  it('keeps neither fields nor values of JavaScript in a share', async () => {
    await withValues()
    const record = (await ask({ type: 'export-transforms' })).transforms.find((t: any) => t.id === 'j1')
    expect(record.code).toBe('')
    expect(record.configFields).toBeUndefined()
    expect(record.configValues).toBeUndefined()
  })

  it('keeps the fields and the values in a backup', async () => {
    await withValues()
    const backup = await ask({ type: 'export-transforms', mode: 'backup' })
    expect(backup.transforms.find((t: any) => t.id === 'c1').configValues).toEqual({ size: 15 })
    const script = backup.transforms.find((t: any) => t.id === 'j1')
    expect(script.configFields).toHaveLength(2)
    expect(script.configValues).toEqual({ words: [{ from: 'secret', to: 'word' }] })
  })
})

describe('import', () => {
  const bundle = (mode: string, ...transforms: object[]) => ({
    format: 'web-alchemist-export',
    schemaVersion: 1,
    exportedAt: 0,
    mode,
    transforms,
  })
  const importedRecord = () => (h.local.get('transforms') as any[])[0]

  it('removes values from a share that carries them and keeps the CSS fields', async () => {
    await boot([])
    await ask({ type: 'import-transforms', bundle: bundle('share', css({ id: 'x', configValues: { size: 15 } })) })
    expect(importedRecord().configFields).toHaveLength(2)
    expect(importedRecord().configValues).toBeUndefined()
  })

  it('removes fields and values from JavaScript in a share', async () => {
    await boot([])
    await ask({
      type: 'import-transforms',
      bundle: bundle('share', js({ id: 'x', configValues: { size: 15 } })),
    })
    expect(importedRecord().configFields).toBeUndefined()
    expect(importedRecord().configValues).toBeUndefined()
  })

  it('keeps valid values from a backup and drops invalid ones', async () => {
    await boot([])
    await ask({
      type: 'import-transforms',
      bundle: bundle('backup', css({ id: 'x', configValues: { size: 15, tint: 'not a colour', nope: 1 } })),
    })
    expect(importedRecord().configValues).toEqual({ size: 15 })
  })

  it('drops an invalid field from a file', async () => {
    await boot([])
    await ask({
      type: 'import-transforms',
      bundle: bundle('share', css({ id: 'x', configFields: [tint, { ...size, key: '__proto__' }, { ...size, default: 99 }] })),
    })
    expect(importedRecord().configFields.map((f: ConfigField) => f.key)).toEqual(['tint'])
  })
})

describe('the separate settings file', () => {
  const file = (values: Record<string, unknown>, fields?: object[]) => ({
    format: 'web-alchemist-settings',
    schemaVersion: 1,
    exportedAt: 0,
    elixir: { name: 'Other' },
    fields: fields ?? Object.keys(values).map((key) => ({ key, type: key === 'size' ? 'number' : 'colour' })),
    values,
  })

  it('writes only the values, with the name and the key and type of each setting', async () => {
    await boot([css({ configValues: { size: 15 } })])
    const out = await ask({ type: 'export-config-values', id: 'c1' })
    expect(out).toMatchObject({
      format: 'web-alchemist-settings',
      elixir: { name: 'Dark' },
      fields: [
        { key: 'tint', type: 'colour' },
        { key: 'size', type: 'number' },
      ],
      values: { tint: '#ffcc00', size: 15 },
    })
    expect(Object.keys(out).sort()).toEqual(['elixir', 'exportedAt', 'fields', 'format', 'schemaVersion', 'values'])
    expect(JSON.stringify(out)).not.toContain('color: red')
  })

  it('applies valid values, ignores unknown keys, skips invalid and mismatched ones, and reports each', async () => {
    await boot([css()])
    const before = stored('c1')
    const result = await ask({
      type: 'import-config-values',
      id: 'c1',
      file: file({ size: 15, tint: 'red', extra: 'x' }),
    })
    expect(result.applied).toEqual(['size'])
    expect(result.skipped.map((s: any) => s.key)).toEqual(['tint'])
    expect(result.unknown).toEqual(['extra'])
    expect(stored('c1').configValues).toEqual({ size: 15 })
    const { configValues: _a, updatedAt: _b, ...restAfter } = stored('c1')
    const { updatedAt: _c, ...restBefore } = before
    expect(restAfter).toEqual(restBefore)

    const mismatch = await ask({
      type: 'import-config-values',
      id: 'c1',
      file: file({ size: 12 }, [{ key: 'size', type: 'text' }]),
    })
    expect(mismatch.applied).toEqual([])
    expect(mismatch.skipped.map((s: any) => s.key)).toEqual(['size'])
    expect(stored('c1').configValues).toEqual({ size: 15 })
  })

  it('never changes code, fields, world, capabilities or match, whatever the file says', async () => {
    await boot([css()])
    const hostile = {
      ...file({ size: 15 }),
      code: 'a { background: url(https://evil.example) }',
      configFields: [],
      world: 'MAIN',
      capabilities: ['network'],
      match: '*://*/*',
    }
    await ask({ type: 'import-config-values', id: 'c1', file: hostile })
    expect(stored('c1')).toMatchObject({ code: 'a { color: red }', match: 'example.com/*', capabilities: [] })
    expect(stored('c1').configFields).toHaveLength(2)
    expect(stored('c1').world).toBeUndefined()
  })

  it('treats a key named __proto__ as an unknown key', async () => {
    await boot([css()])
    const text = JSON.stringify(file({ size: 15 })).replace('"values":{', '"values":{"__proto__":{"polluted":1},')
    const result = await ask({ type: 'import-config-values', id: 'c1', file: JSON.parse(text) })
    expect(result.unknown).toEqual(['__proto__'])
    expect(({} as any).polluted).toBeUndefined()
  })

  it.each([['not an object', 'x'], ['the wrong format', { ...file({}), format: 'other' }], ['no values', { format: 'web-alchemist-settings', schemaVersion: 1 }], ['a newer version', { ...file({}), schemaVersion: 9 }]])(
    'refuses a file with %s',
    async (_name, bad) => {
      await boot([css()])
      expect(await fails({ type: 'import-config-values', id: 'c1', file: bad })).toContain('settings file')
    },
  )

  it('refuses in a private window and for an unknown id', async () => {
    await boot([css()])
    h.privateTabs.add(TAB)
    expect(await fails({ type: 'import-config-values', id: 'c1', file: file({ size: 15 }), tabId: TAB })).toBe(PRIVATE_WINDOW_MESSAGE)
    h.privateTabs.delete(TAB)
    await fails({ type: 'import-config-values', id: 'missing', file: file({ size: 15 }) })
  })
})
