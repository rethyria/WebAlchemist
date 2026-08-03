<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * Primary is a filled accent; secondary is an outline. The design uses
   * exactly these two everywhere, so they live here rather than being restated
   * in each panel's scoped styles.
   */
  interface Props {
    variant?: 'primary' | 'secondary'
    full?: boolean
    small?: boolean
    disabled?: boolean
    grow?: number
    onclick: () => void
    children: Snippet
  }

  let {
    variant = 'secondary',
    full = false,
    small = false,
    disabled = false,
    grow,
    onclick,
    children,
  }: Props = $props()
</script>

<button
  type="button"
  class={variant}
  class:full
  class:small
  {disabled}
  style={grow === undefined ? '' : `flex: ${grow}`}
  {onclick}
>
  {@render children()}
</button>

<style>
  button {
    padding: 9px 11px;
    border-radius: var(--r-button);
    font: 600 12.5px var(--font-ui);
    cursor: pointer;
  }

  button.small {
    padding: 6px 11px;
    font-weight: 400;
    font-size: 12px;
  }

  button.full {
    width: 100%;
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .primary {
    border: none;
    background: var(--accent);
    color: var(--accent-text);
  }

  .secondary {
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
  }
</style>
