<script lang="ts">
  import { ADDRESS_REMOVAL_NOTE } from '@shared/address-policy'

  interface Props {
    /** The address exactly as it is sent to the provider. */
    address: string
  }

  let { address }: Props = $props()
</script>

<section class="sent-address">
  <p class="note">{ADDRESS_REMOVAL_NOTE}</p>
  <p class="address">{address}</p>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .note {
    margin: 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .address {
    margin: 0;
    overflow-wrap: anywhere;
    font: 11px var(--font-mono);
    color: var(--text-dim);
  }
</style>
