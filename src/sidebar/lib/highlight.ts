/**
 * Minimal tokeniser for the code the panel displays.
 *
 * This exists to make generated code scannable, not to be a syntax engine.
 * The one thing it must never do is change the text: every token's `text`
 * concatenates back to the exact input, because this is the code the user is
 * being asked to approve and a highlighter that drops a character would be
 * showing them something other than what runs.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'selector'
  | 'property'
  | 'value'
  | 'keyword'
  | 'string'
  | 'number'

export interface Token {
  text: string
  kind: TokenKind
}

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'yield',
  'null', 'true', 'false', 'undefined',
])

export function highlight(code: string, kind: 'css' | 'js'): Token[] {
  const tokens = kind === 'css' ? tokeniseCss(code) : tokeniseJs(code)
  return merge(tokens)
}

function tokeniseCss(code: string): Token[] {
  const out: Token[] = []
  let index = 0
  let depth = 0

  while (index < code.length) {
    const rest = code.slice(index)

    const comment = /^\/\*[\s\S]*?(\*\/|$)/.exec(rest)
    if (comment) {
      out.push({ text: comment[0], kind: 'comment' })
      index += comment[0].length
      continue
    }

    const char = code[index] as string
    if (char === '{') {
      depth += 1
      out.push({ text: char, kind: 'plain' })
      index += 1
      continue
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1)
      out.push({ text: char, kind: 'plain' })
      index += 1
      continue
    }

    if (depth === 0) {
      // Everything up to the next brace or comment is a selector.
      const selector = /^[^{}]+?(?=\/\*|[{}]|$)/.exec(rest)
      if (selector) {
        out.push({ text: selector[0], kind: 'selector' })
        index += selector[0].length
        continue
      }
    } else {
      const property = /^(\s*)([-\w]+)(\s*:)/.exec(rest)
      if (property) {
        out.push({ text: property[1] as string, kind: 'plain' })
        out.push({ text: property[2] as string, kind: 'property' })
        out.push({ text: property[3] as string, kind: 'plain' })
        index += property[0].length
        continue
      }
      const value = /^[^;{}]+/.exec(rest)
      if (value) {
        out.push({ text: value[0], kind: 'value' })
        index += value[0].length
        continue
      }
    }

    out.push({ text: char, kind: 'plain' })
    index += 1
  }

  return out
}

function tokeniseJs(code: string): Token[] {
  const out: Token[] = []
  let index = 0

  while (index < code.length) {
    const rest = code.slice(index)

    const comment = /^(\/\/[^\n]*|\/\*[\s\S]*?(\*\/|$))/.exec(rest)
    if (comment) {
      out.push({ text: comment[0], kind: 'comment' })
      index += comment[0].length
      continue
    }

    const string = /^('(\\.|[^'\\])*'?|"(\\.|[^"\\])*"?|`(\\.|[^`\\])*`?)/.exec(rest)
    if (string?.[0]) {
      out.push({ text: string[0], kind: 'string' })
      index += string[0].length
      continue
    }

    const number = /^\d+(\.\d+)?/.exec(rest)
    if (number) {
      out.push({ text: number[0], kind: 'number' })
      index += number[0].length
      continue
    }

    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word) {
      out.push({
        text: word[0],
        kind: JS_KEYWORDS.has(word[0]) ? 'keyword' : 'plain',
      })
      index += word[0].length
      continue
    }

    out.push({ text: code[index] as string, kind: 'plain' })
    index += 1
  }

  return out
}

/** Collapses runs of the same kind so the DOM stays small. */
function merge(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const token of tokens) {
    if (!token.text) continue
    const last = out[out.length - 1]
    if (last && last.kind === token.kind) last.text += token.text
    else out.push({ ...token })
  }
  return out
}
