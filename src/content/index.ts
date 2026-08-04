/**
 * Content script. Injected under activeTab when the user starts picking, and on
 * granted origins for health checks.
 *
 * It handles element selection and anchor health, and nothing else. Intent
 * text, model output, generated code, and review verdicts never enter this
 * context — they live in the sidebar, which is browser chrome the page cannot
 * read. The only thing rendered into the page is a highlight, which carries no
 * sensitive content.
 */

import type { ContentEvent, ContentMessage } from '@shared/messages'
import type { OverlayPalette } from '@shared/accents'
import type { HoverTarget, Rect, Transform, TransformRuntimeState } from '@shared/types'
import { captureAnchor, isBuildHashClass, resolveAnchor } from './anchor'
import { extractContext } from './context'

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

/**
 * The overlay lives in a shadow root with a full property reset. It renders on
 * top of arbitrary sites, so nothing may be inherited from the page and nothing
 * may leak into it.
 */
const OVERLAY_STYLES = `
  :host { all: initial; }

  /*
   * The accent arrives as --wa-line / --wa-on, set on the host when picking
   * starts. Everything else is fixed rather than themed: this renders over
   * pages we do not control, so it cannot inherit a palette, and light-dark()
   * would follow the *page's* colour scheme rather than the panel's.
   *
   * The two-tone halo is what makes it work on an arbitrary background: a dark
   * ring immediately outside the edge, a light ring outside that. One of the
   * two always separates the outline from whatever is behind it.
   */
  /*
   * A transparent sheet over the whole viewport, and the only part of the
   * overlay that takes pointer events.
   *
   * Everything else here draws; this one intercepts. With it in place the page
   * never sees a hover, which is what removes the pointer cursor over links and
   * stops Firefox showing the link target in the status bar — neither of which
   * can be suppressed once the pointer is genuinely over an anchor.
   *
   * It also means real clicks land here rather than on the page, so activating
   * what you point at stops being possible by construction rather than by
   * catching events after the fact.
   */
  .capture {
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    cursor: crosshair;
    /* A drag across the page would otherwise select text under the pointer. */
    user-select: none;
    -moz-user-select: none;
  }

  .highlight {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    box-sizing: border-box;
    outline: 2px solid var(--wa-line);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.95), 0 0 0 4px rgba(255, 255, 255, 0.55);
    transition: all 60ms linear;
  }
  .highlight.locked { outline-style: dashed; }

  .label {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 7px;
    border: 1px solid rgba(0, 0, 0, 0.85);
    border-radius: 3px;
    background: var(--wa-line);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--wa-on);
    white-space: nowrap;
  }
  .label .size {
    font-weight: 400;
    opacity: 0.7;
  }

  /*
   * The crop is the consent surface — it is the literal boundary of what gets
   * sent. Dimming everything outside it, rather than tinting the inside, is
   * what makes the boundary legible: the bright region is the payload.
   */
  .mask {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
    background: rgba(21, 20, 26, 0.5);
  }
  .crop {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    box-sizing: border-box;
    border: 1.5px solid var(--wa-line);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.9), 0 0 0 3px rgba(255, 255, 255, 0.45);
  }
  .handle {
    position: absolute;
    width: 9px;
    height: 9px;
    background: var(--wa-line);
    border: 1px solid rgba(0, 0, 0, 0.8);
  }
  .handle.tl { top: -8px; left: -8px; }
  .handle.tr { top: -8px; right: -8px; }
  .handle.bl { bottom: -8px; left: -8px; }
  .handle.br { bottom: -8px; right: -8px; }

  .hint {
    position: fixed;
    pointer-events: none;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 6px;
    background: rgba(21, 20, 26, 0.93);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    font: 11.5px system-ui, sans-serif;
    color: #fbfbfe;
    white-space: nowrap;
  }
  .hint .rule {
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.2);
  }
  .hint kbd {
    padding: 3px 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.13);
    font: 10.5px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fbfbfe;
  }
  .hint .keys { display: flex; gap: 5px; }
  .hint .muted { color: rgba(251, 251, 254, 0.6); }
`

