<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * The sites on which picking and generation are refused (#131).
   *
   * The list starts empty and is saved as a whole by the background, which
   * rejects an entry that is not a site name. An entry covers its subdomains.
   */
  import { normalizeExcludedEntry } from '@shared/excluded-sites'
  import { send } from '@shared/messaging.svelte'
  import Button from '@sidebar/components/Button.svelte'

  let sites = $state<string[]>([])
  let loaded = $state(false)
  let draft = $state('')
  let error = $state<string | null>(null)

  async function load() {
    try {
      sites = await send<string[]>({ type: 'get-excluded-sites' })
      error = null
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      loaded = true
    }
  }

  async function replace(next: string[]) {
    try {
      sites = await send<string[]>({ type: 'set-excluded-sites', sites: next })
      error = null
      return true
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
      return false
    }
  }

  async function add() {
    const host = normalizeExcludedEntry(draft)
    if (host === null) {
      error = t('optNotSiteName', draft.trim())
      return
    }
    if (sites.includes(host)) {
      error = t('optAlreadyListed', host)
      return
    }
    if (await replace([...sites, host])) draft = ''
  }

  $effect(() => {
    void load()
  })
</script>

<section>
  <h2>{t('optExcludedTitle')}</h2>
  <p class="subtitle">
    {t('optExcludedBody')}
  </p>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <div class="add">
    <label for="excluded-site">{t('optSiteName')}</label>
    <input
      id="excluded-site"
      bind:value={draft}
      spellcheck="false"
      autocomplete="off"
      onkeydown={(event) => event.key === 'Enter' && void add()}
    />
    <Button small onclick={() => void add()}>{t('optAddSite')}</Button>
  </div>

  {#if loaded && sites.length === 0}
    <p class="empty">{t('optNoneExcluded')}</p>
  {:else}
    <ul>
      {#each sites as site (site)}
        <li>
          <span class="host">{site}</span>
          <Button small onclick={() => void replace(sites.filter((s) => s !== site))}>
            {t('optRemove')}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--sp-5);
    font: 600 13.5px var(--font-ui);
  }

  .subtitle,
  .empty {
    margin: 0 0 var(--sp-9);
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text-faint);
  }

  .error {
    margin: 0 0 var(--sp-9);
    font: 12px/1.5 var(--font-ui);
    color: var(--block);
  }

  .add {
    display: flex;
    align-items: center;
    gap: var(--sp-9);
    margin: 0 0 var(--sp-9);
  }

  label {
    font: 12px var(--font-ui);
  }

  input {
    flex: 1;
    padding: var(--sp-5) var(--sp-9);
    font: 12px var(--font-mono);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--sp-7);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-13);
    padding: var(--sp-9) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .host {
    overflow-wrap: anywhere;
    font: 12px var(--font-mono);
  }
</style>
