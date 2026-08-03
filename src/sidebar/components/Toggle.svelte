<script lang="ts">
  /** 26×15 track with an 11px knob, per the design. Settings uses `large`. */
  interface Props {
    checked: boolean
    label: string
    large?: boolean
    onchange: (checked: boolean) => void
  }

  let { checked, label, large = false, onchange }: Props = $props()
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="track"
  class:on={checked}
  class:large
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .track {
    position: relative;
    flex: none;
    width: 26px;
    height: 15px;
    padding: 0;
    border: none;
    border-radius: var(--r-panel);
    background: var(--border);
    cursor: pointer;
    transition: background var(--motion) linear;
  }

  .track.on {
    background: var(--accent);
  }

  .track.large {
    width: 34px;
    height: 19px;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--surface);
    transition: left var(--motion) linear;
  }

  .track.on .knob {
    left: 13px;
  }

  .track.large .knob {
    width: 14px;
    height: 14px;
  }

  .track.large.on .knob {
    left: 17px;
  }
</style>
