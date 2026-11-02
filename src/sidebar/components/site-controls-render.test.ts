/**
 * The buttons of the main panel, checked by rendering the real components to
 * HTML with Svelte's server renderer. Every control must be a button, and the
 * standing explanations that were removed must stay removed.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import PickActions from './PickActions.svelte'
import SiteControls from './SiteControls.svelte'

const noop = () => {}
const html = (component: unknown, props: Record<string, unknown>) =>
  (render(component as any, { props }).body as string).replace(/<!--.*?-->/g, '')

describe('the pick actions', () => {
  it('render both actions as buttons and no link-style control', () => {
    const out = html(PickActions, { onselect: noop, onwrite: noop })
    expect(out.match(/<button/g)?.length).toBe(2)
    expect(out).toContain('Select an element')
    expect(out).toContain('Write it myself')
    expect(out).not.toContain('class="link"')
    expect(out).not.toContain('drag a rectangle')
  })

  it('show the order hint only when asked to', () => {
    expect(html(PickActions, { onselect: noop, onwrite: noop })).not.toContain('later one wins')
    expect(html(PickActions, { onselect: noop, onwrite: noop, showOrderHint: true })).toContain(
      'later one wins',
    )
  })
})

describe('the site controls', () => {
  it('offer one button and no standing explanation while the site is on', () => {
    const out = html(SiteControls, { siteOff: false, onsetoff: noop })
    expect(out.match(/<button/g)?.length).toBe(1)
    expect(out).toContain('Turn off everything on this site')
    expect(out).not.toContain('Stops every')
    expect(out).not.toContain('reloaded')
  })

  it('offer one button to turn back on while the site is off', () => {
    const out = html(SiteControls, { siteOff: true, onsetoff: noop })
    expect(out.match(/<button/g)?.length).toBe(1)
    expect(out).toContain('Turn everything back on for this site')
    expect(out).not.toContain('stay saved')
  })

  it('show the result of the last action', () => {
    const out = html(SiteControls, { siteOff: true, notice: 'Reload 1 open tab', onsetoff: noop })
    expect(out).toContain('Reload 1 open tab')
  })
})
