<!--
  @component NeedsYouStrip

  The content list's "Needs you" (Codex-a6ofh.3.4, mockup L1 pin 6): how many
  of the creator's pieces need them, by kind, counted across every page where
  the list looks. Each chip lists its own pieces (`?needs=`); the chip in use
  is pressed, and pressing it again lists them all. A chip with none is
  hidden, but the one in use stays, so it can always be let go; no chip, no
  strip. A read that failed says so, with a Try again (owner): it is never
  shown as nothing needing you.
-->
<script lang="ts">
  import {
    CONTENT_ATTENTION_KINDS,
    type ContentAttentionCounts,
    type ContentAttentionKind,
  } from '@codex/constants';
  import type { Component } from 'svelte';
  import { AlertTriangleIcon, CheckCircleIcon, ClockIcon } from '$lib/components/ui/Icon';
  import type { IconProps } from '$lib/components/ui/Icon/types';
  import * as m from '$paraglide/messages';
  import type { FacetUnread } from '../list-toolbar/list-option';
  import type { ListNeeds } from './list-url';

  interface Props {
    /** The counts; undefined until read (and while a failed read is `unread`). */
    counts: ContentAttentionCounts | undefined;
    /** The chip in use, if any. */
    active: ListNeeds;
    /** The read failed: what to say, and its Try again. */
    unread?: FacetUnread;
    onSelect: (kind: ContentAttentionKind) => void;
  }

  const { counts, active, unread, onSelect }: Props = $props();

  type Tone = 'error' | 'info' | 'success';

  // The row line's own colours (ContentRowLine): what has gone, or didn't
  // go live, in error; what is on its way, in info; what is ready, in success.
  const CHIP: Record<ContentAttentionKind, { tone: Tone; icon: Component<IconProps> }> = {
    'live-media-gone': { tone: 'error', icon: AlertTriangleIcon },
    scheduled: { tone: 'info', icon: ClockIcon },
    'didnt-go-live': { tone: 'error', icon: AlertTriangleIcon },
    'media-gone': { tone: 'error', icon: AlertTriangleIcon },
    processing: { tone: 'info', icon: ClockIcon },
    ready: { tone: 'success', icon: CheckCircleIcon },
  };

  function words(kind: ContentAttentionKind, count: number): string {
    const one = count === 1;
    switch (kind) {
      case 'live-media-gone':
        return one
          ? m.studio_content_needs_live_media_gone_one()
          : m.studio_content_needs_live_media_gone({ count });
      case 'scheduled':
        return one
          ? m.studio_content_needs_scheduled_one()
          : m.studio_content_needs_scheduled({ count });
      case 'didnt-go-live':
        return one
          ? m.studio_content_needs_didnt_go_live_one()
          : m.studio_content_needs_didnt_go_live({ count });
      case 'media-gone':
        return one
          ? m.studio_content_needs_media_gone_one()
          : m.studio_content_needs_media_gone({ count });
      case 'processing':
        return one
          ? m.studio_content_needs_processing_one()
          : m.studio_content_needs_processing({ count });
      case 'ready':
        return one
          ? m.studio_content_needs_ready_one()
          : m.studio_content_needs_ready({ count });
    }
  }

  const chips = $derived(
    counts
      ? CONTENT_ATTENTION_KINDS.filter((kind) => counts[kind] > 0 || kind === active).map(
          (kind) => ({ kind, count: counts[kind] })
        )
      : []
  );

  const labelId = $props.id();
</script>

{#if unread}
  <div class="needs-you">
    <p class="needs-you-note" role="status">{unread.words}</p>
    <button
      type="button"
      class="needs-you-retry"
      aria-busy={unread.retrying}
      onclick={() => void unread.retry()}
    >
      {m.common_try_again()}
    </button>
  </div>
{:else if chips.length > 0}
  <div class="needs-you" role="group" aria-labelledby={labelId}>
    <span class="needs-you-label" id={labelId}>{m.studio_content_needs_label()}</span>
    {#each chips as chip (chip.kind)}
      {@const Icon = CHIP[chip.kind].icon}
      <button
        type="button"
        class="needs-chip"
        data-tone={CHIP[chip.kind].tone}
        data-kind={chip.kind}
        aria-pressed={chip.kind === active}
        onclick={() => onSelect(chip.kind)}
      >
        <Icon size={14} aria-hidden="true" />
        {words(chip.kind, chip.count)}
      </button>
    {/each}
  </div>
{/if}

<style>
  .needs-you {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .needs-you-label {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .needs-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--space-8);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }

  .needs-chip :global(svg) {
    flex-shrink: 0;
  }

  .needs-chip[data-tone='error'] :global(svg) {
    color: var(--color-status-error-text);
  }

  .needs-chip[data-tone='info'] :global(svg) {
    color: var(--color-status-info-text);
  }

  .needs-chip[data-tone='success'] :global(svg) {
    color: var(--color-status-success-text);
  }

  .needs-chip:hover {
    background: var(--color-surface-secondary);
  }

  .needs-chip[aria-pressed='true'] {
    border-color: var(--color-text);
    background: var(--color-surface-secondary);
    font-weight: var(--font-semibold);
  }

  .needs-chip:focus-visible,
  .needs-you-retry:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .needs-you-note {
    margin: 0;
    color: var(--color-text-secondary);
  }

  .needs-you-retry {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    font: inherit;
    font-weight: var(--font-semibold);
    cursor: pointer;
  }

  .needs-you-retry:hover {
    text-decoration: underline;
  }
</style>