/**
 * The persistent outline around what is being transformed.
 *
 * Separate from the picker overlay because it outlives it: once an element is
 * confirmed the picker tears down, but the panel spends the rest of the flow
 * talking about that element, and it should stay visible on the page while it
 * does.
 *
 * It draws N boxes rather than one so 'every one like it' can show what that
 * actually means — the count in the panel is a number, and the boxes are the
 * evidence behind it.
 */
class LockOverlay {
  private host: HTMLDivElement | null = null
  private root: ShadowRoot | null = null
  private targets: Element[] = []
  private frame = 0

  show(elements: Element[], colours: OverlayPalette): void {
    this.targets = elements
    if (!this.host) {
      this.host = document.createElement('div')
      this.host.setAttribute('data-webalchemist-overlay', '')
      this.host.style.setProperty('--wa-line', colours.line)
      this.root = this.host.attachShadow({ mode: 'closed' })
      const style = document.createElement('style')
      style.textContent = LOCK_STYLES
      this.root.append(style)
      document.documentElement.append(this.host)
      // Boxes are positioned in viewport coordinates, so they have to be
      // redrawn as the page moves under them or they drift immediately.
      addEventListener('scroll', this.reposition, true)
      addEventListener('resize', this.reposition)
    }
    this.draw()
  }

  hide(): void {
    removeEventListener('scroll', this.reposition, true)
    removeEventListener('resize', this.reposition)
    cancelAnimationFrame(this.frame)
    this.host?.remove()
    this.host = null
    this.root = null
    this.targets = []
  }

  private reposition = (): void => {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.draw())
  }

  private draw(): void {
    const root = this.root
    if (!root) return
    const style = root.querySelector('style')
    root.replaceChildren(...(style ? [style] : []))

    this.targets.forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      // Elements scrolled far out of view are skipped rather than drawn at the
      // edge, where they would read as a match that is actually somewhere else.
      if (rect.bottom < -40 || rect.top > innerHeight + 40) return
      const box = document.createElement('div')
      box.className = index === 0 ? 'lock primary' : 'lock'
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      root.append(box)
    })
  }
}

const LOCK_STYLES = `
  :host { all: initial; }
  .lock {
    position: fixed;
    pointer-events: none;
    z-index: 2147483640;
    box-sizing: border-box;
    outline: 1.5px dashed var(--wa-line);
    /* Fainter than the picker's: this sits on screen for the whole flow and
       must not compete with the page it is describing. */
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
    opacity: 0.65;
  }
  /* The one that was actually picked, among its lookalikes. */
  .lock.primary {
    outline-width: 2px;
    opacity: 1;
  }
`

class Overlay {
  private host: HTMLDivElement | null = null
  private interactive = true
  private capture: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private label: HTMLDivElement | null = null
  private mask: HTMLDivElement | null = null
  private crop: HTMLDivElement | null = null
  private hint: HTMLDivElement | null = null

  mount(palette: OverlayPalette, interactive = true): void {
    if (this.host) return
    this.interactive = interactive
    this.host = document.createElement('div')
    this.host.setAttribute('data-webalchemist-overlay', '')
    // The accent, handed in from the background where settings live.
    this.host.style.setProperty('--wa-line', palette.line)
    this.host.style.setProperty('--wa-on', palette.labelText)
    const root = this.host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = OVERLAY_STYLES

    this.capture = element('div', 'capture')
    this.highlight = element('div', 'highlight')
    this.label = element('div', 'label')
    this.mask = element('div', 'mask')
    this.crop = element('div', 'crop')
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      this.crop.append(element('div', `handle ${corner}`))
    }
    this.hint = this.buildHint()

