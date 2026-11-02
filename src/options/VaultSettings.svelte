<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * Passphrase mode, and the disclosure that goes with whichever mode is on.
   *
   * The copy here is the part #46 cares about most: it must describe what is
   * actually true afterwards, neither more nor less. Two states, two different
   * true statements, and the one shown follows the stored data rather than a
   * setting — see `vaultState` in storage.ts.
   */
  import { MIN_PASSPHRASE_LENGTH, VAULT_IDLE_OPTIONS } from '@shared/vault-policy'
  import {
    DISCLOSURE_PLAIN,
    DISCLOSURE_SEALED,
    DISCLOSURE_TRANSFORMS,
    LOCKED_CONSEQUENCE,
    STATUS_LOCKED,
    STATUS_UNLOCKED,
  } from '@shared/vault-disclosure'
  import Button from '@sidebar/components/Button.svelte'

  interface Props {
    /*
     * Not called `state`: a prop of that name makes Svelte read every `$state`
     * rune in this file as a store subscription on the prop.
     */
    vault: { sealed: boolean; unlocked: boolean }
    /** Minutes of no use before the vault locks itself; 0 means never. */
    idleMinutes: number
    onidlechange: (minutes: number) => Promise<void>
    onenable: (passphrase: string) => Promise<void>
    ondisable: (passphrase: string) => Promise<void>
    onunlock: (passphrase: string) => Promise<void>
    onlock: () => Promise<void>
    ondiscard: () => Promise<void>
  }

  let { vault, idleMinutes, onidlechange, onenable, ondisable, onunlock, onlock, ondiscard }: Props = $props()

  type Panel = 'enable' | 'disable' | 'unlock' | null
  let panel = $state<Panel>(null)
  let passphrase = $state('')
  let confirmation = $state('')
  let error = $state<string | null>(null)
  let busy = $state(false)
  let discardArmed = $state(false)

  // The background enforces the same limit; see vault-policy.ts for why.
  const MINIMUM = MIN_PASSPHRASE_LENGTH

  let canSubmit = $derived.by(() => {
    if (busy || passphrase.length === 0) return false
    if (panel === 'enable') return passphrase.length >= MINIMUM && passphrase === confirmation
    return true
  })

  function reset(): void {
    passphrase = ''
    confirmation = ''
    error = null
    discardArmed = false
  }

  function open(next: Panel): void {
    panel = panel === next ? null : next
    reset()
  }

  async function discard(): Promise<void> {
    error = null
    try {
      await ondiscard()
      open(null)
    } catch (cause) {
      // Shown, not dropped: the background refuses this from any state but
      // sealed and locked, and a silent refusal would look like a dead button.
      error = cause instanceof Error ? cause.message : String(cause)
      discardArmed = false
    }
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return
    busy = true
    error = null
    try {
      if (panel === 'enable') await onenable(passphrase)
      else if (panel === 'disable') await ondisable(passphrase)
      else if (panel === 'unlock') await onunlock(passphrase)
      panel = null
      reset()
    } catch (cause) {
      /*
       * A wrong passphrase arrives as a decryption failure, which is an
       * OperationError and says nothing a person can act on. AES-GCM
       * authenticates, so a failure here means the key was wrong — there is no
       * other way for it to fail with well-formed stored data.
       */
      const raw = cause instanceof Error ? cause.message : String(cause)
      error = /operation|decrypt/i.test(raw) ? t('optVaultWrongPassphrase') : raw
    } finally {
      busy = false
    }
  }
</script>

