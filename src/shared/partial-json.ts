/**
 * Reading one string field out of JSON that has not finished arriving.
 *
 * The model returns a JSON object, so a streamed response is a partial JSON
 * document — not usable code. To show the code being written we have to pull
 * the `code` field out of a fragment that has no closing brace, and usually no
 * closing quote either.
 *
 * This is not a JSON parser and must not become one. It finds one key, decodes
 * the escapes, and stops at the first thing it cannot interpret. Everything it
 * cannot handle it declines to handle, because a wrong answer here would show
 * the user code that differs from what actually arrived.
 */

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * Returns as much of `key`'s string value as has arrived, or null if the key
 * has not appeared yet.
 *
 * A trailing incomplete escape (`"...\` or `"...\u00`) is dropped rather than
 * guessed at — it will be complete on the next chunk, and a guess would
 * briefly render a character the model did not send.
 */
export function extractPartialString(json: string, key: string): string | null {
  const needle = `"${key}"`
  const keyAt = json.indexOf(needle)
  if (keyAt === -1) return null

  // Step over the key, its colon, and any whitespace around them.
  let i = keyAt + needle.length
  while (i < json.length && /\s/.test(json[i] as string)) i += 1
  if (json[i] !== ':') return null
  i += 1
  while (i < json.length && /\s/.test(json[i] as string)) i += 1
  if (json[i] !== '"') return null
  i += 1

  let out = ''
  while (i < json.length) {
    const char = json[i] as string

    if (char === '"') return out

    if (char !== '\\') {
      out += char
      i += 1
      continue
    }

    // An escape that has not fully arrived: stop, keeping what is complete.
    if (i + 1 >= json.length) return out
    const code = json[i + 1] as string

    if (code === 'u') {
      if (i + 6 > json.length) return out
      const hex = json.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 6
      continue
    }

    const mapped = ESCAPES[code]
    if (mapped === undefined) return out
    out += mapped
    i += 2
  }

  return out
}