    this.hideCrop()
    // A preview draws only. Giving it the capture sheet would put a
    // click-swallowing layer over the page while the user is reading a list.
    if (this.interactive) {
      root.append(style, this.capture, this.mask, this.highlight, this.label, this.crop, this.hint)
    } else {
      this.highlight.classList.add('locked')
      root.append(style, this.highlight, this.label)
    }
    document.documentElement.append(this.host)
  }

  unmount(): void {
    this.host?.remove()
    this.host = null
  }

  showElement(target: Element, selector: string): void {
    if (!this.highlight || !this.label) return
    const rect = target.getBoundingClientRect()
    Object.assign(this.highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })

    this.label.replaceChildren(
      text('span', selector),
      text('span', `${Math.round(rect.width)} × ${Math.round(rect.height)}`, 'size'),
    )
    // Flip below the element when there is no room above it.
    const above = rect.top > 30
    Object.assign(this.label.style, {
      display: 'flex',
      left: `${Math.max(4, rect.left - 2)}px`,
      top: above ? `${rect.top - 27}px` : `${rect.bottom + 6}px`,
    })
  }

  showCrop(rect: Rect): void {
    if (!this.crop || !this.mask) return
    Object.assign(this.crop.style, {
      display: 'block',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })

    // A hole punched in the dimming layer, traced back to the start point so
    // the path stays a single closed polygon.
    const { x, y, width: w, height: h } = rect
    this.mask.style.display = 'block'
    this.mask.style.clipPath =
      `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
      `${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ` +
      `${x + w}px ${y}px, ${x}px ${y}px)`
  }

  hideCrop(): void {
    if (this.crop) this.crop.style.display = 'none'
    if (this.mask) this.mask.style.display = 'none'
  }

  setHint(hasCrop: boolean): void {
    if (!this.hint) return
    const lead = this.hint.firstElementChild
    if (lead) lead.textContent = hasCrop ? 'Confirm or redraw' : 'Hover or drag'
    this.hint.querySelector('.redraw')?.setAttribute(
      'style',
      hasCrop ? '' : 'display:none',
    )
  }

  private buildHint(): HTMLDivElement {
    const bar = element('div', 'hint')
    bar.append(text('span', 'Hover or drag'), element('span', 'rule'))

    const keys = element('div', 'keys')
    for (const key of ['↑', '↓', '←', '→']) keys.append(text('kbd', key))
    bar.append(keys, element('span', 'rule'))

    const confirm = text('span', '')
    confirm.append(text('kbd', '↵'), text('span', ' confirm'))
    const redraw = text('span', 'redraw', 'muted redraw')
    redraw.setAttribute('style', 'display:none')
    const cancel = text('span', '', 'muted')
    cancel.append(text('kbd', 'esc'), text('span', ' cancel'))

    bar.append(confirm, redraw, cancel)
    return bar
  }
}

function element(tag: string, className: string): HTMLDivElement {
  const node = document.createElement(tag) as HTMLDivElement
  node.className = className
  return node
}

function text(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  node.textContent = content
  if (className) node.className = className
  return node
}

const overlay = new Overlay()
const lock = new LockOverlay()
/** Separate instance: a preview may be shown while the picker is not running. */
const preview = new Overlay()
/** Kept so previews and retargets can draw in the user's accent after picking. */
let palette: OverlayPalette | null = null

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

let current: Element | null = null
let dragOrigin: { x: number; y: number } | null = null
let crop: Rect | null = null
let picking = false

/** Short label for a single element: `aside.rail`, `div#root`, `main`. */
function selectorFor(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (element.id) return `${tag}#${element.id}`
  const cls = [...element.classList].find((token) => !isBuildHashClass(token))
  return cls ? `${tag}.${cls}` : tag
}

/**
 * Root first, target last. The panel renders the last entry as the chip, and
 * the whole chain as the ancestor list.
 *
 * Capped because a deeply nested element on a framework-built page can sit
 * twenty wrappers down, and a list that long is not a chooser any more.
 */
const MAX_BREADCRUMB = 12

function breadcrumbFor(element: Element): string[] {
  const parts: string[] = []
  let node: Element | null = element
  while (node && node !== document.documentElement && parts.length < MAX_BREADCRUMB) {
    parts.unshift(selectorFor(node))
    node = node.parentElement
  }
  return parts
}

function describeTarget(element: Element): HoverTarget {
  const rect = element.getBoundingClientRect()
  const role = element.getAttribute('role')
  return {
    breadcrumb: breadcrumbFor(element),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    ...(role ? { role } : {}),
    ...(crop ? { crop } : {}),
    drawing: dragOrigin !== null,
  }
}

function publishTarget(): void {
  if (!current) return
  void send({ type: 'element-hovered', target: describeTarget(current) })
}

function setCurrent(element: Element | null): void {
  if (!element || element === current) return
  // Never let the picker select its own overlay.
  if (element.closest('[data-webalchemist-overlay]')) return
  current = element
  overlay.showElement(element, selectorFor(element))
  publishTarget()
}

/**
 * The topmost page element at a point, ignoring our own overlay.
 *
 * `elementFromPoint` would now always return the capture sheet, so this walks
 * the hit list instead and takes the first thing that is not ours.
 */
function elementUnder(x: number, y: number): Element | null {
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!candidate.closest('[data-webalchemist-overlay]')) return candidate
  }
  return null
}

