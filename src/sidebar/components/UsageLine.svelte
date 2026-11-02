<script lang="ts">
  import type { UsageReport } from '@shared/types'
  import { describeUsage } from '@shared/usage'

  /**
   * What the last model call used. Shows "not reported" when the provider sent
   * no usage block, because a zero would claim the call was free.
   */
  interface Props {
    report: UsageReport | undefined
  }

  let { report }: Props = $props()
</script>

{#if report}
  <p class="usage">{describeUsage(report)} · {report.model}</p>
{/if}

<style>
  .usage {
    margin: 0;
    padding: 0 var(--gutter-sidebar);
    font: 10px var(--font-mono);
    color: var(--text-faint);
    opacity: 0.8;
  }
</style>
