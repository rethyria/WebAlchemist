<script lang="ts">
  import { t } from '@shared/i18n'
  import { highlight } from '@shared/highlight'
  import { indentEdit } from './indent'

  interface Props {
    value: string
    kind: 'css' | 'js'
    onchange: (value: string) => void
  }

  let { value, kind, onchange }: Props = $props()

  let area = $state<HTMLTextAreaElement | null>(null)
  let painted = $state<HTMLDivElement | null>(null)
  let gutter = $state<HTMLDivElement | null>(null)

  let tokens = $derived(highlight(value, kind))
  let lines = $derived(value.split('\n').length)

  /*
   * The coloured copy sits behind a transparent textarea, so the browser does
   * the editing — selection, undo, IME, spellcheck-off, every keyboard idiom
   * a textarea already has — and this only draws. The two must agree on every
   * metric that affects layout, which is why the shared rules below are set on
   * both rather than inherited by one.
   *
   * A trailing newline is the one place they disagree: a textarea reserves a
   * line for it and a div does not, so the last line would scroll out of reach
   * without this.
   */
  let drawn = $derived(value.endsWith('\n') ? `${value} ` : value)
  let drawnTokens = $derived(highlight(drawn, kind))

  /**
   * Replaces the whole text as an edit of the textarea, so that Ctrl+Z undoes
   * it, in the same way as the indent edits below.
   */
  export function replaceAll(text: string): void {
    if (!area || text === area.value) return
    area.focus()
    area.setSelectionRange(0, area.value.length)
    if (!document.execCommand('insertText', false, text)) {
      area.setRangeText(text, 0, area.value.length, 'end')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    }
    area.setSelectionRange(0, 0)
    area.scrollTop = 0
    sync()
  }

  function sync(): void {
    if (!area) return
    if (painted) {
      painted.scrollTop = area.scrollTop
      painted.scrollLeft = area.scrollLeft
    }
    if (gutter) gutter.scrollTop = area.scrollTop
  }

  /*
   * Tab indents rather than leaving the field. In a full-page editor the key
   * means indentation, and the focus order it would otherwise walk is two
   * buttons away. Escape hands it back, so the page stays reachable without a
   * pointer.
   */
  let escaped = $state(false)

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      escaped = true
      return
    }
    if (event.key !== 'Tab' || escaped) {
      escaped = false
      return
    }
    event.preventDefault()

    const target = event.currentTarget as HTMLTextAreaElement
    const edit = indentEdit(value, target.selectionStart, target.selectionEnd, event.shiftKey)

    /*
     * Applied as an edit of the textarea itself, so the browser records it in
     * the undo history. The previous code computed a whole new value and set
     * it from script, which replaced the selection and, in Firefox, probably
     * cleared the undo history (not measured). setRangeText is the fallback for
     * a browser where the editing command is refused; it does not record an
     * undo step, so it raises the input event itself.
     */
    target.setSelectionRange(edit.from, edit.to)
    if (!document.execCommand('insertText', false, edit.text)) {
      target.setRangeText(edit.text, edit.from, edit.to, 'end')
      target.dispatchEvent(new Event('input', { bubbles: true }))
    }
    target.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  }
</script>

<div class="code">
  <div class="gutter" bind:this={gutter} aria-hidden="true">
    {#each { length: lines } as _, index}
      <span>{index + 1}</span>
    {/each}
  </div>

  <div class="field">
    <div class="painted" bind:this={painted} aria-hidden="true">
      {#each drawnTokens as token}<span class={token.kind}>{token.text}</span>{/each}
    </div>

    <textarea
      bind:this={area}
      class="input"
      {value}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label={t('edCodeLabel')}
      oninput={(event) => onchange(event.currentTarget.value)}
      onscroll={sync}
      onkeydown={onKeyDown}
    ></textarea>
  </div>
</div>

<style>
  .code {
    display: flex;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface-sunken);
    overflow: hidden;
  }

  .gutter {
    display: flex;
    flex-direction: column;
    padding: 14px 10px 14px 14px;
    border-right: 1px solid var(--border-subtle);
    background: var(--chrome);
    overflow: hidden;
    text-align: right;
    user-select: none;
  }

  .gutter span {
    font: 12.5px/1.65 var(--font-mono);
    color: var(--code-line-no);
  }

  .field {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  /*
   * Every property here that could move a glyph is repeated on both layers.
   * They are two copies of the same text, one visible and one editable, and a
   * disagreement of half a pixel per character is visible within a line.
   */
  .painted,
  .input {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 14px;
    border: 0;
    font: 12.5px/1.65 var(--font-mono);
    tab-size: 2;
    white-space: pre;
    overflow: auto;
    overflow-wrap: normal;
  }

  .painted {
    pointer-events: none;
    color: var(--text);
  }

  .input {
    background: transparent;
    /* Transparent, not hidden: the caret and selection still have to show. */
    color: transparent;
    caret-color: var(--accent-fg);
    resize: none;
  }

  .input::selection {
    background: var(--accent-chip);
  }

  .input:focus {
    outline: none;
  }

  /*
   * The palette's own code colours, which CodeBlock already draws with. The
   * status hues are deliberately not used here: tokens.css keeps them for
   * state, and a keyword sharing a colour with a blocking finding would make
   * both mean less.
   */
  .comment {
    color: var(--code-comment);
    font-style: italic;
  }
  .string {
    color: var(--code-value);
  }
  .number {
    color: var(--code-value);
  }
  .keyword {
    color: var(--code-selector);
  }
  .property {
    color: var(--code-property);
  }
  .selector {
    color: var(--code-selector);
  }
  .punctuation {
    color: var(--text-dim);
  }
</style>
