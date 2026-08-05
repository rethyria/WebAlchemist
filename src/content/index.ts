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

import type { ContentEvent, ContentMessage, PickMode } from '@shared/messages'
import type { OverlayPalette } from '@shared/accents'
import type {
  HoverTarget,
  Rect,
  Transform,
  TransformRuntimeState,
  TreePath,
  TreeRow,
} from '@shared/types'
import { captureAnchor, isBuildHashClass, resolveAnchor } from './anchor'
import { extractContext, extractElementContext } from './context'

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
  /* Sits under the capture sheet, so it dims without intercepting. */
  .dim {
    position: fixed;
    inset: 0;
    z-index: 2147483644;
    pointer-events: none;
    background: rgba(21, 20, 26, 0.42);
  }

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
    /* Reads against the dimmed page: the target is the one lit region. */
    background: rgb(from var(--wa-line) r g b / 0.16);
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
    background: rgb(from var(--wa-line) r g b / 0.1);
    opacity: 1;
  }
`

class Overlay {
  private host: HTMLDivElement | null = null
  private interactive = true
  private dim: HTMLDivElement | null = null
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

    this.dim = element('div', 'dim')
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
      root.append(
        style,
        this.dim,
        this.capture,
        this.mask,
        this.highlight,
        this.label,
        this.crop,
        this.hint,
      )
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
    if (this.dim) this.dim.style.display = 'none'
    this.mask.style.display = 'block'
    this.mask.style.clipPath =
      `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
      `${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ` +
      `${x + w}px ${y}px, ${x}px ${y}px)`
  }

  hideCrop(): void {
    if (this.crop) this.crop.style.display = 'none'
    if (this.mask) this.mask.style.display = 'none'
    if (this.dim) this.dim.style.display = 'block'
  }

  setHint(hasCrop: boolean, region = false): void {
    if (!this.hint) return
    const lead = this.hint.firstElementChild
    if (lead) {
      lead.textContent = region
        ? 'Drag the area to capture'
        : hasCrop
          ? 'Confirm or redraw'
          : 'Hover or drag'
    }
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
  // Nothing under a screenshot region is being selected, so nothing under it
  // is highlighted or resolved — the rectangle is the whole of the choice.
  if (pickMode === 'region') return
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

  if (pickMode === 'region') {
    // Too small to be a deliberate region. Left waiting rather than cancelled:
    // a stray click while aiming should not throw the user out of the mode.
    if (width < 12 || height < 12) {
      crop = null
      overlay.hideCrop()
      return
    }
    const rect = crop as Rect
    stopPicking()
    void send({
      type: 'region-selected',
      rect,
      clipped: exceedsViewport(rect),
      viewportWidth: window.innerWidth,
    })
    // The subject never stopped being the subject.
    updateLock()
    return
  }

  // A drag under a few pixels is a click, which confirms what is hovered.
  if (width < 12 || height < 12) {
    crop = null
    overlay.hideCrop()
    confirmSelection()
    return
  }

  // A real rectangle resolves to the deepest element that fully contains it,
  // and releasing the mouse is the decision. It used to wait for a separate
  // confirm, which meant the gesture that obviously ended the drag did not end
  // the pick.
  const ancestor = commonAncestor(elementsInRect(crop as Rect))
  if (ancestor) setCurrent(ancestor)
  confirmSelection()
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
      // Nothing is selected in region mode, so there is nothing to confirm —
      // the drag itself is the whole act.
      if (pickMode !== 'region') confirmSelection()
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
      if (pickMode === 'region') return
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

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

/** As far up as the chain is worth reading; a deeper one stops being a list. */
const TREE_MAX_ANCESTORS = 12
/** Generations below any element the tree opens up: children to great-grandchildren. */
const TREE_MAX_DEPTH = 3
/** The selection's own children, which are the likeliest thing to want next. */
const TREE_MAX_CHILDREN = 8
/** Everywhere else. A full list of a wide node stops being a chooser. */
const TREE_MAX_DEEP_CHILDREN = 3
/**
 * Neighbours shown on each side of the selection.
 *
 * A window rather than the whole row of them: siblings are the one part of
 * this tree with no bound at all — a feed or a nav can have hundreds, and all
 * of them are equally close to the selection. Nearest-first is the only
 * ordering that is about the selection rather than about the page.
 */
const TREE_SIBLINGS_EACH_SIDE = 3
/**
 * A ceiling on the whole thing, because the caps above multiply: three
 * generations under seven neighbours is a four-figure list on a page built
 * from small nested boxes. The selection's own subtree is expanded first, so
 * what this cuts is always a neighbour's branch, and the cut is shown.
 */
const TREE_MAX_ROWS = 200

/**
 * Elements that are in the DOM but never on the screen. They are not things
 * anyone can point at, so they are not offered as things to target — and a
 * framework-built page can carry dozens of them directly under <body>.
 */
const UNRENDERED = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'head',
  'title',
  'base',
])

