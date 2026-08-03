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
   * Every colour here is fixed rather than themed. The overlay renders over
   * pages we do not control, so it cannot rely on a surrounding palette, and
   * light-dark() would follow the *page's* scheme rather than the panel's.
   *
   * The two-tone halo is what makes it work on an arbitrary background: a dark
   * ring immediately outside the edge, a light ring outside that. One of the
   * two always separates the outline from whatever is behind it.
   */
  .highlight {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    box-sizing: border-box;
    outline: 2px solid #00ddff;
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
    background: #00ddff;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #15141a;
    white-space: nowrap;
  }
  .label .size {
    font-weight: 400;
    color: rgba(21, 20, 26, 0.7);
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
    border: 1.5px solid #00ddff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.9), 0 0 0 3px rgba(255, 255, 255, 0.45);
  }
  .handle {
    position: absolute;
    width: 9px;
    height: 9px;
    background: #00ddff;
    border: 1px solid rgba(0, 0, 0, 0.8);
  }
  .handle.tl { top: -8px; left: -8px; }
  .handle.tr { top: -8px; right: -8px; }
  .handle.bl { bottom: -8px; left: -8px; }
  .handle.br { bottom: -8px; right: -8px; }

  .hint {
    position: fixed;
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

class Overlay {
  private host: HTMLDivElement | null = null
  private highlight: HTMLDivElement | null = null
  private label: HTMLDivElement | null = null
  private mask: HTMLDivElement | null = null
  private crop: HTMLDivElement | null = null
  private hint: HTMLDivElement | null = null

  mount(): void {
    if (this.host) return
    this.host = document.createElement('div')
    this.host.setAttribute('data-webalchemist-overlay', '')
    const root = this.host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = OVERLAY_STYLES

    this.highlight = element('div', 'highlight')
    this.label = element('div', 'label')
    this.mask = element('div', 'mask')
    this.crop = element('div', 'crop')
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      this.crop.append(element('div', `handle ${corner}`))
    }
    this.hint = this.buildHint()

    this.hideCrop()
    root.append(style, this.mask, this.highlight, this.label, this.crop, this.hint)
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

/** Root first, target last. The panel renders the last entry as the chip. */
function breadcrumbFor(element: Element): string[] {
  const parts: string[] = []
  let node: Element | null = element
  while (node && node !== document.documentElement && parts.length < 5) {
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
  setCurrent(document.elementFromPoint(event.clientX, event.clientY))
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
      const element = document.elementFromPoint(x, y)
      if (element && !element.closest('[data-webalchemist-overlay]')) found.add(element)
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

function confirmSelection(): void {
  if (!current) return
  const anchor = captureAnchor(current)
  const context = extractContext(current, anchor.selector)
  const target = describeTarget(current)

  // The drawn rectangle doubles as the screenshot crop, so it travels with the
  // context. No image is captured here — that happens only if the user opts in
  // for a specific request, and they have already seen this exact rect.
  const region = crop ?? boundingRectWithPadding(current)

  stopPicking()
  void send({
    type: 'element-picked',
    context,
    anchor,
    crop: region,
    cropClipped: exceedsViewport(region),
    target,
    viewportWidth: window.innerWidth,
  })
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

function startPicking(): void {
  if (picking) return
  picking = true
  crop = null
  overlay.mount()
  overlay.setHint(false)
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('keydown', onKeyDown, true)
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

function send(event: ContentEvent): Promise<unknown> {
  return browser.runtime.sendMessage(event)
}

browser.runtime.onMessage.addListener(async (message: ContentMessage) => {
  switch (message.type) {
    case 'start-picking':
      startPicking()
      return true
    case 'cancel-picking':
      stopPicking()
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
