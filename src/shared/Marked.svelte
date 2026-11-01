<script lang="ts">
  import { MARK } from './i18n'

  /**
   * A message with one value that has its own markup. `text` is the message,
   * built with MARK in the place of the value; `value` is drawn in a code
   * element or in bold text at that place.
   */
  interface Props {
    text: string
    value: string
    tag?: 'code' | 'b'
  }

  let { text, value, tag = 'code' }: Props = $props()

  let parts = $derived(text.split(MARK))
</script>

{#each parts as part, index}{part}{#if index < parts.length - 1}{#if tag === 'b'}<b>{value}</b>{:else}<code>{value}</code>{/if}{/if}{/each}

<style>
  code {
    font: 11px var(--font-mono);
    color: var(--text);
    overflow-wrap: anywhere;
  }
</style>
