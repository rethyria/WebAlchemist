<script lang="ts">
  import { MARK } from '@shared/i18n'
  import Marked from '@shared/Marked.svelte'
  import { t } from '@shared/i18n'
  import { focusOnMount } from '../lib/focus'
  import type { RefinementTurn } from '@background/providers/types'
  import type { GenerationResult, ReviewResult } from '@shared/types'
  import type { ElementContext } from '@shared/types'
  import { attemptNumber } from '../lib/attempt'
  import { autogrow } from '../lib/autogrow'
  import Button from './Button.svelte'
  import AddressNote from './AddressNote.svelte'
  import CodeBlock from './CodeBlock.svelte'
  import Label from './Label.svelte'

  interface Props {
    result: GenerationResult
    analysis: ReviewResult | null
    intent: string
    history: RefinementTurn[]
    followUp: string
    /** JS only: whether the draft has been registered and the page reloaded. */
    jsRan: boolean
    /** Extra elements pointed at, sent with the next attempt. */
    references: ElementContext[]
    /** True while the picker is open in the page waiting for a reference. */
    awaitingReference: boolean
    choosingRegion: boolean
    shotPreview: string | null
    shotClipped: boolean
    shotMoved: boolean
    visionSupported: boolean
    /** The page address the next request will carry, as it is sent. */
    sentAddress: string
    onfollowup: (text: string) => void
    onaddreference: () => void
    onremovereference: (selector: string) => void
    onscreenshot: (value: boolean) => void
    onregenerate: () => void
    /** The model review run for the preview, or null when none has run for this code. */
    previewReview: ReviewResult | null
    previewReviewing: boolean
    /** True once the review matched and the static analysis passed. */
    previewAllowed: boolean
    onreviewfirst: () => void
    onrun: () => void
    onreload: () => void
    ondiscard: () => void
    onkeep: () => void
  }

  let {
    result,
    analysis,
    intent,
    history,
    followUp,
    jsRan,
    references,
    awaitingReference,
    choosingRegion,
    shotPreview,
    shotClipped,
    shotMoved,
    visionSupported,
    sentAddress,
    onfollowup,
    onaddreference,
    onremovereference,
    onscreenshot,
    onregenerate,
    previewReview,
    previewReviewing,
    previewAllowed,
    onreviewfirst,
    onrun,
    onreload,
    ondiscard,
    onkeep,
  }: Props = $props()

  let isJs = $derived(result.kind === 'js')
  let blocked = $derived(analysis !== null && !analysis.passed)
  let attempt = $derived(attemptNumber(history.length))

  /*
   * The transcript is the conversation as the user experienced it: their
   * instruction, then what the model says it did. `rationale.approach` is that
   * second half — it is written for a reader, not for the next request.
   */
  let bubbles = $derived(
    [
      ...history.map((turn) => ({ role: turn.role, text: turn.content })),
      { role: 'user' as const, text: intent },
      { role: 'assistant' as const, text: result.rationale.approach },
    ].filter((bubble) => bubble.text),
  )

  let codeOpen = $state(false)
  let lineCount = $derived(result.code.split('\n').length)

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // The same choice the buttons make: after a script ran, the page has to
      // be reloaded before another attempt.
      if (isJs && jsRan) onreload()
      else onregenerate()
    }
  }
</script>

