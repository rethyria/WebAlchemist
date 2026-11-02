<script lang="ts">
  import { t } from '@shared/i18n'
  import Button from './Button.svelte'

  /**
   * Turns every transform on one site off or back on. Turning off asks first,
   * in place, because it reloads the open tabs of the site that ran JavaScript.
   * That fact is shown in the question and not as standing text.
   */
  interface Props {
    siteOff: boolean
    /** Result of the last action, for example how many tabs need a reload. */
    notice?: string
    onsetoff: (off: boolean) => void
  }

  let { siteOff, notice = '', onsetoff }: Props = $props()

  let confirming = $state(false)
</script>

<div class="site-controls">
  {#if siteOff}
    <Button full onclick={() => onsetoff(false)}>{t('appTurnOn')}</Button>
  {:else if confirming}
    <p class="ask">{t('appTurnOffAsk')}</p>
    <div class="pair">
      <Button
        full
        onclick={() => {
          confirming = false
          onsetoff(true)
        }}
      >
        {t('appTurnOffConfirm')}
      </Button>
      <Button full onclick={() => (confirming = false)}>{t('cancel')}</Button>
    </div>
  {:else}
    <Button full onclick={() => (confirming = true)}>{t('appTurnOff')}</Button>
  {/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
</div>

<style>
  .site-controls {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    padding: 8px var(--gutter-sidebar) 12px;
  }

  .pair {
    display: flex;
    gap: 6px;
  }

  .ask,
  .notice {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--text);
  }
</style>