/**
 * The children the tree considers, which is also what `TreePath.down` indexes.
 * Both sides of a path go through here, so the filtering cannot desynchronise
 * the two.
 */
function treeChildren(node: Element): Element[] {
  return [...node.children].filter(
    (child) =>
      !UNRENDERED.has(child.tagName.toLowerCase()) &&
      !child.hasAttribute('data-webalchemist-overlay'),
  )
}

/** Parent hops from `ancestor` down to `node`, or -1 if unrelated. */
function levelsBetween(ancestor: Element, node: Element): number {
  let levels = 0
  let cursor: Element | null = node
  while (cursor && cursor !== ancestor) {
    cursor = cursor.parentElement
    levels += 1
  }
  return cursor ? levels : -1
}

/**
 * Locates a node relative to the picked element.
 *
 * Null when the two are not related, which happens if the page rebuilt the
 * subtree between the pick and now. Callers drop the row rather than offer a
 * move that would resolve to nothing.
 */
function pathFor(node: Element): TreePath | null {
  if (!pickedRoot) return null

  let anchor: Element | null = pickedRoot
  let up = 0
  while (anchor && !anchor.contains(node)) {
    anchor = anchor.parentElement
    up += 1
  }
  if (!anchor) return null

  const down: number[] = []
  let cursor: Element = node
  while (cursor !== anchor) {
    const parent = cursor.parentElement
    if (!parent) return null
    const index = treeChildren(parent).indexOf(cursor)
    if (index < 0) return null
    down.unshift(index)
    cursor = parent
  }
  return { up, down }
}

const pathKey = (path: TreePath): string => `${path.up}:${path.down.join(',')}`

/**
 * Nodes the user asked to see in full, by path.
 *
 * The caps below are what keep a first look at a page readable; they are not
 * a judgement that the rest does not matter. Asking for one node's children
 * lifts the cap for that node alone, and only until the next pick — paths are
 * measured from the picked element, so a new one makes these meaningless.
 */
const expanded = new Set<string>()

function nodeAt(path: TreePath): Element | null {
  let node = ancestorOf(pickedRoot, path.up)
  for (const index of path.down) {
    node = (node ? treeChildren(node)[index] : undefined) ?? null
    if (!node) return null
  }
  return node
}

/**
 * The tree the panel draws: the chain above the current element, the element
 * itself, its nearest neighbours, and what is under all of them.
 *
 * Ancestors get one row each — the chain up to the root is a path, not a
 * branch, so it is the one part with nothing to fan out. Everything at and
 * below the selection's own level is a branch, which is why that half is
 * capped in every direction and says so wherever it truncates.
 *
 * The exception is the element originally picked. Once the selection has moved
 * up to an ancestor, the path back down to it is kept whatever the caps say,
 * and the depth budget re-bases there — walking up must not delete the element
 * that was picked from the list, which is the only way back to it.
 */
