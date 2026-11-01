<script lang="ts">
  import { MAIN_WORLD_RISKS } from '@shared/world'

  interface Props {
    /** True once the user has confirmed the risks. */
    confirmed: boolean
    disabled?: boolean
  }

  let { confirmed = $bindable(), disabled = false }: Props = $props()
</script>

<section class="main-restore" aria-labelledby="main-restore-title">
  <h3 id="main-restore-title">This version runs in the page's own world (MAIN)</h3>
  <p class="warn">Running in the page's own world has these risks:</p>
  <ul class="hint">
    {#each MAIN_WORLD_RISKS as risk}
      <li>{risk}</li>
    {/each}
  </ul>
  <label>
    <input type="checkbox" bind:checked={confirmed} {disabled} />
    I have read the risks and want this version to run in the page's own world
  </label>
</section>
