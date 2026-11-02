/**
 * The settings form, rendered to HTML with Svelte's server renderer. What a
 * click does is covered by config-draft.test.ts, which holds the rules the
 * form follows.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import ConfigForm from './ConfigForm.svelte'
import type { ConfigField } from './types'

const fields: ConfigField[] = [
  { key: 'label', label: 'Label', help: 'Shown in the title.', type: 'text', default: 'Hello' },
  { key: 'size', label: 'Size', type: 'number', default: 10, min: 1, max: 20, unit: 'px' },
  { key: 'on', label: 'Turn it on', type: 'yes-no', default: true },
  { key: 'mode', label: 'Mode', type: 'choice', options: [{ value: 'a', label: 'Dark' }, { value: 'b', label: 'Light' }], default: 'a' },
  { key: 'tint', label: 'Tint', type: 'colour', default: '#ffcc00' },
  { key: 'list', label: 'Names', type: 'list', default: ['one', 'two'] },
  {
    key: 'words',
    label: 'Words to replace',
    type: 'table',
    columns: [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }],
    default: [{ from: "y'all", to: 'you' }],
  },
]

function html(props: Record<string, unknown> = {}) {
  const noop = () => {}
  return render(ConfigForm as any, {
    props: { fields, values: Object.fromEntries(fields.map((f) => [f.key, f.default])), onsave: noop, oncancel: noop, ...props },
  }).body.replace(/<!--.*?-->/g, '')
}

describe('the settings form', () => {
  it('has one control for each kind of setting', () => {
    const body = html()
    expect(body).toContain('type="text"')
    expect(body).toContain('type="number"')
    expect(body).toContain('type="checkbox"')
    expect(body).toContain('<select')
    expect(body).toContain('type="color"')
    expect(body).toContain('value="#ffcc00"')
    expect(body).toContain('From 1px to 20px')
  })

  it('shows the lines of a list and the rows of a table with their column labels, and the buttons to change them', () => {
    const body = html()
    expect(body).toContain('value="one"')
    expect(body).toContain('value="two"')
    expect(body).toContain('aria-label="Remove item 1 of Names"')
    expect(body).toContain('Add item')
    expect(body).toContain('>From<')
    expect(body).toContain('>To<')
    expect(body).toContain('aria-label="From, row 1 of Words to replace"')
    expect(body).toContain('aria-label="Remove row 1 of Words to replace"')
    expect(body).toContain('Add row')
  })

  it('shows the help line, and Save, Cancel and Reset to defaults', () => {
    const body = html()
    expect(body).toContain('Shown in the title.')
    expect(body).toContain('Save settings')
    expect(body).toContain('Cancel')
    expect(body).toContain('Reset to defaults')
  })

  it('leaves out Cancel where there is nothing to close', () => {
    expect(html({ oncancel: undefined })).not.toContain('Cancel')
  })

  it('shows the user values and not the defaults where a value is set', () => {
    const body = html({ values: { label: 'Mine', size: 12 } , fields: fields.slice(0, 2) })
    expect(body).toContain('value="Mine"')
    expect(body).toContain('value="12"')
  })

  it('shows a plain message next to a value that is not valid, and disables Save', () => {
    const body = html({ values: { label: 'x', size: 99 }, fields: fields.slice(0, 2) })
    expect(body).toContain('The number must be at most 20.')
    expect(body).toMatch(/<button[^>]*disabled[^>]*>Save settings/)
  })

  it('does not show a problem for valid values and enables Save (control)', () => {
    const body = html()
    expect(body).not.toContain('role="alert"')
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*>Save settings/)
  })

  it('renders labels, help texts and defaults written by a model as plain text', () => {
    const hostile: ConfigField[] = [
      { key: 'a', label: '<script>alert(1)</script>', help: '<img src=x onerror=alert(2)>', type: 'text', default: '"><b>x</b>' },
    ]
    const body = html({ fields: hostile, values: {} })
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('<img src=x')
    expect(body).not.toContain('<b>x</b>')
    // The renderer escapes the opening angle bracket, which is what ends a tag.
    expect(body).toContain('&lt;script>alert(1)&lt;/script>')
  })
})
