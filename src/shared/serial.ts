/**
 * Runs work one piece at a time for each key, in the order it was asked for.
 *
 * Two screenshot requests for the same tab share one overlay in the page, which
 * the first hides before it captures and shows again afterwards. When the two
 * overlap, the first request shows the overlay again before the second has
 * captured, and the second image contains it (#37). Each key here is a tab id,
 * so requests for the same tab wait for each other and requests for other tabs
 * do not.
 *
 * A piece of work that fails does not stop the ones behind it. A key that has
 * no work waiting is forgotten, so the map does not grow.
 */
export function createSerialQueue<K = string | number>(): {
  run<T>(key: K, work: () => Promise<T>): Promise<T>
  /** The number of keys that have work running or waiting. */
  size(): number
} {
  const tails = new Map<K, Promise<unknown>>()
  return {
    run<T>(key: K, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(work, work)
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    },
    size: () => tails.size,
  }
}
