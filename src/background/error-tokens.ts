/**
 * The random token in the name of each script's error marker (#123).
 *
 * A script that throws writes its error to a data attribute on the document
 * element. The name used to contain the transform id, which a page can learn
 * (a page that replaces Element.prototype.removeAttribute sees the name on
 * every successful run). With the id the page could write a false error for a
 * transform and could recognise the same user on different sites. The name now
 * holds a random token that is made when the script is registered, so it says
 * nothing about the transform. Two ids that differ only by case or punctuation
 * also no longer share a name.
 *
 * The background keeps the map from registration id to token in
 * `storage.session`, because it is suspended and started again and a module
 * variable would be lost, while the registered script keeps the token in its
 * code. The map is lost when the browser closes, at which point the next start
 * registers the scripts again with new tokens (the code differs, so
 * reregisterAll updates them). A health check sends the content script the
 * tokens of the transforms it checks, and the content script is the only
 * reader of the markers.
 */

const KEY = 'wa-error-tokens'

type TokenMap = Record<string, string>

/**
 * Updates run one at a time. Registrations can overlap, and two read-modify-
 * write updates on one storage key would otherwise lose one of the tokens.
 */
let queue: Promise<unknown> = Promise.resolve()

function update<T>(change: (map: TokenMap) => T): Promise<T> {
  const next = queue.then(async () => {
    const map = ((await browser.storage.session.get(KEY))[KEY] as TokenMap | undefined) ?? {}
    const before = JSON.stringify(map)
    const result = change(map)
    // Written only when the map changed, so that registering a script that
    // already has a token adds no storage write.
    if (JSON.stringify(map) !== before) await browser.storage.session.set({ [KEY]: map })
    return result
  })
  queue = next.catch(() => undefined)
  return next
}

function randomToken(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The token of a registration, made on first use and kept after that. */
export function errorTokenFor(registrationId: string): Promise<string> {
  return update((map) => (map[registrationId] ??= randomToken()))
}

/** The tokens held for the given registration ids; ids without one are left out. */
export async function errorTokensFor(ids: string[]): Promise<TokenMap> {
  const map = ((await browser.storage.session.get(KEY))[KEY] as TokenMap | undefined) ?? {}
  return Object.fromEntries(ids.filter((id) => map[id] !== undefined).map((id) => [id, map[id]!]))
}

/** Drops the tokens of registrations that no longer exist. */
export function forgetErrorTokens(ids: string[]): Promise<void> {
  return update((map) => {
    for (const id of ids) delete map[id]
  })
}