function buildTree(current: Element): TreeRow[] {
  const rows: TreeRow[] = []
  const origin = pickedRoot
  const originBelow = origin && origin !== current && current.contains(origin) ? origin : null

  const ancestors: Element[] = []
  let node = current.parentElement
  while (node && node !== document.documentElement && ancestors.length < TREE_MAX_ANCESTORS) {
    ancestors.push(node)
    node = node.parentElement
  }
  ancestors.reverse()

  ancestors.forEach((ancestor, index) => {
    const path = pathFor(ancestor)
    rows.push({
      label: selectorFor(ancestor),
      indent: index,
      relation: 'ancestor',
      above: ancestors.length - index,
      ...(path ? { path } : {}),
      ...(ancestor === origin ? { origin: true } : {}),
    })
  })

  /** The indent the selection and its neighbours share, being the same level. */
  const level = ancestors.length

  /** Generations still allowed below `candidate`, `depth` under its branch root. */
  const allowance = (candidate: Element, depth: number): number => {
    if (!originBelow) return TREE_MAX_DEPTH - depth
    // On the path down to the picked element: keep going, however deep it is.
    if (candidate !== originBelow && candidate.contains(originBelow)) {
      return Number.POSITIVE_INFINITY
    }
    // At or below it: the budget starts again from there rather than from here.
    if (originBelow.contains(candidate)) {
      return TREE_MAX_DEPTH - levelsBetween(originBelow, candidate)
    }
    return TREE_MAX_DEPTH - depth
  }

  let budget = TREE_MAX_ROWS

  /** Whether the user has asked for this node's children in full. */
  const opened = (node: Element): boolean => {
    const path = pathFor(node)
    return path !== null && expanded.has(pathKey(path))
  }

  const walk = (
    out: TreeRow[],
    parent: Element,
    depth: number,
    indent: number,
    relation: 'descendant' | 'sibling',
  ): void => {
    if (allowance(parent, depth) <= 0 || budget <= 0) return

    const children = treeChildren(parent)
    const cap = opened(parent)
      ? children.length
      : parent === current
        ? TREE_MAX_CHILDREN
        : TREE_MAX_DEEP_CHILDREN
    const shown = children.slice(0, cap)

    const onward = originBelow
      ? children.find((child) => child === originBelow || child.contains(originBelow))
      : undefined
    if (onward && !shown.includes(onward)) {
      shown.push(onward)
      shown.sort((a, b) => children.indexOf(a) - children.indexOf(b))
    }

    for (const [index, child] of shown.entries()) {
      if (budget <= 0) {
        // No expand path: this is the list's own ceiling rather than this
        // node's cap, and asking again would not produce different rows.
        out.push({ label: `+${children.length - index} more`, indent, relation: 'more' })
        return
      }
      const path = pathFor(child)
      out.push({
        label: selectorFor(child),
        indent,
        relation,
        ...(path ? { path } : {}),
        ...(child === origin ? { origin: true } : {}),
      })
      budget -= 1
      walk(out, child, depth + 1, indent + 1, relation)
    }

    const hidden = children.length - shown.length
    if (hidden > 0) {
      const path = pathFor(parent)
      out.push({
        label: `+${hidden} more`,
        indent,
        relation: 'more',
        ...(path ? { expand: path } : {}),
      })
    }
  }

  // Expanded before any neighbour, so a page big enough to exhaust the row
  // budget loses a neighbour's branch rather than the selection's own.
  const own: TreeRow[] = []
  walk(own, current, 0, level + 1, 'descendant')

  const parent = current.parentElement
  const family = parent ? treeChildren(parent) : [current]
  const at = family.indexOf(current)
  // The window is a cap on the parent's children like any other, so asking
  // for that parent in full is what shows every neighbour.
  const whole = parent !== null && opened(parent)
  const from = at < 0 || whole ? 0 : Math.max(0, at - TREE_SIBLINGS_EACH_SIDE)
  const to = at < 0 ? 0 : whole ? family.length : Math.min(family.length, at + TREE_SIBLINGS_EACH_SIDE + 1)
  const near = at < 0 ? [current] : family.slice(from, to)
  const parentPath = parent ? pathFor(parent) : null

  const branches = new Map<Element, TreeRow[]>()
  for (const sibling of near) {
    if (sibling === current) continue
    const branch: TreeRow[] = []
    walk(branch, sibling, 0, level + 1, 'sibling')
    branches.set(sibling, branch)
  }

  if (from > 0) {
    rows.push({
      label: `+${from} more`,
      indent: level,
      relation: 'more',
      ...(parentPath ? { expand: parentPath } : {}),
    })
  }

  for (const sibling of near) {
    const path = pathFor(sibling)
    if (sibling === current) {
      rows.push({
        label: selectorFor(current),
        indent: level,
        relation: 'current',
        above: 0,
        ...(path ? { path } : {}),
      })
      rows.push(...own)
      continue
    }
    rows.push({
      label: selectorFor(sibling),
      indent: level,
      relation: 'sibling',
      ...(path ? { path } : {}),
      ...(sibling === origin ? { origin: true } : {}),
    })
    rows.push(...(branches.get(sibling) ?? []))
  }

  if (to < family.length) {
    rows.push({
      label: `+${family.length - to} more`,
      indent: level,
      relation: 'more',
      ...(parentPath ? { expand: parentPath } : {}),
    })
  }

  return rows
}

