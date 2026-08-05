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
    onexpand: (path: TreePath) => void
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
    onexpand,
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
   * The selection is put in the middle of the list, not merely brought into
   * view. It sits between its ancestors and its descendants, so centring it
   * shows both — where the minimum scroll would leave it against an edge with
   * one side of its context off-screen, and leave it wherever it happened to
   * land when it was already visible.
   *
   * The inline axis is left alone: sideways position is the hover's business,
   * and its resting place is the left edge.
   */
  let list = $state<HTMLDivElement | null>(null)

  /**
   * One level of nesting, in pixels, and the gutter before the first.
   *
   * A fixed step rather than one scaled to fit the panel. Squeezing deep
   * trees into the width available made two different depths draw at nearly
   * the same offset, and it left every row starting left of the midline —
   * which is to say there was never anything to centre. The tree is allowed
   * to be wider than the panel instead, and the list scrolls to it.
   */
  const STEP = 9

  /**
   * Breathing room at both ends of the list.
   *
   * It does two jobs, which is why it is one number. As the first row's
   * padding it keeps the shallowest name off the left edge when the list sits
   * at rest; as an inset on the arithmetic below it keeps whichever name the
   * list moved for off the edge it moved towards — which would otherwise be
   * exactly flush, since that edge is what the move was aiming at.
   */
  const EDGE = 10

  /**
   * Rows either side of the pointer that the position tries to take in.
   *
   * The point of the list is the surroundings, so the position is decided by
   * a stretch of it rather than by one row. Taken alternately from above and
   * below, so neither side is preferred.
   */
  const NEIGHBOURS = 5

  /** Where each row's name ends, in the list's own coordinates. Measured. */
  let ends = $state<number[]>([])

  /**
   * Moves the list the least it takes to show the rows around `index`.
   *
   * Two halves. First, how much to show: start from the row itself and take
   * in neighbours one at a time, above and below alternately, keeping each
   * one only while the whole stretch still fits across the panel. What comes
   * out is the widest span of nearby rows that can be read at once, so a deep
   * row four below pulls the view towards it before the pointer gets there.
   *
   * Second, where to put that span: as close to where the list already sits
   * as showing it allows. Anything already on screen therefore stays put —
   * moving to a row that could be read without moving is motion for its own
   * sake, and going from a deep row to a shallow one used to snap left for
   * exactly that non-reason.
   *
   * A name wider than the panel cannot be contained, and falls out of the
   * arithmetic aligned to its start, which is where reading begins.
   */
  function frame(index: number, measured: number[] = ends): void {
    const row = rows[index]
    if (!list || !row) return

    const width = list.clientWidth
    let lo = row.pad
    let hi = measured[index] ?? row.pad

    for (let step = 1; step <= NEIGHBOURS; step += 1) {
      for (const at of [index - step, index + step]) {
        const near = rows[at]
        if (!near) continue
        const low = Math.min(lo, near.pad)
        const high = Math.max(hi, measured[at] ?? near.pad)
        if (high - low <= width) {
          lo = low
          hi = high
        }
      }
    }

    /*
     * Whether to move is asked without the margin, and where to land is
     * answered with it. Asking with it would make the margin a reason to
     * move: a range already legible but sitting closer than EDGE to an edge
     * would be shuffled a few pixels to claim room it did not need.
     */
    const at = list.scrollLeft
    if (at <= lo && at >= hi - width) return
    list.scrollLeft = Math.min(Math.max(at, hi - width + EDGE), lo - EDGE)
  }

  /*
   * Hovering a row is a glance, and a pointer crossing the list produces a
   * row of them. Waiting for the pointer to settle means one scroll where it
   * stopped, rather than one per row it passed over on the way.
   */
  const SETTLE_MS = 60
  let settle: ReturnType<typeof setTimeout> | undefined

  function frameSoon(index: number): void {
    clearTimeout(settle)
    settle = setTimeout(() => frame(index), SETTLE_MS)
  }

  $effect(() => () => clearTimeout(settle))

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
      pad: EDGE + row.indent * STEP,
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

  let selectedIndex = $derived(rows.findIndex((row) => row.isTarget))

  /*
   * The selection is framed by default: centred down the list, and across it
   * by the same rule the hover uses. It sits between its ancestors and its
   * descendants, so its surroundings are the ones worth showing when nothing
   * else is being pointed at.
   *
   * Name widths are read here, once per tree, because they are what decides
   * how much of a stretch fits. Every read happens before anything is
   * written, so the measuring costs one layout rather than one per row.
   */
  $effect(() => {
    void tree
    if (!list) return
    clearTimeout(settle)
    const origin = list.getBoundingClientRect().left - list.scrollLeft
    const measured = [...list.querySelectorAll('.name')].map(
      (name) => name.getBoundingClientRect().right - origin,
    )
    ends = measured
    list.querySelector('.node.selected')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    frame(selectedIndex, measured)
  })

  /** Hovering is a departure from the selection, so leaving returns to it. */
  function rest(): void {
    frameSoon(selectedIndex)
  }
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="scroll"
        bind:this={list}
        onmouseleave={() => {
          onpreview(null)
          rest()
        }}
      >
        <!--
          Every row carries a `.name`, the count rows included, so the measured
          widths line up one-to-one with the rows they came from.
        -->
        <ul>
          {#each rows as row, index}
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
                  onmouseenter={() => {
                    onpreview(path)
                    frameSoon(index)
                  }}
                  onfocus={() => {
                    onpreview(path)
                    /* Keyboard focus is a decision, not a glance: no wait. */
                    frame(index)
                  }}
                  onblur={() => onpreview(null)}
                  ><span class="name"
                    >{row.label}{#if row.origin}<!--
                      Where the pick started, so the way back to it is visible
                      from wherever the selection has moved to.
                    --><span class="origin">picked</span>{/if}</span
                  >
                </button>
              {:else if row.expand}
                {@const open = row.expand}
                <!--
                  Children a cap left out. Not an element — there is nothing
                  here to select or to draw on the page — but the cap can be
                  lifted for the node they belong to.
                -->
                <button
                  type="button"
                  class="more open"
                  style="padding-left: {row.pad}px"
                  onclick={() => onexpand(open)}><span class="name">{row.label}</span></button
                >
              {:else}
                <!-- The list running into its own ceiling rather than a node
                     into its cap, so there is nothing to ask for. -->
                <span class="more" style="padding-left: {row.pad}px"
                  ><span class="name">{row.label}</span></span
                >
              {/if}
            </li>
          {/each}
        </ul>
      </div>
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

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    scroll-behavior: smooth;
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll {
      scroll-behavior: auto;
    }
  }

  /*
   * As wide as the widest row rather than as wide as the panel, so every row
   * fills the scrollable width. Without it a short row's highlight would stop
   * at the panel edge and leave a gap once the list is scrolled across.
   */
  .tree ul {
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .node {
    display: block;
    width: 100%;
    /* The right half of the pair EDGE makes on the left; padding-left is set
       per row, from the same number plus the indent. */
    padding: 5px 10px;
    border: none;
    background: transparent;
    font: 11.5px var(--font-mono);
    color: var(--text-dim);
    text-align: left;
    white-space: nowrap;
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
    width: 100%;
    padding: 4px 10px;
    border: none;
    background: transparent;
    font: 10.5px var(--font-ui);
    color: var(--text-faint);
    text-align: left;
    white-space: nowrap;
  }

  /* A count that can be asked about, marked as such rather than explained. */
  .more.open {
    color: var(--accent-fg);
    cursor: pointer;
  }

  .more.open:hover,
  .more.open:focus-visible {
    background: var(--accent-wash);
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
