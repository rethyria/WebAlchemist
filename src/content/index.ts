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
import type { Transform, TransformRuntimeState } from '@shared/types'
import { captureAnchor, resolveAnchor } from './anchor'
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
  .highlight {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    border: 2px solid #ef8354;
    background: rgba(239, 131, 84, 0.12);
    /* Double outline so the edge stays visible on any background. */
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(255, 255, 255, 0.65);
    transition: all 60ms linear;
  }
  .label {
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #fff;
    background: #2b2d42;
    padding: 3px 6px;
    border-radius: 3px;
    white-space: nowrap;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }
  .drag {
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 1px dashed #ef8354;
    background: rgba(239, 131, 84, 0.08);
  }
`

class Overlay {
  private host: HTMLDivElement | null = null
  private root: ShadowRoot | null = null
  private highlight: HTMLDivElement | null = null
  private label: HTMLDivElement | null = null
  private drag: HTMLDivElement | null = null

  mount(): void {
    if (this.host) return
    this.host = document.createElement('div')
    this.host.setAttribute('data-webalchemist-overlay', '')
    this.root = this.host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = OVERLAY_STYLES
    this.root.append(style)

    this.highlight = document.createElement('div')
    this.highlight.className = 'highlight'
    this.label = document.createElement('div')
    this.label.className = 'label'
    this.drag = document.createElement('div')
    this.drag.className = 'drag'
    this.drag.style.display = 'none'

    this.root.append(this.highlight, this.label, this.drag)
    document.documentElement.append(this.host)
  }

  unmount(): void {
    this.host?.remove()
    this.host = null
    this.root = null
  }

  showElement(element: Element, breadcrumb: string): void {
    if (!this.highlight || !this.label) return
    const rect = element.getBoundingClientRect()
    Object.assign(this.highlight.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })

    // Flip the label below the element when there is no room above it.
    const above = rect.top > 24
    Object.assign(this.label.style, {
      display: 'block',
      left: `${Math.max(4, rect.left)}px`,
      top: above ? `${rect.top - 22}px` : `${rect.bottom + 4}px`,
    })
    this.label.textContent = breadcrumb
  }

  showDrag(rect: { x: number; y: number; width: number; height: number }): void {
    if (!this.drag) return
    Object.assign(this.drag.style, {
      display: 'block',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  hideDrag(): void {
    if (this.drag) this.drag.style.display = 'none'
  }
}

const overlay = new Overlay()

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

let current: Element | null = null
let dragOrigin: { x: number; y: number } | null = null
let picking = false

function breadcrumbFor(element: Element): string {
  const parts: string[] = []
  let node: Element | null = element
  let depth = 0
  while (node && node !== document.documentElement && depth < 4) {
    const tag = node.tagName.toLowerCase()
    const id = node.id ? `#${node.id}` : ''
    parts.unshift(`${tag}${id}`)
    node = node.parentElement
    depth += 1
  }
  return parts.join(' > ')
}

function setCurrent(element: Element | null): void {
  if (!element || element === current) return
  // Never let the picker select its own overlay.
  if (element.closest('[data-webalchemist-overlay]')) return
  current = element
  overlay.showElement(element, breadcrumbFor(element))
}

function onMouseMove(event: MouseEvent): void {
  if (dragOrigin) {
    const rect = {
      x: Math.min(dragOrigin.x, event.clientX),
      y: Math.min(dragOrigin.y, event.clientY),
      width: Math.abs(event.clientX - dragOrigin.x),
      height: Math.abs(event.clientY - dragOrigin.y),
    }
    overlay.showDrag(rect)
    return
  }
  setCurrent(document.elementFromPoint(event.clientX, event.clientY))
}

function onMouseDown(event: MouseEvent): void {
  dragOrigin = { x: event.clientX, y: event.clientY }
  event.preventDefault()
  event.stopPropagation()
}

function onMouseUp(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()

  if (!dragOrigin) return
  const width = Math.abs(event.clientX - dragOrigin.x)
  const height = Math.abs(event.clientY - dragOrigin.y)
  const rect = {
    x: Math.min(dragOrigin.x, event.clientX),
    y: Math.min(dragOrigin.y, event.clientY),
    width,
    height,
  }
  dragOrigin = null

  // A drag under a few pixels is a click; treat it as hover selection.
  if (width < 5 && height < 5) {
    overlay.hideDrag()
    confirmSelection(null)
    return
  }

  // Resolve the drag rectangle to the common ancestor of what it covers, then
  // hand back to hover mode so the user confirms an actual element.
  const covered = elementsInRect(rect)
  const ancestor = commonAncestor(covered)
  if (ancestor) setCurrent(ancestor)
  confirmSelection(rect)
}

function elementsInRect(rect: {
  x: number
  y: number
  width: number
  height: number
}): Element[] {
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
      confirmSelection(null)
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

function confirmSelection(
  dragRect: { x: number; y: number; width: number; height: number } | null,
): void {
  if (!current) return
  const anchor = captureAnchor(current)
  const context = extractContext(current, anchor.selector)

  // The drag rectangle is also the screenshot crop, so it travels with the
  // context. No image is captured here — that happens only if the user opts in
  // for a specific request, and they see this exact rect before it is sent.
  const rect = dragRect ?? boundingRectWithPadding(current)

  stopPicking()
  void send({
    type: 'element-picked',
    context,
    anchor,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ cropRect: rect } as any),
  })
}

/** Falls back to the element's box plus padding so the model sees some context. */
function boundingRectWithPadding(element: Element): {
  x: number
  y: number
  width: number
  height: number
} {
  const PADDING = 12
  const rect = element.getBoundingClientRect()
  return {
    x: Math.max(0, rect.left - PADDING),
    y: Math.max(0, rect.top - PADDING),
    width: Math.min(window.innerWidth, rect.width + PADDING * 2),
    height: Math.min(window.innerHeight, rect.height + PADDING * 2),
  }
}

function startPicking(): void {
  if (picking) return
  picking = true
  overlay.mount()
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('keydown', onKeyDown, true)
}

function stopPicking(): void {
  picking = false
  current = null
  dragOrigin = null
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
