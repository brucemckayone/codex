<!--
  @component ContentRow

  Numbered editorial row for the Studio content list. Each row gets a
  real 16:9 thumbnail (not a 32px avatar), a mono ordinal ("02", "03",
  …), a narrative title + metadata cluster, and inline status + actions.

  Designed to replace generic-SaaS table rows with a rhythm that matches
  ContentForm's FormSection + TodayStat editorial vocabulary.

  @prop ordinal  Two-digit zero-padded row number ("02"..)
  @prop item     The content item
  @prop publishing  Whether this item's publish toggle is in flight
  @prop onPublishToggle  Handler for publish toggle
-->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import {
    FilmIcon,
    MusicIcon,
    FileTextIcon,
    EditIcon,
    LockIcon,
  } from '$lib/components/ui/Icon';
  import Spinner from '$lib/components/ui/Feedback/Spinner/Spinner.svelte';
  import { formatRelativeTime } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    ordinal: string;
    item: ContentWithRelations;
    publishing?: boolean;
    onPublishToggle: () => void;
  }

  const { ordinal, item, publishing = false, onPublishToggle }: Props = $props();

  const typeMeta = $derived.by(() => {
    switch (item.contentType) {
      case 'video':
        return { label: m.content_type_video(), icon: FilmIcon };
      case 'audio':
        return { label: m.content_type_audio(), icon: MusicIcon };
      default:
        return { label: m.content_type_article(), icon: FileTextIcon };
    }
  });

  const statusVariant = $derived(
    item.status === 'published'
      ? 'published'
      : item.status === 'archived'
        ? 'archived'
        : 'draft'
  );

  const statusLabel = $derived.by(() => {
    switch (item.status) {
      case 'published':
        return m.studio_content_status_published();
      case 'archived':
        return m.studio_content_status_archived();
      default:
        return m.studio_content_status_draft();
    }
  });

  const isGated = $derived(
    item.accessType === 'paid' ||
      item.accessType === 'subscribers' ||
      item.accessType === 'followers' ||
      item.accessType === 'team'
  );
</script>

