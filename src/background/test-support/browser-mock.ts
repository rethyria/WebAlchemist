/**
 * An in-memory stand-in for `browser.storage.local` and `browser.storage.session`,
 * for tests that run the real storage and vault code under Node.
 *
 * Every `get` and `set` waits one timer tick before it takes effect. A mock that
 * answered instantly would run each storage call to completion before the next
 * one started, so tests of interleaved writes would pass even against code with
 * a race. The delay makes concurrent calls overlap the way they do in a browser.
 */

function createArea() {
  let data: Record<string, unknown> = {}
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
  return {
    async get(keys?: string | string[]) {
      const wanted = keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : [keys]
      const out: Record<string, unknown> = {}
      for (const key of wanted) if (key in data) out[key] = structuredClone(data[key])
      await tick()
      return out
    },
    async set(values: Record<string, unknown>) {
      await tick()
      Object.assign(data, structuredClone(values))
    },
    async remove(key: string) {
      delete data[key]
    },
    reset() {
      data = {}
    },
    raw() {
      return data
    },
  }
}

/**
 * Records the alarms the code under test schedules. Nothing fires by itself:
 * a test calls the handler it is checking, which stands in for the browser
 * delivering the alarm.
 */
export interface ScheduledAlarm {
  delayInMinutes: number
}
export const alarmsMock = {
  scheduled: new Map<string, ScheduledAlarm>(),
  /** Every create call in order, including ones that replaced an earlier alarm. */
  created: [] as { name: string; delayInMinutes: number }[],
  async create(name: string, info: { delayInMinutes: number }) {
    this.created.push({ name, delayInMinutes: info.delayInMinutes })
    this.scheduled.set(name, { delayInMinutes: info.delayInMinutes })
  },
  async clear(name: string) {
    return this.scheduled.delete(name)
  },
  reset() {
    this.scheduled.clear()
    this.created.length = 0
  },
}

export const localArea = createArea()
export const sessionArea = createArea()

;(globalThis as unknown as { browser: unknown }).browser = {
  storage: { local: localArea, session: sessionArea },
  alarms: alarmsMock,
}

export function resetBrowserMock(): void {
  localArea.reset()
  sessionArea.reset()
  alarmsMock.reset()
}
