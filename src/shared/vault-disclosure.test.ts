import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DISCLOSURE_PLAIN, DISCLOSURE_SEALED, credentialDisclosure } from './vault-disclosure'

const source = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8')

describe('the credential disclosure', () => {
  it('says keys are encrypted when sealed, and does not say they are plain text', () => {
    const { text } = credentialDisclosure({ sealed: true, unlocked: true })
    expect(text).toBe(DISCLOSURE_SEALED)
    expect(text).toMatch(/encrypted with your passphrase/)
    expect(text).not.toMatch(/plain text/)
  })

  // The control: the plain-text wording is still what an unsealed vault gets.
  it('control: says keys are plain text when not sealed', () => {
    const { text, status } = credentialDisclosure({ sealed: false, unlocked: true })
    expect(text).toBe(DISCLOSURE_PLAIN)
    expect(text).toMatch(/plain text/)
    expect(status).toBeNull()
  })

  it('says a sealed, locked vault is locked and what that stops', () => {
    expect(credentialDisclosure({ sealed: true, unlocked: false }).status).toMatch(/^Locked\..*fail/)
    expect(credentialDisclosure({ sealed: true, unlocked: true }).status).toMatch(/^Unlocked/)
  })
})

/*
 * The two components are Svelte files and are not rendered here. What can be
 * checked without a browser is that both take their wording from the shared
 * module and neither carries a copy that could drift.
 */
describe('the surfaces that show it', () => {
  it.each(['src/options/VaultSettings.svelte', 'src/sidebar/components/Settings.svelte'])(
    '%s imports the shared wording and has no copy of it',
    (path) => {
      const text = source(path)
      expect(text).toMatch(/@shared\/vault-disclosure/)
      expect(text).not.toMatch(/Plain text in this browser profile/)
      expect(text).not.toMatch(/Keys are stored as plain text/)
      expect(text).not.toMatch(/Keys are encrypted with your passphrase/)
    },
  )

  it('the sidebar settings panel is given the vault state', () => {
    expect(source('src/sidebar/components/Settings.svelte')).toMatch(/vault\s*:\s*VaultView/)
    expect(source('src/sidebar/App.svelte')).toMatch(/type: 'vault-state'/)
  })
})
