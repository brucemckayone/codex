<!--
  @component BulkResultLine

  What a bulk action did (Codex-a6ofh.3.5, mockup L2): one line, and Show
  for the pieces that did not go through, each in the Publish checklist's
  words where it has them, with the way to put it right. A polite live
  region, so the line is heard when it lands. Mounted afresh for each
  result (`{#key}`), so a new one starts folded.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import type { BulkProblem } from './bulk-report';

  interface Props {
    line: string;
    problems: readonly BulkProblem[];
  }

  const { line, problems }: Props = $props();

  const uid = $props.id();
  let shown = $state(false);
</script>

<div class="bulk-result" role="status">
  <p class="bulk-result-line">
    {line}
    {#if problems.length > 0}
      <button
        type="button"
        class="bulk-result-toggle"
        aria-expanded={shown}
        aria-controls="{uid}-problems"
        onclick={() => (shown = !shown)}
      >
        {shown ? m.studio_content_bulk_hide() : m.studio_content_bulk_show()}
      </button>
    {/if}
  </p>
  {#if problems.length > 0}
    <ul
      id="{uid}-problems"
      class="bulk-problems"
      aria-label={m.studio_content_bulk_problems_label()}
      hidden={!shown}
    >
      {#each problems as problem (problem.id)}
        <li class="bulk-problem">
          <span class="bulk-problem-title">{problem.title}</span>
          <span class="bulk-problem-words">{problem.words}</span>
          {#if problem.fixHref}
            <a class="bulk-problem-fix" href={problem.fixHref}>{m.studio_content_bulk_fix()}</a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .bulk-result {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .bulk-result-line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .bulk-result-toggle {
    margin-left: var(--space-1);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-link);
    font: inherit;
    font-weight: var(--font-medium);
    text-decoration: underline;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .bulk-result-toggle:focus-visible,
  .bulk-problem-fix:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .bulk-problems {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    list-style: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .bulk-problems[hidden] {
    display: none;
  }

  .bulk-problem {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }

  .bulk-problem-title {
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .bulk-problem-words {
    color: var(--color-text-secondary);
  }

  .bulk-problem-fix {
    color: var(--color-link);
    border-radius: var(--radius-sm);
  }
</style>
