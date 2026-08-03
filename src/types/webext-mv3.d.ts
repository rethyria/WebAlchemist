/**
 * Gaps in `@types/firefox-webext-browser`, and where each is handled.
 *
 * 1. `browser.userScripts` is typed as the Manifest V2 *legacy* API. Firefox
 *    ships a different MV3-only API under the same namespace. Declaration
 *    merging the correct shape onto the stale one produces a hybrid matching
 *    neither, so the real surface is declared as its own interface in
 *    `background/userscripts-api.ts` with a single cast at that boundary.
 *
 * 2. `'userScripts'` is missing from the `OptionalPermission` union. A union
 *    cannot be widened by declaration merging, so the one cast needed lives in
 *    `background/registry.ts` as `USER_SCRIPTS_PERMISSION`.
 *
 * Both can be deleted once upstream types cover the MV3 API.
 */

export {}
