/**
 * Extracts what the model needs to write a working transform.
 *
 * Raw markup alone is not enough. To produce CSS that actually wins, the model
 * needs the computed styles it is overriding, the author rules that currently
 * match with their specificity, and the custom properties in scope — otherwise
 * it emits rules that are silently outranked and look like model errors.
 */

import type { ElementContext, PageContext } from '@shared/types'
import { ADDRESS_PLACEHOLDER, mustRemovePart } from '@shared/address-policy'

/** Properties that matter for layout and appearance decisions. */
const RELEVANT_PROPERTIES = [
  'display',
  'position',
  'width',
  'height',
  'max-width',
  'margin',
  'padding',
  'flex',
  'flex-direction',
  'grid-template-columns',
  'grid-area',
  'order',
  'color',
  'background-color',
  'font-size',
  'font-family',
  'line-height',
  'border',
  'border-radius',
  'overflow',
  'z-index',
  'opacity',
  'visibility',
]

const MAX_SUBTREE_NODES = 40
const MAX_SUBTREE_DEPTH = 4
const MAX_TEXT_LENGTH = 80
const MAX_ANCESTORS = 4

/*
 * Custom property names and values, and the declaration text of matching rules,
 * are free-form strings the page author chooses. Measuring the extraction
 * against a hostile fixture (`test/injection/`) showed both reach the model
 * verbatim, and neither had any bound on count or length — a page could put an
 * arbitrary amount of arbitrary text into the payload just by declaring it.
 *
 * The markup excerpt was already capped three ways. These are the same idea
 * applied to the channels that were missed.
 */
const MAX_CUSTOM_PROPERTIES = 64
const MAX_CUSTOM_PROPERTY_LENGTH = 120
const MAX_DECLARATION_LENGTH = 400

/**
 * One element on its own, without the page-level parts.
 *
 * Split out so a reference pick can describe an element without dragging a
 * second copy of the URL, ancestor chain and custom properties along with it —
 * those belong to the page, and the page is the same one.
 */
export function extractElementContext(element: Element, selector: string): ElementContext {
  return {
    selector,
    tag: element.tagName.toLowerCase(),
    outerHTMLExcerpt: summariseSubtree(element),
    computedStyles: relevantStyles(element),
    matchedRules: matchedAuthorRules(element),
  }
}

/** Stands in for every query value, so the model sees the keys and no values. */
export const QUERY_VALUE_PLACEHOLDER = ADDRESS_PLACEHOLDER

/** Decodes a query key; a malformed escape leaves the text as it was. */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/**
 * The address that is sent to the model provider.
 *
 * For http and https it keeps the origin, the path and the query keys, and
 * removes everything else the page address can carry a secret in:
 *
 *  - the fragment, user name and password;
 *  - every query value;
 *  - a query part with no "=", because a bare string such as `?eyJ...` is
 *    itself the token, and sending it as a key would send the token;
 *  - a query key, or a path segment, longer than 32 characters or that looks
 *    like a token (see `looksLikeToken`);
 *  - path parameters (`;jsessionid=...`), which are session identifiers that
 *    some servers put in the path.
 *
 * Every other scheme (file, blob, data, about, ftp, extension pages) sends the
 * scheme alone. Their paths are local file names or random identifiers, and a
 * blob address embeds another origin that would print as a garbled string.
 *
 * Keys are kept because they show how the page is structured (`?tab=` or
 * `?page=`). The panel shows this exact string, with a note built from the same
 * limits (`ADDRESS_REMOVAL_NOTE`), so what the user reads is what leaves the
 * browser.
 */
export function addressForModel(href: string): string {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol

  const path = url.pathname
    .split('/')
    .map((segment) => {
      const withoutParameters = segment.split(';')[0] ?? ''
      return mustRemovePart(withoutParameters) ? ADDRESS_PLACEHOLDER : withoutParameters
    })
    .join('/')

  const keys = new Set<string>()
  for (const part of url.search.replace(/^\?/, '').split('&')) {
    const equals = part.indexOf('=')
    if (equals < 0) continue
    const key = decodeKey(part.slice(0, equals))
    if (key && !mustRemovePart(key)) keys.add(key)
  }
  const query = keys.size
    ? `?${[...keys].map((key) => `${encodeURIComponent(key)}=${QUERY_VALUE_PLACEHOLDER}`).join('&')}`
    : ''
  return `${url.origin}${path}${query}`
}

