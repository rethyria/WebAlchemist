<script lang="ts">
  import type { Snippet } from 'svelte'

  /** The uppercase mono section label the design uses to head every group. */
  interface Props {
    attention?: boolean
    children: Snippet
  }

  let { attention = false, children }: Props = $props()
</script>

<span class="label" class:attention>{@render children()}</span>

<style>
  .label {
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .attention {
    color: var(--attention);
  }
</style>
