<!--
  @component ContentStatusTabs

  The content list's status filter: All, Drafts, Published, Archived
  (Codex-a6ofh.2.6). Both studios' lists share it; the page owns the
  address (`?status=`) and moves when one is chosen. A filter, not tabs:
  pressed buttons in a group, each one press away.

  @prop {ContentStatusFilter} selected - The status shown
  @prop {(status: ContentStatusFilter) => void} onChange - One was chosen
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import type { ContentStatusFilter } from './content-status';

  interface Props {
    selected: ContentStatusFilter;
    onChange: (status: ContentStatusFilter) => void;
  }

  const { selected, onChange }: Props = $props();

  const FILTERS: { value: ContentStatusFilter; label: () => string }[] = [
    { value: 'all', label: m.studio_content_filter_all },
    { value: 'draft', label: m.studio_content_filter_draft },
    { value: 'published', label: m.studio_content_filter_published },
    { value: 'archived', label: m.studio_content_filter_archived },
  ];
</script>

<div class="status-tabs" role="group" aria-label={m.studio_content_filter_label()}>
  {#each FILTERS as filter (filter.value)}
    <button
      type="button"
      class="status-tab"
      aria-pressed={selected === filter.value}
      data-status={filter.value}
      onclick={() => onChange(filter.value)}
    >
      {filter.label()}
    </button>
  {/each}
</div>

<style>
  .status-tabs {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
  }

  .status-tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    /* Root tokens only: the personal studio renders outside the org's brand scope. */
    padding: calc(var(--space-1) + var(--space-0-5)) var(--space-3);
    border-radius: var(--radius-full);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .status-tab:hover {
    color: var(--color-text-secondary);
  }

  .status-tab[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .status-tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
