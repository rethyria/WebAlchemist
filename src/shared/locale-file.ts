import { EN_CATALOGUE } from './catalogue'
import type { CatalogueEntry } from './catalogue/define'

/**
 * Builds the text of `_locales/en/messages.json` from the English catalogue.
 *
 * Each named placeholder becomes a `placeholders` object whose `content` is the
 * positional substitution ($1, $2, and so on) that browser.i18n.getMessage
 * receives from t().
 */
export function buildMessagesJson(
  catalogue: Record<string, CatalogueEntry> = EN_CATALOGUE,
): string {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(catalogue)) {
    const item: Record<string, unknown> = { message: entry.message }
    if (entry.description) item['description'] = entry.description
    if (entry.placeholders && entry.placeholders.length > 0) {
      item['placeholders'] = Object.fromEntries(
        entry.placeholders.map((name, index) => [name.toLowerCase(), { content: `$${index + 1}` }]),
      )
    }
    out[key] = item
  }
  return JSON.stringify(out, null, 2) + '\n'
}
