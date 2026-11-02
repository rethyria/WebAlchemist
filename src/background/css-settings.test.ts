/**
 * Settings in CSS. A reference var(--setting-<key>) is replaced with the
 * serialised value before the CSS is checked, and every check and every insert
 * uses that same text. These tests load the real background script and send the
 * messages and navigation events the browser sends.
 *
 * Safety properties checked here: a value cannot smuggle a url() or an @import
 * past the CSS check, the substituted values are strictly serialised, and the
 * text that is checked is the text that is inserted.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { checkCss } from '@safety/css-check'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { ConfigField } from '@shared/types'
import { createHarness, cssTransform, type Harness } from './test-browser'

const TAB = 1
const SHOP = 'https://shop.example.com/cart'

const tint: ConfigField = { key: 'tint', label: 'Tint', type: 'colour', default: '#ffcc00' }
const size: ConfigField = { key: 'size', label: 'Size', type: 'number', default: 10, min: 1, max: 20, unit: 'px' }
const label: ConfigField = { key: 'label', label: 'Label', type: 'text', default: 'hi' }
const mode: ConfigField = {
  key: 'mode',
  label: 'Mode',
  type: 'choice',
  options: [{ value: 'block', label: 'Block' }, { value: 'none', label: 'None' }],
  default: 'block',
}
const words: ConfigField = { key: 'words', label: 'Words', type: 'list', default: ['a'] }

const CSS = 'a { color: var(--setting-tint); width: var(--setting-size); display: var(--setting-mode); } b::after { content: var(--setting-label) }'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const css = (over: Record<string, unknown> = {}): any =>
  cssTransform({
    id: 'c1',
    match: 'shop.example.com/*',
    code: CSS,
    configFields: [tint, size, mode, label],
    ...over,
  })

let h: Harness
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const commit = (url: string) => h.listeners.get('browser.webNavigation.onCommitted')!({ frameId: 0, tabId: TAB, url })
const stored = (id: string) => (h.local.get('transforms') as any[]).find((t) => t.id === id)
const lastInserted = () => h.calls.insertCSS.at(-1)?.css ?? ''

async function start(transforms: object[], settings: object = DEFAULT_SETTINGS) {
  h.local.set('transforms', transforms)
  h.local.set('settings', settings)
  h.tabUrls.set(TAB, SHOP)
  h.origins = ['*://shop.example.com/*']
  h.contentReply = (message) => (message.type === 'ping' ? true : { type: 'health-check-result', states: [] })
  await h.boot()
}
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

beforeEach(() => {
  h = createHarness()
  h.hasUserScripts = true
})

describe('stored CSS with settings, applied on a navigation', () => {
  it('inserts the CSS with the defaults put in', async () => {
    await start([css()])
    await commit(SHOP)
    expect(lastInserted()).toContain('color: #ffcc00; width: 10px; display: block;')
    expect(lastInserted()).toContain('content: "hi"')
    expect(lastInserted()).not.toContain('--setting-')
  })

  it('inserts the CSS with the values the user set, and a default where none is set', async () => {
    await start([css({ configValues: { tint: '#00ff00', size: 12, label: 'Sale' } })])
    await commit(SHOP)
    expect(lastInserted()).toContain('color: #00ff00; width: 12px; display: block;')
    expect(lastInserted()).toContain('content: "Sale"')
  })

  it('uses the default for a stored value that is not valid', async () => {
    await start([css({ configValues: { size: 999, tint: 'red' } })])
    await commit(SHOP)
    expect(lastInserted()).toContain('color: #ffcc00; width: 10px;')
  })

  it('leaves the CSS out, with a reason, when it reads a setting that the fields lack', async () => {
    await start([css({ configFields: [tint] })])
    await commit(SHOP)
    expect(h.calls.insertCSS).toHaveLength(0)
    const states = await ask({ type: 'get-blocked-states', url: SHOP })
    expect(states[0].brokenReason).toMatch(/does not define/)
  })

  it('leaves the CSS out when a reference has a fallback or names a list', async () => {
    await start([css({ code: 'a { color: var(--setting-tint, red) }' }), css({ id: 'c2', code: 'a { content: var(--setting-words) }', configFields: [words] })])
    await commit(SHOP)
    expect(h.calls.insertCSS).toHaveLength(0)
    const states = await ask({ type: 'get-blocked-states', url: SHOP })
    expect(states.map((s: any) => s.id).sort()).toEqual(['c1', 'c2'])
  })

  it('leaves the CSS out when a choice has an option that is not a plain word', async () => {
    const odd = { ...mode, options: [{ value: 'block; x', label: 'A' }, { value: 'none', label: 'B' }], default: 'none' }
    await start([css({ configFields: [tint, size, odd, label] })])
    await commit(SHOP)
    expect(h.calls.insertCSS).toHaveLength(0)
  })
})

describe('a value cannot smuggle an address past the CSS check', () => {
  const hostile = [
    '"; } x { background: url(https://evil.example/t) } y { content: "',
    'url(https://evil.example/t)',
    '); } @import "https://evil.example/x.css"; a { x: (',
    '\\22 ); background: url(https://evil.example/t); content: \\22 ',
    '@import url(https://evil.example/x.css);',
    "'); background: url(//evil.example/t",
  ]

  for (const value of hostile) {
    it(`keeps ${JSON.stringify(value).slice(0, 40)} inside one string, and what is inserted passes the check`, async () => {
      await start([css({ configValues: { label: value } })])
      await commit(SHOP)
      const text = lastInserted()
      expect(text).toContain('content: "')
      // The text that was inserted passes the same check that the page's CSS must pass.
      const result = checkCss(text, { mode: 'block', pageUrl: SHOP })
      expect(result.passed).toBe(true)
      expect(result.externalUrls).toEqual([])
      expect(result.findings).toEqual([])
    })
  }

  it('control: the same text written as CSS code and not as a value is refused', () => {
    const result = checkCss('b::after { content: ""; } x { background: url(https://evil.example/t) } y { content: "" }', { mode: 'block', pageUrl: SHOP })
    expect(result.passed).toBe(false)
  })

  it('refuses a value that becomes an address in a place where CSS reads one', async () => {
    // image-set takes a bare string as an address, so the checked text has an external address.
    const code = 'a { background: image-set(var(--setting-label)) }'
    await start([css({ code, configFields: [label], configValues: { label: 'https://evil.example/t.png' } })])
    await commit(SHOP)
    expect(h.calls.insertCSS).toHaveLength(0)
    const states = await ask({ type: 'get-blocked-states', url: SHOP })
    expect(states).toHaveLength(1)
  })

  it('control: the same CSS with a harmless value is inserted', async () => {
    const code = 'a { background: image-set(var(--setting-label)) }'
    await start([css({ code, configFields: [label], configValues: { label: 'data:image/png;base64,AAAA' } })])
    await commit(SHOP)
    expect(lastInserted()).toContain('image-set("data:image/png;base64,AAAA")')
  })

  it('also checks the whole joined text, so one elixir cannot complete another', async () => {
    // The value ends a comment that the first elixir opens. The text of each
    // elixir is one string, so nothing is joined across them.
    await start([
      css({ id: 'c1', code: 'a { content: var(--setting-label) }', configFields: [label], configValues: { label: '*/ url(https://evil.example/t) /*' } }),
      css({ id: 'c2', code: 'b { color: red }', configFields: [] }),
    ])
    await commit(SHOP)
    const text = lastInserted()
    expect(checkCss(text, { mode: 'block', pageUrl: SHOP }).passed).toBe(true)
  })
})

