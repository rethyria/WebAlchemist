<script lang="ts">
  import { t } from '@shared/i18n'
  import { MAIN_WORLD_RISKS } from '@shared/world'

  interface Props {
    /** True once the user has confirmed the risks. */
    confirmed: boolean
    disabled?: boolean
  }

  let { confirmed = $bindable(), disabled = false }: Props = $props()
</script>

<section class="main-restore" aria-labelledby="main-restore-title">
  <h3 id="main-restore-title">{t('edMainRestoreTitle')}</h3>
  <p class="warn">{t('approvalRisksIntro')}</p>
  <ul class="hint">
    {#each MAIN_WORLD_RISKS as risk}
      <li>{risk}</li>
    {/each}
  </ul>
  <label>
    <input type="checkbox" bind:checked={confirmed} {disabled} />
    {t('edMainRestoreConfirm')}
  </label>
</section>
