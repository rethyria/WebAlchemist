<script lang="ts">
  import type { Transform, TransformRuntimeState } from '@shared/types'
  import Toggle from './Toggle.svelte'

  interface Props {
    transform: Transform
    /* Named `runtime`, not `state`: a prop called `state` makes every
       `$state(...)` in this component parse as store access on it. */
    runtime: TransformRuntimeState | undefined
    /** 1-based place in the list. Later entries win a conflict. */
    position: number
    expanded: boolean
    /** True while this row is the one being dragged. */
    dragging: boolean
    ontoggle: (enabled: boolean) => void
    onexpand: () => void
    onrename: (name: string) => void
    ondelete: () => void
    ongrab: () => void
    /** The dragged row should come to rest here. */
    onhover: () => void
    ondrop: () => void
    /** Keyboard equivalent of a drag: -1 earlier, +1 later. */
    onmove: (delta: number) => void
  }

  let {
    transform,
    runtime,
    position,
    expanded,
    dragging,
    ontoggle,
    onexpand,
    onrename,
    ondelete,
    ongrab,
    onhover,
    ondrop,
    onmove,
  }: Props = $props()

  /*
   * Reordering is offered by keyboard as well as by drag. A drag-only control
   * cannot be operated without a pointer, and this one decides which transform
   * wins a conflict — it is not decoration.
   */
  function onHandleKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onmove(event.key === 'ArrowUp' ? -1 : 1)
  }

  let broken = $derived(runtime?.status === 'broken')
  /* JS carrying capabilities, or broken, gets the attention treatment. */
  let flagged = $derived(broken || transform.capabilities.length > 0)

  /*
   * Delete asks first and asks in place. A transform is minutes of work and a
   * model call, and there is no undo behind this — but a modal for a list row
   * is heavier than the action deserves, so the row itself becomes the
   * question and the answer is one click away from the cancel.
   */
  let confirming = $state(false)

  let renaming = $state(false)
  let draftName = $state('')

  function startRename() {
    draftName = transform.name
    renaming = true
  }

  function commitRename() {
    renaming = false
    const next = draftName.trim()
    // An empty name would leave a row with nothing to click on.
    if (next && next !== transform.name) onrename(next)
  }

  function onRenameKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRename()
    }
    if (event.key === 'Escape') renaming = false
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class="row"
  class:expanded
  class:dragging
  ondragover={(event) => {
    // Without preventDefault this is not a drop target and the drag is refused.
    event.preventDefault()
    onhover()
  }}
  ondrop={(event) => {
    event.preventDefault()
    ondrop()
  }}