describe('what is serialised', () => {
  it('writes a number without an exponent and with its unit, a colour as lowercase hex and a choice as a word', async () => {
    const tiny: ConfigField = { key: 'tiny', label: 'Tiny', type: 'number', default: 0.0000001, unit: 'em' }
    await start([css({ code: 'a { margin: var(--setting-tiny); color: var(--setting-tint); display: var(--setting-mode) }', configFields: [tiny, tint, mode], configValues: { tint: '#ABCDEF', mode: 'none' } })])
    await commit(SHOP)
    expect(lastInserted()).toContain('margin: 0.0000001em; color: #abcdef; display: none')
  })

  it('escapes the quote, the backslash and a line break in text', async () => {
    await start([css({ configValues: { label: 'a"b\\c' } })])
    await commit(SHOP)
    expect(lastInserted()).toContain('content: "a\\22 b\\5c c"')
  })
})

describe('the text that is checked is the text that is inserted', () => {
  it('uses the same effective text when saving, applying, previewing and analysing', async () => {
    await start([])
    const draft = css({ id: 'new1', configValues: { label: 'Sale' } })
    // Analysis of a draft: the defaults, since nothing is stored for this id.
    const analysis = await ask({ type: 'analyse-css', css: CSS, match: 'shop.example.com/*', tabId: TAB, configFields: draft.configFields, transformId: 'new1' })
    expect(analysis.passed).toBe(true)
    // Preview: the defaults too, and never the values that came in the message.
    await ask({ type: 'preview-css', tabId: TAB, css: CSS, configFields: draft.configFields, transformId: 'new1', configValues: { label: 'FROM-MESSAGE' } })
    expect(lastInserted()).toContain('content: "hi"')
    expect(lastInserted()).not.toContain('FROM-MESSAGE')
    await ask({ type: 'clear-preview-css', tabId: TAB, css: '' })
    // Saving, then applying.
    await ask({ type: 'save-transform', transform: draft, tabId: TAB })
    expect(stored('new1').configValues).toBeUndefined()
    expect(lastInserted()).toContain('content: "hi"')
  })

  it('checks a save with the stored values, not with the values in the message', async () => {
    const code = 'a { background: image-set(var(--setting-label)) }'
    await start([css({ code, configFields: [label], configValues: { label: 'data:image/png;base64,AAAA' } })])
    // The message carries a value that would fail the check. It is not used.
    await ask({ type: 'save-transform', transform: css({ code, configFields: [label], name: 'Renamed', configValues: { label: 'https://evil.example/t.png' } }), tabId: TAB })
    expect(stored('c1').name).toBe('Renamed')
    expect(stored('c1').configValues).toEqual({ label: 'data:image/png;base64,AAAA' })
  })

  it('refuses a save of changed CSS that would put a stored value where an address is read', async () => {
    // The stored value is harmless in the stored code. The new code reads it as an address.
    await start([css({ code: 'a { content: var(--setting-label) }', configFields: [label], configValues: { label: 'https://evil.example/t.png' } })])
    const message = await fails({
      type: 'save-transform',
      transform: css({ code: 'a { background: image-set(var(--setting-label)) }', configFields: [label] }),
      tabId: TAB,
    })
    expect(message.length).toBeGreaterThan(0)
    expect(stored('c1').code).toBe('a { content: var(--setting-label) }')
  })

  it('refuses a save of CSS that reads an unknown setting, has a fallback, or names a list', async () => {
    await start([])
    for (const code of ['a { color: var(--setting-nope) }', 'a { color: var(--setting-tint, red) }', 'a { content: var(--setting-words) }']) {
      const message = await fails({ type: 'save-transform', transform: css({ id: 'x', code, configFields: [tint, words] }), tabId: TAB })
      expect(message.length).toBeGreaterThan(0)
    }
    expect(stored('x')).toBeUndefined()
  })

  it('refuses a draft whose CSS reads an unknown setting at analysis and preview', async () => {
    await start([])
    const analysis = await ask({ type: 'analyse-css', css: 'a { color: var(--setting-nope) }', match: 'shop.example.com/*', tabId: TAB, configFields: [tint], transformId: 'n' })
    expect(analysis.passed).toBe(false)
    expect(analysis.static.some((f: any) => f.severity === 'block')).toBe(true)
    await fails({ type: 'preview-css', tabId: TAB, css: 'a { color: var(--setting-nope) }', configFields: [tint], transformId: 'n' })
    expect(h.calls.insertCSS).toHaveLength(0)
  })

  it('previews with the stored values of a saved elixir', async () => {
    await start([css({ configValues: { label: 'Stored' } })])
    await ask({ type: 'preview-css', tabId: TAB, css: CSS, configFields: css().configFields, transformId: 'c1' })
    expect(lastInserted()).toContain('content: "Stored"')
  })
})

