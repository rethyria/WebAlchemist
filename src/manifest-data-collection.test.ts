import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'))
const declared = manifest.browser_specific_settings.gecko.data_collection_permissions

/*
 * Why the manifest declares these categories (manifest.json cannot hold a
 * comment, so the reasoning is kept here and in docs/amo.md).
 *
 * When the user asks for a change, the background script sends the user's
 * description, the text and markup of the page, and the page address to the
 * AI provider the user configured. A screenshot is sent only when the user
 * asks for one. Nothing is sent to the developer.
 *
 * - websiteContent covers the page text, the page markup and the screenshots.
 * - browsingActivity covers the page address, which identifies a page the user
 *   visited.
 *
 * Categories that were considered and not declared:
 *
 * - personalCommunications and financialAndPaymentInfo. The extension does not
 *   look for such data, but the user can point it at a webmail or banking page,
 *   and the page text would then reach the provider. These categories describe
 *   what the add-on collects by design, so they are left out. This is a
 *   judgement, not a certainty: Mozilla's reviewers may ask for them.
 * - authenticationInfo. The user's own API key is sent to the provider it
 *   belongs to, as the Authorization header. It is not collected for any other
 *   purpose, and whether Mozilla counts that as collection is uncertain.
 * - none. This is false and must never be declared.
 *
 * Mozilla's list of categories can change; check it again before each
 * submission.
 */
describe('data collection declaration', () => {
  it('declares page content and browsing activity as required', () => {
    expect(declared.required).toEqual(['browsingActivity', 'websiteContent'])
  })

  it('does not claim that no data is collected', () => {
    expect(declared.required).not.toContain('none')
  })
})
