<script lang="ts">
  import { highlight } from '../lib/highlight'
  import type { TransformKind } from '@shared/types'

  interface Props {
    code: string
    kind: TransformKind
    /** Streaming shows a caret and clips rather than scrolls. */
    streaming?: boolean
    /** Lines flagged by static analysis, 1-indexed. */
    flagged?: number[]
  }

  let { code, kind, streaming = false, flagged = [] }: Props = $props()

  let box = $state<HTMLPreElement | null>(null)
  /*
   * Tail-following, but only while the user is already at the bottom. Yanking
   * the view back on every chunk would make it impossible to read anything
   * further up while the response is still arriving.
   */
  let following = $state(true)

  function onScroll() {
    if (!box) return
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight
    following = distance < 24
  }

  $effect(() => {
    // Referenced so this re-runs on each chunk.
    void code
    if (!streaming || !following || !box) return
    box.scrollTop = box.scrollHeight
  })

  let tokens = $derived(highlight(code, kind))
  let flaggedSet = $derived(new Set(flagged))

  /*
   * Flagged lines are marked by splitting the rendered text on newlines, so
   * the tint follows the line rather than the token. Only done when there is
   * something to flag — the common case renders one flat run of spans.
   */
  let lines = $derived.by(() => {
    if (flaggedSet.size === 0) return null
    return code.split('\n').map((text, index) => ({
      text,
      number: index + 1,
      flagged: flaggedSet.has(index + 1),
    }))
  })
</script>

<pre bind:this={box} onscroll={onScroll} class:streaming>{#if lines}{#each lines as line (line.number)}<span
        class="line"
        class:flagged={line.flagged}>{#each highlight(line.text, kind) as token}<span
            class={token.kind}>{token.text}</span
          >{/each}{'\n'}</span
      >{/each}{:else}{#each tokens as token}<span class={token.kind}>{token.text}</span
    >{/each}{/if}{#if streaming}<span class="caret" aria-hidden="true"></span>{/if}</pre>

<style>
  pre {
    margin: 0;
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-input);
    background: var(--surface-sunken);
    font: 11px/1.7 var(--font-mono);
    color: var(--text);
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /*
   * A fixed window that scrolls, rather than one that grows. Growing it on
   * every chunk would drag the rest of the panel around for the whole request;
   * clipping it, which is what this did before, hid the code being written the
   * moment it passed the bottom edge.
   */
  pre.streaming {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
  }

  .line {
    display: inline-block;
    width: 100%;
  }

  .line.flagged {
    background: var(--code-flagged-bg);
  }

  .comment {
    color: var(--code-comment);
  }
  .selector,
  .keyword {
    color: var(--code-selector);
  }
  .property {
    color: var(--code-property);
  }
  .value,
  .string,
  .number {
    color: var(--code-value);
  }

  .caret {
    display: inline-block;
    width: 1.5px;
    height: 12px;
    margin-left: 2px;
    vertical-align: -1px;
    background: var(--accent-fg);
  }
</style>
