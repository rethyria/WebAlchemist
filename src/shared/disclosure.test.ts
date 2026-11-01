import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REVOKE_KEY_NOTICE } from './disclosure'

describe('REVOKE_KEY_NOTICE', () => {
  it('tells the user to delete the key and says uninstalling does not', () => {
    expect(REVOKE_KEY_NOTICE).toMatch(/delete your API key/)
    expect(REVOKE_KEY_NOTICE).toMatch(/does not revoke it/)
  })

  // The components are not rendered in tests, so this checks that each surface
  // imports and uses the constant. Control: the same check on a component that
  // does not show the notice fails.
  const uses = (path: string) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    return source.includes("from '@shared/disclosure'") && source.includes('{REVOKE_KEY_NOTICE}')
  }

  it('is shown on the settings page', () => {
    expect(uses('../options/ProviderSettings.svelte')).toBe(true)
  })

  it('is shown in the sidebar settings panel', () => {
    expect(uses('../sidebar/components/Settings.svelte')).toBe(true)
  })

  it('is not shown on a surface that does not carry it', () => {
    expect(uses('../options/VaultSettings.svelte')).toBe(false)
  })
})
