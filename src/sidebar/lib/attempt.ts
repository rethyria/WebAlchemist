/**
 * The attempt number shown in the Refining panel, counting the result on
 * screen as one attempt. Each refinement adds two history entries, the
 * instruction and the reply to it, so two entries make one finished attempt.
 * The previous divisor of 3 made the label lag: it still read 1 after one
 * refinement and read 3 only after four.
 */
export function attemptNumber(historyLength: number): number {
  return Math.floor(historyLength / 2) + 1
}
