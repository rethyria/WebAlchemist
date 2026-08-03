<script lang="ts">
  /**
   * Placeholder shell for settings. Replaced by the designed components.
   *
   * The one thing this file establishes and the design must keep: credentials
   * are write-only from here. There is a setter and a "configured" boolean, and
   * no path that returns a key value to this context.
   */
  import type { CredentialStatus, Settings } from '@shared/types'

  let settings = $state<Settings | null>(null)
  let statuses = $state<CredentialStatus[]>([])

  async function load() {
    const settingsResponse = await browser.runtime.sendMessage({ type: 'get-settings' })
    if (settingsResponse.ok) settings = settingsResponse.data

    const statusResponse = await browser.runtime.sendMessage({
      type: 'get-credential-statuses',
    })
    if (statusResponse.ok) statuses = statusResponse.data
  }

  $effect(() => {
    void load()
  })
</script>

<main>
  <h1>WebAlchemist settings</h1>

  <section>
    <h2>Providers</h2>
    {#if !settings || settings.providers.length === 0}
      <p>No provider is set up. Add one to start generating transforms.</p>
    {:else}
      <ul>
        {#each settings.providers as provider (provider.id)}
          <li>
            {provider.label}
            <span>
              {statuses.find((s) => s.providerId === provider.id)?.configured
                ? 'Credential configured'
                : 'No credential'}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="disclosure">
    <h2>How your credentials are stored</h2>
    <p>
      Credentials are stored in this browser profile's extension storage. Browsers do not
      offer extensions access to the operating system keychain, so this data is protected
      by file permissions on your profile directory and nothing more. Anyone who can read
      your profile directory can read these credentials.
    </p>
  </section>
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    max-width: 720px;
    margin: 0 auto;
    padding: 24px;
    color: light-dark(#1a1a1a, #f0f0f0);
    background: light-dark(#ffffff, #1c1b22);
  }
  h1 {
    font-size: 20px;
  }
  h2 {
    font-size: 15px;
  }
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid light-dark(#e0e0e0, #333);
  }
  .disclosure {
    margin-top: 32px;
    padding: 12px;
    border-left: 3px solid light-dark(#8d99ae, #5a6478);
    font-size: 13px;
    line-height: 1.5;
  }
</style>
