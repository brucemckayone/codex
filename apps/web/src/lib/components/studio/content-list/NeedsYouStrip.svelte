<!--
  @component NeedsYouStrip

  The content list's "Needs you" (Codex-a6ofh.3.4, mockup L1 pin 6): how many
  of the creator's pieces need them, by kind, counted across every page where
  the list looks. Each chip lists its own pieces (`?needs=`); the chip in use
  is pressed, and pressing it again lists them all. A chip with none is
  hidden, but the one in use stays, so it can always be let go: by name,
  while the counts are being read or could not be. No chip, no strip. A read
  that failed says so, with a Try again (owner): it is never shown as
  nothing needing you.
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
  import { formatShortSentenceDate } from '$lib/utils/format';
  import type { FacetUnread } from '../list-toolbar/list-option';
  import UnreadNote from '../list-toolbar/UnreadNote.svelte';
  import { type ListNeeds, NEEDS_NONE } from './list-url';
  import { NEEDS_NAMED } from './narrowed-words';

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

  interface Chip {
    tone: 'error' | 'warning' | 'info' | 'success';
    icon: Component<IconProps>;
    one: () => string;
    many: (inputs: { count: number }) => string;
  }

  // The row line's own colours (ContentRowLine): what has gone, or didn't
  // go live, in error; what is leaving on a day, in warning (LN3); what is on
  // its way, in info; what is ready, in success.
  const CHIP: Record<ContentAttentionKind, Chip> = {
    leaving: {
      tone: 'warning',
      icon: ClockIcon,
      one: m.studio_content_needs_leaving_one,
      many: m.studio_content_needs_leaving,
    },
    'live-media-gone': {
      tone: 'error',
      icon: AlertTriangleIcon,
      one: m.studio_content_needs_live_media_gone_one,
      many: m.studio_content_needs_live_media_gone,
    },
    scheduled: {
      tone: 'info',
      icon: ClockIcon,
      one: m.studio_content_needs_scheduled_one,
      many: m.studio_content_needs_scheduled,
    },
    'didnt-go-live': {
      tone: 'error',
      icon: AlertTriangleIcon,
      one: m.studio_content_needs_didnt_go_live_one,
      many: m.studio_content_needs_didnt_go_live,
    },
    'media-gone': {
      tone: 'error',
      icon: AlertTriangleIcon,
      one: m.studio_content_needs_media_gone_one,
      many: m.studio_content_needs_media_gone,
    },
    processing: {
      tone: 'info',
      icon: ClockIcon,
      one: m.studio_content_needs_processing_one,
      many: m.studio_content_needs_processing,
    },
    ready: {
      tone: 'success',
      icon: CheckCircleIcon,
      one: m.studio_content_needs_ready_one,
      many: m.studio_content_needs_ready,
    },
  };

  const chips = $derived.by(() => {
    if (counts) {
      // A worker older than a kind sends no count for it: none, never "undefined".
      return CONTENT_ATTENTION_KINDS.filter((kind) => (counts[kind] ?? 0) > 0 || kind === active).map(
        (kind) => {
          const count = counts[kind] ?? 0;
          const chip = CHIP[kind];
          const words = count === 1 ? chip.one() : chip.many({ count });
          return { kind, ...chip, words: withLeaveDate(kind, words, counts) };
        }
      );
    }
    if (active === NEEDS_NONE) return [];
    // The kind without its count: the chip in use while none is read.
    return [{ kind: active, ...CHIP[active], words: NEEDS_NAMED[active]() }];
  });

  /** The leaving chip names the first day one goes: "1 piece leaving · 17 Dec". */
  function withLeaveDate(
    kind: ContentAttentionKind,
    words: string,
    read: ContentAttentionCounts
  ): string {
    if (kind !== 'leaving' || !read.leavingFirst) return words;
    return m.studio_content_needs_leaving_on({
      words,
      date: formatShortSentenceDate(read.leavingFirst),
    });
  }

  const labelId = $props.id();
</script>

{#if unread || chips.length > 0}
  <div class="needs-you" role="group" aria-labelledby={labelId}>
    <span class="needs-you-label" id={labelId}>{m.studio_content_needs_label()}</span>
    {#each chips as chip (chip.kind)}
      <button
        type="button"
        class="needs-chip"
        data-tone={chip.tone}
        data-kind={chip.kind}
        aria-pressed={chip.kind === active}
        onclick={() => onSelect(chip.kind)}
      >
        <chip.icon size={14} aria-hidden="true" />
        {chip.words}
      </button>
    {/each}
    {#if unread}<UnreadNote {unread} />{/if}
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

  .needs-chip[data-tone='warning'] :global(svg) {
    color: var(--color-status-warning-text);
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

  /* Pressed by its ring, never a bolder label: wider words would move
     every chip after it. */
  .needs-chip[aria-pressed='true'] {
    border-color: var(--color-text);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-text);
    background: var(--color-surface-secondary);
  }

  .needs-chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
