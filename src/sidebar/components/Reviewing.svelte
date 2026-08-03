<script lang="ts">
  import { CAPABILITY_ENFORCEMENT } from '@shared/types'
  import type { GenerationResult, ReviewResult } from '@shared/types'
  import Button from './Button.svelte'
  import CodeBlock from './CodeBlock.svelte'
  import Label from './Label.svelte'

  /**
   * Treatment A: a clean review collapses to a single quiet line, expandable
   * to the three rows underneath it.
   *
   * There is no green banner and no tick. A review that celebrates itself
   * trains people to skim past the one that matters, and the only reviews
   * worth reading are the ones with something in them.
   */
  interface Props {
    result: GenerationResult
    review: ReviewResult | null
    intent: string
    onrefuse: () => void
    onsave: () => void
    onback: () => void
  }

  let { result, review, intent, onrefuse, onsave, onback }: Props = $props()

  let detailOpen = $state(false)
  let codeOpen = $state(false)

  /* Set once the user has refused, so the block card can say why it appeared. */
  let refused = $state(false)

  let blocking = $derived(review?.static.filter((f) => f.severity === 'block') ?? [])
  let warnings = $derived(review?.static.filter((f) => f.severity === 'warn') ?? [])
  let capabilities = $derived(result.capabilities)
  let mismatch = $derived(review?.model && review.model.verdict !== 'match')

  let clean = $derived(
    review !== null &&
      blocking.length === 0 &&
      warnings.length === 0 &&
      capabilities.length === 0 &&
      !mismatch,
  )

  let flaggedLines = $derived([...blocking, ...warnings].map((f) => f.line))
  let lineCount = $derived(result.code.split('\n').length)

  let modelLine = $derived.by(() => {
    if (result.kind === 'css') return 'CSS — not reviewed'
    if (!review?.model) return 'not reviewed'
    return review.model.verdict === 'match'
      ? 'Second model read it and agrees with your description'
      : review.model.explanation
  })
</script>

