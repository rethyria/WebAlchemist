/**
 * The buttons of the main panel, checked by rendering the real components to
 * HTML with Svelte's server renderer. Every control must be a button, and the
 * standing explanations that were removed must stay removed.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import PickActions from './PickActions.svelte'
import SiteControls from './SiteControls.svelte'
import OrderInfo from './OrderInfo.svelte'

const noop = () => {}
const html = (component: unknown, props: Record<string, unknown>) =>
  (render(component as any, { props }).body as string).replace(/<!--.*?-->/g, '')

describe('the pick actions', () => {
  it('render both actions as buttons and no link-style control', () => {
    const out = html(PickActions, { onselect: noop, onwrite: noop })
    expect(out.match(/<button/g)?.length).toBe(2)
    expect(out).toContain('Choose part of the page to change')
    expect(out).toContain('Write it myself')
    expect(out).not.toContain('class="link"')
    expect(out).not.toContain('drag a rectangle')
  })

  it('do not show the order explanation as standing text', () => {
    const out = html(PickActions, { onselect: noop, onwrite: noop })
    expect(out).not.toContain('later one wins')
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

describe('the order information button', () => {
  const out = html(OrderInfo, {})

  it('has the accessible name About the order and is linked to a tooltip', () => {
    expect(out).toContain('aria-label="About the order"')
    const described = /aria-describedby="([^"]+)"/.exec(out)?.[1]
    expect(described).toBeTruthy()
    expect(out).toContain(`id="${described}"`)
    expect(out).toContain('role="tooltip"')
  })

  it('keeps the explanation in a hidden tooltip, not in a title attribute', () => {
    expect(out).toContain('If elixirs conflict, the later one wins')
    expect(out).toMatch(/role="tooltip"[^>]*hidden/)
    expect(out).not.toContain('title=')
  })
})

describe('the main panel', () => {
  it('shows the order information button only when the site has more than one elixir', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../App.svelte', import.meta.url), 'utf8')
    expect(source).toMatch(/\{#if transforms\.length > 1\}\s*<OrderInfo \/>/)
  })
})

describe('the picking step', () => {
  it('names the start button and asks for a click or tap on the part of the page to change', async () => {
    const { EN_CATALOGUE } = await import('@shared/catalogue')
    expect(EN_CATALOGUE.appSelect.message).toBe('Choose part of the page to change')
    expect(EN_CATALOGUE.pickingTitle.message).toBe('Click the part of the page you want to change')
    expect(EN_CATALOGUE.pickingTapHint.message).toBe('Tap the part of the page you want to change.')
    expect(EN_CATALOGUE.pickingTouchHelp.message).toContain('Tap the part of the page you want to change.')
  })
})

describe('the button names Brew and Brew again', () => {
  it('replace Generate and Regenerate in the visible text', async () => {
    const { EN_CATALOGUE } = await import('@shared/catalogue')
    expect(EN_CATALOGUE.describingGenerate.message).toBe('Brew')
    expect(EN_CATALOGUE.refRegenerate.message).toBe('Brew again')
    expect(EN_CATALOGUE.generatingTitle.message).toBe('Brewing')
    for (const entry of Object.values(EN_CATALOGUE)) {
      expect(entry.message).not.toMatch(/\bRegenerate\b|\bGenerate\b/)
    }
  })
})
