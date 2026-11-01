<script lang="ts">
  import { t } from '@shared/i18n'
  import { radioGroup } from '@shared/radio-group'
  import type { MatchPreset } from '@shared/match'
  import type { GenerationResult } from '@shared/types'
  import { autogrow } from '../lib/autogrow'
  import Button from './Button.svelte'
  import { focusOnMount } from '../lib/focus'
  import CodeBlock from './CodeBlock.svelte'
  import Label from './Label.svelte'

  interface Props {
    result: GenerationResult
    intent: string
    /** True when the intent was consolidated from more than one message. */
    consolidated: boolean
    presets: MatchPreset[]
    match: string
    onintent: (intent: string) => void
    onmatch: (pattern: string) => void
    oncontinue: () => void
  }

  let {
    result,
    intent,
    consolidated,
    presets,
    match,
    onintent,
    onmatch,
    oncontinue,
  }: Props = $props()

  let codeOpen = $state(false)
  let lineCount = $derived(result.code.split('\n').length)
</script>

<div class="panel">
  <header>
    <Label>{t('savingStep1')}</Label>
    <h1 use:focusOnMount>{t('savingTitle')}</h1>
  </header>

  <section>
    <textarea
      use:autogrow={intent}
      value={intent}
      oninput={(event) => onintent(event.currentTarget.value)}
    ></textarea>
    <p class="note">
      {#if consolidated}{t('savingNoteConsolidated')}{:else}{t('savingNote')}{/if}
    </p>
  </section>

  <section>
    <Label>{t('savingStep2')}</Label>
    <div class="options" role="radiogroup" aria-label={t('savingWhereLabel')} use:radioGroup>
      {#each presets as preset (preset.pattern)}
        <button
          type="button"
          role="radio"
          aria-checked={match === preset.pattern}
          class="option"
          class:selected={match === preset.pattern}
          onclick={() => onmatch(preset.pattern)}
        >
          <span class="dot" aria-hidden="true"></span>
          <span class="pattern">{preset.pattern}</span>
        </button>
      {/each}
    </div>
  </section>

  <details bind:open={codeOpen}>
    <summary>
      <span class="caret" aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
      {t('savingCodeAndRationale')}
      <span class="meta">{t('savingMeta', lineCount, result.kind.toUpperCase())}</span>
    </summary>
    <div class="detail">
      <Label>{t('savingApproach')}</Label>
      <p class="prose">{result.rationale.approach}</p>
      <CodeBlock code={result.code} kind={result.kind} />
    </div>
  </details>

  <div class="submit">
    <Button variant="primary" full disabled={!match || !intent.trim()} onclick={oncontinue}>
      {t('savingContinue')}
    </Button>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    gap: 13px;
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

  section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-6);
  }

  textarea {
    min-height: 56px;
    padding: 9px 10px;
    border: 1px solid var(--accent-fg);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 12.5px/1.55 var(--font-ui);
    color: var(--text);
    resize: none;
    overflow-y: hidden;
  }

  textarea:focus {
    outline: none;
  }

  .note {
    margin: 0;
    font: 11px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: transparent;
    cursor: pointer;
  }

  .option.selected {
    border-color: var(--accent-fg);
    background: var(--accent-wash);
  }

  .dot {
    width: 12px;
    height: 12px;
    flex: none;
    border: 1.5px solid var(--border-strong);
    border-radius: 50%;
  }

  .option.selected .dot {
    border: 4px solid var(--accent-fg);
    background: var(--surface-sunken);
  }

  .pattern {
    font: 11.5px var(--font-mono);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .submit {
    margin-top: auto;
  }
</style>
