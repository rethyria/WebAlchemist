<script lang="ts">
  import { ADDRESS_REMOVAL_NOTE } from '@shared/address-policy'
  import { t } from '@shared/i18n'

  interface Props {
    /** The address exactly as it is sent to the provider. */
    address: string
  }

  let { address }: Props = $props()
</script>

<details class="sent-address">
  <summary>{t('addressSentSummary', address)}</summary>
  <p class="note">{ADDRESS_REMOVAL_NOTE}</p>
</details>

<style>
  summary {
    overflow-wrap: anywhere;
    font: 11px var(--font-mono);
    color: var(--text-faint);
    cursor: pointer;
  }

  .note {
    margin: var(--sp-5) 0 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }
</style>
