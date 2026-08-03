/**
 * Svelte action: a textarea that grows to fit what is in it.
 *
 * Height is reset to `auto` before reading `scrollHeight` on purpose. Without
 * the reset, scrollHeight can never report less than the current height, so the
 * box grows and never shrinks — deleting text would leave the empty space
 * behind.
 */

const MAX_HEIGHT = 240

/**
 * The parameter exists only so Svelte re-runs `update` when the bound text
 * changes from outside — a regeneration, or an intent being seeded. Its value
 * is never read.
 */
export function autogrow(node: HTMLTextAreaElement, _value?: unknown) {
  const max = MAX_HEIGHT
  const resize = () => {
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, max)}px`
    // Only scroll once it has stopped growing, so the bar does not flicker in
    // and out on every keystroke below the cap.
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden'
  }

  node.addEventListener('input', resize)
  // The first measurement has to wait for layout; a textarea rendered into a
  // panel that is still being laid out reports a scrollHeight of zero.
  requestAnimationFrame(resize)

  return {
    /** Text set from outside — a regeneration, or the intent being seeded. */
    update: () => requestAnimationFrame(resize),
    destroy: () => node.removeEventListener('input', resize),
  }
}
