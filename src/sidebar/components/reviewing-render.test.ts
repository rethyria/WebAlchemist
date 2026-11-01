/**
 * The approval panel's rendered text (issue 64), checked by rendering the real
 * component to HTML with Svelte's server renderer. No browser is involved, so
 * this covers what the template prints and not how it looks, how focus moves
 * or what a click does. Effects do not run in a server render, so the
 * approve button's state is checked through the `shown` prop it is given.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Reviewing from './Reviewing.svelte'

const jsResult = {
  name: 'Hide banner',
  kind: 'js',
  world: 'USER_SCRIPT',
  requestedWorld: 'USER_SCRIPT',
  worldReason: '',
  capabilities: [],
  code: 'document.title = "SECRET-MARKER"',
  rationale: { targets: 't', approach: 'a', assumptions: ['the banner keeps its id'] },
  intent: 'i',
} as any

const cleanReview = {
  static: [],
  undeclaredCapabilities: [],
  passed: true,
  model: { verdict: 'match', explanation: 'It only changes the title.' },
  approvalToken: 't',
} as any

function html(over: Record<string, unknown> = {}) {
  const noop = () => {}
  return render(Reviewing as any, {
    props: {
      result: jsResult,
      review: cleanReview,
      intent: 'i',
      origin: 'https://*.example.com/*',
      match: '*://*.example.com/shop/*',
      shown: true,
      onshown: noop,
      permissionDenied: false,
      onrefuse: noop,
      onapproveurls: noop,
      onsave: noop,
      onworld: noop,
      onback: noop,
      ...over,
    },
  }).body
}

describe('the approval panel for JavaScript with a clean review', () => {
  const body = html()

  it('shows the code expanded', () => {
    expect(body).toMatch(/<details[^>]* open/)
    expect(body).toContain('SECRET-MARKER')
  })

  it('does not collapse the review to one line', () => {
    expect(body).not.toContain('Checked')
    expect(body).not.toContain('nothing flagged')
    expect(body).toContain('No known patterns found.')
    expect(body).toContain('still runs with access to this page')
  })

  it('shows the world, the capabilities, the sites and the second model note', () => {
    expect(body).toContain('Isolated world (USER_SCRIPT)')
    expect(body).toContain('None declared')
    expect(body).toContain('example.com and every subdomain of example.com')
    expect(body).toContain('pages whose path starts with /shop/')
    expect(body).toContain('It only changes the title.')
  })

  it('lists capabilities when they are declared', () => {
    expect(html({ result: { ...jsResult, capabilities: ['network'] } })).toContain('network')
  })
})

describe('the approve button', () => {
  it('is disabled until the panel has been shown', () => {
    expect(html({ shown: false })).toMatch(/<button[^>]*disabled=""[^>]*><!---->Save transform/)
  })

  it('control: is enabled once the panel has been shown', () => {
    expect(html({ shown: true })).not.toMatch(/<button[^>]*disabled=""[^>]*><!---->Save transform/)
  })
})

describe('the world warning', () => {
  it('shows the four risks for a pending request, with a button to allow it', () => {
    const body = html({ result: { ...jsResult, requestedWorld: 'MAIN', worldReason: 'needs window.app' } })
    expect(body).toContain('needs window.app')
    expect(body).toContain('The page can change this code')
    expect(body).toContain("Allow the page's own world")
  })

  it('control: shows no risk list for the isolated world with no request', () => {
    expect(html()).not.toContain('has these risks')
  })
})

describe('CSS', () => {
  it('keeps the code collapsed, as the issue asks for JavaScript only', () => {
    const body = html({ result: { ...jsResult, kind: 'css', code: 'a{}' } })
    expect(body).not.toMatch(/<details[^>]* open/)
  })
})
