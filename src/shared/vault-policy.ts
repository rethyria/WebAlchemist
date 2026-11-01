/**
 * The shortest passphrase the vault accepts.
 *
 * Shared so that the settings page and the background script cannot disagree.
 * The page checks it to disable the button; the background checks it because a
 * message can arrive from any extension context without passing through the
 * page, and a key derived from a short passphrase is cheap to guess offline.
 *
 * Long rather than complex. A passphrase protecting a file at rest is only
 * ever attacked offline, where character-class rules buy far less than length,
 * and 600,000 PBKDF2 iterations does the rest of the work.
 */
export const MIN_PASSPHRASE_LENGTH = 12

/**
 * How long an unlocked vault stays unlocked without being used, in minutes.
 * Zero means it never locks by itself.
 *
 * Thirty minutes is the default. It is long enough that a person working with
 * the extension through a session is not asked for the passphrase between
 * generations, and short enough that an unattended browser does not stay
 * readable for the rest of the day. The derivation takes a few hundred
 * milliseconds, so the cost of a lock is typing the passphrase again.
 */
export const DEFAULT_VAULT_IDLE_MINUTES = 30

/** The choices offered in settings, shortest first, with "never" last. */
export const VAULT_IDLE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 480, label: '8 hours' },
  { minutes: 0, label: 'Never' },
]