function onMouseMove(event: MouseEvent): void {
  if (dragOrigin) {
    crop = {
      x: Math.min(dragOrigin.x, event.clientX),
      y: Math.min(dragOrigin.y, event.clientY),
      width: Math.abs(event.clientX - dragOrigin.x),
      height: Math.abs(event.clientY - dragOrigin.y),
    }
    overlay.showCrop(crop)
    return
  }
  // Once a rectangle exists it owns the selection; moving the mouse must not
  // silently retarget underneath it.
  if (crop) return
  setCurrent(elementUnder(event.clientX, event.clientY))
}

function onMouseDown(event: MouseEvent): void {
  dragOrigin = { x: event.clientX, y: event.clientY }
  crop = null
  overlay.hideCrop()
  event.preventDefault()
  event.stopPropagation()
}

function onMouseUp(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()

  if (!dragOrigin) return
  const width = Math.abs(event.clientX - dragOrigin.x)
  const height = Math.abs(event.clientY - dragOrigin.y)
  dragOrigin = null

  // A drag under a few pixels is a click, which confirms what is hovered.
  if (width < 12 || height < 12) {
    crop = null
    overlay.hideCrop()
    confirmSelection()
    return
  }

  // A real rectangle resolves to the deepest element that fully contains it,
  // then waits. Drawing a region is not the same act as approving it, and the
  // rectangle is what a screenshot would send — the user confirms it
  // explicitly.
  const ancestor = commonAncestor(elementsInRect(crop as Rect))
  if (ancestor) setCurrent(ancestor)
  overlay.setHint(true)
  publishTarget()
}

function elementsInRect(rect: Rect): Element[] {
  const found = new Set<Element>()
  const steps = 6
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const x = rect.x + (rect.width * i) / steps
      const y = rect.y + (rect.height * j) / steps
      const element = elementUnder(x, y)
      if (element) found.add(element)
    }
  }
  return [...found]
}

function commonAncestor(elements: Element[]): Element | null {
  if (elements.length === 0) return null
  const first = elements[0]
  if (!first) return null
  let ancestor: Element | null = first
  for (const element of elements.slice(1)) {
    while (ancestor && !ancestor.contains(element)) ancestor = ancestor.parentElement
  }
  return ancestor
}

function onKeyDown(event: KeyboardEvent): void {
  if (!picking) return

  const handled = () => {
    event.preventDefault()
    event.stopPropagation()
  }

  switch (event.key) {
    case 'Escape':
      handled()
      stopPicking()
      void send({ type: 'picking-cancelled' })
      return
    case 'Enter':
      handled()
      confirmSelection()
      return
    case 'Backspace':
      if (!crop) return
      handled()
      crop = null
      overlay.hideCrop()
      overlay.setHint(false)
      publishTarget()
      return
    case 'ArrowUp':
      handled()
      setCurrent(current?.parentElement ?? null)
      return
    case 'ArrowDown':
      handled()
      setCurrent(current?.firstElementChild ?? null)
      return
    case 'ArrowLeft':
      handled()
      setCurrent(current?.previousElementSibling ?? null)
      return
    case 'ArrowRight':
      handled()
      setCurrent(current?.nextElementSibling ?? null)
      return
  }
}