describe('a change of values for CSS', () => {
  it('takes the old CSS off and puts the new CSS on at once, with no reload', async () => {
    await start([css()])
    await commit(SHOP)
    h.calls.insertCSS.length = 0
    h.calls.removeCSS.length = 0
    const result = await ask({ type: 'set-config-values', id: 'c1', values: { tint: '#00ff00' }, tabId: TAB })
    expect(result.reloadTabs).toBe(0)
    expect(h.calls.removeCSS.at(-1)?.css).toContain('color: #ffcc00')
    expect(lastInserted()).toContain('color: #00ff00')
  })

  it('refuses a value for which the CSS would not pass the check, and stores nothing', async () => {
    await start([css({ code: 'a { background: image-set(var(--setting-label)) }', configFields: [label], configValues: { label: 'data:image/png;base64,AAAA' } })])
    const message = await fails({ type: 'set-config-values', id: 'c1', values: { label: 'https://evil.example/t.png' }, tabId: TAB })
    expect(message).toMatch(/would not pass the check/)
    expect(stored('c1').configValues).toEqual({ label: 'data:image/png;base64,AAAA' })
  })

  it('refuses the same value through a settings file', async () => {
    await start([css({ code: 'a { background: image-set(var(--setting-label)) }', configFields: [label] })])
    const file = { format: 'web-alchemist-settings', schemaVersion: 1, exportedAt: 0, elixir: { name: 'x' }, fields: [{ key: 'label', type: 'text' }], values: { label: 'https://evil.example/t.png' } }
    await fails({ type: 'import-config-values', id: 'c1', file, tabId: TAB })
    expect(stored('c1').configValues).toBeUndefined()
  })
})

