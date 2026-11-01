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

import type { TransformRuntimeState } from './types'

const MAX_MESSAGE = 200

/** The reason a repair request carries for a script that threw. Never varies. */
export const SCRIPT_ERROR_REASON = 'The script threw an error when it ran.'

/** The attribute that holds the last error of one transform. */
export function errorAttributeName(transformId: string): string {
  return `data-wa-error-${transformId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
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
