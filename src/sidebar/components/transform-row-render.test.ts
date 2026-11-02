/**
 * The notice on a transform that the migration moved out of MAIN (issue 53),
 * checked by rendering the real row to HTML with Svelte's server renderer. No
 * browser is involved, so what a click does is not covered here.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { WORLD_RESET_NOTICE } from '@shared/world'
import { hasAccess } from '@shared/site-access'
import TransformRow from './TransformRow.svelte'

const base = {
  id: 't',
  name: 'Hide banner',
  enabled: true,
  order: 0,
  match: 'example.com/*',
  kind: 'js',
  origin: 'ai',
  world: 'USER_SCRIPT',
  capabilities: [],
  intent: 'Hide the banner',
  rationale: { targets: '', approach: 'a', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: '', landmarks: [], selector: 'div' },
  code: 'x',
  createdAt: 0,
  updatedAt: 0,
}

function html(transform: Record<string, unknown>, access = true) {
  const noop = () => {}
  return render(TransformRow as any, {
    props: {
      transform,
      runtime: undefined,
      position: 1,
      expanded: true,
      dragging: false,
      hasAccess: access,
      ongrant: noop,
      ontoggle: noop,
      onexpand: noop,
      onrename: noop,
      onedit: noop,
      oneditwithai: noop,
      oneditintent: noop,
      ondelete: noop,
      onrepair: noop,
      conflicts: [],
      names: {},
      ongrab: noop,
      onhover: noop,
      ondrop: noop,
      onmove: noop,
    },
  }).body.replace(/<!--.*?-->/g, '')
}
const unescape = (text: string) => text.replace(/&#39;/g, "'")

describe('the row of a transform that was moved out of MAIN', () => {
  it('shows the notice and the control to open the editor', () => {
    const body = unescape(html({ ...base, worldResetFromModel: true }))
    expect(body).toContain(unescape(WORLD_RESET_NOTICE))
    expect(body).toContain("Open the editor to allow the page's own world")
  })

  it('shows neither for a transform that was not moved (control)', () => {
    const body = unescape(html(base))
    expect(body).not.toContain(unescape(WORLD_RESET_NOTICE))
    expect(body).not.toContain('Open the editor to turn on')
  })
})

describe('the actions on an open row', () => {
  it('place Refine beside Rename and keep the old name out', () => {
    const body = html(base)
    expect(body).toContain('Refine')
    expect(body).not.toContain('Change with AI')
    expect(body.indexOf('Rename')).toBeGreaterThan(-1)
    expect(body.indexOf('Refine') - body.indexOf('Rename')).toBeLessThan(120)
  })
})

describe('the row of a transform on an https page after access is granted', () => {
  const youtube = { ...base, match: 'https://www.youtube.com/*' }
  const noAccess = 'No access to this site'

  // permissions.request resolves true without a prompt when Firefox already
  // holds the origin as an any-scheme pattern, so getAll() does not change.
  it('stops showing no access when a held any-scheme origin covers it', () => {
    const held = ['*://www.youtube.com/*']
    expect(html(youtube, hasAccess(held, youtube))).not.toContain(noAccess)
  })

  it('shows no access when only another scheme is held (control)', () => {
    const held = ['http://www.youtube.com/*']
    expect(html(youtube, hasAccess(held, youtube))).toContain(noAccess)
  })
})