/**
 * The element originally confirmed in the overlay.
 *
 * Every retarget is measured from here rather than from the current target.
 * Walking relatively would make the steps cumulative and one-way: after moving
 * up twice there would be no way back down, because the descendants are no
 * longer on the path.
 */
let pickedRoot: Element | null = null

function ancestorOf(element: Element | null, levelsUp: number): Element | null {
  let node = element
  for (let i = 0; i < levelsUp && node?.parentElement; i += 1) node = node.parentElement
  return node
}

function emitPicked(element: Element, region: Rect): void {
  describedElement = element
  updateLock()
  const anchor = captureAnchor(element)
  void send({
    type: 'element-picked',
    context: extractContext(element, anchor.selector),
    anchor,
    crop: region,
    cropClipped: exceedsViewport(region),
    target: describeTarget(element),
    viewportWidth: window.innerWidth,
  })
}

function confirmSelection(): void {
  if (!current) return
  const target = current

  // The drawn rectangle doubles as the screenshot crop, so it travels with the
  // context. No image is captured here — that happens only if the user opts in
  // for a specific request, and they have already seen this exact rect.
  const region = crop ?? boundingRectWithPadding(target)

  stopPicking()
  pickedRoot = target
  emitPicked(target, region)
}

/**
 * Selects the ancestor `levelsUp` above the originally picked element.
 *
 * The crop is recomputed rather than carried over: it is the region a
 * screenshot would cover, and after moving to a larger ancestor the old
 * rectangle would no longer contain what is being pointed at.
 */
function retarget(levelsUp: number): void {
  const node = ancestorOf(pickedRoot, levelsUp)
  if (!node) return
  emitPicked(node, boundingRectWithPadding(node))
}

/**
 * What "every one like it" means, decided here rather than by the model.
 *
 * The scope control is offered before generation, so there is no
 * model-written selector to count yet. This is the extension's own reading,
 * and it is what the boxes on the page show — so the user sees the set they
 * are about to ask for rather than being told a number.
 *
 * Deliberately conservative. A selector that is too broad would light up half
 * the page and misrepresent the request; too narrow simply shows fewer boxes,
 * which is the safer way to be wrong.
 */
function similarSelectorFor(element: Element): string | null {
  const tag = element.tagName.toLowerCase()
  const classes = [...element.classList].filter((token) => !isBuildHashClass(token))

  if (classes.length > 0) {
    return `${tag}.${classes.map((c) => CSS.escape(c)).join('.')}`
  }

  const role = element.getAttribute('role')
  if (role) return `${tag}[role="${CSS.escape(role)}"]`

  // With nothing distinguishing it, siblings of the same tag are the most
  // defensible reading — a bare tag selector would match the whole document.
  const parent = element.parentElement
  if (!parent) return null
  const parentSelector = selectorFor(parent)
  return `${parentSelector} > ${tag}`
}

function similarTo(element: Element): Element[] {
  const selector = similarSelectorFor(element)
  if (!selector) return [element]
  try {
    const found = [...document.querySelectorAll(selector)]
    // The picked element leads, so the panel and the overlay agree on which
    // box is the one that was actually chosen.
    return [element, ...found.filter((other) => other !== element)]
  } catch {
    return [element]
  }
}

/** The element the panel is describing, and how widely it is being applied. */
let describedElement: Element | null = null
let lockScope: 'element' | 'similar' = 'element'

function updateLock(): number {
  if (!describedElement || !palette) return 0
  const targets = lockScope === 'similar' ? similarTo(describedElement) : [describedElement]
  lock.show(targets, palette)
  return targets.length
}

