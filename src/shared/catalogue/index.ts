import type { CatalogueEntry } from './define'
import { disclosureMessages } from './disclosure'
import { manifestMessages } from './manifest'
import { sharedMessages } from './shared'

/**
 * The English message catalogue, the single source of user-facing text.
 *
 * `_locales/en/messages.json` is generated from this value at build time (see
 * locale-file.ts), and t() in src/shared/i18n.ts reads it when the browser
 * returns no text for a key. Each surface keeps its messages in its own file
 * in this directory.
 */
export const EN_CATALOGUE = {
  ...disclosureMessages,
  ...manifestMessages,
  ...sharedMessages,
} as const satisfies Record<string, CatalogueEntry>

export type MessageKey = keyof typeof EN_CATALOGUE
