/**
 * Accent colours as values, for the places that cannot read a CSS variable.
 *
 * `tokens.css` is where the accent is applied for anything rendered in an
 * extension page. Two consumers cannot use it:
 *
 *   - The in-page overlay lives in a shadow root with `all: initial` on a site
 *     we do not control. It cannot inherit our variables, and reading the
 *     page's would give us the site's palette.
 *   - The settings swatches need the literal hue to paint the dot, not the
 *     resolved accent — the whole point is showing the seven you did not pick.
 *
 * These values are duplicated in tokens.css, which is the price of CSS not
 * being able to import from TypeScript. If a hue changes, both change. The
 * derivations behind `fg` are documented there.
 */

import type { Accent } from './types'

export interface AccentColours {
  /** The fill. Buttons, toggle tracks, the swatch dot itself. */
  swatch: string
  /** The same hue lifted to be legible as a line or text on a dark surface. */
  fgDark: string
  /** And darkened, for a light one. */
  fgLight: string
  /** Whichever of black or white reads on `swatch`. */
  on: string
}

export const ACCENT_COLOURS: Record<Accent, AccentColours> = {
  red: { swatch: '#c92a2a', fgDark: '#dd7979', fgLight: '#c92a2a', on: '#ffffff' },
  orange: { swatch: '#c2410c', fgDark: '#d7825f', fgLight: '#c2410c', on: '#ffffff' },
  amber: { swatch: '#ffd43b', fgDark: '#ffd43b', fgLight: '#6b5818', on: '#15141a' },
  green: { swatch: '#1f7a33', fgDark: '#67a574', fgLight: '#1f7a33', on: '#ffffff' },
  blue: { swatch: '#0060df', fgDark: '#5998ea', fgLight: '#0060df', on: '#ffffff' },
  indigo: { swatch: '#4338ca', fgDark: '#9a92f5', fgLight: '#4338ca', on: '#ffffff' },
  violet: { swatch: '#7c3aed', fgDark: '#aa7ff3', fgLight: '#7c3aed', on: '#ffffff' },
  mono: { swatch: '#f5f3f0', fgDark: '#fbfbfe', fgLight: '#15141a', on: '#15141a' },
}

/**
 * What the picker overlay should draw itself in.
 *
 * The overlay always uses the lifted tone rather than the fill. It sits on
 * arbitrary page backgrounds behind a two-tone halo, and a saturated mid-tone
 * like #4338ca disappears into a dark page even with the halo carrying the
 * edge.
 */
export interface OverlayPalette {
  line: string
  labelText: string
}

export function overlayPaletteFor(accent: Accent, dark: boolean): OverlayPalette {
  const colours = ACCENT_COLOURS[accent]
  const line = dark ? colours.fgDark : colours.fgLight
  return { line, labelText: readableOn(line) }
}

/** Relative luminance, sufficient for picking black or white text. */
function readableOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.5 ? '#15141a' : '#ffffff'
}
