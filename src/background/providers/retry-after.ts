/**
 * How long to wait before trying again, when the provider says.
 *
 * #35: `FlowError` has carried a `retryInSeconds` since it was written and it
 * has always been `0`, so the panel showed a manual "try again" button standing
 * in for a countdown that never counted. The number was never read off the
 * response.
 *
 * RFC 9110 allows two forms — a delay in seconds, or an HTTP date — and
 * providers use both. Anthropic sends `retry-after` in seconds; some
 * OpenAI-compatible endpoints send `x-ratelimit-reset-*` instead, as either an
 * epoch or a duration.
 *
 * Everything here is a pure function of the headers and the current time,
 * because the alternative is discovering at 3am that a countdown was reading a
 * millisecond epoch as seconds.
 */

/** Anything longer than this is not a wait, it is a different day. */
const MAXIMUM_SECONDS = 3600

/** Below this a countdown is noise; the retry may as well be immediate. */
const MINIMUM_SECONDS = 1

export interface HeaderSource {
  get(name: string): string | null | undefined
}

/**
 * Reads a wait in seconds, or null when the provider did not say.
 *
 * Null and zero are different answers and must stay different. Null means "no
 * guidance, so do not invent a countdown"; zero would mean "retry now", which
 * no provider returning 429 intends. A zero-second countdown is the specific
 * wrong behaviour this returns null to avoid.
 */
export function retryAfterSeconds(headers: HeaderSource | null | undefined, now: number): number | null {
  if (!headers) return null

  const direct = parseRetryAfter(headers.get('retry-after'), now)
  if (direct !== null) return clamp(direct)

  /*
   * The OpenAI-compatible fallbacks, in the order they are worth trusting.
   * `reset-requests` is the one that governs a plain rate limit; the token
   * variants can be far longer and describe a different budget.
   */
  for (const name of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset']) {
    const value = parseResetHeader(headers.get(name), now)
    if (value !== null) return clamp(value)
  }

  return null
}

function clamp(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds > MAXIMUM_SECONDS) return null
  return Math.max(MINIMUM_SECONDS, Math.ceil(seconds))
}

/** RFC 9110: either delta-seconds or an HTTP-date. */
function parseRetryAfter(raw: string | null | undefined, now: number): number | null {
  if (raw === null || raw === undefined) return null
  const text = raw.trim()
  if (text === '') return null

  if (/^\d+$/.test(text)) return Number(text)

  const when = Date.parse(text)
  if (Number.isNaN(when)) return null
  return (when - now) / 1000
}

/**
 * The OpenAI-compatible shapes, which are not standardised and vary by vendor:
 * `20s`, `1m30s`, `1500ms`, a bare number of seconds, or an epoch.
 */
function parseResetHeader(raw: string | null | undefined, now: number): number | null {
  if (raw === null || raw === undefined) return null
  const text = raw.trim().toLowerCase()
  if (text === '') return null

  const duration = text.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/)
  if (duration && duration.slice(1).some(Boolean)) {
    const [, h, m, s, ms] = duration
    return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0) + Number(ms ?? 0) / 1000
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)

  /*
   * A bare number is ambiguous, and guessing wrong is the difference between
   * waiting nine seconds and waiting fifty-four years. Anything large enough to
   * be a plausible epoch is treated as one — a *duration* that big has already
   * been rejected by the hour cap, so there is no overlap to get wrong.
   */
  if (value > 1e12) return (value - now) / 1000
  if (value > 1e9) return value - now / 1000
  return value
}
