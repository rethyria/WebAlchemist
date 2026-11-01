import type { MessageKey } from './catalogue'
import type { CatalogueEntry } from './catalogue/define'

export type { MessageKey }

/**
 * Returns the text for a message key in the browser's language.
 *
 * `browser.i18n.getMessage` returns an empty string for a key that the active
 * locale and the default locale both lack, and it is absent in tests and in
 * any context outside an extension. In those cases the English catalogue
 * supplies the text, so a label is never blank. Substitutions fill the
 * placeholders of the message in the order that the entry lists them.
 */
let fallback: Record<string, CatalogueEntry> = {}

/**
 * Sets the English catalogue that t() reads when the browser has no text for a
 * key. Each entry point registers the messages that it uses, so that the
 * content script, which runs on every page, carries only its own surface.
 */
export function useCatalogue(catalogue: Record<string, CatalogueEntry>): void {
  fallback = catalogue
}

export function t(key: MessageKey, ...substitutions: Array<string | number>): string {
  const values = substitutions.map(String)
  const translated = browserMessage(key, values)
  if (translated !== '') return translated
  const entry = fallback[key]
  return entry ? fillEnglish(entry, values) : key
}

function browserMessage(key: string, values: string[]): string {
  const i18n = (globalThis as { browser?: { i18n?: typeof browser.i18n } }).browser?.i18n
  if (!i18n || typeof i18n.getMessage !== 'function') return ''
  try {
    const text: unknown = i18n.getMessage(key, values)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

/**
 * Fills the placeholders of an English entry the way Firefox fills a message:
 * a declared named placeholder takes the substitution at its position, a named
 * placeholder that is not declared becomes empty, $1 to $9 take the
 * substitution at that position and become empty when there is none, and $$
 * is a dollar sign.
 */
export function fillEnglish(entry: CatalogueEntry, values: string[]): string {
  const names = (entry.placeholders ?? []).map((name) => name.toLowerCase())
  return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$|\$([1-9])/g, (match, name?: string, digit?: string) => {
    if (match === '$$') return '$'
    if (digit !== undefined) return values[Number(digit) - 1] ?? ''
    const index = names.indexOf(name!.toLowerCase())
    return index === -1 ? '' : (values[index] ?? '')
  })
}

/**
 * Sets the language of an extension page to the browser's interface language,
 * so that assistive technology reads translated text in the right language.
 * The pages declare English in their HTML, which is the language of the
 * default catalogue.
 */
export function applyPageLanguage(): void {
  const i18n = (globalThis as { browser?: { i18n?: typeof browser.i18n } }).browser?.i18n
  const language = typeof i18n?.getUILanguage === 'function' ? i18n.getUILanguage() : ''
  if (typeof language === 'string' && language !== '') document.documentElement.lang = language
}

/**
 * Stands in for a value that a component draws with its own markup, such as a
 * code element or bold text, which a message cannot hold. A message receives
 * this character where the value belongs, and the Marked component swaps it for
 * the marked value, so a translator can still move the value in the sentence.
 */
export const MARK = '\u0001'
