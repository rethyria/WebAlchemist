<script lang="ts">
  import type { HoverTarget, Rect } from '@shared/types'
  import { autogrow } from '../lib/autogrow'
  import Button from './Button.svelte'
  import Label from './Label.svelte'

  interface Props {
    target: HoverTarget
    crop: Rect
    cropClipped: boolean
    instruction: string
    choosingRegion: boolean
    /** The captured image, once there is one. */
    shotPreview: string | null
    shotClipped: boolean
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
    scopeDepth: number
    scopeCount: number
    scopeContainer: string | null
    onscope: (depth: number) => void
    oncancel: () => void
    ongenerate: () => void
  }

  let {
    target,
    crop,
    cropClipped,
    instruction,
    choosingRegion,
    shotPreview,
    shotClipped,
    visionSupported,
    providerLabel,
    onchange,
    onscreenshot,
    onrepick,
    chain,
    depth,
    onretarget,
    onpreview,
    scopeDepth,
    scopeCount,
    scopeContainer,
    onscope,
    oncancel,
    ongenerate,
  }: Props = $props()

  let selector = $derived(target.breadcrumb.at(-1) ?? '')

  /*
   * Root first, so the list reads outermost to innermost with the element
   * originally picked at the bottom. Distance from the end is how far up the
   * chain each row sits — an absolute position, so the list moves in both
   * directions rather than only outwards.
   */
  /* How far the scope can widen: up to the outermost ancestor we captured. */
  let maxDepth = $derived(Math.max(0, chain.length - 1 - depth))

  /*
   * The slider reads as specificity, so the full-right position is the most
   * specific — the picked element alone. Depth counts the other way, which is
   * why the two are mirrored here rather than anywhere else.
   */
  let specificity = $derived(maxDepth - scopeDepth)

  let ancestors = $derived(
    chain.map((label, index) => {
      const levelsUp = chain.length - 1 - index
      return {
        label,
        levelsUp,
        indent: Math.min(index, 6),
        isTarget: levelsUp === depth,
        // The container the current scope resolves to, marked distinctly:
        // it answers a different question from the target.
        isContainer: scopeDepth > 0 && levelsUp === depth + scopeDepth,
        /*
         * Everything between the container and the target is inside the
         * scope. Shading the span, rather than only its top row, is what
         * makes the slider legible — the reach is a region of the chain,
         * not a single line in it.
         */
        inScope:
          scopeDepth > 0 && levelsUp <= depth + scopeDepth && levelsUp >= depth,
      }
    }),
  )
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
              class:selected={ancestor.isTarget}
              class:container={ancestor.isContainer}
              class:in-scope={ancestor.inScope}
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

  {#if maxDepth > 0}
    <section class="scope">
      <Label>How widely should it apply?</Label>
      <input
        type="range"
        min="0"
        max={maxDepth}
        value={specificity}
        aria-label="How widely should it apply"
        oninput={(event) => onscope(maxDepth - Number(event.currentTarget.value))}
      />
      <p class="note">
        {#if scopeDepth === 0}
          Just this element.
        {:else if scopeContainer}
          {scopeCount === 1 ? 'Only this one' : `All ${scopeCount} like it`} inside
          <code>{scopeContainer}</code>, outlined on the page.
        {:else}
          Every element like this one.
        {/if}
      </p>
    </section>
  {/if}

  <section>
    <Label>What should change?</Label>
    <textarea
      use:autogrow={instruction}
      value={instruction}
      placeholder="Give the comment tree a dark background"
      oninput={(event) => onchange(event.currentTarget.value)}
    ></textarea>
    <div class="actions">
      <Button grow={1} small onclick={oncancel}>Cancel</Button>
      <Button
        variant="primary"
        grow={2}
        small
        disabled={!instruction.trim()}
        onclick={ongenerate}
      >
        Generate
      </Button>
    </div>
  </section>

  {#if visionSupported}
    <section class="screenshot">
      <!--
        An action, not a state. Taking a screenshot is a thing the user does
        once and then either keeps or drops; a checkbox implied it could be
        armed in advance, which it cannot.
      -->
      {#if !shotPreview}
        <button
          type="button"
          class="shot-action"
          disabled={choosingRegion}
          onclick={() => onscreenshot(true)}
        >
          {choosingRegion ? 'Drag the area on the page…' : 'Add a screenshot'}
        </button>
      {/if}

      <!--
        The image itself, not its dimensions. This is the consent surface: what
        is on screen here is exactly what leaves the browser, so it has to be
        the picture rather than a description of one.
      -->
      {#if shotPreview}
        <img class="shot" src={shotPreview} alt="The region that will be sent" />
        <p class="warning">
          This image is sent to {providerLabel}, including any text, names or
          images that happen to be in it.
        </p>
        <p class="note">
          {#if shotClipped}
            Clipped at the viewport — only the visible part was captured.
          {/if}
          Dropped again every time you start a new request.
        </p>
        <button type="button" class="shot-action" onclick={() => onscreenshot(false)}>
          Remove screenshot
        </button>
      {/if}
    </section>
  {/if}
</div>

<style>
  /*
   * The list is the only part that flexes. Everything else keeps the height it
   * asks for, so the description field, its buttons and the screenshot opt-in
   * are never pushed off the panel by a deeply nested chain.
   */
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    gap: var(--sp-11);
    padding: var(--gutter-sidebar);
  }

  .panel > :global(*) {
    flex: none;
  }

  .actions {
    display: flex;
    gap: var(--sp-6);
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
   * Sized to its content, not to the space available — a three-row chain
   * should look like three rows. It still gives way when the panel is short,
   * shrinking and scrolling rather than pushing the controls off.
   */
  .tree {
    flex: 0 1 auto !important;
    min-height: 52px;
  }

  .tree ul {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
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

  .scope input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--accent-fg);
  }

  .note code {
    font: 11px var(--font-mono);
    color: var(--text-dim);
  }

  /*
   * The container is a different kind of answer from the target — one is what
   * changes, the other is how far the change reaches — so it reads as a
   * distinct colour rather than a second shade of the selection.
   */
  .ancestor.container {
    background: rgb(from var(--neutral) r g b / 0.22);
    color: var(--text);
    box-shadow: inset 2px 0 0 var(--neutral);
  }

  /* The span the container reaches over, faint so the two ends still read. */
  .ancestor.in-scope:not(.container):not(.selected) {
    background: rgb(from var(--neutral) r g b / 0.1);
    box-shadow: inset 2px 0 0 rgb(from var(--neutral) r g b / 0.45);
  }

  .ancestor.selected.in-scope {
    box-shadow: inset 2px 0 0 rgb(from var(--neutral) r g b / 0.45);
  }

  .screenshot {
    gap: var(--sp-9);
    padding: var(--sp-11);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }



  /* Stands in for the capture rather than showing one: taking the screenshot
     to preview it would be the very thing the toggle is asking about. */


  .shot {
    display: block;
    width: 100%;
    max-height: 220px;
    object-fit: contain;
    object-position: left top;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
  }

  .shot-action {
    align-self: flex-start;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: transparent;
    font: 11.5px var(--font-ui);
    color: var(--text);
    cursor: pointer;
  }

  .shot-action:disabled {
    border-color: var(--accent-fg);
    color: var(--accent-fg);
    cursor: default;
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
