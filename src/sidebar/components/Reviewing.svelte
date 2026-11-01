<script lang="ts">
  import { CAPABILITY_ENFORCEMENT } from '@shared/types'
  import type { GenerationResult, ReviewResult } from '@shared/types'
  import Button from './Button.svelte'
  import CodeBlock from './CodeBlock.svelte'
  import Label from './Label.svelte'
  import { describeMatch } from '@shared/match'
  import { MAIN_WORLD_RISKS, WORLD_NAMES, worldState } from '@shared/world'
  import type { ExecutionWorld } from '@shared/types'

  /**
   * Everything the user needs to judge the code is shown at once: the world,
   * the capabilities, which sites the code runs on, the code scan, the second
   * model's reading and, for JavaScript, the code itself. Nothing is collapsed,
   * and a review with nothing found says what the checks cover and what they
   * do not (issue 64). A clean result is not shown in a way that invites
   * skipping the code.
   */
  interface Props {
    result: GenerationResult
    review: ReviewResult | null
    intent: string
    /** Host the transform will need permission to run on. */
    origin: string
    /** The match pattern the transform will be saved with. */
    match: string
    /** True once the panel has been displayed with its review. */
    shown: boolean
    /** Called after the review is on screen. Saving is not possible before it. */
    onshown: () => void
    permissionDenied: boolean
    onrefuse: () => void
    onapproveurls: () => void
    onsave: () => void
    /** The user's choice of world. The model's request does not call this. */
    onworld: (world: ExecutionWorld) => void
    onback: () => void
  }

  let {
    result,
    review,
    intent,
    origin,
    match,
    shown,
    onshown,
    permissionDenied,
    onrefuse,
    onapproveurls,
    onsave,
    onworld,
    onback,
  }: Props = $props()

  /* JavaScript is shown expanded. The user decides on code they can see. */
  // svelte-ignore state_referenced_locally
  let codeOpen = $state(result.kind === 'js')

  $effect(() => {
    // Runs after the review has been rendered, so the approve button is
    // enabled only for a panel the user could see.
    if (review !== null) onshown()
  })

  /* Set once the user has refused, so the block card can say why it appeared. */
  let refused = $state(false)

  let blocking = $derived(review?.static.filter((f) => f.severity === 'block') ?? [])
  let warnings = $derived(review?.static.filter((f) => f.severity === 'warn') ?? [])
  let pendingUrls = $derived(review?.pendingUrls ?? [])
  let capabilities = $derived(result.capabilities)
  let mismatch = $derived(review?.model && review.model.verdict !== 'match')

  let world = $derived(worldState(result))

  let flaggedLines = $derived([...blocking, ...warnings].map((f) => f.line))
  let lineCount = $derived(result.code.split('\n').length)

  let findingCount = $derived(blocking.length + warnings.length)
  let where = $derived(describeMatch(match))
</script>

