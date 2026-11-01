/**
 * The hosts on which the user has turned off every transform.
 *
 * Kept in its own storage key, not in the settings object, so that saving the
 * settings page never overwrites it and turning a site off never overwrites a
 * settings change made at the same time.
 */

import { hostOfUrl } from '@shared/site-off'

const KEY = 'wa-sites-off'

/** Writes are chained so that two quick changes cannot read the same list. */
let writes: Promise<unknown> = Promise.resolve()

export async function getOffHosts(): Promise<string[]> {
  const value = (await browser.storage.local.get(KEY))[KEY]
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === 'string') : []
}

export async function isUrlOff(rawUrl: string): Promise<boolean> {
  const host = hostOfUrl(rawUrl)
  return host !== null && (await getOffHosts()).includes(host)
}

/** Turns a host off or on, and returns the list that is stored afterwards. */
export function setHostOff(host: string, off: boolean): Promise<string[]> {
  const run = async () => {
    const current = await getOffHosts()
    const next = off ? [...new Set([...current, host])] : current.filter((h) => h !== host)
    await browser.storage.local.set({ [KEY]: next })
    return next
  }
  const result = writes.then(run, run)
  writes = result.catch(() => {})
  return result
}