function emitPicked(element: Element, region: Rect, drawn = false): void {
  describedElement = element
  updateLock()
  const anchor = captureAnchor(element)
  void send({
    type: 'element-picked',
    context: extractContext(element, anchor.selector),
    anchor,
    crop: region,
    cropClipped: exceedsViewport(region),
    cropDrawn: drawn,
    target: describeTarget(element),
    tree: buildTree(element),
    viewportWidth: window.innerWidth,
  })
}

function confirmSelection(): void {
  if (!current) return
  const target = current

  // The drawn rectangle doubles as the screenshot crop, so it travels with the
  // context. No image is captured here — that happens only if the user opts in
  // for a specific request, and they have already seen this exact rect.
  const drawn = crop !== null
  const region = crop ?? boundingRectWithPadding(target)

  stopPicking()

  /*
   * A reference is only something for the next request to talk about. It gets
   * no anchor, because nothing will be resolved against it on a later visit;
   * no crop, because it is not what a screenshot would frame; and it leaves
   * pickedRoot alone, so the retarget slider still measures from the real
   * target rather than from whatever was pointed at last.
   */
  if (pickMode === 'reference') {
    void send({
      type: 'element-referenced',
      element: extractElementContext(target, selectorFor(target)),
    })
    // The subject never stopped being the subject; put its outline back.
    updateLock()
    return
  }

  // Paths are measured from the picked element, so what was asked for around
  // the last one says nothing about this one.
  expanded.clear()
  pickedRoot = target
  emitPicked(target, region, drawn)
}

/**
 * Selects the node the path points at, measured from the originally picked
 * element.
 *
 * The crop is recomputed rather than carried over: it is the region a
 * screenshot would cover, and after moving to a different element the old
 * rectangle would no longer contain what is being pointed at.
 */
