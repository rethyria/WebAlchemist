/**
 * Keyboard behaviour for custom radio groups (`role="radiogroup"` containing
 * `role="radio"` buttons).
 *
 * The WAI-ARIA radio pattern gives a group one tab stop and moves the
 * selection with the arrow keys. The buttons here were each a tab stop and
 * ignored the arrow keys, so a group of five was five tab presses and the
 * arrow keys did nothing. The decisions are pure functions so they can be
 * tested; `radioGroup` applies them to the page.
 */

/**
 * The index the arrow, Home or End key moves to, or null for any other key.
 * Movement wraps at both ends, as native radio buttons do.
 */
export function radioTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The one radio that stays in the tab order: the checked one, or the first
 * when none is checked, so a group with no selection can still be entered.
 */
export function tabStopIndex(checked: boolean[]): number {
  const index = checked.indexOf(true)
  return index === -1 ? 0 : index
}

const RADIO = '[role="radio"]:not([disabled])'

/** Svelte action for the element that has `role="radiogroup"`. */
export function radioGroup(group: HTMLElement): { destroy(): void } {
  const radios = () => [...group.querySelectorAll<HTMLElement>(RADIO)]

  function applyTabStops(): void {
    const items = radios()
    const stop = tabStopIndex(items.map((item) => item.getAttribute('aria-checked') === 'true'))
    items.forEach((item, index) => {
      const wanted = index === stop ? '0' : '-1'
      // Written only on a change, because the observer below watches
      // attributes and would otherwise see its own writes.
      if (item.getAttribute('tabindex') !== wanted) item.setAttribute('tabindex', wanted)
    })
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const items = radios()
    const from = items.findIndex((item) => item === document.activeElement)
    if (from === -1) return
    const to = radioTarget(event.key, from, items.length)
    if (to === null) return
    event.preventDefault()
    const next = items[to]
    next?.focus()
    // Moving to a radio selects it, as with native radio buttons.
    next?.click()
  }

  // The checked state changes through the component's own attributes, so the
  // tab stop follows it from here instead of from each component.
  const observer = new MutationObserver(applyTabStops)
  observer.observe(group, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'disabled'],
  })
  group.addEventListener('keydown', onkeydown)
  applyTabStops()

  return {
    destroy() {
      observer.disconnect()
      group.removeEventListener('keydown', onkeydown)
    },
  }
}
