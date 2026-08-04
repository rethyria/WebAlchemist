<script lang="ts">
  import type { HoverTarget, Rect, TreePath, TreeRow } from '@shared/types'
  import { autogrow } from '../lib/autogrow'
  import Button from './Button.svelte'
  import Toggle from './Toggle.svelte'
  import Label from './Label.svelte'

  interface Props {
    /** True when the pick came from a drawn rectangle. */
    regionAvailable: boolean
    target: HoverTarget
    crop: Rect
    cropClipped: boolean
    instruction: string
    choosingRegion: boolean
    /** The captured image, once there is one. */
    shotPreview: string | null
    shotClipped: boolean
    visionSupported: boolean
    onchange: (instruction: string) => void
    onscreenshot: (send: boolean) => void
    onincluderegion: () => void
    onrepick: () => void
    /** The chain above the selection, the selection, and what is under it. */
    tree: TreeRow[]
    onretarget: (path: TreePath) => void
    onpreview: (path: TreePath | null) => void
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
    regionAvailable,
    choosingRegion,
    shotPreview,
    shotClipped,
    visionSupported,
    onchange,
    onscreenshot,
    onincluderegion,
    onrepick,
    tree,
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

  /* How far the scope can widen: up to the outermost ancestor the page sent. */
  let maxDepth = $derived(tree.filter((row) => row.relation === 'ancestor').length)

  /*
   * The slider reads as specificity, so the full-right position is the most
   * specific — the picked element alone. Depth counts the other way, which is
   * why the two are mirrored here rather than anywhere else.
   */
  let specificity = $derived(maxDepth - scopeDepth)

  /*
   * Indentation is scaled to fit the deepest row rather than clipped at a
   * level, so nesting stays readable however deep the tree runs. Clipping
   * drew two different depths as the same line, which is worse than a tight
   * step: the indent is the only thing saying what contains what.
   *
   * Capped at the step a shallow tree already used, so nothing changes for
   * the common case, and floored so the deepest levels stay distinguishable.
   */
  /*
   * The selection can now sit a long way down the list — three generations
   * under any of several neighbours — so it is scrolled to rather than left to
   * be found. `nearest` because the row is usually already visible, and moving
   * the list when it did not need to move is its own kind of noise.
   */
  let list = $state<HTMLUListElement | null>(null)
  $effect(() => {
    void tree
    list?.querySelector('.node.selected')?.scrollIntoView({ block: 'nearest' })
  })

  const INDENT_BUDGET = 108
  let step = $derived.by(() => {
    const deepest = Math.max(0, ...tree.map((row) => row.indent))
    if (deepest === 0) return 9
    return Math.max(3, Math.min(9, INDENT_BUDGET / deepest))
  })

  /*
   * Outermost first, so the list reads down the page's own nesting: ancestors,
   * then the selection, then what is inside it. `above` is distance up from
   * the selection and only ancestors have one, which is also why the scope
   * shading below can key off it directly — the scope only ever widens
   * upwards.
   */
  let rows = $derived(
    tree.map((row) => ({
      ...row,
      pad: 6 + row.indent * step,
      isTarget: row.relation === 'current',
      // The container the current scope resolves to, marked distinctly: it
      // answers a different question from the target.
      isContainer: scopeDepth > 0 && row.above === scopeDepth,
      /*
       * Everything between the container and the target is inside the scope.
       * Shading the span, rather than only its top row, is what makes the
       * slider legible — the reach is a region of the chain, not a single
       * line in it.
       */
      inScope: scopeDepth > 0 && row.above !== undefined && row.above <= scopeDepth,
    })),
  )
</script>

<div class="panel">
  <header>
    <span class="selector">{selector}</span>
    <span class="locked">locked</span>
    <button type="button" class="change" onclick={onrepick}>Change</button>
  </header>

  {#if rows.length > 1}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <section class="tree">
      <Label>Or target another element</Label>
      <ul bind:this={list} onmouseleave={() => onpreview(null)}>
        {#each rows as row}
          <li>
            {#if row.path}
              {@const path = row.path}
              <button
                type="button"
                class="node"
                class:selected={row.isTarget}
                class:container={row.isContainer}
                class:in-scope={row.inScope}
                class:aside={row.relation === 'sibling'}
                style="padding-left: {row.pad}px"
                onclick={() => onretarget(path)}
                onmouseenter={() => onpreview(path)}
                onfocus={() => onpreview(path)}
                onblur={() => onpreview(null)}
              >
                {row.label}
                <!-- Where the pick started, so the way back to it is visible
                     from wherever the selection has moved to. -->
                {#if row.origin}<span class="origin">picked</span>{/if}
              </button>
            {:else}
              <!-- Children not shown. A count rather than an element: there is
                   nothing here to select or to draw on the page. -->
              <span class="more" style="padding-left: {row.pad}px">{row.label}</span>
            {/if}
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
        A drawn rectangle is already a region the user chose, so including it
        is a yes/no about something that exists — a toggle. With no drawn
        rectangle there is nothing to include yet, so the only thing on offer
        is the act of making one, which is a button.
      -->
      {#if regionAvailable && !shotPreview}
        <div class="include">
          <Toggle
            checked={false}
            label="Include screenshot of the area you drew"
            onchange={(on) => on && onincluderegion()}
          />
          <span class="include-text">Include screenshot of the area you drew</span>
        </div>
      {/if}

      {#if !shotPreview}
        <button
          type="button"
          class="shot-action"
          disabled={choosingRegion}
          onclick={() => onscreenshot(true)}
        >
          {choosingRegion
            ? 'Drag the area on the page…'
            : regionAvailable
              ? 'Add a different screenshot'
              : 'Add a screenshot'}
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
          This image is sent to your AI provider. Everything visible in it goes
          too — names, messages, account details, anything personal that happens
          to be on screen.
        </p>
        {#if shotClipped}
          <p class="note">
            Clipped at the viewport — only the visible part was captured.
          </p>
        {/if}
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

  .node {
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

  .node:hover,
  .node:focus-visible {
    background: var(--accent-wash);
    color: var(--text);
  }

  /* The current target. Still clickable — it is how you come back to it. */
  .node.selected {
    background: var(--accent-chip);
    color: var(--accent-fg);
  }

  /* A neighbouring branch: reachable, but not on the line being described. */
  .node.aside {
    color: var(--text-faint);
  }

  .origin {
    margin-left: var(--sp-5);
    padding: 1px 4px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 10px var(--font-ui);
    color: var(--text-faint);
  }

  .more {
    display: block;
    padding: 4px 8px;
    font: 10.5px var(--font-ui);
    color: var(--text-faint);
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
  .node.container {
    background: rgb(from var(--neutral) r g b / 0.22);
    color: var(--text);
    box-shadow: inset 2px 0 0 var(--neutral);
  }

  /* The span the container reaches over, faint so the two ends still read. */
  .node.in-scope:not(.container):not(.selected) {
    background: rgb(from var(--neutral) r g b / 0.1);
    box-shadow: inset 2px 0 0 rgb(from var(--neutral) r g b / 0.45);
  }

  .node.selected.in-scope {
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

  .include {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
  }

  .include-text {
    font: 11.5px/1.4 var(--font-ui);
    color: var(--text-dim);
  }

  .shot-action {
    width: 100%;
    padding: 7px 10px;
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
