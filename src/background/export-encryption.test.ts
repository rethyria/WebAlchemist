/**
 * Encrypting an export file with a passphrase (#132).
 *
 * The first block calls the functions directly. The second sends the messages
 * the settings page sends to the real background script. Each refusal has a
 * control with the right passphrase, and the ciphertext checks have a control
 * that finds the same text in the plain file.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { isEncryptedExport } from '@shared/export-envelope'
import { EXPORT_WARNING, passphraseProblem } from '../options/transfer-ui'
import { encryptExport, openExport } from './export-crypto'
import { createHarness, cssTransform, type Harness } from './test-browser'

const PASSPHRASE = 'correct horse battery staple'
/** Text of the kind a transform stores from a page, and an address that names a bank. */
const PAGE_TEXT = 'Account 4417-PRIVATE balance'
const HOST = 'online.bank.example'

const record = (over: Record<string, unknown> = {}) =>
  cssTransform({
    id: 'bank',
    name: 'Hide balance',
    match: `https://${HOST}/*`,
    code: 'aside { display: none }',
    intent: 'Hide the balance panel',
    anchor: { tag: 'div', classes: [], path: 'body', landmarks: [], selector: 'div', text: PAGE_TEXT },
    ...over,
  })

describe('the encrypted file', () => {
  const bundle = { format: 'web-alchemist-export', schemaVersion: 1, exportedAt: 0, transforms: [record()] }

  it('holds none of the page text, address, name or intent', async () => {
    const text = JSON.stringify(await encryptExport(bundle, PASSPHRASE))
    for (const secret of [PAGE_TEXT, HOST, 'Hide balance', 'Hide the balance panel', 'aside']) {
      expect(text).not.toContain(secret)
    }
  })

  it('shows all of it in the plain file (control)', () => {
    const text = JSON.stringify(bundle)
    for (const secret of [PAGE_TEXT, HOST, 'Hide balance', 'Hide the balance panel']) {
      expect(text).toContain(secret)
    }
  })

  it('names itself as encrypted and says how, and nothing else about the contents', async () => {
    const file = await encryptExport(bundle, PASSPHRASE)
    expect(isEncryptedExport(file)).toBe(true)
    expect(Object.keys(file).sort()).toEqual(['cipher', 'encrypted', 'format', 'kdf', 'schemaVersion', 'sealed'])
    expect(file).toMatchObject({ kdf: 'PBKDF2-SHA256', cipher: 'AES-GCM' })
  })

  it('opens with the passphrase it was made with, giving the same export (control)', async () => {
    const file = await encryptExport(bundle, PASSPHRASE)
    expect(await openExport(file, PASSPHRASE)).toEqual(bundle)
  })

  it('does not open with another passphrase', async () => {
    const file = await encryptExport(bundle, PASSPHRASE)
    await expect(openExport(file, 'a different passphrase')).rejects.toThrow('could not be decrypted')
  })

  it('does not open with no passphrase', async () => {
    const file = await encryptExport(bundle, PASSPHRASE)
    await expect(openExport(file, undefined)).rejects.toThrow('This file is encrypted')
    await expect(openExport(file, '')).rejects.toThrow('This file is encrypted')
  })

  it('does not open once the ciphertext was changed', async () => {
    const file = await encryptExport(bundle, PASSPHRASE)
    const data = file.sealed.data
    const flipped = (data[0] === 'A' ? 'B' : 'A') + data.slice(1)
    await expect(openExport({ ...file, sealed: { ...file.sealed, data: flipped } }, PASSPHRASE)).rejects.toThrow(
      'could not be decrypted',
    )
  })

  it('gives a different salt, vector and ciphertext each time', async () => {
    const a = await encryptExport(bundle, PASSPHRASE)
    const b = await encryptExport(bundle, PASSPHRASE)
    expect(a.sealed.salt).not.toBe(b.sealed.salt)
    expect(a.sealed.iv).not.toBe(b.sealed.iv)
    expect(a.sealed.data).not.toBe(b.sealed.data)
  })

  it('refuses a passphrase shorter than the vault accepts', async () => {
    await expect(encryptExport(bundle, 'short')).rejects.toThrow('at least 12 characters')
  })

  it('returns a file that is not encrypted as it is, and ignores a passphrase for it', async () => {
    expect(await openExport(bundle, PASSPHRASE)).toBe(bundle)
    expect(isEncryptedExport(bundle)).toBe(false)
  })
})

