import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { MARK, t } from './i18n'
import Marked from './Marked.svelte'

const html = (props: { text: string; value: string; tag?: 'code' | 'b' }) =>
  render(Marked as any, { props }).body.replace(/<!--.*?-->/g, '')

describe('Marked', () => {
  it('draws the value in a code element where the message holds the mark', () => {
    const body = html({ text: t('optRedirect', MARK), value: 'https://x.example/cb' })
    expect(body).toContain('Register <code')
    expect(body).toContain('>https://x.example/cb</code> as the redirect URI with the provider.')
  })

  it('draws the value in bold text for a user-typed name', () => {
    const body = html({ text: t('trWinsOver', 'color', MARK), value: 'My dark mode', tag: 'b' })
    expect(body).toContain('This one overrides color from <b>My dark mode</b>.')
  })

  it('keeps the value where a translation moves the mark', () => {
    expect(html({ text: `Fin ${MARK} début`, value: 'v' })).toContain('Fin <code')
  })
})
