<script lang="ts">
  import { t } from '@shared/i18n'
  import { announcement } from '../lib/countdown'
  import type { FlowError } from '../lib/flow.svelte'
  import { SENSITIVE_PAGE_TITLE } from '@shared/excluded-sites'
  import Button from './Button.svelte'

  /**
   * Four dead ends, kept apart. Each has a different way out, and that way out
   * is the only part of an error message anyone reads — collapsing them into
   * one "something went wrong" would throw away the useful half.
   */
  interface Props {
    error: FlowError
    /** Null when there is no request to repeat; the retry buttons are then not shown. */
    onretry: (() => void) | null
    onsettings: () => void
    /** Opens settings at the model pickers. */
    onmodelsettings: () => void
    ondismiss: () => void
    /** Throws away the unsaved transform. Used by the card for a refused request. */
    ondiscard: () => void
  }

  let { error, onretry, onsettings, onmodelsettings, ondismiss, ondiscard }: Props = $props()

  let detailOpen = $state(false)
</script>

<div
  class="card"
  class:block={error.kind === 'request-failed' || error.kind === 'billing' || error.kind === 'refused'}
  class:attention={error.kind === 'rate-limited' || error.kind === 'sensitive-page'}
  role={error.kind === 'rate-limited' ? undefined : 'alert'}
>
  {#if error.kind === 'no-provider'}
    <span class="title">{t('errNoProviderTitle')}</span>
    <p>
      {t('errNoProviderBody')}
    </p>
    <div class="actions">
      <Button variant="primary" small onclick={onsettings}>{t('errAddProvider')}</Button>
    </div>
  {:else if error.kind === 'request-failed'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">{t('errRequestFailedTitle')}</span>
    </div>
    <p>{error.descriptionKept ? t('errMessageKept', error.message) : error.message}</p>
    {#if detailOpen && error.detail}
      <pre>{error.detail}</pre>
    {/if}
    <div class="actions">
      {#if onretry}
        <Button variant="primary" small onclick={onretry}>{t('tryAgain')}</Button>
      {/if}
      {#if error.detail}
        <Button small onclick={() => (detailOpen = !detailOpen)}>
          {detailOpen ? t('errHideResponse') : t('errShowResponse')}
        </Button>
      {/if}
      <Button small onclick={ondismiss}>{t('dismiss')}</Button>
    </div>
  {:else if error.kind === 'sensitive-page'}
    <div class="head">
      <span class="dot attention" aria-hidden="true"></span>
      <span class="title">{SENSITIVE_PAGE_TITLE}</span>
    </div>
    <p>{error.message}</p>
    <div class="actions">
      {#if onretry}
        <Button variant="primary" small onclick={onretry}>{t('errSendPage')}</Button>
      {/if}
      <Button small onclick={ondismiss}>{t('cancel')}</Button>
    </div>
  {:else if error.kind === 'model-unavailable'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">{t('errModelUnavailableTitle')}</span>
    </div>
    <p>{error.descriptionKept ? t('errMessageKept', error.message) : error.message}</p>
    <div class="actions">
      <Button variant="primary" small onclick={onmodelsettings}>{t('errOpenModelSettings')}</Button>
      {#if onretry}
        <Button small onclick={onretry}>{t('tryAgain')}</Button>
      {/if}
      <Button small onclick={ondismiss}>{t('dismiss')}</Button>
    </div>
  {:else if error.kind === 'model-not-permitted'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">{t('errModelNotPermittedTitle')}</span>
    </div>
    <p>{error.descriptionKept ? t('errMessageKept', error.message) : error.message}</p>
    <div class="actions">
      <Button variant="primary" small onclick={onmodelsettings}>{t('errOpenModelSettings')}</Button>
      <Button small onclick={ondismiss}>{t('dismiss')}</Button>
    </div>
  {:else if error.kind === 'billing'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">{t('errBillingTitle')}</span>
    </div>
    <p>{error.descriptionKept ? t('errMessageKept', error.message) : error.message}</p>
    <div class="actions">
      {#if onretry}
        <Button variant="primary" small onclick={onretry}>{t('tryAgain')}</Button>
      {/if}
      <Button small onclick={ondismiss}>{t('dismiss')}</Button>
    </div>
  {:else if error.kind === 'refused'}
    <div class="head">
      <span class="dot block" aria-hidden="true"></span>
      <span class="title">{t('errRefusedTitle')}</span>
    </div>
    <p>{error.message}</p>
    <div class="actions">
      {#if error.subject === 'question'}
        <!-- A refused question does not end the run, so the way out is closing the card. -->
        <Button variant="primary" small onclick={ondismiss}>{t('dismiss')}</Button>
      {:else}
        <Button variant="danger" small onclick={ondiscard}>{t('discard')}</Button>
      {/if}
    </div>
  {:else if error.kind === 'rate-limited'}
    <!--
      The alert holds the title and the provider's message, which is what a
      screen-reader user needs to hear. The countdown below it changes every
      second, so it stays outside the alert; with the alert on the whole card a
      screen reader was likely to announce every change (not tested with a
      screen reader).
    -->
    <div class="alert" role="alert">
      <div class="head">
        <span class="dot attention" aria-hidden="true"></span>
        <span class="title">{t('errRateLimitedTitle')}</span>
      </div>
      <p>{error.message}</p>
    </div>
    {#if error.retryInSeconds !== null}
      <!--
        A real countdown, not a label. It reaches zero and the request goes
        again on its own — which is what the provider asked for, and what a
        person watching a panel is worse at timing than a timer.

        Waiting is the primary action, so Cancel is the one that has to be
        clicked: an automatic request is only acceptable if it can be stopped.
      -->
      <p class="countdown" aria-hidden="true">
        {t(error.retryInSeconds === 1 ? 'errCountdownOne' : 'errCountdown', error.retryInSeconds)}
      </p>
      <!-- What assistive technology gets instead: a polite region whose text changes at coarse steps. -->
      <p class="hidden" role="status">
        {announcement(error.retryInSeconds)}
      </p>
      <div class="actions">
        {#if onretry}
          <Button small onclick={onretry}>{t('errTryNow')}</Button>
        {/if}
        <Button small onclick={ondismiss}>{t('cancel')}</Button>
      </div>
    {:else}
      <!-- No guidance from the provider, so nothing to count down from. -->
      <div class="actions">
        {#if onretry}
          <Button variant="primary" small onclick={onretry}>{t('tryAgain')}</Button>
        {/if}
        <Button small onclick={ondismiss}>{onretry ? t('cancel') : t('dismiss')}</Button>
      </div>
    {/if}
  {:else}
    <span class="title">{t('errCredentialExpiredTitle')}</span>
    <p>
      {t('errCredentialExpiredBody', error.message)}
    </p>
    <div class="actions">
      <Button variant="primary" small onclick={onsettings}>{t('errReconnect')}</Button>
    </div>
  {/if}
</div>

<style>
  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .alert {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .countdown {
    font-variant-numeric: tabular-nums;
    color: var(--attention);
  }

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
