/**
 * The approval panel for restored JavaScript names its world and, for MAIN,
 * lists the risks (#124). Rendered to HTML with Svelte's server renderer, so
 * what a click does is not covered here.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { MAIN_WORLD_RISKS, WORLD_NAMES } from '@shared/world'
import RestoredCodeApproval from './RestoredCodeApproval.svelte'

const base = {
  id: 't',
  name: 'Hide banner',
  enabled: false,
  order: 0,
  match: 'example.com/*',
  kind: 'js',
  origin: 'imported',
  capabilities: [],
  intent: 'Hide the banner',
  rationale: { targets: '', approach: '', assumptions: [] },
  anchor: { tag: 'div', classes: [], path: '', landmarks: [], selector: 'div' },
  code: 'document.body.remove()',
  awaitsApproval: true,
  createdAt: 0,
  updatedAt: 0,
}

const unescape = (text: string) => text.replace(/&#39;/g, "'")
function html(transform: Record<string, unknown>) {
  const noop = () => {}
  return unescape(
    render(RestoredCodeApproval as any, { props: { transform, onapprove: noop, oncancel: noop } }).body.replace(
      /<!--.*?-->/g,
      '',
    ),
  )
}

describe('restored code that runs in MAIN', () => {
  const body = html({ ...base, world: 'MAIN' })

  it('names the world', () => {
    expect(body).toContain(unescape(WORLD_NAMES.MAIN))
  })

  it('lists every risk of MAIN', () => {
    for (const risk of MAIN_WORLD_RISKS) expect(body).toContain(unescape(risk))
  })

  it('keeps the approve button disabled until the risks are confirmed', () => {
    expect(body).toMatch(/<button[^>]*disabled[^>]*>\s*Approve and turn on/)
    expect(body).toContain('I have read the risks')
  })
})

describe('restored code that runs in the isolated world (control)', () => {
  const body = html({ ...base, world: 'USER_SCRIPT' })

  it('names the world and shows no MAIN risks', () => {
    expect(body).toContain(unescape(WORLD_NAMES.USER_SCRIPT))
    expect(body).not.toContain(unescape(MAIN_WORLD_RISKS[0]!))
    expect(body).not.toContain('I have read the risks')
  })

  it('leaves the approve button enabled', () => {
    expect(body).not.toMatch(/<button[^>]*disabled[^>]*>\s*Approve and turn on/)
  })
})