function retarget(path: TreePath): void {
  const node = nodeAt(path)
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

/**
 * Resolves after the next paint.
 *
 * One frame callback runs *before* the paint it was scheduled for; the second
 * is the first thing to run after it. This is the ordinary idiom for "the
 * screen now shows what I just changed", and here it is the difference between
 * a screenshot with our highlights in it and one without.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** The element the panel is describing, and how far up the chain it applies. */
let describedElement: Element | null = null
let lockDepth = 0

/**
 * What the current picking session will do with what it confirms.
 *
 * Defaults to 'target' so any path that starts picking without saying behaves
 * as it always has.
 */
let pickMode: PickMode = 'target'

/**
 * The elements a given depth covers, and the container it resolves to.
 *
 * Depth 0 is the picked element alone. Beyond that the search is confined to
 * the ancestor that many levels up — which is the point of expressing scope
 * this way. "Every element like this" without a container is not a request
 * anyone can check; "every element like this inside `ul.results`" is.
 */
function resolveScope(
  element: Element,
  depth: number,
): { targets: Element[]; container: string | null } {
  if (depth <= 0) return { targets: [element], container: null }

  const container = ancestorOf(element, depth)
  const selector = similarSelectorFor(element)
  if (!container || !selector) return { targets: [element], container: null }

  try {
    const found = [...container.querySelectorAll(selector)]
    return {
      // The picked element leads, so the panel and the overlay agree on which
      // box is the one that was actually chosen.
      targets: [element, ...found.filter((other) => other !== element)],
      container: selectorFor(container),
    }
  } catch {
    return { targets: [element], container: null }
  }
}

function updateLock(): { count: number; container: string | null } {
  if (!describedElement || !palette) return { count: 0, container: null }
  const { targets, container } = resolveScope(describedElement, lockDepth)
  lock.show(targets, palette)
  return { count: targets.length, container }
}

/** Draws a node without selecting it, for hovering the list. */
function highlightNode(path: TreePath | null): void {
  if (path === null || !palette) {
    preview.unmount()
    return
  }
  const node = nodeAt(path)
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
  overlay.setHint(false, pickMode === 'region')

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

/**
 * Guards against a second copy of this script running in the same tab.
 *
 * `scripting.executeScript` re-runs the file every time it is called, and each
 * run is a fresh module with its own overlay, lock and listeners. Starting the
 * picker then went to all of them: every one mounted its own dimming layer and
 * its own event-swallowing sheet, so the page got darker with each visit to
 * the picker and stayed in pick mode after leaving it.
 *
 * The flag lives on the sandbox global, which is shared between content
 * scripts of this extension in this tab, rather than on the page — a
 * persistent attribute in the DOM would hand every site a way to detect the
 * extension.
 */
const LOADED = '__webAlchemistContentLoaded'
const sandbox = globalThis as unknown as Record<string, unknown>

if (!sandbox[LOADED]) {
  sandbox[LOADED] = true
  browser.runtime.onMessage.addListener(handleMessage)
}

async function handleMessage(message: ContentMessage) {
  switch (message.type) {
    case 'start-picking':
      palette = message.palette
      pickMode = message.mode
      preview.unmount()
      /*
       * A reference pick keeps the subject. Only a target pick replaces it, so
       * only a target pick may take the outline down — clearing it here
       * unconditionally would make pointing at a second element look like it
       * had thrown the first one away.
       */
      if (pickMode === 'target') {
        lock.hide()
        describedElement = null
      }
      startPicking(message.palette)
      return true
    case 'recapture': {
      // Re-read from the live DOM, which by now carries the preview.
      if (!describedElement || !describedElement.isConnected) return null
      return extractContext(describedElement, captureAnchor(describedElement).selector)
    }
    case 'cancel-picking':
      stopPicking()
      return true
    case 'retarget':
      preview.unmount()
      retarget(message.path)
      return true
    case 'highlight-node':
      highlightNode(message.path)
      return true
    case 'expand-node': {
      // Answers with the tree rather than announcing a pick: nothing about
      // what is being described has changed, only how much of it is listed.
      if (!describedElement || !describedElement.isConnected) return null
      expanded.add(pathKey(message.path))
      return buildTree(describedElement)
    }
    case 'set-lock-scope': {
      lockDepth = message.depth
      return updateLock()
    }
    case 'set-lock-visible':
      // Rebuilt from describedElement rather than restored, so the boxes come
      // back where the elements are now rather than where they were.
      if (message.visible) {
        updateLock()
        return true
      }
      /*
       * Everything of ours, not just the outline. The hover preview draws its
       * own boxes and the picker its own sheet, and a capture is a picture of
       * whatever is on screen — it does not care which of our overlays drew it.
       */
      lock.hide()
      preview.unmount()
      overlay.unmount()
      /*
       * Removing the nodes is not the same as the page having been drawn
       * without them. captureVisibleTab grabs the frame the compositor has,
       * so returning as soon as the DOM changed meant the screenshot could
       * still contain the highlights it had just taken down.
       */
      await nextPaint()
      return true

    case 'clear-lock':
      describedElement = null
      lockDepth = 0
      lock.hide()
      return true
    case 'run-health-check':
      return { type: 'health-check-result', states: await runHealthCheck(message.transforms) }
    case 'ping':
      return true
    case 'url-changed':
      // Re-evaluation is driven from the background script, which owns the
      // record set; nothing to do here beyond dropping picker state.
      stopPicking()
      return true
    case 'apply-transforms':
      return true
  }
}