describe('import of CSS with settings', () => {
  const bundle = (mode: string, ...transforms: object[]) => ({ format: 'web-alchemist-export', schemaVersion: 1, exportedAt: 0, mode, transforms })

  it('imports CSS with its fields from a share and applies the defaults once it is turned on', async () => {
    await start([])
    await ask({ type: 'import-transforms', bundle: bundle('share', css({ id: 'x', configValues: { label: 'secret' } })) })
    const record = (h.local.get('transforms') as any[])[0]
    expect(record.code).toBe(CSS)
    expect(record.configFields).toHaveLength(4)
    expect(record.configValues).toBeUndefined()
  })

  it('does not import CSS that reads a setting the file does not define', async () => {
    await start([])
    await ask({ type: 'import-transforms', bundle: bundle('share', css({ id: 'x', configFields: [tint] })) })
    const record = (h.local.get('transforms') as any[])[0]
    expect(record.code).toBe('')
  })

  it('does not import CSS whose fields are invalid', async () => {
    await start([])
    await ask({ type: 'import-transforms', bundle: bundle('share', css({ id: 'x', configFields: [{ ...tint, key: '__proto__' }, size, mode, label] })) })
    expect((h.local.get('transforms') as any[])[0].code).toBe('')
  })

  it('checks a backup with the values it carries, and drops CSS that fails with them', async () => {
    await start([])
    const code = 'a { background: image-set(var(--setting-label)) }'
    await ask({ type: 'import-transforms', bundle: bundle('backup', css({ id: 'x', code, configFields: [label], configValues: { label: 'https://evil.example/t.png' } })) })
    expect((h.local.get('transforms') as any[])[0].code).toBe('')
  })
})
