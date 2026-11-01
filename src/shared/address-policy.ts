/**
 * What is removed from a page address before it is sent to the model provider
 * (#65). The limits live here, apart from the content script that applies them,
 * so the sidebar can state the same numbers it enforces.
 */

/** Longest query key or path segment that is sent. Longer ones are removed. */
export const ADDRESS_PART_LIMIT = 32

/** Stands in for a query value and for a removed path segment. */
export const ADDRESS_PLACEHOLDER = '[removed]'

/** A run of this many digits in a row looks like an account, order or session number. */
const LONG_DIGIT_RUN = 6

/** A run of this many identifier characters in a row, with a letter and a digit in it, looks like a token. */
const TOKEN_RUN = 20

/**
 * True when a query key or path segment looks like a secret or an identifier
 * instead of a word.
 *
 * Two shapes are caught: a long run of digits, and a long run of base64 or hex
 * characters that mixes letters and digits. Hyphens end a run on purpose, so a
 * slug made of words ("how-to-make-tea") is kept even when it is long, and a
 * run needs a digit as well as a letter so a long ordinary word is kept. This
 * will remove some harmless segments, such as an order number; the cost of that
 * is a less specific address, and the cost of the other mistake is a leaked
 * token.
 */
export function looksLikeToken(text: string): boolean {
  if (new RegExp(`\\d{${LONG_DIGIT_RUN},}`).test(text)) return true
  const runs = text.match(new RegExp(`[A-Za-z0-9_+/=]{${TOKEN_RUN},}`, 'g')) ?? []
  return runs.some((run) => /\d/.test(run) && /[A-Za-z]/.test(run))
}

/** True when a query key or path segment must not be sent. */
export function mustRemovePart(text: string): boolean {
  return text.length > ADDRESS_PART_LIMIT || looksLikeToken(text)
}

/**
 * The sentence the panel shows next to the address. It names every removal
 * `addressForModel` makes, so what the user reads matches what is sent.
 */
export const ADDRESS_REMOVAL_NOTE =
  `Page address sent to your AI provider. Removed from it: the fragment, the user name and password, ` +
  `query values, query keys with no value, query keys and path segments longer than ${ADDRESS_PART_LIMIT} characters ` +
  `or that look like tokens (a long run of digits, or a long run of letters and digits), and path parameters ` +
  `(everything after a semicolon in a path segment). Removed path segments are shown as ${ADDRESS_PLACEHOLDER}. ` +
  `For file, blob, data and other addresses that are not http or https, only the scheme is sent.`
