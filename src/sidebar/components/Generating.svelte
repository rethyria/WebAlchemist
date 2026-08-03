<script lang="ts">
  import type { ProgressStage } from '../lib/flow.svelte'
  import type { TransformKind } from '@shared/types'
  import Button from './Button.svelte'
  import CodeBlock from './CodeBlock.svelte'

  interface Props {
    stage: ProgressStage
    reached: (stage: ProgressStage) => boolean
    elapsed: number
    kind: TransformKind | null
    code: string
    withScreenshot: boolean
    contextSize: number
    oncancel: () => void
  }

  let {
    stage,
    reached,
    elapsed,
    kind,
    code,
    withScreenshot,
    contextSize,
    oncancel,
  }: Props = $props()

  /*
   * A checklist rather than a spinner. The request takes ten to thirty seconds
   * and a spinner would say nothing about which part is slow, or that a
   * screenshot went with it.
   */
  let steps = $derived([
    { id: 'context' as const, text: 'Read the element and its ancestors' },
    {
      id: 'sent' as const,
      text: `Sent ${(contextSize / 1024).toFixed(1)} kB of page context${
        withScreenshot ? ', with a screenshot' : ', no screenshot'
      }`,
    },
    { id: 'streaming' as const, text: 'Writing code' },
    { id: 'analysis' as const, text: 'Static analysis' },
    { id: 'preview' as const, text: 'Preview on the page' },
  ])

  /*
   * Elapsed time drives the bar, not a percentage: nothing here knows how long
   * the model will take, and a bar that claims to would be inventing it. It is
   * capped so it slows down rather than completing early.
   */
  let fraction = $derived(Math.min(0.95, elapsed / 30))
</script>

<div class="panel">
  <header>
    <span class="title">Writing {kind === 'js' ? 'JavaScript' : 'CSS'}</span>
    <span class="elapsed">{elapsed}s</span>
  </header>

  <div class="bar">
    <div class="fill" style="width: {(fraction * 100).toFixed(1)}%"></div>
  </div>

  <ol class="steps">
    {#each steps as step}
      <li class:done={reached(step.id)} class:current={stage === step.id}>
        <span class="marker" aria-hidden="true">{reached(step.id) ? '✓' : '·'}</span>
        {step.text}
      </li>
    {/each}
  </ol>

  {#if code}
    <CodeBlock {code} kind={kind ?? 'css'} streaming />
  {:else}
    <div class="placeholder"></div>
  {/if}

  <Button full onclick={oncancel}>Cancel</Button>
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-12);
    padding: var(--gutter-sidebar);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .title {
    font: 600 12.5px var(--font-ui);
  }

  .elapsed {
    margin-left: auto;
    font: 11px var(--font-mono);
    color: var(--text-faint);
  }

  .bar {
    height: 3px;
    overflow: hidden;
    border-radius: var(--r-progress);
    background: var(--chrome);
  }

  .fill {
    height: 100%;
    background: var(--accent-fg);
    transition: width 1s linear;
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  /* Done and pending are both recessive; only the current step is bright. */
  .steps li {
    opacity: 0.55;
  }

  .steps li.done {
    opacity: 1;
  }

  .steps li.current {
    opacity: 1;
    color: var(--text);
  }

  .marker {
    display: inline-block;
    width: 12px;
  }

  .placeholder {
    flex: 1;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
  }
</style>
