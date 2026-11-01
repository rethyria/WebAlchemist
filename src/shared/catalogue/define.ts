/**
 * One entry of the English message catalogue.
 *
 * The text uses the notation of a WebExtension messages.json file. A value
 * that varies is written as a named placeholder between dollar signs, for
 * example $COUNT$, and its name is listed in `placeholders` in the order of
 * the substitutions that the caller passes to t(). A literal dollar sign is
 * written $$. Naming the placeholders lets a translator move them anywhere in
 * the sentence.
 */
export interface CatalogueEntry {
  message: string
  /** Tells a translator where the text appears and what a placeholder stands for. */
  description?: string
  /** Placeholder names in substitution order. Absent when the text has none. */
  placeholders?: readonly string[]
}

/** Returns the entries unchanged and keeps their literal keys for typing. */
export function defineMessages<const T extends Record<string, CatalogueEntry>>(entries: T): T {
  return entries
}