export function extractContext(element: Element, selector: string): PageContext {
  return {
    url: addressForModel(location.href),
    target: extractElementContext(element, selector),
    ancestors: ancestorChain(element),
    customProperties: customPropertiesInScope(element),
  }
}

function relevantStyles(element: Element): Record<string, string> {
  const computed = getComputedStyle(element)
  const styles: Record<string, string> = {}
  for (const property of RELEVANT_PROPERTIES) {
    const value = computed.getPropertyValue(property)
    if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
      styles[property] = value.trim()
    }
  }
  return styles
}

function ancestorChain(element: Element): PageContext['ancestors'] {
  const chain: PageContext['ancestors'] = []
  let current = element.parentElement
  let depth = 0

  while (current && current !== document.documentElement && depth < MAX_ANCESTORS) {
    chain.push({
      selector: describeElement(current),
      tag: current.tagName.toLowerCase(),
      computedStyles: relevantStyles(current),
    })
    current = current.parentElement
    depth += 1
  }

  return chain
}

/**
 * Author rules that match the target, with specificity, ordered least to most
 * specific. This is what tells the model what it has to beat.
 */
function matchedAuthorRules(element: Element): PageContext['target']['matchedRules'] {
  const matched: PageContext['target']['matchedRules'] = []

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      // Cross-origin stylesheet; its rules are not readable. The model still
      // sees the resulting computed styles.
      continue
    }

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      try {
        if (!element.matches(rule.selectorText)) continue
      } catch {
        continue
      }
      matched.push({
        selector: rule.selectorText,
        specificity: formatSpecificity(rule.selectorText),
        declarations: truncate(rule.style.cssText, MAX_DECLARATION_LENGTH),
      })
    }
  }

  return matched
    .sort((a, b) => a.specificity.localeCompare(b.specificity))
    .slice(-12)
}

/** Approximate (id, class, type) specificity. Good enough to rank rules. */
function formatSpecificity(selector: string): string {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(?!\()/g) ?? []).length
  const types = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return `${ids},${classes},${types}`
}

function customPropertiesInScope(element: Element): Record<string, string> {
  const computed = getComputedStyle(element)
  const properties: Record<string, string> = {}
  let count = 0

  // computedStyleMap is not available everywhere; walk declared sheets instead.
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      for (const property of Array.from(rule.style)) {
        if (!property.startsWith('--')) continue
        if (count >= MAX_CUSTOM_PROPERTIES) return properties
        const value = computed.getPropertyValue(property).trim()
        if (!value) continue
        if (!(property in properties)) count += 1
        properties[property] = truncate(value, MAX_CUSTOM_PROPERTY_LENGTH)
      }
    }
  }

  return properties
}

/**
 * Marks a cut rather than making one silently.
 *
 * A value that stops mid-word reads to the model as the whole value, and it
 * will write a rule against the truncated form. The ellipsis is what tells it
 * something was removed.
 */
function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/**
 * Bounded rendering of the target's subtree. Depth- and node-capped, with text
 * truncated, so a large region cannot blow the context window.
 */
export function summariseSubtree(element: Element): string {
  let budget = MAX_SUBTREE_NODES

  const render = (node: Element, depth: number): string => {
    if (budget <= 0) return ''
    budget -= 1

    const indent = '  '.repeat(depth)
    const open = describeElement(node)

    if (depth >= MAX_SUBTREE_DEPTH) {
      const count = node.children.length
      return count > 0
        ? `${indent}<${open}> … ${count} more element${count === 1 ? '' : 's'} …`
        : `${indent}<${open}>`
    }

    const children = Array.from(node.children)
    if (children.length === 0) {
      const text = (node.textContent ?? '').trim().slice(0, MAX_TEXT_LENGTH)
      return text ? `${indent}<${open}>${text}` : `${indent}<${open}>`
    }

    const rendered = children
      .map((child) => render(child, depth + 1))
      .filter(Boolean)
      .join('\n')
    return `${indent}<${open}>\n${rendered}`
  }

  const output = render(element, 0)
  return budget <= 0 ? `${output}\n… truncated …` : output
}

/** Short human- and model-readable description of an element. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const role = element.getAttribute('role')
  const classes = Array.from(element.classList).slice(0, 3)
  const classPart = classes.length > 0 ? `.${classes.join('.')}` : ''
  const rolePart = role ? `[role=${role}]` : ''
  return `${tag}${id}${classPart}${rolePart}`
}
