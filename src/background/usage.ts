/**
 * Records the token usage of the model calls made for one request and reports
 * what the request used.
 *
 * The adapters call the listener synchronously, before they parse a response,
 * and the recording is asynchronous, so the listener only starts it. `settled`
 * waits for every started recording, and is called in a `finally` so that a
 * request that failed after a billed response is still counted.
 */

import type { Provider, UsageReport } from '@shared/types'
import { costOf, priceFor } from '@shared/usage'
import { recordUsage } from './storage'
import type { UsageListener } from './providers/types'

export function createUsageRecorder(transformId?: string) {
  const started: Promise<UsageReport>[] = []

  const listener = (call: Parameters<UsageListener>[0], provider: Provider): void => {
    const price = priceFor(provider, call.model)
    const costUsd = call.usage && price ? costOf(call.usage, price) : null
    const report: UsageReport = { model: call.model, usage: call.usage, costUsd }
    started.push(
      // A storage failure must not fail the generation that was already paid
      // for; the panel still shows what the response said.
      recordUsage({
        providerId: provider.id,
        ...(transformId ? { transformId } : {}),
        usage: call.usage,
        costUsd,
      }).then(
        () => report,
        () => report,
      ),
    )
  }

  return {
    listener,
    /** The last call's report, or undefined when no call returned a response. */
    async settled(): Promise<UsageReport | undefined> {
      return (await Promise.all(started)).at(-1)
    },
  }
}
