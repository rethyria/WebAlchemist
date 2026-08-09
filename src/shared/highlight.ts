/**
 * Syntax colouring for the transform editor.
 *
 * Written rather than pulled in. A real parser is the wrong tool here twice
 * over: code being typed is invalid most of the time, and acorn — which this
 * project already depends on for static analysis — throws at the first token
 * it cannot read, so a live editor would lose its colours mid-word. This
 * scans instead, and the worst it can do on input it misreads is colour
 * something wrongly, which is what a highlighter should do when unsure.
 *
 * It is not a lexer either, and should not be treated as one. Nothing
 * security-relevant may be built on what it returns; the analysis that decides
 * whether code may be saved reads the real AST, in safety/, and always will.
 */

export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'property'
  | 'selector'
  | 'punctuation'
  | 'text'

export interface Token {
  text: string
  kind: TokenKind
}

const JS_KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null',
  'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

/*
 * Ordered: whichever alternative matches at the current position wins, so
 * comments and strings come before anything that could appear inside one.
 * Every branch is anchored with `y`, so scanning is linear and cannot skip
 * input — anything unmatched is emitted verbatim as `text`.
 */
const JS_PATTERNS: [TokenKind, RegExp][] = [
  ['comment', /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/y],
  ['string', /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?/y],
  ['number', /0[xX][0-9a-fA-F]+n?|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?n?|\.\d+/y],
  ['keyword', /[A-Za-z_$][\w$]*/y],
  ['punctuation', /[{}()[\];,.:?=+\-*/%<>!&|^~]+/y],
]

const CSS_PATTERNS: [TokenKind, RegExp][] = [
  ['comment', /\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/y],
  ['keyword', /@[\w-]+|!important/y],
  ['number', /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|[a-z]{1,4})?|#[0-9a-fA-F]{3,8}\b/y],
  ['punctuation', /[{}();:,>~+*]/y],
]

/**
 * Splits `code` into coloured runs. Concatenating every `text` returns the
 * input exactly — the editor lays this under a transparent textarea, so a
 * single dropped or added character would visibly misalign the two.
 */
export function highlight(code: string, kind: 'css' | 'js'): Token[] {
  const patterns = kind === 'js' ? JS_PATTERNS : CSS_PATTERNS
  const tokens: Token[] = []
  let plain = ''

  const flush = (): void => {
    if (plain) tokens.push({ text: plain, kind: 'text' })
    plain = ''
  }

  /*
   * CSS colours the same identifier differently either side of a colon, and
   * has no keyword to tell them apart — `color` is a property in one place and
   * a value in another. Depth tracks whether we are inside a rule at all, so
   * text outside one can be coloured as a selector.
   */
  let inBlock = false
  let afterColon = false

  let at = 0
  while (at < code.length) {
    let matched = false

    for (const [tokenKind, pattern] of patterns) {
      pattern.lastIndex = at
      const found = pattern.exec(code)
      if (!found || found[0].length === 0) continue

      const text = found[0]
      let resolved: TokenKind = tokenKind

      if (kind === 'js' && tokenKind === 'keyword' && !JS_KEYWORDS.has(text)) {
        resolved = 'text'
      }
      if (kind === 'css' && tokenKind === 'punctuation') {
        if (text === '{') {
          inBlock = true
          afterColon = false
        } else if (text === '}') {
          inBlock = false
          afterColon = false
        } else if (text === ':') {
          afterColon = true
        } else if (text === ';') {
          afterColon = false
        }
      }

      flush()
      tokens.push({ text, kind: resolved })
      at += text.length
      matched = true
      break
    }

    if (matched) continue

    /*
     * CSS identifiers and selectors are whatever is left. Which of the two
     * depends on where we are: inside a block before a colon it names a
     * property, outside a block it is part of a selector.
     */
    if (kind === 'css') {
      const word = /[^\s{}();:,"'/@!]+/y
      word.lastIndex = at
      const found = word.exec(code)
      if (found && found[0].length > 0) {
        flush()
        tokens.push({
          text: found[0],
          kind: inBlock ? (afterColon ? 'text' : 'property') : 'selector',
        })
        at += found[0].length
        continue
      }
    }

    plain += code[at]
    at += 1
  }

  flush()
  return tokens
}
