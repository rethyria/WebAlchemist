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
