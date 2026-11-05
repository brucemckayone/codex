<!--
  @component MediaStatusPill

  A media item's status as a pill: the grid tile, the list row and the phone
  row all draw it (Codex-a6ofh.1.6). The kind comes from `tile-state.ts`
  (`tilePill(describeTile(...))`), so every surface names a state the same way.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import type { TilePill } from './tile-state';

  interface Props {
    pill: TilePill;
  }

  const { pill }: Props = $props();

  const PILL_LABELS: Record<TilePill, () => string> = {
    uploading: () => m.media_status_uploading(),
    stopped: () => m.media_status_stopped(),
    processing: () => m.media_status_processing(),
    waiting: () => m.media_status_waiting(),
    ready: () => m.media_status_ready(),
    failed: () => m.media_status_failed(),
  };
</script>

<span class="status-pill" data-status={pill}>
  <span class="status-dot" aria-hidden="true">
    {#if pill === 'ready'}
      <CheckIcon size={8} />
    {/if}
  </span>
  {PILL_LABELS[pill]()}
</span>

<style>
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    flex-shrink: 0;
    line-height: var(--leading-none);
    white-space: nowrap;
  }

  .status-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background-color: currentColor;
  }

  .status-pill[data-status='ready'] {
    color: var(--color-status-success-text);
    background: var(--color-status-success-surface);
    border-color: var(--color-status-success-border);
  }

  .status-pill[data-status='processing'],
  .status-pill[data-status='stopped'] {
    color: var(--color-status-warning-text);
    background: var(--color-status-warning-surface);
    border-color: var(--color-status-warning-border);
  }

  .status-pill[data-status='failed'] {
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
    border-color: var(--color-status-error-border);
  }

  .status-pill[data-status='waiting'] {
    color: var(--color-status-info-text);
    background: var(--color-status-info-surface);
    border-color: var(--color-status-info-border);
  }

  /* Neutral: the base pill's text-secondary ink (muted read 2.3:1 here). */
  .status-pill[data-status='uploading'] {
    background: var(--color-surface-secondary);
  }
</style>
