/**
 * The wait, in seconds, that a screen reader is told about during a rate-limit
 * countdown.
 *
 * The visible countdown changes every second. Announcing every change meant a
 * screen-reader user heard about thirty announcements during a 30-second wait,
 * which interrupted whatever else they were reading. The announced value is the
 * smallest step that is not below the real wait, so it changes only when the
 * wait drops under 60, 30, 10 and 5 seconds. Above 60 seconds it changes once
 * a minute.
 */
export function announcedSeconds(seconds: number): number {
  const steps = [5, 10, 30, 60]
  const step = steps.find((s) => s >= seconds)
  return step ?? Math.ceil(seconds / 60) * 60
}

/**
 * The sentence a screen reader gets for the wait. "Up to" is used because the
 * announced value is the real wait rounded up to a step, so the real wait is
 * at most that long and equals it at each step boundary. "Less than" was wrong
 * at exactly 30 seconds.
 */
export function announcement(seconds: number): string {
  return `Trying again in up to ${announcedSeconds(seconds)} seconds`
}
