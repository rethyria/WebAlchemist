<script lang="ts">
  import type { HoverTarget, Rect, TransformScope } from '@shared/types'
  import { autogrow } from '../lib/autogrow'
  import Button from './Button.svelte'
  import Label from './Label.svelte'
  import Toggle from './Toggle.svelte'

  interface Props {
    target: HoverTarget
    crop: Rect
    cropClipped: boolean
    instruction: string
    sendScreenshot: boolean
    visionSupported: boolean
    providerLabel: string
    onchange: (instruction: string) => void
    onscreenshot: (send: boolean) => void
    onrepick: () => void
    /** The chain as first picked, so rows below the current one stay. */
    chain: string[]
    depth: number
    onretarget: (levelsUp: number) => void
    onpreview: (levelsUp: number | null) => void
    scope: TransformScope
    scopeCount: number
    onscope: (scope: TransformScope) => void
    ongenerate: () => void
  }

  let {
    target,
    crop,
    cropClipped,
    instruction,
    sendScreenshot,
    visionSupported,
    providerLabel,
    onchange,
    onscreenshot,
    onrepick,
    chain,
    depth,
    onretarget,
    onpreview,
    scope,
    scopeCount,
    onscope,
    ongenerate,
  }: Props = $props()

  let selector = $derived(target.breadcrumb.at(-1) ?? '')

  /*
   * Root first, so the list reads outermost to innermost with the element
   * originally picked at the bottom. Distance from the end is how far up the
   * chain each row sits — an absolute position, so the list moves in both
   * directions rather than only outwards.
   */
  let ancestors = $derived(
    chain.map((label, index) => ({
      label,
      levelsUp: chain.length - 1 - index,
      indent: Math.min(index, 6),
    })),
  )
  let cropLabel = $derived(`${Math.round(crop.width)} × ${Math.round(crop.height)}`)
</script>

<div class="panel">
  <header>
    <span class="selector">{selector}</span>
    <span class="locked">locked</span>
    <button type="button" class="change" onclick={onrepick}>Change</button>
  </header>

  {#if ancestors.length > 1}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <section class="tree">
      <Label>Or target a container it sits in</Label>
      <ul onmouseleave={() => onpreview(null)}>
        {#each ancestors as ancestor}
          <li>
            <button
              type="button"
              class="ancestor"
              class:selected={ancestor.levelsUp === depth}
              style="padding-left: {6 + ancestor.indent * 9}px"
              onclick={() => onretarget(ancestor.levelsUp)}
              onmouseenter={() => onpreview(ancestor.levelsUp)}
              onfocus={() => onpreview(ancestor.levelsUp)}
              onblur={() => onpreview(null)}
            >
              {ancestor.label}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="scope">
    <Label>How widely should it apply?</Label>
    <div class="choices" role="radiogroup" aria-label="How widely should it apply?">
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'element'}
        class:selected={scope === 'element'}
        onclick={() => onscope('element')}
      >
        Just this element
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scope === 'similar'}
        class:selected={scope === 'similar'}
        onclick={() => onscope('similar')}
      >
        Every one like it
      </button>
    </div>
    {#if scope === 'similar'}
      <p class="note">
        {#if scopeCount > 1}
          {scopeCount} elements on this page, outlined so you can check the set
          before asking for it.
        {:else}
          Nothing else on this page looks like it, so this will behave the same
          as targeting just the one.
        {/if}
      </p>
    {/if}
  </section>

  <section>
    <Label>What should change?</Label>
    <textarea
      use:autogrow={instruction}
      value={instruction}
      placeholder="Give the comment tree a dark background"
      oninput={(event) => onchange(event.currentTarget.value)}
    ></textarea>
    <Button variant="primary" full disabled={!instruction.trim()} onclick={ongenerate}>
      Generate
    </Button>
  </section>

  {#if visionSupported}
    <section class="screenshot">
      <div class="opt-in">
        <Toggle
          checked={sendScreenshot}
          label="Send a screenshot of this region"
          onchange={onscreenshot}
        />
        <span class="opt-in-text">Send a screenshot of this region</span>
      </div>

      {#if sendScreenshot}
        <div class="preview" aria-hidden="true">
          <span class="preview-text">crop {cropLabel}</span>
        </div>
        <p class="warning">
          Everything inside this rectangle is sent to {providerLabel}, including any
          text, names, or images that happen to be there.
        </p>
        <p class="note">
          {#if cropClipped}
            Clipped at the viewport — only the visible part is captured.
          {/if}
          Off again every time you start a new request.
        </p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    gap: var(--sp-11);
    padding: var(--gutter-sidebar);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .selector {
    padding: 2px 6px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 11.5px var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .locked {
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .change {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    font: 11px var(--font-ui);
    color: var(--accent-fg);
    cursor: pointer;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  textarea {
    min-height: 62px;
    overflow-y: hidden;
    resize: none;
    padding: 9px 10px;
    border: 1px solid var(--accent-fg);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12.5px/1.55 var(--font-ui);
    color: var(--text);
  }

  textarea:focus {
    outline: none;
  }

  /*
   * Scrolls rather than growing. A framework-built page can nest an element a
   * dozen wrappers deep, and the list must not push the description field off
   * the panel.
   */
  .tree ul {
    display: flex;
    flex-direction: column;
    max-height: 132px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
  }

  .ancestor {
    display: block;
    width: 100%;
    padding: 5px 8px;
    border: none;
    background: transparent;
    font: 11.5px var(--font-mono);
    color: var(--text-dim);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .ancestor:hover,
  .ancestor:focus-visible {
    background: var(--accent-wash);
    color: var(--text);
  }

  /* The current target. Still clickable — it is how you come back to it. */
  .ancestor.selected {
    background: var(--accent-chip);
    color: var(--accent-fg);
  }

  .choices {
    display: flex;
    gap: var(--sp-6);
  }

  .choices button {
    flex: 1;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: transparent;
    font: 11.5px var(--font-ui);
    color: var(--text-dim);
    cursor: pointer;
  }

  .choices button.selected {
    border-color: var(--accent-fg);
    background: var(--accent-wash);
    color: var(--text);
  }

  .screenshot {
    gap: var(--sp-9);
    padding: var(--sp-11);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .opt-in {
    display: flex;
    align-items: center;
    gap: var(--sp-9);
  }

  .opt-in-text {
    font: 12.5px var(--font-ui);
  }

  /* Stands in for the capture rather than showing one: taking the screenshot
     to preview it would be the very thing the toggle is asking about. */
  .preview {
    display: flex;
    height: 74px;
    align-items: center;
    justify-content: center;
    border: 1.5px dashed var(--attention);
    border-radius: var(--r-button);
    background: repeating-linear-gradient(
      135deg,
      var(--surface-raised) 0 6px,
      var(--surface-sunken) 6px 12px
    );
  }

  .preview-text {
    font: 10.5px var(--font-mono);
    color: var(--text-dim);
  }

  .warning {
    margin: 0;
    font: 11.5px/1.55 var(--font-ui);
    color: var(--attention);
  }

  .note {
    margin: 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }
</style>
