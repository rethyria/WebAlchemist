import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { overlayMessages } from '@shared/catalogue/overlay'

/**
 * The content script carries only the overlay messages as its English
 * fallback (see i18n-overlay.ts). This builds the extension into a temporary
 * directory and checks that every message key that the built content script
 * asks for is defined in the overlay surface, so that a shared module that
 * the content script reaches cannot ask for a message that it lacks.
 */

/** The keys that the text of a built script passes to t(), in single or double quotes. */
export function keysAsked(bundle: string): string[] {
  return [...new Set([...bundle.matchAll(/\bt\(\s*['"](\w+)['"]/g)].map((match) => match[1]!))]
}

describe('the built content script', () => {
  it('asks only for messages that the overlay surface defines', { timeout: 120_000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'wa-content-bundle-'))
    try {
      execFileSync('npx', ['vite', 'build'], {
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env, WA_OUT_DIR: out },
        stdio: 'pipe',
      })
      const bundle = readFileSync(join(out, 'src/content/index.js'), 'utf8')
      const asked = keysAsked(bundle)
      expect(asked.length).toBeGreaterThan(0)
      expect(asked.filter((key) => !(key in overlayMessages))).toEqual([])
      // Control: a key from another surface is reported by the same filter.
      expect(['sidebarTitle', ...asked].filter((key) => !(key in overlayMessages))).toEqual(['sidebarTitle'])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
