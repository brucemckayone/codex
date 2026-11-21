<!--
  @component ContentRowLine

  The line under a piece's title in the content list (Codex-a6ofh.3.1): a
  draft's two steps, or the words for a schedule, a refusal or media gone
  from a live piece (`rowLine`). The table and the cards both show it, so a
  piece reads the same in either view.

  A leaving piece's (Codex-a6ofh.6, mockup LN3): when it leaves, and Keep it
  when the leave is the creator's own, with a line when their org deleted it
  too. One only the org's delete holds is a note with "Delete it too" under
  it (owner 2026-11-20). Either action sits above the row-wide link.

  @prop line      What the row says
  @prop title     The piece's title, for the action's accessible name
  @prop compact   A phone row's shorter line
  @prop busy      An action on the list is under way: the line's waits
  @prop onaction  Its Keep it or Delete it too; leaving it out offers neither
-->
<script lang="ts">
  import { ClockIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import DraftProgress from './DraftProgress.svelte';
  import type { LeavingLine, RowLine } from './row-facts';

  interface Props {
    line: RowLine;
    title?: string;
    compact?: boolean;
    busy?: boolean;
    onaction?: (action: LeavingLine['action']) => void;
  }

  const { line, title = '', compact = false, busy = false, onaction }: Props = $props();
</script>

{#if line.kind === 'progress'}
  <DraftProgress progress={line.progress} />
{:else if line.kind === 'leaving'}
  <span class="row-line" data-kind="leaving">
    <ClockIcon size={12} aria-hidden="true" />
    <span>{compact ? line.short : line.words}</span>
    {#if onaction && line.action === 'keep'}
      <span aria-hidden="true">·</span>
      <button
        type="button"
        class="row-line-action"
        data-action="keep"
        aria-label={m.studio_leaving_keep_named({ title })}
        disabled={busy}
        onclick={() => onaction('keep')}
      >
        {m.studio_leaving_keep()}
      </button>
    {:else if onaction}
      <button
        type="button"
        class="row-line-action"
        data-action="delete-too"
        aria-label={m.studio_leaving_delete_too_named({ title })}
        disabled={busy}
        onclick={() => onaction('delete-too')}
      >
        {m.studio_leaving_delete_too()}
      </button>
    {/if}
    {#if line.orgToo}
      <span class="row-line-org-too">{m.studio_leaving_org_too()}</span>
    {/if}
  </span>
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

  .row-line[data-kind='leaving'] {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-status-warning-text);
  }

  .row-line[data-kind='leaving'] :global(svg) {
    flex-shrink: 0;
  }

  /* Above a phone row's or a card's row-wide link, so a press keeps it. */
  .row-line-action {
    position: relative;
    z-index: 1;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    font: inherit;
    font-weight: var(--font-semibold);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
  }

  /* Under the org's note, on a line of its own: it is a choice, not a fact. */
  .row-line-action[data-action='delete-too'],
  .row-line-org-too {
    flex-basis: 100%;
    text-align: start;
  }

  .row-line-org-too {
    color: var(--color-text-secondary);
  }

  .row-line-action:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-50);
  }

  .row-line-action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
