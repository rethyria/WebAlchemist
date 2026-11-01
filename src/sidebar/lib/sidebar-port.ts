/**
 * Holds the `wa-sidebar` port open for as long as the panel is on screen.
 *
 * The background closes this port whenever Firefox suspends it, which happens
 * after 30 seconds without activity and does not mean the panel closed. A port
 * opened once therefore stops reporting the panel's closing after the first
 * suspension, and previews are never discarded. This connects again each time
 * the port drops, which also starts the background page again if it was
 * suspended.
 *
 * The retry waits instead of reconnecting at once. If the background ever
 * refused the port, an immediate retry would loop without pause.
 */

export interface PortLike {
  onDisconnect: { addListener(listener: () => void): void }
  disconnect(): void
}

const RETRY_DELAY_MS = 250

/** Returns the function that releases the port when the panel closes. */
export function holdSidebarPort(connect: () => PortLike): () => void {
  let port: PortLike | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let released = false

  const open = () => {
    retry = null
    const current = connect()
    port = current
    current.onDisconnect.addListener(() => {
      if (released || port !== current) return
      port = null
      retry = setTimeout(open, RETRY_DELAY_MS)
    })
  }
  open()

  return () => {
    released = true
    if (retry !== null) clearTimeout(retry)
    port?.disconnect()
  }
}
