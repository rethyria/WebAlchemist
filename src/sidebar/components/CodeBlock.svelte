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

<pre class:streaming>{#if lines}{#each lines as line (line.number)}<span
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

  /* While streaming the box is a fixed window: growing it on every chunk
     would drag the rest of the panel around for the whole request. */
  pre.streaming {
    flex: 1;
    overflow: hidden;
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