/** Draws an ancestor without selecting it, for hovering the list. */
function highlightAncestor(levelsUp: number | null): void {
  if (levelsUp === null || !palette) {
    preview.unmount()
    return
  }
  const node = ancestorOf(pickedRoot, levelsUp)
  if (!node) return
  preview.mount(palette, false)
  preview.showElement(node, selectorFor(node))
}

/** Falls back to the element's box plus padding so the model sees some context. */
function boundingRectWithPadding(element: Element): Rect {
  const PADDING = 12
  const rect = element.getBoundingClientRect()
  return {
    x: Math.max(0, rect.left - PADDING),
    y: Math.max(0, rect.top - PADDING),
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  }
}

/**
 * captureVisibleTab can only photograph what is on screen. A region taller
 * than the viewport comes back cut, and the describe step says so rather than
 * sending a partial crop that looks complete.
 */
function exceedsViewport(rect: Rect): boolean {
  return (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > window.innerWidth ||
    rect.y + rect.height > window.innerHeight
  )
}

/**
 * Everything the page must not receive while the picker is active.
 *
 * Stopping `mousedown` and `mouseup` is not enough, which is the bug this
 * exists to fix: the browser synthesises `click` separately after a
 * down/up pair, so picking a button pressed it and picking a link followed it.
 * `preventDefault` on `mousedown` does not suppress that either — the click
 * has to be swallowed in its own right.
 *
 * Pointer and touch events are here because plenty of sites are built on those
 * rather than mouse events, and `dragstart` because pressing on a link or
 * image and moving — which is exactly the drag gesture — otherwise begins a
 * native drag.
 *
 * Scroll events are deliberately absent. Scrolling the page to reach something
 * further down is part of picking, not an interaction to suppress.
 */
const SWALLOWED_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'dragstart',
  'keydown',
  'keyup',
  'keypress',
  'submit',
] as const

/**
 * Hidden from the page, but *not* cancelled.
 *
 * Calling preventDefault on a pointer or touch event suppresses the
 * compatibility mouse events the browser would otherwise synthesise from it —
 * including the mousedown and mouseup this picker runs on. Cancelling these
 * would stop the page reacting and stop the picker working at the same time.
 *
 * Blocking propagation is enough: the page never sees them, and the mouse
 * events they generate are cancelled by the list above.
 */
const MUFFLED_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointercancel',
  'touchstart',
  'touchend',
  'touchcancel',
] as const

/**
 * Registered after the picker's own handlers, so those still run.
 *
 * `stopImmediatePropagation` stops other listeners on this same node, which is
 * why the ordering matters and why the picker's handlers must not call it
 * themselves.
 */
