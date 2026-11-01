/**
 * Keyboard actions of the element picker, shared by the content script and the
 * sidebar.
 *
 * The content script listens for keys on the page's document, but after a
 * click on "Select an element" the keyboard focus is in the sidebar, where
 * the page's listener never sees the keys. The sidebar therefore maps the same
 * keys with this module and forwards the resulting action to the page. Both
 * sides use one mapping so a key cannot mean different things on each.
 */

export type PickerAction = 'parent' | 'child' | 'previous' | 'next' | 'confirm' | 'cancel'

const ACTIONS: Record<string, PickerAction> = {
  ArrowUp: 'parent',
  ArrowDown: 'child',
  ArrowLeft: 'previous',
  ArrowRight: 'next',
  Enter: 'confirm',
  Escape: 'cancel',
}

/** The action for a key, or null when the picker does not use the key. */
export function pickerActionFor(key: string): PickerAction | null {
  // An own-property check, so a key such as "constructor" does not resolve to
  // an inherited member of the object.
  return Object.prototype.hasOwnProperty.call(ACTIONS, key) ? (ACTIONS[key] ?? null) : null
}

/** The part of a keyboard event that the sidebar needs to decide on a key. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** Whether the event came from a control that acts on Enter by itself. */
  fromButtonLike: boolean
  /** Whether the key is held down and the browser is repeating it. */
  repeat?: boolean
}

/**
 * The action the sidebar forwards for a key press, or null to leave the key
 * alone. Keys with a modifier belong to the browser or the system. Enter is
 * left to a focused button or link, because forwarding it would confirm a pick
 * and also activate the control, for example Cancel.
 */
export function forwardedAction(event: KeyLike): PickerAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null
  const action = pickerActionFor(event.key)
  if (action === 'confirm' && event.fromButtonLike) return null
  // A held Enter would confirm again on every repeat (#118).
  if (action === 'confirm' && event.repeat) return null
  return action
}

/** The tree neighbours of an element, as far as the picker needs them. */
export interface TreeNode<T> {
  parentElement: T | null
  firstElementChild: T | null
  previousElementSibling: T | null
  nextElementSibling: T | null
}

/** The element a movement action selects, or null when there is none there. */
export function moveFrom<T extends TreeNode<T>>(
  action: PickerAction,
  current: T | null,
): T | null {
  switch (action) {
    case 'parent':
      return current?.parentElement ?? null
    case 'child':
      return current?.firstElementChild ?? null
    case 'previous':
      return current?.previousElementSibling ?? null
    case 'next':
      return current?.nextElementSibling ?? null
    default:
      return null
  }
}