<section>
  <h2>{t('optVaultTitle')}</h2>
  <p class="body">{DISCLOSURE_TRANSFORMS}</p>

  {#if !vault.sealed}
    <p class="body">{DISCLOSURE_PLAIN}</p>
    <p class="body">
      {t('optVaultAbout')}
    </p>
    <p class="body caution">
      {t('optVaultNoRecovery')}
    </p>
    <p class="body caution">
      {t('optVaultOldCopy')}
    </p>
  {:else}
    <p class="body">{DISCLOSURE_SEALED}</p>
    <p class="body">
      {t('optVaultLimits')}
    </p>
    <p class="body">
      <strong>{vault.unlocked ? STATUS_UNLOCKED : STATUS_LOCKED}</strong>
      {#if !vault.unlocked}
        {LOCKED_CONSEQUENCE}
      {/if}
    </p>
  {/if}

  {#if vault.sealed}
    <label class="idle">
      {t('optVaultIdleBefore')}
      <select
        value={idleMinutes}
        onchange={(event) => void onidlechange(Number(event.currentTarget.value))}
      >
        {#each VAULT_IDLE_OPTIONS as option}
          <option value={option.minutes}>{option.label}</option>
        {/each}
      </select>
      {t('optVaultIdleAfter')}
    </label>
    <p class="note">
      {t('optVaultLockNote')}
    </p>
  {/if}

  <div class="actions">
    {#if !vault.sealed}
      <Button small onclick={() => open('enable')}>{t('optVaultProtect')}</Button>
    {:else}
      {#if vault.unlocked}
        <Button small onclick={() => void onlock()}>{t('optVaultLockNow')}</Button>
      {:else}
        <Button small onclick={() => open('unlock')}>{t('optVaultUnlock')}</Button>
      {/if}
      <Button small variant="danger" onclick={() => open('disable')}>{t('optVaultRemove')}</Button>
    {/if}
  </div>

  {#if panel}
    <div class="panel">
      <label>
        {panel === 'enable' ? t('optVaultNewPassphrase') : t('optVaultPassphrase')}
        <input
          type="password"
          bind:value={passphrase}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(event) => {
            if (event.key === 'Enter' && panel !== 'enable') void submit()
          }}
        />
      </label>

      {#if panel === 'enable'}
        <label>
          {t('optVaultAgain')}
          <input
            type="password"
            bind:value={confirmation}
            autocomplete="off"
            spellcheck="false"
            onkeydown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </label>
        {#if passphrase.length > 0 && passphrase.length < MINIMUM}
          <p class="note">{t('optVaultMinimum', MINIMUM)}</p>
        {:else if confirmation.length > 0 && passphrase !== confirmation}
          <p class="note">{t('optVaultMismatch')}</p>
        {/if}
      {/if}

      {#if panel === 'disable'}
        <p class="note">
          {t('optVaultPlainAgain')}
        </p>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <Button
          variant={panel === 'disable' ? 'danger' : 'primary'}
          small
          disabled={!canSubmit}
          onclick={() => void submit()}
        >
          {#if busy}
            {t('optVaultWorking')}
          {:else if panel === 'enable'}
            {t('optVaultEncrypt')}
          {:else if panel === 'disable'}
            {t('optVaultRemoveIt')}
          {:else}
            {t('optVaultUnlock')}
          {/if}
        </Button>
        <Button small onclick={() => open(null)}>{t('cancel')}</Button>
      </div>

      {#if panel === 'unlock' && vault.sealed && !vault.unlocked}
        <!--
          The only exit from a forgotten passphrase, and it is destructive, so
          it asks twice and is never the primary action. It is also tied to the
          vault state, not only to the open panel: the panel can stay open while
          the state changes underneath it, for example when another settings tab
          unlocks the vault, and discarding is wrong from any state but sealed
          and locked. The background refuses it from other states as well.
        -->
        <div class="forgotten">
          {#if !discardArmed}
            <button type="button" class="link" onclick={() => (discardArmed = true)}>
              {t('optVaultForgotten')}
            </button>
          {:else}
            <p class="note">
              {t('optVaultDiscardNote')}
            </p>
            <div class="actions">
              <Button small variant="danger" onclick={() => void discard()}>
                {t('optVaultDiscard')}
              </Button>
              <Button small onclick={() => (discardArmed = false)}>{t('optVaultKeep')}</Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  section {
    max-width: 600px;
    padding-left: var(--sp-13);
    border-left: 3px solid var(--neutral);
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
  }

  h2 {
    margin: 0;
    font: 600 13.5px var(--font-ui);
  }

  .body {
    margin: 0;
    font: 12px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .idle {
    display: flex;
    align-items: center;
    gap: var(--sp-7);
    flex-wrap: wrap;
    font: 12px/1.6 var(--font-ui);
    color: var(--text-dim);
  }

  .idle select {
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface);
    font: 12px var(--font-ui);
    color: var(--text);
  }

  .caution {
    color: var(--attention);
  }

  .actions {
    display: flex;
    gap: var(--sp-7);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-9);
    padding: var(--sp-11) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface-sunken);
  }

  .panel label {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    font: 600 9.5px var(--font-mono);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .panel input {
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface);
    font: 12px var(--font-mono);
    color: var(--text);
    text-transform: none;
    letter-spacing: normal;
  }

  .note {
    margin: 0;
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .error {
    margin: 0;
    font: 12px/1.5 var(--font-ui);
    color: var(--attention);
  }

  .forgotten {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    padding-top: var(--sp-9);
    border-top: 1px solid var(--border-subtle);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    font: 11.5px var(--font-ui);
    color: var(--text-faint);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