<div class="panel">
  <header>
    <Label>Step 3 of 3 · Approve</Label>
    <h1>{result.name}</h1>
  </header>

  {#if review === null}
    <p class="waiting">Reading the code…</p>
  {:else}
    {#if result.kind === 'js'}
      <div class="card" class:attention={world.showRisks}>
        <div class="card-head">
          {#if world.showRisks}<span class="dot attention" aria-hidden="true"></span>{/if}
          <div class="card-body">
            <span class="card-title">Runs in: {WORLD_NAMES[world.world]}</span>
            {#if world.requestPending}
              <p class="finding">
                The model asked to run this code in the page's own world. It stays in the
                isolated world until you allow it here.
              </p>
              <p class="finding">
                {world.reason ? `Reason given: ${world.reason}` : 'No reason was given.'}
              </p>
            {:else if world.runsInMain}
              <p class="finding">
                This code runs in the page's own world.
                {#if world.reason}Reason given: {world.reason}{/if}
              </p>
            {:else}
              <p class="finding">
                The code runs apart from the page's own scripts, and the page cannot change it.
              </p>
            {/if}
          </div>
        </div>
        {#if world.showRisks}
          <p class="finding">Running in the page's own world has these risks:</p>
          <ul class="risks">
            {#each MAIN_WORLD_RISKS as risk}
              <li>{risk}</li>
            {/each}
          </ul>
          <div>
            {#if world.runsInMain}
              <Button small full onclick={() => onworld('USER_SCRIPT')}>
                Run in the isolated world instead
              </Button>
            {:else}
              <Button small full onclick={() => onworld('MAIN')}>
                Allow the page's own world
              </Button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

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

    {#if pendingUrls.length > 0 && blocking.length === 0}
      <div class="card attention">
        <div class="card-head">
          <span class="dot attention" aria-hidden="true"></span>
          <div class="card-body">
            <span class="card-title">This CSS loads addresses outside this site</span>
            <p class="finding">
              The browser requests
              {pendingUrls.length === 1 ? 'this address' : 'these addresses'} on every
              visit. A request can carry information about the page, and the server
              that receives it can see it. Only the addresses listed here will be
              allowed to load.
            </p>
          </div>
        </div>
        <ul class="urls">
          {#each pendingUrls as url}
            <li><code>{url}</code></li>
          {/each}
        </ul>
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
                <!--
                  Not "blocked at runtime". The browser was measured and does
                  not stop this; what stops it is this code not being saved.
                -->
                That is {finding.capability}, which this transform did not declare,
                so it cannot be saved as it stands.
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
          <!--
            What "allow" costs, said plainly. The browser does not police any
            of these once the code is saved — that was measured, not assumed,
            and the claim used to be the other way round. Approval is the
            control, so the sentence has to say so.
          -->
          <p class="quiet">
            {#if capabilities.every((c) => CAPABILITY_ENFORCEMENT[c] === 'csp')}
              Anything it did not ask for is blocked while it runs.
            {:else}
              The browser does not police this once it is saved. Approving is
              what allows it; refusing means the code is not saved at all.
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

    <dl class="rows">
      <div class="row">
        <dt>Runs on</dt>
        <dd>
          {where.schemes}; {where.sites}; {where.pages}.
        </dd>
      </div>
      {#if result.kind === 'js'}
        <div class="row">
          <dt>World</dt>
          <dd>{WORLD_NAMES[world.world]}</dd>
        </div>
      {/if}
      <div class="row">
        <dt>Capabilities</dt>
        <dd>
          {#if capabilities.length === 0}
            None declared. Code that uses network, storage or cookies without declaring it cannot be saved.
          {:else}
            {capabilities.join(', ')}
          {/if}
        </dd>
      </div>
      <div class="row">
        <dt>{result.kind === 'css' ? 'CSS check' : 'Code scan'}</dt>
        <dd>
          {#if findingCount === 0}
            No known patterns found.
            {#if result.kind === 'js'}
              The scan looks for known patterns and cannot prove the code harmless. The
              code still runs with access to this page.
            {:else}
              The check looks for addresses the CSS would load.
            {/if}
          {:else}
            {findingCount}
            {findingCount === 1 ? 'finding' : 'findings'}, listed above.
          {/if}
        </dd>
      </div>
      <div class="row">
        <dt>Second model</dt>
        <dd>
          {#if result.kind === 'css'}
            CSS is not sent to a second model.
          {:else if !review.model}
            Not reviewed.
          {:else if review.model.verdict === 'match'}
            Read the code and agreed it does what you described.
            {#if review.model.explanation}Its note: {review.model.explanation}{/if}
          {:else}
            Verdict: {review.model.verdict}. {review.model.explanation}
          {/if}
        </dd>
      </div>
    </dl>
  {/if}

  <details bind:open={codeOpen}>
    <summary>
      <span class="caret" aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
      {result.kind === 'js' ? 'Code to be run, and rationale' : 'Code and rationale'}
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

  <p class="grant">
    Saving asks Firefox for permission to run on <code>{origin}</code>{#if result.kind === 'js'}, and to
      run user scripts{/if}. Without it the transform saves but never applies.
  </p>

  {#if permissionDenied}
    <div class="card attention">
      <div class="card-head">
        <span class="dot attention" aria-hidden="true"></span>
        <div class="card-body">
          <span class="card-title">Permission was declined</span>
          <p class="finding">
            Nothing was saved. A transform without this grant would sit in the list
            looking active and do nothing on every visit.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <div class="submit">
    {#if blocking.length > 0}
      <Button full onclick={onback}>Back</Button>
    {:else if pendingUrls.length > 0}
      <div class="split">
        <Button grow={1} small onclick={onback}>Back</Button>
        <Button variant="primary" grow={1.3} small disabled={!shown} onclick={onapproveurls}>
          Approve {pendingUrls.length === 1 ? 'this address' : 'these addresses'}
        </Button>
      </div>
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
        <Button variant="primary" grow={1.3} small disabled={!shown} onclick={onsave}>
          Allow and save
        </Button>
      </div>
    {:else}
      <Button variant="primary" full disabled={review === null || !shown} onclick={onsave}>
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
    min-height: 0;
    overflow-y: auto;
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
    flex-direction: column;
    gap: var(--sp-3);
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  dt {
    font: 600 11.5px var(--font-ui);
    color: var(--text-dim);
  }

  dd {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-dim);
    overflow-wrap: anywhere;
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

  .grant {
    margin: 0;
    font: 11.5px/1.55 var(--font-ui);
    color: var(--text-faint);
  }

  .submit {
    margin-top: auto;
  }

  .risks {
    margin: 0;
    padding-left: 16px;
    font: 11.5px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .urls {
    margin: 0;
    padding-left: 16px;
    font: 11.5px/1.6 var(--font-ui);
    word-break: break-all;
  }

  .split {
    display: flex;
    gap: var(--sp-7);
  }
</style>
