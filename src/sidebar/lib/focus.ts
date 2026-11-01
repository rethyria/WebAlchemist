/**
 * Keyboard focus when a panel replaces another.
 *
 * Each step of the flow is a separate component that the sidebar swaps in. A
 * swap removes the element that had the focus, so without a move the focus
 * returns to the top of the document and a keyboard or screen reader user has
 * to tab through the header again. Each step marks one element, its heading or
 * its first control, with this action so the focus lands there.
 */

/** Elements that take focus without a tabindex. */
const NATIVELY_FOCUSABLE = 'button, a[href], input, textarea, select, summary'

/**
 * Whether an element needs `tabindex="-1"` before it can take focus from a
 * script. A heading or a container does; a button or a field does not, and
 * adding the attribute to them would not change their place in the tab order.
 */
export function needsTabindex(element: Pick<Element, 'matches' | 'hasAttribute'>): boolean {
  return !element.hasAttribute('tabindex') && !element.matches(NATIVELY_FOCUSABLE)
}

/**
 * Whether a script may move the focus now. A step can change because a late
 * event arrived, for example a health check result or a finished generation,
 * while the user is typing in the page. A move then would take the keyboard
 * from the page, so it is skipped when the sidebar does not have the focus
 * (#39).
 */
export function mayMoveFocus(doc: Pick<Document, 'hasFocus'>): boolean {
  return doc.hasFocus()
}

/** Svelte action: moves the focus to the element when it is added to the page. */
export function focusOnMount(node: HTMLElement): void {
  if (!mayMoveFocus(document)) return
  if (needsTabindex(node)) node.tabIndex = -1
  // preventScroll: the panel is already at the top, and a scroll would hide the
  // header the user has just been looking at.
  node.focus({ preventScroll: true })
}

/**
 * Whether the flow has just returned to the transform list from another
 * step, which is when the list needs to take the focus. At start-up there is
 * no previous step and the focus is left where the browser put it.
 */
export function returnedToList(previous: string | null, step: string): boolean {
  return previous !== null && previous !== 'list' && step === 'list'
}

/** Moves the focus to the transform list's marked element, when a move is allowed. */
export function focusList(doc: Pick<Document, 'hasFocus' | 'querySelector'>): void {
  if (!mayMoveFocus(doc)) return
  doc.querySelector<HTMLElement>('[data-list-focus]')?.focus()
}