function swallow(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function muffle(event: Event): void {
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function detachSwallow(): void {
  for (const type of SWALLOWED_EVENTS) {
    document.removeEventListener(type, swallow, true)
  }
  for (const type of MUFFLED_EVENTS) {
    document.removeEventListener(type, muffle, true)
  }
}

const TRAILING_EVENTS = ['click', 'auxclick', 'dblclick'] as const

/**
 * Swallows the one click that arrives *after* picking has ended.
 *
 * Confirming a selection happens on mouseup, and mouseup tears the picker
 * down — but the browser has not dispatched the click yet. Removing the
 * listeners at that moment leaves nothing to catch it, so the click lands on
 * whatever was just picked: a button is pressed, a link is followed.
 *
 * This was the actual cause of picking activating elements, and it is why
 * swallowing `click` during picking was not enough on its own. It is also
 * invisible to any test that dispatches a bare click, because without a
 * preceding mousedown and mouseup the teardown never runs.
 *
 * One shot, then out of the way, so a deliberate click a moment later works.
 */
function guardTrailingClick(): void {
  const swallowOnce = (event: Event) => {
    swallow(event)
    cleanup()
  }
  const cleanup = () => {
    clearTimeout(timer)
    for (const type of TRAILING_EVENTS) {
      document.removeEventListener(type, swallowOnce, true)
    }
  }

  for (const type of TRAILING_EVENTS) {
    document.addEventListener(type, swallowOnce, { capture: true, passive: false })
  }
  // Nothing trailing arrives when picking ends via Escape or Enter.
  const timer = setTimeout(cleanup, 700)
}

function startPicking(palette: OverlayPalette): void {
  if (picking) return
  picking = true
  crop = null
  overlay.mount(palette)
  overlay.setHint(false)

  // The picker's own handlers first, so they see the event before it is
  // swallowed below.
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('keydown', onKeyDown, true)

  for (const type of SWALLOWED_EVENTS) {
    document.addEventListener(type, swallow, { capture: true, passive: false })
  }
  for (const type of MUFFLED_EVENTS) {
    document.addEventListener(type, muffle, true)
  }
}

function stopPicking(): void {
  picking = false
  current = null
  dragOrigin = null
  crop = null
  overlay.unmount()
  document.removeEventListener('mousemove', onMouseMove, true)
  document.removeEventListener('mousedown', onMouseDown, true)
  document.removeEventListener('mouseup', onMouseUp, true)
  document.removeEventListener('keydown', onKeyDown, true)

  detachSwallow()
  // The click completing the mouseup that got us here has not fired yet.
  guardTrailingClick()
}

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

/**
 * On a slow SPA an element that has not rendered yet is indistinguishable from
 * one that is gone. Without this grace period every transform on every SPA
 * reports as broken on every load, and the signal becomes noise the user learns
 * to ignore.
 */
const GRACE_PERIOD_MS = 3000

async function runHealthCheck(transforms: Transform[]): Promise<TransformRuntimeState[]> {
  const pending = new Map(transforms.map((t) => [t.id, t]))
  const states: TransformRuntimeState[] = []

  const settle = () => {
    for (const [id, transform] of pending) {
      const resolution = resolveAnchor(transform.anchor)
      if (resolution) {
        states.push({ id, status: 'ok' })
        pending.delete(id)
      }
    }
  }

  settle()
  if (pending.size === 0) return states

  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      settle()
      if (pending.size === 0) {
        observer.disconnect()
        resolve()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
      resolve()
    }, GRACE_PERIOD_MS)
  })

  // Anything still unresolved after the grace period is genuinely broken.
  for (const [id, transform] of pending) {
    const failed = transform.rationale.assumptions[0]
    states.push({
      id,
      status: 'broken',
      brokenReason: `Nothing on this page matches ${transform.anchor.selector}`,
      ...(failed ? { failedAssumption: failed } : {}),
    })
  }

  return states
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

/**
 * Broadcast to every extension page. An open sidebar receives it; a closed one
 * does not, and that is not an error worth reporting — with no listener the
 * send rejects, so the rejection is swallowed rather than left unhandled.
 */
function send(event: ContentEvent): Promise<unknown> {
  return browser.runtime.sendMessage(event).catch(() => undefined)
}

browser.runtime.onMessage.addListener(async (message: ContentMessage) => {
  switch (message.type) {
    case 'start-picking':
      palette = message.palette
      preview.unmount()
      // The previous target stops being the subject the moment picking starts.
      lock.hide()
      describedElement = null
      startPicking(message.palette)
      return true
    case 'cancel-picking':
      stopPicking()
      return true
    case 'retarget':
      preview.unmount()
      retarget(message.levelsUp)
      return true
    case 'highlight-ancestor':
      highlightAncestor(message.levelsUp)
      return true
    case 'set-lock-scope':
      lockScope = message.scope
      return { type: 'lock-count', count: updateLock() }
    case 'clear-lock':
      describedElement = null
      lockScope = 'element'
      lock.hide()
      return true
    case 'run-health-check':
      return { type: 'health-check-result', states: await runHealthCheck(message.transforms) }
    case 'url-changed':
      // Re-evaluation is driven from the background script, which owns the
      // record set; nothing to do here beyond dropping picker state.
      stopPicking()
      return true
    case 'apply-transforms':
      return true
  }
})
