<script lang="ts">
  import { t } from '@shared/i18n'
  import { firstRunDisclosure } from '@shared/disclosure'
  import type { VaultView } from '@shared/vault-disclosure'
  import Button from './Button.svelte'
  import { focusOnMount } from '../lib/focus'

  /**
   * The first-run disclosure, shared by the settings page and the sidebar.
   *
   * The wording comes from firstRunDisclosure(), so this component only lays
   * it out. `onacknowledge` stores the acknowledgement. `onwriteitmyself` is
   * given where the surface has a way to write a transform by hand, which
   * needs no provider and so is not held back by the disclosure.
   */
  interface Props {
    vault: VaultView
    onacknowledge: () => void
    onwriteitmyself?: (() => void) | undefined
    /** Whether the heading takes the focus when this appears. */
    takeFocus?: boolean
    /** 1 where the disclosure is the page's main heading, 2 under another h1. */
    level?: 1 | 2
  }

  let { vault, onacknowledge, onwriteitmyself, takeFocus = false, level = 1 }: Props = $props()

  let sections = $derived(firstRunDisclosure(vault))

  // An action that does nothing, so that the focus move can be switched off
  // without a second copy of the heading.
  function focusIf(node: HTMLElement, enabled: boolean) {
    if (enabled) focusOnMount(node)
  }
</script>

<section class="disclosure" aria-labelledby="first-run-title">
  <svelte:element this={level === 1 ? 'h1' : 'h2'} id="first-run-title" tabindex="-1" use:focusIf={takeFocus}>
    {t('firstRunTitle')}
  </svelte:element>
  <p class="lead">
    {t('firstRunLead')}
  </p>

  {#each sections as section}
    <div class="part">
      <svelte:element this={level === 1 ? 'h2' : 'h3'}>{section.heading}</svelte:element>
      {#if section.lead}<p>{section.lead}</p>{/if}
      {#if section.items.length > 0}
        <ul>
          {#each section.items as item}<li>{item}</li>{/each}
        </ul>
      {/if}
      {#each section.paragraphs as paragraph}<p>{paragraph}</p>{/each}
    </div>
  {/each}

  <div class="actions">
    <Button variant="primary" onclick={onacknowledge}>{t('firstRunAcknowledge')}</Button>
    {#if onwriteitmyself}
      <button type="button" class="link" onclick={onwriteitmyself}>{t('firstRunWriteMyself')}</button>
    {/if}
  </div>
  {#if onwriteitmyself}
    <p class="note">{t('firstRunHandNote')}</p>
  {/if}
</section>

<style>
  .disclosure {
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
    min-height: 0;
    overflow-y: auto;
  }

  #first-run-title {
    margin: 0;
    font: 600 15px var(--font-ui);
  }

  .part :global(h2),
  .part :global(h3) {
    margin: 0 0 var(--sp-3);
    font: 600 12.5px var(--font-ui);
  }

  p,
  li {
    margin: 0 0 var(--sp-3);
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  .lead {
    color: var(--text);
  }

  ul {
    margin: 0 0 var(--sp-3);
    padding-left: 18px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-9);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-fg);
    font: 12px var(--font-ui);
    text-decoration: underline;
    cursor: pointer;
  }

  .note {
    color: var(--text-faint);
  }
</style>
