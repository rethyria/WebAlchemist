/**
 * Just enough CSS parsing to say what a transform sets, and where.
 *
 * This is not a CSS parser in the general sense and does not try to be. It
 * answers one question — which properties does this stylesheet set, under
 * which selectors — because that is what deciding whether two transforms
 * collide requires. Anything it cannot read it drops rather than guesses at,
 * since a missed conflict is a transform that quietly loses, while an
 * invented one is a warning about nothing.
 *
 * What it handles: comments, at-rules that contain ordinary rules (`@media`,
 * `@supports`, `@layer`), selector lists, `!important`, and declarations
 * whose values contain braces, colons or semicolons inside strings, comments
 * or parentheses — `content: ";"` and `background: url(a;b)` both appear in
 * real stylesheets and both break a naive split.
 *
 * What it drops: `@keyframes` and `@font-face`, whose inner blocks are not
 * element rules at all, so their "selectors" would be nonsense to compare.
 */

export interface Declaration {
  /** Lower-cased property name, e.g. `background-color`. */
  property: string
  /** `!important` changes which of two rules actually wins. */
  important: boolean
}

export interface Rule {
  /** The selector list, split and trimmed: `a, b` becomes two entries. */
  selectors: string[]
  declarations: Declaration[]
}

/** At-rules whose bodies are declarations or frames, not element rules. */
const NOT_ELEMENT_RULES = /^@(keyframes|-\w+-keyframes|font-face|counter-style|property|page)\b/i

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * Splits a declaration block on top-level semicolons.
 *
 * Top-level meaning outside quotes and parentheses, so `url(data:image/svg+xml;base64,…)`
 * survives as one declaration instead of becoming two broken halves.
 */
function splitDeclarations(block: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0

  for (let i = 0; i < block.length; i += 1) {
    const c = block[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth += 1
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) {
      out.push(block.slice(start, i))
      start = i + 1
    }
  }
  out.push(block.slice(start))
  return out
}

function parseDeclarations(block: string): Declaration[] {
  const declarations: Declaration[] = []

  for (const piece of splitDeclarations(block)) {
    const text = piece.trim()
    if (!text) continue

    // The *first* colon separates name from value; later ones belong to the
    // value, as in `background: url(http://…)`.
    const colon = text.indexOf(':')
    if (colon <= 0) continue

    const property = text.slice(0, colon).trim().toLowerCase()
    // A property name is an identifier, possibly a custom one. Anything else
    // is a fragment of something this parser misread, and is dropped.
    if (!/^(--)?[a-z][a-z0-9-]*$/.test(property)) continue

    declarations.push({
      property,
      important: /!\s*important\s*$/i.test(text.slice(colon + 1).trim()),
    })
  }

  return declarations
}

function splitSelectors(prelude: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0

  for (let i = 0; i < prelude.length; i += 1) {
    const c = prelude[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    // Commas inside :is(), :not() and attribute selectors are not separators.
    else if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      out.push(prelude.slice(start, i))
      start = i + 1
    }
  }
  out.push(prelude.slice(start))

  return out.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

/**
 * Every rule in a stylesheet, with at-rule nesting flattened away.
 *
 * A rule inside `@media` is still a rule that sets properties on elements;
 * whether the media query is currently matching is a question for the page,
 * not for this.
 */
export function parseRules(css: string): Rule[] {
  const text = stripComments(css)
  const rules: Rule[] = []

  let i = 0
  const parseBlock = (end: number): void => {
    let prelude = ''

    while (i < end) {
      const c = text[i]

      if (c === '{') {
        const open = i
        let depth = 1
        let j = i + 1
        let quote: string | null = null
        for (; j < end && depth > 0; j += 1) {
          const d = text[j]
          if (quote) {
            if (d === '\\') j += 1
            else if (d === quote) quote = null
            continue
          }
          if (d === '"' || d === "'") quote = d
          else if (d === '{') depth += 1
          else if (d === '}') depth -= 1
        }
        const close = j - 1
        const head = prelude.trim()
        prelude = ''
        i = j

        if (head.startsWith('@')) {
          if (NOT_ELEMENT_RULES.test(head)) continue
          // An at-rule that wraps ordinary rules: descend and keep going.
          const save = i
          i = open + 1
          parseBlock(close)
          i = save
          continue
        }

        if (!head) continue
        const declarations = parseDeclarations(text.slice(open + 1, close))
        if (declarations.length > 0) {
          rules.push({ selectors: splitSelectors(head), declarations })
        }
        continue
      }

      if (c === ';' && prelude.trim().startsWith('@')) {
        // A statement at-rule, e.g. `@import url(…);` — nothing to compare.
        prelude = ''
        i += 1
        continue
      }

      prelude += c
      i += 1
    }
  }

  parseBlock(text.length)
  return rules
}

/** Every property a stylesheet sets anywhere, for a quick pre-filter. */
export function propertiesIn(css: string): Set<string> {
  const properties = new Set<string>()
  for (const rule of parseRules(css)) {
    for (const declaration of rule.declarations) properties.add(declaration.property)
  }
  return properties
}
