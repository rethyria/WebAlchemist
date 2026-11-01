/**
 * Reporting the errors of JavaScript transforms (#123).
 *
 * The user script world runs with messaging off, so a transform that throws
 * cannot tell the extension. The harness instead writes the last error of each
 * transform to a data attribute on the document element, and the content
 * script reads it when a health check runs.
 *
 * The page can read and forge these attributes, and can remove them. They are
 * used for diagnostics only: they decide what the panel shows and nothing that
 * grants a permission or runs code. The text is capped and shown as plain text,
 * labelled as text reported by the page.
 *
 * The text is never sent to the model. A repair request puts its reason above
 * the page-content fence, where the system prompt says instructions are
 * obeyed, so page-controlled text there would be a prompt injection (#123).
 * The reason sent is the fixed sentence SCRIPT_ERROR_REASON.
 */

import type { Transform, TransformRuntimeState } from './types'

const MAX_MESSAGE = 200

/** The reason a repair request carries for a script that threw. Never varies. */
export const SCRIPT_ERROR_REASON = 'The script threw an error when it ran.'

/**
 * The attribute that holds the last error of one registered script. The token
 * is random per registration and is not the transform id (see
 * background/error-tokens.ts).
 */
export function errorAttributeName(token: string): string {
  return `data-wa-error-${token.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
}

/** One line of at most MAX_MESSAGE characters. */
export function shortErrorMessage(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE - 1)}…` : oneLine
}

/**
 * Marks a transform as broken when its script left an error.
 *
 * `take` returns the recorded error for a transform id and removes it, or null
 * when there is none. A transform whose anchor was already found as broken
 * keeps that reason, since it is the earlier fact.
 */
export function withScriptErrors(
  states: TransformRuntimeState[],
  kindOf: (id: string) => 'css' | 'js' | undefined,
  take: (id: string) => string | null,
): TransformRuntimeState[] {
  return states.map((state) => {
    if (kindOf(state.id) !== 'js') return state
    const error = take(state.id)
    if (error === null || state.status === 'broken') return state
    const { failedAssumption: _unused, ...rest } = state
    return {
      ...rest,
      status: 'broken',
      brokenReason: SCRIPT_ERROR_REASON,
      pageReportedError: shortErrorMessage(error),
    }
  })
}

/** The part of an element the health check reads and clears markers with. */
export interface MarkerHolder {
  getAttribute(name: string): string | null
  removeAttribute(name: string): void
}

/**
 * Applies the markers on `holder` to the states of a health check.
 *
 * `tokens` maps a transform id to the token in its marker name. A transform
 * without a token is not read. Reading a marker removes it, so the next check
 * reports an error only when the script failed again. This is the content
 * script's health check path, kept here so that a test can run it on a fake
 * element.
 */
export function readScriptErrors(
  states: TransformRuntimeState[],
  transforms: Pick<Transform, 'id' | 'kind'>[],
  tokens: Record<string, string>,
  holder: MarkerHolder,
): TransformRuntimeState[] {
  return withScriptErrors(
    states,
    (id) => transforms.find((t) => t.id === id)?.kind,
    (id) => {
      const token = tokens[id]
      if (token === undefined) return null
      const name = errorAttributeName(token)
      const text = holder.getAttribute(name)
      if (text !== null) holder.removeAttribute(name)
      return text
    },
  )
}
