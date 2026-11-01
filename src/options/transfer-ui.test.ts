import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PlannedTransform } from '@background/transfer'
import {
  describeResult,
  downloadText,
  exportFileName,
  originsToRequest,
  parseBundleText,
  requestImportOrigins,
} from './transfer-ui'

const item = (over: Partial<PlannedTransform>): PlannedTransform => ({
  name: 'n',
  kind: 'css',
  match: 'example.com/*',
  sites: 'Every page on example.com',
  origin: '*://example.com/*',
  intent: '',
  status: 'import',
  needsRegeneration: false,
  needsApproval: false,
  ...over,
})

describe('the export file', () => {
  it('is named for the mode and the local date', () => {
    expect(exportFileName('share', new Date(2026, 10, 1))).toBe('web-alchemist-share-2026-11-01.json')
  })

  it('is named as encrypted when it is', () => {
    expect(exportFileName('backup', new Date(2026, 10, 1), true)).toBe(
      'web-alchemist-backup-2026-11-01-encrypted.json',
    )
  })

  it('is downloaded through a Blob URL and an anchor, and the URL is released after the click', () => {
    const order: string[] = []
    const anchor = { href: '', download: '', click: () => order.push(`click ${anchor.href} ${anchor.download}`) }
    let blob: Blob | undefined
    downloadText('{"a":1}', 'x.json', {
      createObjectURL: (b) => {
        blob = b
        order.push('create')
        return 'blob:abc'
      },
      revokeObjectURL: (url) => order.push(`revoke ${url}`),
      createAnchor: () => anchor,
    })
    expect(order).toEqual(['create', 'click blob:abc x.json', 'revoke blob:abc'])
    expect(blob?.type).toBe('application/json')
    expect(blob?.size).toBe(7)
  })

  it('needs no downloads permission: the manifest does not ask for one', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8'))
    const asked = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])]
    expect(asked).not.toContain('downloads')
    // Control: the same lookup finds a permission the manifest does ask for.
    expect(asked).toContain('userScripts')
  })
})

describe('reading the chosen file', () => {
  it('parses JSON', () => {
    expect(parseBundleText('{"a":1}')).toEqual({ a: 1 })
  })

  it('refuses text that is not JSON with a message about the file', () => {
    expect(() => parseBundleText('not json')).toThrow('not valid JSON')
  })
})

describe('the host permission request for an import', () => {
  const items = [
    item({ origin: '*://a.example/*' }),
    item({ origin: '*://a.example/*' }),
    item({ origin: '*://b.example/*', kind: 'js' }),
    item({ origin: '*://dup.example/*', status: 'duplicate' }),
    item({ origin: null, status: 'refused' }),
  ]

  it('lists each origin once, for the records that will be imported only', () => {
    expect(originsToRequest(items)).toEqual(['*://a.example/*', '*://b.example/*'])
  })

  it('is one request, made before the function returns', () => {
    const request = vi.fn(async () => true)
    const result = requestImportOrigins(request, items)
    // Nothing has been awaited yet: the click is still being handled.
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ origins: ['*://a.example/*', '*://b.example/*'] })
    return expect(result).resolves.toBe(true)
  })

  it('resolves false when the user refuses, and when the request throws', async () => {
    expect(await requestImportOrigins(async () => false, items)).toBe(false)
    expect(
      await requestImportOrigins(async () => {
        throw new Error('no gesture')
      }, items),
    ).toBe(false)
  })

  it('asks for nothing when no record will be imported', async () => {
    const request = vi.fn(async () => false)
    expect(await requestImportOrigins(request, [items[3]!, items[4]!])).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('what the user is told after an import', () => {
  const result = {
    imported: 2,
    skipped: 1,
    duplicates: 1,
    needsRegeneration: ['x'],
    items: [] as PlannedTransform[],
    settingsRestored: false,
  }

  it('says how many were imported, that they are off, and what needs regenerating', () => {
    const text = describeResult(result, true)
    expect(text).toContain('Imported 2 transforms. They are all turned off.')
    expect(text).toContain('1 transform has no code and needs regenerating')
    expect(text).toContain('1 transform already saved and skipped.')
    expect(text).toContain('1 transform refused.')
    expect(text).not.toContain('No access')
  })

  it('says how many scripts wait for approval and that settings were restored', () => {
    const text = describeResult(
      {
        ...result,
        settingsRestored: true,
        items: [item({ kind: 'js', needsApproval: true, code: 'x()' }), item({})],
      },
      true,
    )
    expect(text).toContain('1 transform was restored with JavaScript code. Each stays off until')
    expect(text).toContain('The accent colour and health check mode were restored.')
  })

  it('does not mention approval or settings when there are none (control)', () => {
    const text = describeResult(result, true)
    expect(text).not.toContain('approved')
    expect(text).not.toContain('accent')
  })

  it('says the sites have no access when the request was refused', () => {
    expect(describeResult(result, false)).toContain('"No access to this site"')
  })
})
