<script lang="ts">
  import type { FlowError } from '../lib/flow.svelte'
  import Button from './Button.svelte'

  /**
   * Four dead ends, kept apart. Each has a different way out, and that way out
   * is the only part of an error message anyone reads — collapsing them into
   * one "something went wrong" would throw away the useful half.
   */
  interface Props {
    error: FlowError
    onretry: () => void
    onsettings: () => void
    ondismiss: () => void
  }

  let { error, onretry, onsettings, ondismiss }: Props = $props()

  let detailOpen = $state(false)
</script>

<div
  class="card"
  class:block={error.kind === 'request-failed'}
  class:attention={error.kind === 'rate-limited'}
  role="alert"
>
  {#if error.kind === 'no-provider'}
    <span class="title">No provider set up</span>
    <p>
      Nothing can be generated until an API key is stored. Anthropic or any
      OpenAI-compatible endpoint.
    </p>
    <div class="actions">
      <Button variant="primary" small onclick={onsettings}>Add a provider</Button>
    </div>
  {:else if error.kind === 'request-failed'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">The request failed</span>
    </div>
    <p>{error.message} Your description is kept.</p>
    {#if detailOpen && error.detail}
      <pre>{error.detail}</pre>
    {/if}
    <div class="actions">
      <Button variant="primary" small onclick={onretry}>Try again</Button>
      {#if error.detail}
        <Button small onclick={() => (detailOpen = !detailOpen)}>
          {detailOpen ? 'Hide response' : 'Show response'}
        </Button>
      {/if}
      <Button small onclick={ondismiss}>Dismiss</Button>
    </div>
  {:else if error.kind === 'rate-limited'}
    <div class="head">
      <span class="dot attention" aria-hidden="true"></span>
      <span class="title">Rate limited</span>
    </div>
    <p>{error.message}</p>
    <div class="actions">
      <Button variant="primary" small onclick={onretry}>Try again</Button>
      <Button small onclick={ondismiss}>Cancel</Button>
    </div>
  {:else}
    <span class="title">Credential expired</span>
    <p>
      {error.message} Saved transforms keep working; new ones cannot be generated.
    </p>
    <div class="actions">
      <Button variant="primary" small onclick={onsettings}>Reconnect</Button>
    </div>
  {/if}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: var(--gutter-sidebar) var(--gutter-sidebar) 0;
    padding: var(--gutter-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--r-panel);
    background: var(--surface);
  }

  .card.block {
    border-color: rgb(from var(--block) r g b / 0.4);
  }

  .card.attention {
    border-color: rgb(from var(--attention) r g b / 0.4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
  }

  .dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
  }

  .dot.block {
    background: var(--block);
  }

  .dot.attention {
    background: var(--attention);
  }

  .title {
    font: 600 12.5px var(--font-ui);
  }

  p {
    margin: 0;
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  pre {
    margin: 0;
    max-height: 140px;
    padding: 9px;
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 11px/1.6 var(--font-mono);
    color: var(--text-dim);
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-6);
  }
</style>
