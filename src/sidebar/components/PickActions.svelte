<script lang="ts">
  import { t } from '@shared/i18n'
  import Button from './Button.svelte'

  /**
   * The two ways to start a new transform: pick an element and describe the
   * change, or write the code by hand. Both are buttons. The hint about the
   * order of transforms is shown only when there is more than one, because with
   * one transform there is nothing to order.
   */
  interface Props {
    onselect: () => void
    onwrite: () => void
    showOrderHint?: boolean
  }

  let { onselect, onwrite, showOrderHint = false }: Props = $props()
</script>

<div class="pick">
  <Button variant="primary" full onclick={onselect}>{t('appSelect')}</Button>
  <Button full onclick={onwrite}>{t('appWriteMyself')}</Button>
  {#if showOrderHint}
    <p class="hint">{t('appOrderHint')}</p>
  {/if}
</div>

<style>
  .pick {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
  }

  .hint {
    margin: 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-dim);
    text-align: center;
  }
</style>
