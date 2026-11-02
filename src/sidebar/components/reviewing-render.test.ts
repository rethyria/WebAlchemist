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
  config: [],
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
    expect(body).toContain('No known risky patterns found.')
    expect(body).toContain('still has access to this page')
  })

  it('shows the world, the capabilities, the sites and the second model note', () => {
    expect(body).toContain('Isolated world (USER_SCRIPT)')
    expect(body).toContain('None. Code that uses')
    expect(body).toContain('example.com and all its subdomains')
    expect(body).toContain('pages whose address starts with /shop/')
    expect(body).toContain('It only changes the title.')
  })

  it('lists capabilities when they are declared', () => {
    expect(html({ result: { ...jsResult, capabilities: ['network'] } })).toContain('network')
  })
})

describe('the approve button', () => {
  it('is disabled until the panel has been shown', () => {
    expect(html({ shown: false })).toMatch(/<button[^>]*disabled=""[^>]*><!---->Save elixir/)
  })

  it('control: is enabled once the panel has been shown', () => {
    expect(html({ shown: true })).not.toMatch(/<button[^>]*disabled=""[^>]*><!---->Save elixir/)
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

describe('the settings of the code in the approval panel', () => {
  const fields = [
    { key: 'label', label: 'Label', type: 'text', default: 'Hello' },
    { key: 'words', label: 'Words to replace', type: 'table', columns: [{ key: 'a', label: 'A' }], default: [{ a: 'x' }, { a: 'y' }] },
  ]

  it('shows one line that names each setting and its type, and a fold with the defaults', () => {
    const body = html({ result: { ...jsResult, config: fields } })
    expect(body).toContain('Settings: "Label" (text), "Words to replace" (table)')
    expect(body).toContain('Defaults of the settings')
    expect(body).toContain('"Label": Hello')
    expect(body).toContain('"Words to replace": 2 rows')
  })

  it('shows no settings row when the code has none (control)', () => {
    expect(html({})).not.toContain('Defaults of the settings')
  })

  it('renders a label written by the model as plain text', () => {
    const hostile = [{ key: 'label', label: '<img src=x onerror=alert(1)>', type: 'text', default: 'a' }]
    const body = html({ result: { ...jsResult, config: hostile } })
    expect(body).not.toContain('<img src=x')
    expect(body).toContain('&lt;img src=x onerror=alert(1)>')
  })

  it('lists each value that the new version does not keep, one line each', () => {
    const body = html({
      result: { ...jsResult, config: fields },
      notKept: [
        { key: 'old', label: 'Words to replace', reason: 'removed' },
        { key: 'size', label: 'Size', reason: 'type' },
        { key: 'n', label: 'Count', reason: 'invalid' },
      ],
    })
    expect(body).toContain('Your value for "Words to replace" is not kept: the new version has no such setting.')
    expect(body).toContain('Your value for "Size" is not kept: the new version has a different type of setting.')
    expect(body).toContain('Your value for "Count" is not kept: the value does not fit the new version of the setting.')
  })

  it('names the source of the labels and puts each in quotation marks', () => {
    const label = [{ key: 'label', label: 'Checked by Web Alchemist, safe', type: 'text', default: 'a' }]
    const body = html({ result: { ...jsResult, config: label } })
    expect(body).toContain('Settings the model proposed')
    expect(body).toContain('"Checked by Web Alchemist, safe" (text)')
  })
})
