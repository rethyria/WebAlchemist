<script lang="ts">
  import { t } from '@shared/i18n'
  import type { HoverTarget } from '@shared/types'
  import { forwardedAction, type PickerAction } from '@shared/picker-keys'
  import { focusOnMount } from '../lib/focus'
  import Button from './Button.svelte'
  import Label from './Label.svelte'
  import { boundTab } from '@shared/panel-binding'

  interface Props {
    hover: HoverTarget | null
    oncancel: () => void
    onkey: (action: PickerAction) => void
  }

  let { hover, oncancel, onkey }: Props = $props()

  /** The panel is open in a tab (Firefox for Android), so the page is picked by touch. */
  const touch = boundTab() !== null

  let trail = $derived(hover?.breadcrumb.slice(0, -1) ?? [])
  let leaf = $derived(hover?.breadcrumb.at(-1) ?? '')

  let mode = $derived(
    hover?.drawing
      ? t('pickingModeDrawing')
      : hover?.crop
        ? t('pickingModeCrop')
        : touch
          ? t('pickingModeTouch')
          : t('pickingModeHover'),
  )

  /*
   * The page's own listener only sees keys while the page has the focus, and
   * clicking "Select an element" leaves the focus here. Keys are therefore
   * handled on the window of the sidebar and forwarded. The listener exists
   * only while this panel is mounted, so every way out of picking removes it.
   */
  function onwindowkeydown(event: KeyboardEvent): void {
    const target = event.target instanceof Element ? event.target : null
    const action = forwardedAction({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      fromButtonLike: target?.closest('button, a, input, textarea, select, summary') != null,
    })
    if (!action) return
    event.preventDefault()
    onkey(action)
  }

  const KEYS: [string, string][] = [
    ['↑', t('pickingKeyParent')],
    ['↓', t('pickingKeyChild')],
    ['← →', t('pickingKeySibling')],
    ['↵', t('pickingKeyConfirm')],
    [t('pickingKeyEscape'), t('cancel')],
  ]
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div class="panel">
  <h1 class="title" tabindex="-1" use:focusOnMount>{t('pickingTitle')}</h1>
  <div class="mode">
    <span class="live" aria-hidden="true"></span>
    <span class="mode-text">{mode}</span>
  </div>

  <section>
    <Label>{t('pickingCurrent')}</Label>
    {#if hover}
      <div class="crumb">
        {#each trail as part}<span class="part">{part}</span><span
            class="sep"
            aria-hidden="true">›</span
          >{/each}<span class="leaf">{leaf}</span>
      </div>
      <div class="facts">
        <span class="fact">{hover.width} × {hover.height}</span>
        {#if hover.role}
          <span class="fact">role={hover.role}</span>
        {/if}
        {#if hover.crop}
          <span class="fact crop">
            {t('pickingCrop', Math.round(hover.crop.width), Math.round(hover.crop.height))}
          </span>
        {/if}
      </div>
    {:else}
      <p class="waiting">
        {touch ? t('pickingTapHint') : t('pickingMoveHint')}
      </p>
    {/if}
  </section>

  {#if touch}
    <div class="keys">
      <Label>{t('pickingTouchLabel')}</Label>
      <p class="waiting">
        {t('pickingTouchHelp')}
      </p>
    </div>
  {:else}
    <div class="keys">
      <Label>{t('pickingKeysLabel')}</Label>
      <dl>
        {#each KEYS as [key, meaning]}
          <dt><kbd>{key}</kbd></dt>
          <dd>{meaning}</dd>
        {/each}
      </dl>
    </div>
  {/if}

  <Button full onclick={oncancel}>{t('cancel')}</Button>
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 13px;
    padding: var(--gutter-sidebar);
    min-height: 0;
    overflow-y: auto;
  }

  .title {
    margin: 0;
    font: 600 13px var(--font-ui);
  }

  .title:focus-visible {
    outline: 2px solid var(--accent-fg);
    outline-offset: 2px;
  }

  .mode {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
  }

  .live {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent-fg);
  }

  .mode-text {
    font: 600 12.5px var(--font-ui);
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .crumb {
    font: 11.5px/1.9 var(--font-mono);
    color: var(--text-faint);
    word-break: break-all;
  }

  .sep {
    margin: 0 3px;
    opacity: 0.5;
  }

  .leaf {
    padding: 1px 4px;
    border-radius: var(--r-badge);
    background: var(--accent-chip);
    color: var(--accent-fg);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
    margin-top: var(--sp-2);
  }

  .fact {
    padding: 2px 6px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 10.5px var(--font-mono);
    color: var(--text-dim);
  }

  /* The crop is the only thing here that will leave the machine. */
  .fact.crop {
    background: rgb(from var(--attention) r g b / 0.16);
    color: var(--attention);
  }

  .waiting {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .keys {
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
    padding: var(--sp-11);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-card);
    background: var(--surface-raised);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 5px 9px;
    align-items: center;
    margin: 0;
  }

  dt,
  dd {
    margin: 0;
  }

  dd {
    font: 11.5px var(--font-ui);
    color: var(--text-dim);
  }

  kbd {
    display: block;
    padding: 2px 5px;
    border-radius: var(--r-badge);
    background: var(--chrome);
    font: 11px var(--font-mono);
    text-align: center;
  }
</style>
