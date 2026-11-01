/**
 * The sidebar's `wa-sidebar` port (#81).
 *
 * The background page is suspended after 30 idle seconds, and that closes the
 * port from the background's side. The panel is still open then, so it has to
 * connect again, or the background has no way to learn that the panel closes
 * later and previews are never discarded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdSidebarPort, type PortLike } from './sidebar-port'

function fakeConnect() {
  const ports: (PortLike & { drop(): void; disconnect: ReturnType<typeof vi.fn> })[] = []
  const connect = vi.fn(() => {
    let onDrop: () => void = () => {}
    const port = {
      onDisconnect: { addListener: (l: () => void) => (onDrop = l) },
      disconnect: vi.fn(),
      /** The background closing its end, as happens on suspension. */
      drop: () => onDrop(),
    }
    ports.push(port)
    return port
  })
  return { connect, ports }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('holdSidebarPort', () => {
  it('connects once when the panel opens', () => {
    const { connect } = fakeConnect()
    holdSidebarPort(connect)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('connects again after the background closes the port', async () => {
    const { connect, ports } = fakeConnect()
    holdSidebarPort(connect)
    ports[0]!.drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('keeps reconnecting after each later suspension', async () => {
    const { connect, ports } = fakeConnect()
    holdSidebarPort(connect)
    for (let i = 0; i < 3; i += 1) {
      ports.at(-1)!.drop()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(connect).toHaveBeenCalledTimes(4)
  })

  it('does not connect again once the panel has closed', async () => {
    const { connect, ports } = fakeConnect()
    const stop = holdSidebarPort(connect)
    stop()
    expect(ports[0]!.disconnect).toHaveBeenCalledTimes(1)
    ports[0]!.drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('does not connect after the panel closes during the retry delay', async () => {
    const { connect, ports } = fakeConnect()
    const stop = holdSidebarPort(connect)
    ports[0]!.drop()
    stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('waits between attempts, so a background that refuses it is not met with a tight loop', async () => {
    const { connect, ports } = fakeConnect()
    holdSidebarPort(connect)
    ports[0]!.drop()
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(connect).toHaveBeenCalledTimes(1)
  })
})
