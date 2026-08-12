<script lang="ts">
  /**
   * Passphrase mode, and the disclosure that goes with whichever mode is on.
   *
   * The copy here is the part #46 cares about most: it must describe what is
   * actually true afterwards, neither more nor less. Two states, two different
   * true statements, and the one shown follows the stored data rather than a
   * setting — see `vaultState` in storage.ts.
   */
  import Button from '@sidebar/components/Button.svelte'

  interface Props {
    /*
     * Not called `state`: a prop of that name makes Svelte read every `$state`
     * rune in this file as a store subscription on the prop.
     */
    vault: { sealed: boolean; unlocked: boolean }
    onenable: (passphrase: string) => Promise<void>
    ondisable: (passphrase: string) => Promise<void>
    onunlock: (passphrase: string) => Promise<void>
    onlock: () => Promise<void>
    ondiscard: () => Promise<void>
  }

  let { vault, onenable, ondisable, onunlock, onlock, ondiscard }: Props = $props()

  type Panel = 'enable' | 'disable' | 'unlock' | null
  let panel = $state<Panel>(null)
  let passphrase = $state('')
  let confirmation = $state('')
  let error = $state<string | null>(null)
  let busy = $state(false)
  let discardArmed = $state(false)

  /*
   * Long rather than complex. A passphrase protecting a file at rest is only
   * ever attacked offline, where character-class rules buy far less than
   * length — and 600,000 PBKDF2 iterations is doing the rest of the work.
   */
  const MINIMUM = 12

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
      error = /operation|decrypt/i.test(raw) ? 'That passphrase is not the one that was set.' : raw
    } finally {
      busy = false
    }
  }
</script>

<section>
  <h2>How your credentials are stored</h2>

  {#if !vault.sealed}
    <p class="body">
      Keys are stored as plain text in this browser profile's directory. Browsers offer
      extensions no access to the operating system keychain, so this data is protected by
      file permissions and nothing else. Anyone who can read your profile directory can
      read these keys.
    </p>
    <p class="body">
      A passphrase changes that. Your keys are encrypted with it, and nothing stored on
      this machine can decrypt them without it — so reading the profile directory yields
      ciphertext and nothing else. You unlock once each time you start the browser.
    </p>
    <p class="body caution">
      There is no way to recover a forgotten passphrase. That is what makes it worth
      something, and it means losing it means re-entering your keys.
    </p>
    <p class="body caution">
      Turning this on encrypts your keys from that point on. It cannot erase the copy
      already written to this profile — browsers give extensions no way to reclaim that
      space, and it stays readable until the browser reuses it. If that matters to you,
      replace the key at your provider after turning this on.
    </p>
  {:else}
    <p class="body">
      Keys are encrypted with your passphrase. What sits in this browser profile is
      ciphertext, and nothing stored on this machine decrypts it — the key is derived from
      your passphrase when you unlock, and kept in memory for the session only.
    </p>
    <p class="body">
      This protects the profile at rest. It does not protect against software already
      running inside this extension while it is unlocked, which can ask for the keys the
      same way the extension itself does.
    </p>
    <p class="body">
      <strong>{vault.unlocked ? 'Unlocked for this session.' : 'Locked.'}</strong>
      {#if !vault.unlocked}
        Generating anything will fail until you unlock.
      {/if}
    </p>
  {/if}

  <div class="actions">
    {#if !vault.sealed}
      <Button small onclick={() => open('enable')}>Protect with a passphrase</Button>
    {:else}
      {#if vault.unlocked}
        <Button small onclick={() => void onlock()}>Lock now</Button>
      {:else}
        <Button small onclick={() => open('unlock')}>Unlock</Button>
      {/if}
      <Button small onclick={() => open('disable')}>Remove the passphrase</Button>
    {/if}
  </div>

  {#if panel}
    <div class="panel">
      <label>
        {panel === 'enable' ? 'New passphrase' : 'Passphrase'}
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
          Type it again
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
          <p class="note">At least {MINIMUM} characters. Length matters more than symbols here.</p>
        {:else if confirmation.length > 0 && passphrase !== confirmation}
          <p class="note">The two do not match.</p>
        {/if}
      {/if}

      {#if panel === 'disable'}
        <p class="note">
          Your keys go back to being stored as plain text in this profile.
        </p>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <Button variant="primary" small disabled={!canSubmit} onclick={() => void submit()}>
          {#if busy}
            Working…
          {:else if panel === 'enable'}
            Encrypt my keys
          {:else if panel === 'disable'}
            Remove it
          {:else}
            Unlock
          {/if}
        </Button>
        <Button small onclick={() => open(null)}>Cancel</Button>
      </div>

      {#if panel === 'unlock'}
        <!--
          The only exit from a forgotten passphrase, and it is destructive, so
          it asks twice and is never the primary action.
        -->
        <div class="forgotten">
          {#if !discardArmed}
            <button type="button" class="link" onclick={() => (discardArmed = true)}>
              I have forgotten it
            </button>
          {:else}
            <p class="note">
              There is no recovery. Discarding deletes the stored keys so you can enter them
              again; your transforms are not affected.
            </p>
            <div class="actions">
              <Button small onclick={() => void ondiscard().then(() => open(null))}>
                Discard the stored keys
              </Button>
              <Button small onclick={() => (discardArmed = false)}>Keep them</Button>
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
