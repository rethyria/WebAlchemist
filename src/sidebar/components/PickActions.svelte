<script lang="ts">
  import { t } from '@shared/i18n'
  import Button from './Button.svelte'

  /**
   * The two ways to start a new transform: pick an element and describe the
   * change, or write the code by hand. Both are buttons.
   */
  interface Props {
    onselect: () => void
    onwrite: () => void
  }

  let { onselect, onwrite }: Props = $props()
</script>

<div class="pick">
  <Button variant="primary" full onclick={onselect}>{t('appSelect')}</Button>
  <Button full onclick={onwrite}>{t('appWriteMyself')}</Button>
</div>

<style>
  .pick {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
  }
</style>
