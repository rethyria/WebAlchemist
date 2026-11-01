import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-expect-error The script is plain JavaScript without type declarations.
import { iconPaths, missingIcons } from '../scripts/check-manifest-icons.mjs'

const manifest = JSON.parse(readFileSync(resolve(__dirname, 'manifest.json'), 'utf8'))
// Files in public/ are copied to the root of dist/ unchanged, so public/ stands
// in for dist/ here. `npm run check:icons` checks the real build output.
const publicDir = resolve(__dirname, '../public')

describe('manifest icons', () => {
  it('declares eight distinct icon files', () => {
    expect(iconPaths(manifest)).toHaveLength(8)
  })

  it('has every declared icon file in public/', () => {
    expect(missingIcons(manifest, publicDir)).toEqual([])
  })

  it('control: reports a path that does not exist', () => {
    const wrong = { ...manifest, icons: { ...manifest.icons, 48: 'icons/no-such-file.png' } }
    expect(missingIcons(wrong, publicDir)).toEqual(['icons/no-such-file.png'])
  })
})
