<!--
  @component ContentRowLine

  The line under a piece's title in the content list (Codex-a6ofh.3.1): a
  draft's two steps, or the words for a schedule, a refusal or media gone
  from a live piece (`rowLine`). The table and the cards both show it, so a
  piece reads the same in either view.
-->
<script lang="ts">
  import DraftProgress from './DraftProgress.svelte';
  import type { RowLine } from './row-facts';

  interface Props {
    line: RowLine;
  }

  const { line }: Props = $props();
</script>

{#if line.kind === 'progress'}
  <DraftProgress progress={line.progress} />
{:else}
  <span class="row-line" data-kind={line.kind}>{line.words}</span>
{/if}

<style>
  .row-line {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .row-line[data-kind='scheduled'] {
    color: var(--color-status-info-text);
  }

  .row-line[data-kind='blocked'],
  .row-line[data-kind='media'] {
    color: var(--color-status-error-text);
  }
</style>
