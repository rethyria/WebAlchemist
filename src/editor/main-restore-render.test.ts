/**
 * The confirmation for restoring a version that runs in MAIN (issue 53),
 * checked by rendering the real component to HTML with Svelte's server
 * renderer. No browser is involved, so this covers what the template prints and
 * not what a click does; the rule that refuses a restore is tested through
 * restoreRefusal in shared/versions.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { MAIN_WORLD_RISKS } from '@shared/world'
import MainRestoreRisks from './MainRestoreRisks.svelte'

const html = (confirmed: boolean) =>
  render(MainRestoreRisks as any, { props: { confirmed } }).body.replace(/<!--.*?-->/g, '')
const unescape = (text: string) => text.replace(/&#39;/g, "'").replace(/&apos;/g, "'")

describe('the MAIN restore confirmation', () => {
  it('lists every one of the five risks', () => {
    const body = unescape(html(false))
    expect(MAIN_WORLD_RISKS).toHaveLength(5)
    for (const risk of MAIN_WORLD_RISKS) expect(body).toContain(unescape(risk))
  })

  it('has a checkbox that is not ticked until the user confirms', () => {
    expect(html(false)).not.toMatch(/checked/)
    expect(html(true)).toMatch(/checked/)
  })
})
