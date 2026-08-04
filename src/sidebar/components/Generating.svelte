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
    thinkingChars: number
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
    thinkingChars,
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
    {
      /*
       * On a hard change this is most of the wait. Without it the panel sat on
       * "sent" for the whole reasoning phase, which read as a hang — and was
       * indistinguishable from the genuine hang it turned out to be masking.
       */
      id: 'thinking' as const,
      text: thinkingChars
        ? `Thinking — ${thinkingChars.toLocaleString()} characters`
        : 'Thinking',
    },
    {
      id: 'streaming' as const,
      text: code ? `Writing code — ${code.split('\n').length} lines so far` : 'Writing code',
    },
    { id: 'analysis' as const, text: 'Static analysis' },
    { id: 'preview' as const, text: 'Preview on the page' },
  ])

</script>

<div class="panel">
  <header>
    <!--
      Neutral until the model has said which it is writing. Defaulting to CSS
      titled every JavaScript run wrongly for its whole duration.
    -->
    <span class="title">
      {kind === null ? 'Generating' : kind === 'js' ? 'Writing JavaScript' : 'Writing CSS'}
    </span>
    <span class="elapsed">{elapsed}s</span>
  </header>

  <!--
    An indeterminate bar, not a progress bar. Nothing here knows how long the
    model will take, so a filling bar would be inventing a number — which is
    what the previous one did, and it read as meaningless because it was.
  -->
  <div class="bar" role="progressbar" aria-label="Working"><div class="sweep"></div></div>

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
    /*
     * Without this the panel takes its height from its content — a flex item
     * defaults to min-height:auto — so the code block below could never be
     * shorter than the code inside it, and `overflow-y: auto` had nothing to
     * scroll. The panel simply grew past the bottom of the sidebar instead.
     * Refining already carried this line; generating did not.
     */
    min-height: 0;
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

  .sweep {
    width: 40%;
    height: 100%;
    border-radius: var(--r-progress);
    background: var(--accent-fg);
    animation: sweep 1.4s ease-in-out infinite;
  }

  @keyframes sweep {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .sweep {
      width: 100%;
      animation: none;
      opacity: 0.5;
    }
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