>
  <div class="head">
    <button
      type="button"
      class="handle"
      draggable="true"
      aria-label="Reorder {transform.name}. Arrow keys move it."
      ondragstart={(event) => {
        // Firefox refuses to start a drag with no payload set.
        event.dataTransfer?.setData('text/plain', transform.id)
        ongrab()
      }}
      ondragend={ondrop}
      onkeydown={onHandleKey}>{position}</button
    >

    <Toggle
      checked={transform.enabled}
      label="Enable {transform.name}"
      onchange={ontoggle}
    />

    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename"
        autofocus
        value={draftName}
        aria-label="Name"
        oninput={(event) => (draftName = event.currentTarget.value)}
        onblur={commitRename}
        onkeydown={onRenameKey}
      />
    {:else}
      <button
        type="button"
        class="name"
        onclick={onexpand}
        ondblclick={startRename}
        aria-expanded={expanded}
      >
        {transform.name}
      </button>
    {/if}

    <div class="meta">
      <span
        class="dot"
        class:broken
        title={broken ? 'Stopped working' : 'Working'}
      ></span>
      <span class="badge" class:flagged={flagged && transform.kind === 'js'}>
        {transform.kind.toUpperCase()}
      </span>
    </div>
  </div>

  {#if expanded}
    <div class="body">
      <section>
        <h3 class="label">You wanted</h3>
        <p>{transform.intent}</p>
      </section>

      {#if broken}
        <section>
          <h3 class="label attention">What broke</h3>
          <p>{runtime?.brokenReason}</p>
          {#if runtime?.failedAssumption}
            <p class="assumption">This transform assumed {runtime.failedAssumption}.</p>
          {/if}
        </section>

        <!--
          Repair and Edit stood here and did nothing — their handlers were
          empty. They are gone rather than left inert: a button that claims a
          capability the extension does not have is worse than its absence,
          because it costs the user a click to find out. See #24 and #25.
        -->
        <div class="actions">
          <button type="button" class="secondary" onclick={() => ontoggle(false)}>
            Disable
          </button>
        </div>
      {/if}

      <div class="manage">
        {#if confirming}
          <span class="ask">Delete this transform?</span>
          <button type="button" class="danger" onclick={ondelete}>Delete</button>
          <button type="button" class="secondary" onclick={() => (confirming = false)}>
            Cancel
          </button>
        {:else}
          <button type="button" class="secondary" onclick={startRename}>Rename</button>
          <button type="button" class="secondary" onclick={() => (confirming = true)}>
            Delete
          </button>
        {/if}
      </div>

      <details class="disclosure">
        <summary>Code and rationale</summary>
        <div class="rationale">
          <h4 class="label">Approach</h4>
          <p>{transform.rationale.approach}</p>
          <h4 class="label">Assumes</h4>
          <ul>
            {#each transform.rationale.assumptions as assumption}
              <li>{assumption}</li>
            {/each}
          </ul>
          <pre>{transform.code}</pre>
        </div>
      </details>
    </div>
  {/if}
</li>

<style>
  .row {
    border-bottom: 1px solid var(--border-subtle);
    list-style: none;
  }

  .row.expanded {
    background: var(--surface-raised);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px var(--gutter-sidebar);
  }

  .handle {
    /* Fixed width so the column holds still when the list passes nine. */
    min-width: 1.4ch;
    padding: 0 1px;
    border: none;
    background: none;
    font: 11px var(--font-mono);
    color: var(--text-faint);
    text-align: right;
    font-variant-numeric: tabular-nums;
    cursor: grab;
  }

  .handle:active {
    cursor: grabbing;
  }

  .handle:focus-visible {
    outline: 1px solid var(--accent-fg);
    border-radius: 2px;
  }

  /* The row being carried, so the gap it leaves is legible as it moves. */
  .row.dragging {
    opacity: 0.4;
  }

  .rename {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--accent-fg);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 13px var(--font-ui);
    color: var(--text);
  }

  .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    font: 13px var(--font-ui);
    color: var(--text);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ok);
  }

  /* Broken is the only status that gets a hue. Working stays neutral. */
  .dot.broken {
    background: var(--attention);
  }

  .badge {
    padding: 2px 5px;
    border: 1px solid transparent;
    border-radius: var(--r-badge);
    background: rgba(255, 255, 255, 0.08);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .badge.flagged {
    background: rgb(from var(--attention) r g b / 0.16);
    border-color: rgb(from var(--attention) r g b / 0.35);
    color: var(--attention);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 11px;
    /* Aligns under the name, past the handle and toggle. */
    padding: 0 var(--gutter-sidebar) var(--gutter-sidebar) var(--indent-expanded);
  }

  .label {
    margin: 0 0 3px;
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .label.attention {
    color: var(--attention);
  }

  p {
    margin: 0;
    font: 12.5px/1.5 var(--font-ui);
    color: var(--text);
  }

  .assumption {
    margin-top: 3px;
    color: var(--text-dim);
  }

  .actions,
  .manage {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Separated from the transform's own content: these act on the record. */
  .manage button {
    padding: 5px 9px;
    font-weight: 400;
    font-size: 12px;
  }

  .manage {
    padding-top: 2px;
    border-top: 1px solid var(--border-subtle);
    margin-top: 2px;
  }

  .ask {
    margin-right: auto;
    font: 12px var(--font-ui);
    color: var(--text);
  }

  button.secondary,
  button.danger {
    padding: 8px 10px;
    border-radius: var(--r-button);
    font: 600 12.5px var(--font-ui);
    cursor: pointer;
  }

  button.secondary {
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
  }

  /* The only destructive control in the panel, and the only one tinted. */
  button.danger {
    border: 1px solid var(--attention);
    background: rgb(from var(--attention) r g b / 0.12);
    color: var(--attention);
  }

  .disclosure summary {
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-dim);
    cursor: pointer;
  }

  .rationale {
    padding-top: 7px;
  }

  .rationale ul {
    margin: 0 0 9px;
    padding-left: 16px;
    font: 12.5px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  pre {
    margin: 0;
    padding: 9px;
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 11px/1.7 var(--font-mono);
    color: var(--text-dim);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