<article class="row" data-status={statusVariant}>
  <div class="row-thumb">
    {#if item.thumbnailUrl}
      <img src={item.thumbnailUrl} alt="" class="thumb-img" loading="lazy" />
    {:else}
      <span class="thumb-placeholder">
        <typeMeta.icon size={24} />
      </span>
    {/if}
    <span class="thumb-type" aria-hidden="true">
      <typeMeta.icon size={12} />
    </span>
  </div>

  <span class="row-ordinal" aria-hidden="true">{ordinal}</span>

  <div class="row-body">
    <h3 class="row-title">
      <a href="/studio/content/{item.id}/edit" class="row-title-link">
        {item.title}
      </a>
    </h3>
    <ul class="row-meta" aria-label="Item details">
      <li class="meta-chip">
        <typeMeta.icon size={12} />
        <span>{typeMeta.label}</span>
      </li>
      {#if item.category}
        <li class="meta-chip meta-chip--muted">{item.category}</li>
      {/if}
      <li class="meta-chip meta-chip--access" data-access={item.accessType}>
        {#if isGated}
          <LockIcon size={10} />
        {/if}
        <span>{item.accessType}</span>
      </li>
    </ul>
  </div>

  <div class="row-status">
    <span class="status-pill" data-status={statusVariant}>
      <span class="status-dot" aria-hidden="true"></span>
      {statusLabel}
    </span>
    <time class="row-date" datetime={new Date(item.updatedAt).toISOString()}>
      {formatRelativeTime(item.updatedAt)}
    </time>
  </div>

  <div class="row-actions">
    <button
      type="button"
      class="row-toggle"
      data-action={statusVariant === 'published' ? 'unpublish' : 'publish'}
      disabled={publishing}
      onclick={onPublishToggle}
    >
      {#if publishing}
        <Spinner size="sm" />
      {:else if statusVariant === 'published'}
        {m.studio_content_form_unpublish()}
      {:else}
        {m.studio_content_form_publish()}
      {/if}
    </button>
    <a href="/studio/content/{item.id}/edit" class="row-edit" aria-label="Edit {item.title}">
      <EditIcon size={14} />
      <span class="row-edit-label">{m.studio_content_edit()}</span>
    </a>
  </div>
</article>

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns:
      /* thumb */ minmax(9rem, 12rem)
      /* ordinal */ auto
      /* body */ minmax(0, 1fr)
      /* status */ auto
      /* actions */ auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    background-color: transparent;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  @media (prefers-reduced-motion: no-preference) {
    .row:hover { transform: translateX(var(--space-0-5)); }
  }

  .row:hover {
    background-color: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
    border-color: var(--color-border);
  }

  @media (--below-md) {
    .row {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'thumb body actions'
        'thumb status actions';
      row-gap: var(--space-2);
      column-gap: var(--space-3);
      align-items: start;
    }
    .row-thumb   { grid-area: thumb; width: 6rem; }
    .row-ordinal { display: none; }
    .row-body    { grid-area: body; align-self: end; }
    .row-status  { grid-area: status; align-self: start; }
    .row-actions { grid-area: actions; }
  }

  /* ── Thumbnail ──────────────────────────────────────────── */
  .row-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 14%, var(--color-surface-secondary)),
        var(--color-surface-secondary)
      );
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 55%, var(--color-text-muted));
  }

  .thumb-type {
    position: absolute;
    bottom: var(--space-1);
    right: var(--space-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full, 9999px);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
  }

  /* ── Ordinal ────────────────────────────────────────────── */
  .row-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    padding-right: var(--space-3);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    line-height: var(--leading-none);
  }

  .row:hover .row-ordinal { color: var(--color-text-secondary); }

  /* ── Body ───────────────────────────────────────────────── */
  .row-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .row-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-snug);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .row-title-link {
    color: inherit;
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-out);
  }

  /* Full-row click target — title link expands via ::after to cover the
     row. Single anchor, single focus target, no aria-hidden hack. The
     publish toggle button and edit link escape via position: relative +
     z-index above this overlay. */
  .row-title-link::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .row-title-link:hover { color: var(--color-interactive); }

  .row-title-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .row-meta {
    list-style: none;
    margin: 0;
    padding: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    flex-wrap: wrap;
    min-width: 0;
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-full, 9999px);
    text-transform: capitalize;
    white-space: nowrap;
  }

  .meta-chip--muted { background: transparent; color: var(--color-text-muted); }

  .meta-chip--access[data-access='free'] {
    color: var(--color-text-muted);
    background: transparent;
  }

  .meta-chip--access[data-access='paid'],
  .meta-chip--access[data-access='subscribers'] {
    color: var(--color-brand-primary, var(--color-interactive));
    background: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 10%, var(--color-surface));
  }

  /* ── Status ─────────────────────────────────────────────── */
  .row-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-0-5);
    min-width: 0;
  }

  @media (--below-md) {
    .row-status { align-items: flex-start; }
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .status-dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full, 9999px);
    background-color: currentColor;
  }

  .status-pill[data-status='published'] {
    color: var(--color-success-700);
    background: var(--color-success-50);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .status-pill[data-status='draft'] {
    color: var(--color-warning-700);
    background: var(--color-warning-50);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  }

  .status-pill[data-status='archived'] {
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
  }

  .row-date {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Actions ────────────────────────────────────────────── */
  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    /* Lift above .row-title-link::after so toggle and edit remain
       interactive over the row-wide click overlay. */
    position: relative;
    z-index: 2;
  }

  .row-toggle {
    appearance: none;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    padding: var(--space-1-5) var(--space-2-5);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    background: transparent;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
    white-space: nowrap;
  }

  .row-toggle[data-action='publish'] { color: var(--color-success-700); }
  .row-toggle[data-action='publish']:hover:not(:disabled) {
    background: var(--color-success-50);
  }

  .row-toggle[data-action='unpublish'] { color: var(--color-text-muted); }
  .row-toggle[data-action='unpublish']:hover:not(:disabled) {
    background: var(--color-surface-secondary);
    color: var(--color-warning-700);
  }

  .row-toggle:disabled { opacity: var(--opacity-60, 0.6); cursor: not-allowed; }

  .row-toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .row-edit {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2-5);
    border-radius: var(--radius-md);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-interactive);
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .row-edit:hover { background-color: var(--color-interactive-subtle); }

  .row-edit:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-sm) {
    .row-edit-label { display: none; }
    .row-edit { padding: var(--space-1-5); }
  }
</style>
