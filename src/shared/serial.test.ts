import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serial'

/** A promise that is settled by the test, to hold a piece of work open. */
function gate<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSerialQueue', () => {
  // Control for the serial tests: without the queue, two pieces of work for the same key overlap.
  it('control: without the queue, two pieces of work overlap', async () => {
    const log: string[] = []
    const first = gate()
    const work = (name: string, hold?: Promise<void>) => async () => {
      log.push(`${name} start`)
      await hold
      log.push(`${name} end`)
    }
    const a = work('a', first.promise)()
    const b = work('b')()
    first.resolve()
    await Promise.all([a, b])
    expect(log).toEqual(['a start', 'b start', 'b end', 'a end'])
  })

  it('runs two pieces of work for one key one after the other, in the order asked', async () => {
    const queue = createSerialQueue<number>()
    const log: string[] = []
    const first = gate()
    const work = (name: string, hold?: Promise<void>) => async () => {
      log.push(`${name} start`)
      await hold
      log.push(`${name} end`)
      return name
    }
    const a = queue.run(1, work('a', first.promise))
    const b = queue.run(1, work('b'))
    const c = queue.run(1, work('c'))
    await flush()
    expect(log).toEqual(['a start'])
    first.resolve()
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
  })

  it('does not make work for another key wait', async () => {
    const queue = createSerialQueue<number>()
    const log: string[] = []
    const held = gate()
    const a = queue.run(1, async () => {
      log.push('tab 1 start')
      await held.promise
      log.push('tab 1 end')
    })
    const b = queue.run(2, async () => {
      log.push('tab 2 start')
      log.push('tab 2 end')
    })
    await b
    expect(log).toEqual(['tab 1 start', 'tab 2 start', 'tab 2 end'])
    held.resolve()
    await a
  })

  it('runs the next piece of work after one that failed, and passes the failure to its caller', async () => {
    const queue = createSerialQueue<number>()
    const first = gate()
    const failing = queue.run(1, async () => {
      await first.promise
      throw new Error('first failed')
    })
    const next = queue.run(1, async () => 'second ran')
    first.resolve()
    await expect(failing).rejects.toThrow('first failed')
    await expect(next).resolves.toBe('second ran')
  })

  it('forgets a key when its work is finished', async () => {
    const queue = createSerialQueue<number>()
    await queue.run(1, async () => 1)
    await queue.run(2, async () => 2).catch(() => {})
    await flush()
    expect(queue.size()).toBe(0)
    const held = gate()
    const pending = queue.run(1, () => held.promise)
    expect(queue.size()).toBe(1)
    held.resolve()
    await pending
    await flush()
    expect(queue.size()).toBe(0)
  })
})
