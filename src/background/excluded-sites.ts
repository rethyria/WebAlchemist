/**
 * The excluded-sites list, in its own storage key so that saving the settings
 * never overwrites it, as with the per-site off switch in site-off.ts.
 */

import { excludedHostFor, normalizeExcludedEntry } from '@shared/excluded-sites'
import { t } from '@shared/i18n'

const KEY = 'wa-excluded-sites'

export async function getExcludedSites(): Promise<string[]> {
  const value = (await browser.storage.local.get(KEY))[KEY]
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === 'string') : []
}

/**
 * Replaces the list. Entries that are not host names are refused rather than
 * dropped, so that a typo is reported to the person who made it.
 */
export async function setExcludedSites(entries: string[]): Promise<string[]> {
  const normalized: string[] = []
  for (const entry of entries) {
    const host = normalizeExcludedEntry(entry)
    if (host === null) throw new Error(t('bgIsNotASiteNameSo', entry))
    if (!normalized.includes(host)) normalized.push(host)
  }
  await browser.storage.local.set({ [KEY]: normalized })
  return normalized
}

/** The excluded host that covers the address, or null. */
export async function excludedHostOf(url: string): Promise<string | null> {
  return excludedHostFor(await getExcludedSites(), url)
}
