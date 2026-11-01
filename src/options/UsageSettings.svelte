<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * What model calls have used, from the totals the background records.
   *
   * Tokens are always shown. A cost is shown only for calls that had a price:
   * the Anthropic list for Anthropic models, and the price the user entered
   * for an OpenAI-compatible provider. Calls whose response had no usage block
   * are counted separately and shown as "not reported", since adding zero for
   * them would understate the total.
   */
  import type { Provider, UsageStore, UsageTotals } from '@shared/types'
  import { NOT_SAVED_USAGE_ID, formatCost, formatTokens } from '@shared/usage'

  interface Props {
    usage: UsageStore
    providers: Provider[]
    /** Transform names by id, for the rows of the per-transform list. */
    transformNames: Record<string, string>
  }

  let { usage, providers, transformNames }: Props = $props()

  let months = $derived(Object.keys(usage.months).sort().reverse())
  let transformIds = $derived(
    Object.keys(usage.transforms).sort(
      (a, b) => (usage.transforms[b]?.costUsd ?? 0) - (usage.transforms[a]?.costUsd ?? 0),
    ),
  )

  function labelOf(providerId: string): string {
    return providers.find((p) => p.id === providerId)?.label ?? t('optUsageRemovedProvider')
  }

  function summary(totals: UsageTotals): string {
    const parts: string[] = []
    if (totals.reportedCalls > 0) {
      parts.push(
        t('usageTokens', formatTokens(totals.inputTokens), formatTokens(totals.outputTokens)),
      )
    }
    const unreported = totals.calls - totals.reportedCalls
    if (unreported > 0) {
      parts.push(
        totals.reportedCalls === 0
          ? t('optUsageNotReported')
          : t('optUsageSomeNotReported', unreported, totals.calls),
      )
    }
    if (totals.pricedCalls > 0) {
      parts.push(
        totals.pricedCalls < totals.reportedCalls
          ? t('optUsageCostPartial', formatCost(totals.costUsd), totals.pricedCalls, totals.reportedCalls)
          : formatCost(totals.costUsd),
      )
    }
    return parts.join(', ')
  }
</script>

<section>
  <h2>{t('optUsageTitle')}</h2>
  {#if months.length === 0}
    <p class="body">{t('optUsageNone')}</p>
  {:else}
    <h3>{t('optUsagePerProvider')}</h3>
    <ul>
      {#each months as month}
        {#each Object.entries(usage.months[month] ?? {}) as [providerId, totals]}
          <li>
            <span class="name">{month} · {labelOf(providerId)}</span>
            <span class="figures">{totals.calls === 1 ? t('optUsageCallOne', summary(totals)) : t('optUsageCalls', totals.calls, summary(totals))}</span>
          </li>
        {/each}
      {/each}
    </ul>
    <h3>{t('optUsagePerTransform')}</h3>
    <ul>
      {#each transformIds as id}
        <li>
          <span class="name">{id === NOT_SAVED_USAGE_ID ? t('optUsageDrafts') : (transformNames[id] ?? t('optUsageDeleted'))}</span>
          <span class="figures">{summary(usage.transforms[id] as UsageTotals)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    max-width: 600px;
    padding-left: var(--sp-13);
    border-left: 3px solid var(--neutral);
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
  }

  h2 {
    margin: 0;
    font: 600 13.5px var(--font-ui);
  }

  h3 {
    margin: 0;
    font: 600 12px var(--font-ui);
    color: var(--text-dim);
  }

  .body {
    margin: 0;
    font: 12px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  li {
    display: flex;
    flex-direction: column;
    font: 12px/1.5 var(--font-ui);
  }

  .figures {
    font: 11.5px var(--font-mono);
    color: var(--text-faint);
  }
</style>
