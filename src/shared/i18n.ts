import { EN_CATALOGUE, type MessageKey } from './catalogue'
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
export function t(key: MessageKey, ...substitutions: Array<string | number>): string {
  const values = substitutions.map(String)
  const translated = browserMessage(key, values)
  if (translated !== '') return translated
  return fillEnglish(EN_CATALOGUE[key], values)
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

/** Fills the placeholders of an English entry the way the browser fills a translated one. */
export function fillEnglish(entry: CatalogueEntry, values: string[]): string {
  const names = entry.placeholders ?? []
  return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$/g, (match, name: string | undefined) => {
    if (match === '$$') return '$'
    const index = names.findIndex((candidate) => candidate.toLowerCase() === name!.toLowerCase())
    return index === -1 ? match : (values[index] ?? '')
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