describe('exporting and importing through the background script', () => {
  let h: Harness
  const stored = () => h.local.get('transforms') as any[]
  async function ask(message: unknown): Promise<any> {
    const reply = await h.onMessage(message)
    if (!reply.ok) throw new Error(reply.error.message)
    return reply.data
  }

  beforeEach(async () => {
    h = createHarness()
    h.hasUserScripts = true
    h.local.set('transforms', [record()])
    h.local.set('settings', DEFAULT_SETTINGS)
    h.contentReply = (m) => (m.type === 'ping' ? true : { type: 'health-check-result', states: [] })
    await h.boot()
  })

  it('writes a plain file with no passphrase', async () => {
    const file = await ask({ type: 'export-transforms' })
    expect(isEncryptedExport(file)).toBe(false)
    expect(JSON.stringify(file)).toContain(PAGE_TEXT)
  })

  it('writes an encrypted file with a passphrase, in either mode', async () => {
    for (const mode of ['share', 'backup'] as const) {
      const file = await ask({ type: 'export-transforms', mode, passphrase: PASSPHRASE })
      expect(isEncryptedExport(file)).toBe(true)
      expect(JSON.stringify(file)).not.toContain(PAGE_TEXT)
      expect(JSON.stringify(file)).not.toContain(HOST)
    }
  })

  it('refuses a short passphrase and writes nothing', async () => {
    await expect(ask({ type: 'export-transforms', passphrase: 'short' })).rejects.toThrow('at least 12')
  })

  describe('importing the encrypted file into an empty profile', () => {
    let file: unknown
    beforeEach(async () => {
      file = await ask({ type: 'export-transforms', passphrase: PASSPHRASE })
      h.local.set('transforms', [])
    })

    it('is refused with no passphrase, and stores nothing', async () => {
      await expect(ask({ type: 'import-transforms', bundle: file })).rejects.toThrow('This file is encrypted')
      await expect(ask({ type: 'preview-import', bundle: file })).rejects.toThrow('This file is encrypted')
      expect(stored()).toEqual([])
    })

    it('is refused with a wrong passphrase, and stores nothing', async () => {
      await expect(
        ask({ type: 'import-transforms', bundle: file, passphrase: 'not the passphrase' }),
      ).rejects.toThrow('could not be decrypted')
      expect(stored()).toEqual([])
    })

    it('imports with the right passphrase (control)', async () => {
      const preview = await ask({ type: 'preview-import', bundle: file, passphrase: PASSPHRASE })
      expect(preview.items.map((i: any) => i.name)).toEqual(['Hide balance'])
      const result = await ask({ type: 'import-transforms', bundle: file, passphrase: PASSPHRASE })
      expect(result.imported).toBe(1)
      expect(stored()[0].anchor.text).toBe(PAGE_TEXT)
    })
  })

  it('imports a plain file even when a passphrase is sent with it', async () => {
    const file = await ask({ type: 'export-transforms' })
    h.local.set('transforms', [])
    const result = await ask({ type: 'import-transforms', bundle: file, passphrase: PASSPHRASE })
    expect(result.imported).toBe(1)
  })

  it('leaves transforms in storage as plain text, which is the decided limit of this change', async () => {
    await ask({ type: 'export-transforms', passphrase: PASSPHRASE })
    expect(JSON.stringify(stored())).toContain(PAGE_TEXT)
  })
})

describe('what the export panel says and asks', () => {
  it('names the page text and the addresses in the file, and says it is plain text unless encrypted', () => {
    expect(EXPORT_WARNING).toContain('the start of the text of each page element')
    expect(EXPORT_WARNING).toContain('the addresses they apply to')
    expect(EXPORT_WARNING).toContain('plain text unless you encrypt it')
  })

  it('needs a passphrase of the vault length that is typed twice the same', () => {
    expect(passphraseProblem('short', 'short')).toContain('at least 12')
    expect(passphraseProblem(PASSPHRASE, 'something else entirely')).toContain('do not match')
    expect(passphraseProblem(PASSPHRASE, PASSPHRASE)).toBeNull()
  })
})
