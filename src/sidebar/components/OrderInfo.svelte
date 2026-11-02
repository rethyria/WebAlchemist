<script lang="ts">
  import { t } from '@shared/i18n'

  /**
   * A small question mark button that explains how the order of elixirs
   * settles a conflict. The tooltip shows while the pointer is over the button,
   * while the button has keyboard focus, and after a tap or click, and Escape
   * hides it. The button is linked to the tooltip with aria-describedby, so a
   * screen reader reads the explanation as the description of the button. The
   * parent must be positioned, because the tooltip is placed against it.
   */
  const tipId = 'order-info-tip'

  let hovered = $state(false)
  let focused = $state(false)
  let pinned = $state(false)
  let dismissed = $state(false)

  let shown = $derived((hovered || focused || pinned) && !dismissed)

  function reveal(): void {
    dismissed = false
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && shown) {
      dismissed = true
      pinned = false
      event.stopPropagation()
    }
  }
</script>

<button
  type="button"
  class="info"
  aria-label={t('appOrderInfo')}
  aria-describedby={tipId}
  onmouseenter={() => {
    reveal()
    hovered = true
  }}
  onmouseleave={() => (hovered = false)}
  onfocus={() => {
    reveal()
    focused = true
  }}
  onblur={() => {
    focused = false
    pinned = false
  }}
  onclick={() => {
    reveal()
    pinned = !pinned
  }}
  {onkeydown}
>
  <span aria-hidden="true">?</span>
</button>
<span id={tipId} class="tip" role="tooltip" hidden={!shown}>{t('appOrderHint')}</span>

<style>
  .info {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: transparent;
    font: 600 11px/1 var(--font-ui);
    color: var(--text);
    cursor: pointer;
  }

  .tip {
    position: absolute;
    top: 100%;
    right: var(--gutter-sidebar);
    z-index: 5;
    max-width: 220px;
    margin-top: var(--sp-5);
    padding: var(--sp-6) var(--sp-9);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-card);
    background: var(--surface-raised);
    box-shadow: var(--shadow-panel);
    font: 11.5px/1.5 var(--font-ui);
    color: var(--text);
  }

  .tip[hidden] {
    display: none;
  }
</style>
