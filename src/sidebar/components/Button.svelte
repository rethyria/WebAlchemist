<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * Primary is a filled accent; secondary is an outline. Danger (red) is for
   * an action that deletes or stops something, and caution (amber) is for an
   * action that gives code or a file more reach. Both are outlined and tinted,
   * and the label always says what the button does. They live here rather than
   * being restated in each panel's scoped styles.
   */
  interface Props {
    variant?: 'primary' | 'secondary' | 'danger' | 'caution'
    full?: boolean
    small?: boolean
    disabled?: boolean
    title?: string
    grow?: number
    onclick: () => void
    children: Snippet
  }

  let {
    variant = 'secondary',
    full = false,
    small = false,
    disabled = false,
    title,
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
  {title}
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

  .danger {
    border: 1px solid var(--danger);
    background: rgb(from var(--danger) r g b / 0.1);
    color: var(--danger);
  }

  .caution {
    border: 1px solid var(--caution);
    background: rgb(from var(--caution) r g b / 0.1);
    color: var(--caution);
  }
</style>
