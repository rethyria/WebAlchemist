/**
 * The error card's rendered text for a refused request (issue 153), checked by
 * rendering the real component to HTML with Svelte's server renderer. This
 * covers which buttons the template prints and not what a click does.
 */

import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import ErrorCard from './ErrorCard.svelte'

function html(error: Record<string, unknown>, retry: (() => void) | null) {
  const noop = () => {}
  return render(ErrorCard as any, {
    props: {
      error,
      onretry: retry,
      onsettings: noop,
      onmodelsettings: noop,
      ondismiss: noop,
      ondiscard: noop,
    },
  }).body
}

describe('the card for a refused request', () => {
  it.each(['review', 'generation'])('offers Discard and no retry for a refused %s', (subject) => {
    const body = html({ kind: 'refused', subject, message: 'Declined message.' }, null)
    expect(body).toContain('Declined message.')
    expect(body).toContain('Discard')
    expect(body).not.toContain('Try again')
  })

  it('offers no retry even when a retry action is supplied', () => {
    const body = html({ kind: 'refused', subject: 'review', message: 'm' }, () => {})
    expect(body).not.toContain('Try again')
  })

  it('still offers Try again on a failed request (control)', () => {
    const body = html({ kind: 'request-failed', message: 'Network down.' }, () => {})
    expect(body).toContain('Try again')
  })
})
