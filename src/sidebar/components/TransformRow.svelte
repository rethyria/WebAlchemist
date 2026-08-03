<script lang="ts">
  import type { Transform, TransformRuntimeState } from '@shared/types'
  import Toggle from './Toggle.svelte'

  interface Props {
    transform: Transform
    state: TransformRuntimeState | undefined
    expanded: boolean
    ontoggle: (enabled: boolean) => void
    onexpand: () => void
    onrepair: () => void
    onedit: () => void
  }

  let { transform, state, expanded, ontoggle, onexpand, onrepair, onedit }: Props = $props()

  let broken = $derived(state?.status === 'broken')
  /* JS carrying capabilities, or broken, gets the attention treatment. */
  let flagged = $derived(broken || transform.capabilities.length > 0)
</script>

<li class="row" class:expanded>
  <div class="head">
    <span class="handle" aria-hidden="true">⠿</span>

    <Toggle
      checked={transform.enabled}
      label="Enable {transform.name}"
      onchange={ontoggle}
    />

    <button type="button" class="name" onclick={onexpand} aria-expanded={expanded}>
      {transform.name}
    </button>

    <div class="meta">
      <span
        class="dot"
        class:broken
        title={broken ? 'Stopped working' : 'Working'}
      ></span>
      <span class="badge" class:flagged={flagged && transform.kind === 'js'}>
        {transform.kind.toUpperCase()}
      </span>
      <span class="badge" class:you={transform.origin === 'manual'}>
        {transform.origin === 'ai' ? 'AI' : 'you'}
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
          <p>{state?.brokenReason}</p>
          {#if state?.failedAssumption}
            <p class="assumption">This transform assumed {state.failedAssumption}.</p>
          {/if}
        </section>

        <div class="actions">
          <button type="button" class="primary" onclick={onrepair}>Repair with AI</button>
          <button type="button" class="secondary" onclick={onedit}>Edit</button>
          <button type="button" class="secondary" onclick={() => ontoggle(false)}>
            Disable
          </button>
        </div>
      {/if}

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
    font: 12px var(--font-mono);
    color: var(--text-faint);
    cursor: grab;
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

  .badge.you {
    opacity: 0.55;
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

  .actions {
    display: flex;
    gap: 6px;
  }

  button.primary,
  button.secondary {
    padding: 8px 10px;
    border-radius: var(--r-button);
    font: 600 12.5px var(--font-ui);
    cursor: pointer;
  }

  button.primary {
    border: none;
    background: var(--accent);
    color: var(--accent-text);
  }

  button.secondary {
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text);
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
