/**
 * Lays out the code of an elixir for a person to read: one statement or
 * declaration per line and 2-space indentation. It changes whitespace only, and
 * keeps comments, strings, template literals and regular expression literals.
 *
 * The formatter is js-beautify, which runs in the browser without eval and
 * without the network. It is applied to what a model wrote, before any check,
 * so that the text that is checked, reviewed, approved and run is the same
 * text, and to the text in the editor only when the user asks.
 */
import jsBeautify from 'js-beautify/js/lib/beautify.js'
import cssBeautify from 'js-beautify/js/lib/beautify-css.js'

export type CodeKind = 'css' | 'js'

const COMMON = {
  indent_size: 2,
  indent_char: ' ',
  eol: '\n',
  end_with_newline: false,
}

/**
 * Returns the code laid out for reading. When the formatter throws or returns
 * nothing for code that is not empty, the code is returned as it was given.
 */
export function formatCode(code: string, kind: CodeKind): string {
  if (code.trim() === '') return code
  try {
    const formatted =
      kind === 'css'
        ? cssBeautify.css_beautify(code, { ...COMMON, newline_between_rules: true })
        : jsBeautify.js_beautify(code, {
            ...COMMON,
            preserve_newlines: true,
            max_preserve_newlines: 2,
            brace_style: 'collapse',
            wrap_line_length: 0,
          })
    return formatted.trim() === '' ? code : formatted
  } catch {
    return code
  }
}

/**
 * The generation result with its code laid out for reading. This is applied
 * once, where a result leaves the model provider, before the static analysis,
 * the CSS check, the automatic code check and the approval token see the code.
 */
export function formatGeneration<T extends { kind: CodeKind; code: string }>(result: T): T {
  // A provider's answer is parsed from the model's JSON and can lack the field.
  // A question from the model has no code to lay out.
  if (typeof result.code !== 'string' || result.code === '') return result
  const code = formatCode(result.code, result.kind)
  return code === result.code ? result : { ...result, code }
}