<div class="panel">
  <header>
    <Label>Step 3 of 3 · Approve</Label>
    <h1>{result.name}</h1>
  </header>

  {#if review === null}
    <p class="waiting">Reading the code…</p>
  {:else}
    {#if blocking.length > 0}
      <div class="card block">
        <div class="card-head">
          <span class="dot block" aria-hidden="true"></span>
          <span class="card-title">This cannot be saved as it is</span>
        </div>
        {#each blocking as finding}
          <p class="finding">
            Line {finding.line} uses <code>{finding.api}</code>. {finding.explanation}
          </p>
        {/each}
        <p class="quiet">
          {#if refused}
            You refused what this code needs, so it will not be saved. Go back and
            describe what you want without it.
          {:else}
            Go back and describe what you want differently.
          {/if}
        </p>
      </div>
    {/if}

    {#each warnings as finding}
      <div class="card attention">
        <div class="card-head">
          <span class="dot attention" aria-hidden="true"></span>
          <div class="card-body">
            <span class="card-title">{finding.explanation}</span>
            <p class="finding">
              Line {finding.line} uses <code>{finding.api}</code>.
              {#if finding.capability && capabilities.includes(finding.capability)}
                That is {finding.capability} this transform declared, so it will work.
              {:else if finding.capability}
                That is {finding.capability}, which this transform did not declare —
                it will be blocked at runtime.
              {/if}
            </p>
          </div>
        </div>
        {#if capabilities.length > 0}
          <div class="chips">
            {#each capabilities as capability}
              <span class="chip">{capability}</span>
            {/each}
            <span class="quiet">requested · nothing else</span>
          </div>
          <p class="quiet">
            {#if capabilities.every((c) => CAPABILITY_ENFORCEMENT[c] === 'csp')}
              Anything it did not ask for is blocked while it runs.
            {:else}
              The browser can block network access this way, but not storage or
              cookies — for those, refusing means the code is not saved at all.
            {/if}
          </p>
        {/if}
      </div>
    {/each}

    {#if mismatch && review.model}
      <div class="card attention">
        <div class="card-head">
          <span class="dot attention" aria-hidden="true"></span>
          <div class="card-body">
            <span class="card-title">
              The second model does not agree this matches your description
            </span>
            <p class="finding">{review.model.explanation}</p>
          </div>
        </div>
        <p class="quiet">You asked for: {intent}</p>
      </div>
    {/if}

    {#if clean}
      <button type="button" class="quiet-line" onclick={() => (detailOpen = !detailOpen)}>
        <span class="dot" aria-hidden="true"></span>
        Checked — nothing flagged
        <span class="caret" aria-hidden="true">{detailOpen ? '▾' : '▸'}</span>
      </button>
    {/if}

    {#if detailOpen || !clean}
      <dl class="rows">
        <div class="row">
          <span class="dot" aria-hidden="true"></span>
          <dt>Code scan</dt>
          <dd>
            {#if blocking.length + warnings.length === 0}
              no findings
            {:else}
              {blocking.length + warnings.length}
              {blocking.length + warnings.length === 1 ? 'finding' : 'findings'}
            {/if}
          </dd>
        </div>
        <div class="row">
          <span class="dot" aria-hidden="true"></span>
          <dt>Capabilities</dt>
          <dd>
            {capabilities.length === 0 ? 'none requested' : capabilities.join(', ')}
          </dd>
        </div>
        <div class="row">
          <span class="dot" aria-hidden="true"></span>
          <dt>Second model</dt>
          <dd>{result.kind === 'css' ? 'CSS — not reviewed' : (review.model?.verdict ?? 'not reviewed')}</dd>
        </div>
      </dl>
    {/if}

    {#if result.kind === 'js' && review.model?.verdict === 'match' && !clean}
      <p class="quiet-line static">
        <span class="dot" aria-hidden="true"></span>
        {modelLine}
      </p>
    {/if}
  {/if}

  <details bind:open={codeOpen}>
    <summary>
      <span class="caret" aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
      Code and rationale
      <span class="meta">{lineCount} lines · {result.kind.toUpperCase()}</span>
    </summary>
    <div class="detail">
      <CodeBlock code={result.code} kind={result.kind} flagged={flaggedLines} />
      <Label>Assumes</Label>
      <ul class="assumptions">
        {#each result.rationale.assumptions as assumption}
          <li>{assumption}</li>
        {/each}
      </ul>
    </div>
  </details>

  <div class="submit">
    {#if blocking.length > 0}
      <Button full onclick={onback}>Back</Button>
    {:else if capabilities.length > 0}
      <div class="split">
        <Button
          grow={1}
          small
          onclick={() => {
            refused = true
            onrefuse()
          }}
        >
          Refuse {capabilities.join(' and ')}
        </Button>
        <Button variant="primary" grow={1.3} small onclick={onsave}>Allow and save</Button>
      </div>
    {:else}
      <Button variant="primary" full disabled={review === null} onclick={onsave}>
        Save transform
      </Button>
    {/if}
  </div>
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
    flex-direction: column;
    gap: var(--sp-3);
  }

  h1 {
    margin: 0;
    font: 600 14px var(--font-ui);
  }

  .waiting {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: var(--sp-11);
    border-radius: var(--r-card);
  }

  .card.attention {
    border: 1px solid rgb(from var(--attention) r g b / 0.4);
    background: rgb(from var(--attention) r g b / 0.09);
  }

  .card.block {
    border: 1px solid rgb(from var(--block) r g b / 0.4);
    background: rgb(from var(--block) r g b / 0.09);
  }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .card-title {
    font: 600 12.5px var(--font-ui);
  }

  .finding {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  code {
    padding: 1px 4px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 11.5px var(--font-mono);
  }

  .quiet {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .chips {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
  }

  .chip {
    padding: 2px 6px;
    border-radius: var(--r-badge);
    background: var(--surface-raised);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .dot {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: 50%;
    background: var(--ok);
  }

  .dot.attention {
    width: 6px;
    height: 6px;
    background: var(--attention);
  }

  .dot.block {
    width: 6px;
    height: 6px;
    background: var(--block);
  }

  .quiet-line {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--sp-6);
    padding: 0;
    border: none;
    background: none;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
    text-align: left;
    cursor: pointer;
  }

  .quiet-line.static {
    cursor: default;
  }

  .quiet-line .caret {
    margin-left: auto;
  }

  .caret {
    font-size: 9px;
  }

  .rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    border-top: 1px solid var(--border-subtle);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  dt {
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  dd {
    margin: 0 0 0 auto;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
  }

  summary {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .meta {
    margin-left: auto;
    font: 10.5px var(--font-mono);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    padding-top: var(--sp-9);
  }

  .assumptions {
    margin: 0;
    padding-left: 16px;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  .submit {
    margin-top: auto;
  }

  .split {
    display: flex;
    gap: var(--sp-7);
  }
</style>
