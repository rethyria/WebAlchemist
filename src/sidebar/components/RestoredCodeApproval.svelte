<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * The panel in which the user reads JavaScript that was restored from a
   * backup, with the world it runs in, before approving it (#124). For code
   * that runs in MAIN the risks are listed and must be confirmed first.
   */
  import type { Transform } from '@shared/types'
  import { MAIN_WORLD_RISKS, WORLD_NAMES, worldOf } from '@shared/world'

  interface Props {
    transform: Transform
    /** Called from the click, before any await, because it may need to request a permission. */
    onapprove: () => void
    oncancel: () => void
  }

  let { transform, onapprove, oncancel }: Props = $props()

  let risksRead = $state(false)
  const inMain = $derived(worldOf(transform) === 'MAIN')
</script>

<div class="approval">
  <p>{t('approvalRunsIn', WORLD_NAMES[worldOf(transform)])}</p>
  {#if inMain}
    <p>{t('approvalRisksIntro')}</p>
    <ul class="risks">
      {#each MAIN_WORLD_RISKS as risk}
        <li>{risk}</li>
      {/each}
    </ul>
    <label>
      <input type="checkbox" bind:checked={risksRead} />
      {t('approvalRisksRead')}
    </label>
  {/if}
  <pre>{transform.code}</pre>
  {#if transform.capabilities.length > 0}
    <p>{t('approvalCapabilities', transform.capabilities.join(', '))}</p>
  {/if}
  <div class="actions">
    <button
      type="button"
      class="primary"
      class:btn-caution={inMain || transform.capabilities.length > 0}
      disabled={inMain && !risksRead}
      onclick={onapprove}
    >
      {t('approvalApprove')}
    </button>
    <button type="button" class="secondary" onclick={oncancel}>{t('cancel')}</button>
  </div>
</div>

<style>
  .approval {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 var(--gutter-sidebar) 9px var(--indent-expanded);
    font: 11.5px/1.5 var(--font-ui);
  }

  .approval pre {
    max-height: 220px;
    overflow: auto;
    margin: 0;
    font: 11px/1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .approval p {
    margin: 0;
  }

  .risks {
    margin: 0;
    padding-left: 18px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  button.secondary {
    padding: 8px 10px;
    border-radius: var(--r-button);
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
    font: 600 12.5px var(--font-ui);
    cursor: pointer;
  }
</style>
