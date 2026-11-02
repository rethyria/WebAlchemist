<script lang="ts">
  import { MARK } from '@shared/i18n'
  import Marked from '@shared/Marked.svelte'
  import { t } from '@shared/i18n'
  import { CAPABILITY_ENFORCEMENT } from '@shared/types'
  import type { GenerationResult, ReviewResult } from '@shared/types'
  import Button from './Button.svelte'
  import { focusOnMount } from '../lib/focus'
  import { reviewAnnouncement } from '../lib/announce'
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
    <Label>{t('revStep3')}</Label>
    <h1 use:focusOnMount>{result.name}</h1>
  </header>

  <!-- Persistent, so the arrival of the review is a change that is read out once. -->
  <p class="sr-only" role="status">{reviewAnnouncement(review, result.kind)}</p>

  {#if review === null}
    <p class="waiting">{t('revReading')}</p>
  {:else}
    {#if result.kind === 'js'}
      <div class="card" class:attention={world.showRisks}>
        <div class="card-head">
          {#if world.showRisks}<span class="dot attention" aria-hidden="true"></span>{/if}
          <div class="card-body">
            <span class="card-title">{t('revRunsIn', WORLD_NAMES[world.world])}</span>
            {#if world.requestPending}
              <p class="finding">
                {t('revModelAskedMain')}
              </p>
              <p class="finding">
                {world.reason ? t('revReasonGiven', world.reason) : t('revNoReason')}
              </p>
            {:else if world.runsInMain}
              <p class="finding">
                {t('revRunsInMain')}
                {#if world.reason}{t('revReasonGiven', world.reason)}{/if}
              </p>
            {:else}
              <details class="fold">
                <summary>{t('detailsLabel')}</summary>
                <p class="finding">{t('revRunsIsolated')}</p>
              </details>
            {/if}
          </div>
        </div>
        {#if world.showRisks}
          <p class="finding">{t('approvalRisksIntro')}</p>
          <ul class="risks">
            {#each MAIN_WORLD_RISKS as risk}
              <li>{risk}</li>
            {/each}
          </ul>
          <div>
            {#if world.runsInMain}
              <Button small full onclick={() => onworld('USER_SCRIPT')}>
                {t('revRunIsolated')}
              </Button>
            {:else}
              <Button small full onclick={() => onworld('MAIN')}>
                {t('revAllowMain')}
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
          <span class="card-title">{t('revBlockedTitle')}</span>
        </div>
        {#each blocking as finding}
          <p class="finding">
            <Marked text={t('revBlockedFinding', finding.line, MARK, finding.explanation)} value={finding.api} />
          </p>
        {/each}
        <p class="quiet">
          {#if refused}
            {t('revRefused')}
          {:else}
            {t('revGoBackDifferent')}
          {/if}
        </p>
      </div>
    {/if}

    {#if pendingUrls.length > 0 && blocking.length === 0}
      <div class="card attention">
        <div class="card-head">
          <span class="dot attention" aria-hidden="true"></span>
          <div class="card-body">
            <span class="card-title">{t('revUrlsTitle')}</span>
            <p class="finding">
              {t(pendingUrls.length === 1 ? 'revUrlsBodyOne' : 'revUrlsBodyMany')}
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
              <Marked text={t('revWarnLine', finding.line, MARK)} value={finding.api} />
              {#if finding.capability && capabilities.includes(finding.capability)}
                {t('revWarnDeclared', finding.capability)}
              {:else if finding.capability}
                <!--
                  Not "blocked at runtime". The browser was measured and does
                  not stop this; what stops it is this code not being saved.
                -->
                {t('revWarnUndeclared', finding.capability)}
              {/if}
            </p>
          </div>
        </div>
        {#if capabilities.length > 0}
          <div class="chips">
            {#each capabilities as capability}
              <span class="chip">{capability}</span>
            {/each}
            <span class="quiet">{t('revRequested')}</span>
          </div>
          <!--
            What "allow" costs, said plainly. The browser does not police any
            of these once the code is saved — that was measured, not assumed,
            and the claim used to be the other way round. Approval is the
            control, so the sentence has to say so.
          -->
          <p class="quiet">
            {#if capabilities.every((c) => CAPABILITY_ENFORCEMENT[c] === 'csp')}
              {t('revCspBlocks')}
            {:else}
              {t('revNotEnforced')}
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
              {t('revMismatchTitle')}
            </span>
            <p class="finding">{review.model.explanation}</p>
          </div>
        </div>
        <p class="quiet">{t('revYouAskedFor', intent)}</p>
      </div>
    {/if}

    <dl class="rows">
      <div class="row">
        <dt>{t('revRunsOn')}</dt>
        <dd>
          {where.variants ? t('revWhereVariants', where.schemes, where.sites, where.pages, where.variants) : t('revWhere', where.schemes, where.sites, where.pages)}
        </dd>
      </div>
      {#if result.kind === 'js'}
        <div class="row">
          <dt>{t('versionRowWorld')}</dt>
          <dd>{WORLD_NAMES[world.world]}</dd>
        </div>
      {/if}
      <div class="row">
        <dt>{t('versionRowCapabilities')}</dt>
        <dd>
          {#if capabilities.length === 0}
            {t('revNoneDeclared')}
          {:else}
            {capabilities.join(', ')}
          {/if}
        </dd>
      </div>
      <div class="row">
        <dt>{result.kind === 'css' ? t('revCssCheck') : t('revCodeScan')}</dt>
        <dd>
          {#if findingCount === 0 && result.kind === 'js'}
            <details class="fold">
              <summary>{t('revNoFindingsJsShort')}</summary>
              <p class="finding">{t('revNoFindingsJs')}</p>
            </details>
          {:else if findingCount === 0}
            {t('revNoFindingsCss')}
          {:else}
            {t(findingCount === 1 ? 'revFindingsOne' : 'revFindings', findingCount)}
          {/if}
        </dd>
      </div>
      <div class="row">
        <dt>{t('revSecondModel')}</dt>
        <dd>
          {#if result.kind === 'css'}
            {t('revCssNotReviewed')}
          {:else if !review.model}
            {t('revNotReviewed')}
          {:else if review.model.verdict === 'match'}
            {t('revModelAgreed')}
            {#if review.model.explanation}{t('revModelNote', review.model.explanation)}{/if}
          {:else}
            {t('revVerdict', review.model.verdict, review.model.explanation)}
          {/if}
        </dd>
      </div>
    </dl>
  {/if}

  <details bind:open={codeOpen}>
    <summary>
      <span class="caret" aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
      {result.kind === 'js' ? t('revCodeToRun') : t('savingCodeAndRationale')}
      <span class="meta">{t('savingMeta', lineCount, result.kind.toUpperCase())}</span>
    </summary>
    <div class="detail">
      <CodeBlock code={result.code} kind={result.kind} flagged={flaggedLines} />
      <Label>{t('refAssumes')}</Label>
      <ul class="assumptions">
        {#each result.rationale.assumptions as assumption}
          <li>{assumption}</li>
        {/each}
      </ul>
    </div>
  </details>

  <p class="grant">
    <Marked text={t(result.kind === 'js' ? 'revGrantJs' : 'revGrant', MARK)} value={origin} />
  </p>

  {#if permissionDenied}
    <div class="card attention">
      <div class="card-head">
        <span class="dot attention" aria-hidden="true"></span>
        <div class="card-body">
          <span class="card-title">{t('revDeclinedTitle')}</span>
          <p class="finding">
            {t('revDeclinedBody')}
          </p>
        </div>
      </div>
    </div>
  {/if}

  <div class="submit">
    {#if blocking.length > 0}
      <Button full onclick={onback}>{t('back')}</Button>
    {:else if pendingUrls.length > 0}
      <div class="split">
        <Button grow={1} small onclick={onback}>{t('back')}</Button>
        <Button variant="primary" grow={1.3} small disabled={!shown} onclick={onapproveurls}>
          {t(pendingUrls.length === 1 ? 'revApproveAddress' : 'revApproveAddresses')}
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
          {t('revRefuse', capabilities.join(' and '))}
        </Button>
        <Button variant="primary" grow={1.3} small disabled={!shown} onclick={onsave}>
          {t('revAllowSave')}
        </Button>
      </div>
    {:else}
      <Button variant="primary" full disabled={review === null || !shown} onclick={onsave}>
        {t('revSave')}
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

  .fold summary {
    display: list-item;
    list-style: revert;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
    cursor: pointer;
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
