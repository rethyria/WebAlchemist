import type { CatalogueEntry } from './define'
import { manifestMessages } from './manifest'

/**
 * The English message catalogue, the single source of user-facing text.
 *
 * `_locales/en/messages.json` is generated from this value at build time (see
 * locale-file.ts), and t() in src/shared/i18n.ts reads it when the browser
 * returns no text for a key. Each surface keeps its messages in its own file
 * in this directory.
 */
export const EN_CATALOGUE = {
  ...manifestMessages,
} as const satisfies Record<string, CatalogueEntry>

export type MessageKey = keyof typeof EN_CATALOGUE
