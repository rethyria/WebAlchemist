/**
 * The conversation shown in the Refining step. It is for display only: nothing
 * in it is sent to a model. A request and its result are one attempt, and a
 * question and its answer are a side exchange that does not change the draft.
 */

export interface TranscriptEntry {
  /**
   * `replied` is the user's text that the model answered with a question, and
   * `asked` is that question. They are a conversation turn, not a side
   * exchange, and they are not an attempt.
   */
  kind: 'request' | 'result' | 'question' | 'answer' | 'replied' | 'asked'
  /** Empty for an attempt whose text the panel does not show once it is replaced. */
  text: string
}

export interface Bubble {
  role: 'user' | 'assistant'
  text: string
  /** Set on the bubbles of a side exchange. */
  side?: 'question' | 'answer'
  /** True on the first answer, which carries the one-time note. */
  firstAnswer?: boolean
}

/**
 * The bubbles in the order the events happened.
 *
 * The latest request and result are shown from the current values, which the
 * panel can still change, and earlier ones from the text recorded with them. A
 * log with no attempt in it (a draft that was not produced in this panel) gets
 * one attempt in front, so the current request and result are always shown.
 * `pending` is a question that has been sent and has no complete answer yet.
 */
export function transcriptBubbles(
  log: readonly TranscriptEntry[],
  request: string,
  result: string,
  pending: { question: string; answer: string } | null = null,
): Bubble[] {
  const entries: TranscriptEntry[] = log.some((entry) => entry.kind === 'request')
    ? [...log]
    : [{ kind: 'request', text: '' }, { kind: 'result', text: '' }, ...log]
  const lastRequest = entries.map((entry) => entry.kind).lastIndexOf('request')
  const lastResult = entries.map((entry) => entry.kind).lastIndexOf('result')

  const bubbles: Bubble[] = entries.map((entry, index): Bubble => {
    switch (entry.kind) {
      case 'request':
        return { role: 'user', text: index === lastRequest ? request : entry.text }
      case 'result':
        return { role: 'assistant', text: index === lastResult ? result : entry.text }
      case 'question':
        return { role: 'user', text: entry.text, side: 'question' }
      case 'answer':
        return { role: 'assistant', text: entry.text, side: 'answer' }
      case 'replied':
        return { role: 'user', text: entry.text }
      case 'asked':
        return { role: 'assistant', text: entry.text }
    }
  })
  if (pending) {
    bubbles.push({ role: 'user', text: pending.question, side: 'question' })
    if (pending.answer) bubbles.push({ role: 'assistant', text: pending.answer, side: 'answer' })
  }

  const shown = bubbles.filter((bubble) => bubble.text)
  const first = shown.findIndex((bubble) => bubble.side === 'answer')
  if (first !== -1) shown[first] = { ...shown[first]!, firstAnswer: true }
  return shown
}
