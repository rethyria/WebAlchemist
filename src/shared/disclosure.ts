/**
 * Advice shown beside the credential settings on the settings page and in the
 * sidebar's settings panel.
 *
 * Firefox deletes an extension's storage on uninstall but cannot run extension
 * code at that moment, so the extension cannot revoke an API key at the
 * provider. The user has to, and nothing else in the product tells them.
 * Kept in one place so the two surfaces cannot drift apart.
 */
export const REVOKE_KEY_NOTICE =
  'If you stop using Web Alchemist, delete your API key in your provider\'s console. Removing the extension does not revoke it.'
