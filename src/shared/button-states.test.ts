import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('shared button states', () => {
  it('give every button a hover and an active state that disabled buttons do not get', () => {
    expect(css).toMatch(/button:not\(:disabled\):hover/)
    expect(css).toMatch(/button:not\(:disabled\):active/)
    expect(css).toMatch(/button:disabled\s*\{[^}]*cursor: default/)
  })

  it('draws focus as a 2px outline', () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: 2px solid var\(--accent-fg\)/)
  })

  it('animates only with --motion, which is 0ms under reduced motion', () => {
    expect(css).toMatch(/transition: box-shadow var\(--motion\)/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--motion: 0ms/)
  })

  it('keeps the focus colour at 3:1 or more on every surface in every accent and theme', () => {
    const light = ['#ffffff', '#f7f7fb', '#f0f0f4']
    const dark = ['#1c1b22', '#22212a', '#15141a', '#2b2a33']
    const accents = [...css.matchAll(/:root\[data-accent='(\w+)'\][^{]*\{([^}]*)\}/g)]
    expect(accents.length).toBe(8)
    for (const [, name, body] of accents) {
      const l = /--accent-fg-l: (#[0-9a-f]{6})/.exec(body!)![1]!
      const d = /--accent-fg-d: (#[0-9a-f]{6})/.exec(body!)![1]!
      for (const s of light) expect(ratio(l, s), `${name} light on ${s}`).toBeGreaterThanOrEqual(3)
      for (const s of dark) expect(ratio(d, s), `${name} dark on ${s}`).toBeGreaterThanOrEqual(3)
    }
  })
})
