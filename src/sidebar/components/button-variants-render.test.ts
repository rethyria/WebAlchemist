/**
 * The two semantic button variants: danger (red) for deleting or stopping, and
 * caution (amber) for giving code or a file more reach. The tests check which
 * buttons carry which variant, by rendering the real components to HTML.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Button from './Button.svelte'
import SiteControls from './SiteControls.svelte'
import TransformRow from './TransformRow.svelte'

const noop = () => {}
const strip = (text: string) => text.replace(/<!--.*?-->/g, '')

/** The classes of the button whose text contains `label`. */
function classOf(markup: string, label: string): string {
  const match = [...markup.matchAll(/<button([^>]*)>([^<]*)</g)].find((m) => m[2]!.includes(label))
  expect(match, `button "${label}"`).toBeTruthy()
  return /class="([^"]*)"/.exec(match![1]!)?.[1] ?? ''
}

describe('Button', () => {
  it('has a class for each variant', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'caution']) {
      const out = strip(
        render(Button as any, { props: { variant, onclick: noop, children: () => {} } }).body,
      )
      expect(out).toContain(`class="${variant}`)
    }
  })
})

describe('colour tokens', () => {
  const css = readFileSync(new URL('../../shared/tokens.css', import.meta.url), 'utf8')
  it('define both light and dark values for danger and caution', () => {
    expect(css).toMatch(/--danger: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)/)
    expect(css).toMatch(/--caution: light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)/)
  })
})

describe('buttons that delete or stop something', () => {
  it('mark Turn off everything on this site as danger', () => {
    const out = strip(render(SiteControls as any, { props: { siteOff: false, onsetoff: noop } }).body)
    expect(classOf(out, 'Turn off everything')).toContain('danger')
  })

  it('mark Delete on a row as danger and leave Rename and Refine plain', () => {
    const transform = {
      id: 't', name: 'Hide banner', enabled: true, order: 0, match: 'example.com/*', kind: 'css',
      origin: 'ai', world: 'USER_SCRIPT', capabilities: [], intent: 'x',
      rationale: { targets: '', approach: 'a', assumptions: [] },
      anchor: { tag: 'div', classes: [], path: '', landmarks: [], selector: 'div' },
      code: 'x', createdAt: 0, updatedAt: 0,
    }
    const out = strip(
      render(TransformRow as any, {
        props: {
          transform, runtime: undefined, position: 1, expanded: true, dragging: false, hasAccess: true,
          ongrant: noop, onapprove: noop, ontoggle: noop, onexpand: noop, onrename: noop, onedit: noop,
          oneditwithai: noop, oneditintent: noop, ondelete: noop, onrepair: noop, conflicts: [],
          names: {}, ongrab: noop, onhover: noop, ondrop: noop, onmove: noop,
        },
      }).body,
    )
    expect(classOf(out, 'Delete')).toContain('btn-danger')
    expect(classOf(out, 'Rename')).not.toContain('btn-')
    expect(classOf(out, 'Refine')).not.toContain('btn-')
  })
})
