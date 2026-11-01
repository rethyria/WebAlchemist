<script lang="ts">
  import { t } from '@shared/i18n'
  /**
   * The sites the extension can read, with the transforms that depend on each.
   *
   * Grants are made one site at a time when a transform is saved, and persist
   * until revoked. Before this list the only place to see or revoke them was
   * about:addons. Removing one calls permissions.remove, and the background
   * reconciles the content script registration from permissions.onRemoved.
   */
  import { removeAccessQuestion, siteGrants, type SiteGrant } from '@shared/site-access'
  import type { Transform } from '@shared/types'
  import Button from '@sidebar/components/Button.svelte'

  interface Props {
    /** Loads every saved transform. */
    loadTransforms: () => Promise<Transform[]>
  }

  let { loadTransforms }: Props = $props()

  let grants = $state<SiteGrant[]>([])
  let loaded = $state(false)
  let error = $state<string | null>(null)
  let removing = $state<string | null>(null)

  async function refresh() {
    try {
      const held = await browser.permissions.getAll()
      grants = siteGrants(held.origins ?? [], await loadTransforms())
      error = null
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      loaded = true
    }
  }

  async function remove(grant: SiteGrant) {
    const question = removeAccessQuestion(grant)
    if (question !== null && !confirm(question)) return
    const origin = grant.origin
    removing = origin
    try {
      const removed = await browser.permissions.remove({ origins: [origin] })
      if (!removed) error = t('optAccessNotRemoved', origin)
      await refresh()
    } catch (cause) {
      error = String(cause instanceof Error ? cause.message : cause)
    } finally {
      removing = null
    }
  }

  const describeCount = (count: number): string =>
    count === 0
      ? t('optUsesNone')
      : count === 1
        ? t('optUsesOne')
        : t('optUsesMany', count)

  $effect(() => {
    void refresh()
    // Grants also change from about:addons and from the sidebar.
    const onChange = () => void refresh()
    browser.permissions.onAdded.addListener(onChange)
    browser.permissions.onRemoved.addListener(onChange)
    return () => {
      browser.permissions.onAdded.removeListener(onChange)
      browser.permissions.onRemoved.removeListener(onChange)
    }
  })
</script>

<section>
  <h2>{t('optSiteAccessTitle')}</h2>
  <p class="subtitle">
    {t('optSiteAccessBody')}
  </p>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if loaded && grants.length === 0}
    <p class="empty">{t('optNoAccess')}</p>
  {:else}
    <ul>
      {#each grants as grant (grant.origin)}
        <li>
          <div class="text">
            <span class="origin">{grant.origin}</span>
            <span class="count">{describeCount(grant.transforms)}</span>
          </div>
          <Button small disabled={removing === grant.origin} onclick={() => void remove(grant)}>
            {t('optRemoveAccess')}
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
    gap: var(--sp-13);
    padding: var(--sp-9) var(--sp-13);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .origin {
    overflow-wrap: anywhere;
    font: 12px var(--font-mono);
  }

  .count {
    font: 11px var(--font-ui);
    color: var(--text-faint);
  }
</style>