<div class="panel">
  <header>
    <span class="live" class:idle={isJs && !jsRan} aria-hidden="true"></span>
    <span class="status" role="heading" aria-level="1" use:focusOnMount>
      <span class="sr-only">{t('refCodeReady')} </span>
      {#if !isJs && blocked}
        {t('refStatusBlocked')}
      {:else if !isJs}
        {t('refStatusLive')}
      {:else if jsRan}
        {t('refStatusRan')}
      {:else}
        {t('refStatusNotRun')}
      {/if}
    </span>
    {#if isJs}
      <span class="badge">{t('refBadgeJs')}</span>
    {:else}
      <span class="unsaved">{t('refUnsaved')}</span>
    {/if}
  </header>

  {#if blocked}
    <div class="notice block">
      <span class="notice-title">
        {isJs ? t('refBlockedJsTitle') : t('refBlockedCssTitle')}
      </span>
      <p>
        {isJs ? t('refRejectedByAnalysis') : t('refRejectedByCssCheck')}
      </p>
      <ul>
        {#each analysis?.static.filter((f) => f.severity === 'block') ?? [] as finding}
          <li><Marked text={t('refFinding', MARK, finding.line, finding.explanation)} value={finding.api} /></li>
        {/each}
        {#each analysis?.pendingUrls ?? [] as url}
          <li><Marked text={t('refPendingUrl', MARK)} value={url} /></li>
        {/each}
      </ul>
      <p class="quiet">{t('refSayWhat')}</p>
    </div>
  {:else if isJs && !jsRan}
    <div class="notice">
      <span class="notice-title">{t('refJsNextLoadTitle')}</span>
      <p>
        {t('refJsNextLoadBody')}
      </p>
      <p class="quiet">{t('refNothingStored')}</p>
      {#if !previewAllowed}
        <!--
          The script runs on the page with the user's session, so it is not
          offered until a second model has read it (issue 55).
        -->
        <p>
          {#if previewReviewing}
            {t('refReviewReading')}
          {:else if previewReview && previewReview.model && previewReview.model.verdict !== 'match'}
            {t('refReviewDisagrees', previewReview.model.explanation)}
          {:else if previewReview && !previewReview.passed}
            {t('refReviewScanRejected')}
          {:else}
            {t('refReviewNeeded')}
          {/if}
        </p>
      {/if}
    </div>
  {:else if isJs && jsRan}
    <div class="notice attention">
      <span class="notice-title">{t('refReloadTitle')}</span>
      <p>
        {t('refReloadBody')}
      </p>
      <p class="quiet">{t('refReloadKept')}</p>
    </div>
  {:else}
    <p class="explainer">
      {t('refExplainer')}
    </p>
  {/if}

  <section class="transcript">
    {#if attempt > 1}
      <Label>{t('refAttempt', attempt)}</Label>
    {/if}
    <div class="bubbles">
      {#each bubbles as bubble}
        <p class="bubble {bubble.role}">{bubble.text}</p>
      {/each}
    </div>

    <details bind:open={codeOpen}>
      <summary>
        <span class="caret" aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
        {t('savingCodeAndRationale')}
        <span class="meta">{t('savingMeta', lineCount, result.kind.toUpperCase())}</span>
      </summary>
      <div class="detail">
        <Label>{t('refTargets')}</Label>
        <p class="prose">{result.rationale.targets}</p>
        <Label>{t('refAssumes')}</Label>
        <ul class="assumptions">
          {#each result.rationale.assumptions as assumption}
            <li>{assumption}</li>
          {/each}
        </ul>
        <CodeBlock code={result.code} kind={result.kind} />
      </div>
    </details>
  </section>

  <div class="foot">
    <section class="ask">
      <Label>{t('refAskLabel')}</Label>
      <textarea
        use:autogrow={followUp}
        value={followUp}
        placeholder={t('refPlaceholder')}
        oninput={(event) => onfollowup(event.currentTarget.value)}
        onkeydown={onKeyDown}
      ></textarea>

      <!--
        Context the follow-up can name. Without this the only way to mention a
        second element was to describe it in prose and hope the selector the
        model guessed from that description was the one meant.
      -->
      <div class="context">
        {#each references as reference (reference.selector)}
          <span class="chip">
            <code>{reference.selector}</code>
            <button
              type="button"
              class="drop"
              aria-label={t('refRemoveRef', reference.selector)}
              onclick={() => onremovereference(reference.selector)}>×</button
            >
          </span>
        {/each}
        <button type="button" class="add" disabled={awaitingReference} onclick={onaddreference}>
          {awaitingReference ? t('refPickOne') : t('refPointAt')}
        </button>
      </div>

      {#if visionSupported}
        <!-- An action rather than a state; see Describing. -->
        {#if !shotPreview}
          <button
            type="button"
            class="shot-action"
            disabled={choosingRegion}
            onclick={() => onscreenshot(true)}
          >
            {choosingRegion
              ? t('describingShotDrag')
              : t('refShotAdd')}
          </button>
        {/if}
        {#if shotPreview}
          <img class="shot-image" src={shotPreview} alt={t('describingShotAlt')} />
          <p class="shot-warning">
            {t('describingShotWarning')}{shotClipped
              ? ' ' + t('refShotClipped')
              : ''}{shotMoved
              ? ' ' + t('refShotMoved')
              : ''}
          </p>
          <button type="button" class="shot-action" onclick={() => onscreenshot(false)}>
            {t('describingShotRemove')}
          </button>
        {/if}
      {/if}
      {#if isJs && jsRan}
        <Button variant="primary" full onclick={onreload}>
          {t('refReloadAndTry')}
        </Button>
      {:else}
        <button
          type="button"
          class="regenerate"
          class:ready={followUp.trim().length > 0}
          disabled={!followUp.trim()}
          onclick={onregenerate}
        >
          {t('refRegenerate')}
        </button>
      {/if}
    </section>

    <AddressNote address={sentAddress} />

    <div class="actions">
      <Button grow={1} small onclick={ondiscard}>{t('discard')}</Button>
      {#if isJs && !jsRan && !blocked && previewAllowed}
        <Button variant="primary" grow={1.4} small onclick={onrun}>
          {t('refReloadAndRun')}
        </Button>
      {:else if isJs && !jsRan && !blocked}
        <Button variant="primary" grow={1.4} small disabled={previewReviewing} onclick={onreviewfirst}>
          {previewReviewing ? t('refReading') : t('refReadFirst')}
        </Button>
      {:else}
        <Button variant="primary" grow={1.4} small onclick={onkeep} disabled={blocked}>
          {t('refKeep')}
        </Button>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-12);
    padding: var(--gutter-sidebar);
    /* Lets the transcript below shrink instead of pushing the composer out. */
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
  }

  .live {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent-fg);
  }

  .live.idle {
    background: var(--ok);
  }

  .status {
    font: 600 12.5px var(--font-ui);
  }

  .unsaved {
    margin-left: auto;
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }

  .badge {
    margin-left: auto;
    padding: 2px 5px;
    border: 1px solid rgb(from var(--attention) r g b / 0.35);
    border-radius: var(--r-badge);
    background: rgb(from var(--attention) r g b / 0.16);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--attention);
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
    padding: var(--sp-11);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface-raised);
  }

  .notice.attention {
    border-color: rgb(from var(--attention) r g b / 0.35);
    background: rgb(from var(--attention) r g b / 0.09);
  }

  .notice.block {
    border-color: rgb(from var(--block) r g b / 0.4);
    background: rgb(from var(--block) r g b / 0.09);
  }

  .notice-title {
    font: 600 12.5px var(--font-ui);
  }

  .notice p {
    margin: 0;
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  .notice .quiet {
    color: var(--text-faint);
  }

  .notice ul {
    margin: 0;
    padding-left: 16px;
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  code {
    font: 11.5px var(--font-mono);
  }

  .explainer {
    margin: 0;
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  /* The only part that scrolls. */
  .transcript {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--sp-7);
    min-height: 0;
    overflow-y: auto;
  }

  .bubbles {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .bubble {
    max-width: 88%;
    margin: 0;
    padding: 7px 9px;
    font: 12px/1.5 var(--font-ui);
  }

  .bubble.user {
    align-self: flex-end;
    border-radius: var(--r-panel) var(--r-panel) var(--sp-2) var(--r-panel);
    background: var(--accent-chip);
    color: var(--text);
  }

  .bubble.assistant {
    align-self: flex-start;
    border-radius: var(--r-panel) var(--r-panel) var(--r-panel) var(--sp-2);
    background: var(--surface-raised);
    color: var(--text-dim);
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

  .caret {
    font-size: 9px;
  }

  .meta {
    margin-left: auto;
    font: 10.5px var(--font-mono);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding-top: var(--sp-7);
  }

  .prose {
    margin: 0 0 var(--sp-6);
    font: 12px/1.55 var(--font-ui);
    color: var(--text-dim);
  }

  .assumptions {
    margin: 0 0 var(--sp-9);
    padding-left: 16px;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-dim);
  }

  .foot {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--sp-11);
    margin-top: auto;
  }

  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
  }

  textarea {
    min-height: 52px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12.5px/1.55 var(--font-ui);
    color: var(--text);
    resize: none;
    overflow-y: hidden;
  }

  .context {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-badge);
    background: var(--surface-sunken);
    max-width: 100%;
  }

  .chip code {
    font: 10.5px var(--font-mono);
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drop {
    padding: 0 3px;
    border: none;
    background: none;
    font: 12px var(--font-ui);
    color: var(--text-faint);
    cursor: pointer;
  }

  .add {
    padding: 3px 7px;
    border: 1px dashed var(--border);
    border-radius: var(--r-badge);
    background: transparent;
    font: 10.5px var(--font-ui);
    color: var(--text-dim);
    cursor: pointer;
  }

  .add:disabled {
    color: var(--accent-fg);
    border-color: var(--accent-fg);
    cursor: default;
  }




  .shot-image {
    display: block;
    width: 100%;
    max-height: 180px;
    object-fit: contain;
    object-position: left top;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
  }

  .shot-action {
    width: 100%;
    padding: 6px 9px;
    border: 1px dashed var(--border);
    border-radius: var(--r-button);
    background: transparent;
    font: 11px var(--font-ui);
    color: var(--text-dim);
    cursor: pointer;
  }

  .shot-action:disabled {
    border-style: solid;
    border-color: var(--accent-fg);
    color: var(--accent-fg);
    cursor: default;
  }


  .shot-warning {
    margin: 0;
    font: 11px/1.45 var(--font-ui);
    color: var(--text-faint);
  }

  /* Outlined rather than filled: the filled button on this screen is the one
     that ends the loop, and there should only be one of those. */
  .regenerate {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-button);
    background: transparent;
    font: 600 12.5px var(--font-ui);
    color: var(--text-faint);
    cursor: default;
  }

  .regenerate.ready {
    border-color: var(--accent-fg);
    color: var(--accent-fg);
    cursor: pointer;
  }

  .actions {
    display: flex;
    gap: var(--sp-7);
    padding-top: var(--sp-9);
    border-top: 1px solid var(--border-subtle);
  }
</style>
