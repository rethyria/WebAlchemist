/**
 * The "Format code" button of the editor page. There is no browser here, so
 * these read the sources: they cover that the button exists, that it uses the
 * shared formatter with the kind of the elixir, and that the text goes in as an
 * edit of the textarea, which keeps Ctrl+Z working. What a click does in a
 * browser was not run.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EN_CATALOGUE } from '@shared/catalogue'

const app = readFileSync(new URL('./App.svelte', import.meta.url), 'utf8')
const area = readFileSync(new URL('./CodeArea.svelte', import.meta.url), 'utf8')

describe('the Format code button', () => {
  it('has the text "Format code" and is an ordinary secondary button', () => {
    expect(EN_CATALOGUE.edFormatCode.message).toBe('Format code')
    expect(app).toMatch(/<button type="button" class="secondary" onclick=\{formatEditorCode\}>\{t\('edFormatCode'\)\}<\/button>/)
  })

  it('formats the current text for the kind of the elixir', () => {
    expect(app).toContain("import { formatCode } from '@shared/format-code'")
    expect(app).toMatch(/codeArea\?\.replaceAll\(formatCode\(code, language\)\)/)
    expect(app).toMatch(/const language = creating \|\| !transform \? kind : transform\.kind/)
  })

  it('replaces the text as an edit of the textarea so that it can be undone', () => {
    const body = area.slice(area.indexOf('export function replaceAll'), area.indexOf('function sync'))
    expect(body).toContain("document.execCommand('insertText', false, text)")
    expect(body).toContain('setRangeText')
  })

  it('does not format by itself when the text is typed or loaded', () => {
    expect(app.match(/formatCode\(/g)).toHaveLength(1)
  })
})
