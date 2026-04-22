<!--
  @component ContentFeatureSlab

  Editorial hero slab for the most-recently-touched item on the content
  list. Takes the visual oxygen the old generic-table first row lacked:
  16:9 hero thumbnail on the left, numbered "01" ordinal and narrative
  metadata on the right, plus primary actions.

  Only rendered on page 1 with no search active — a true feature tile,
  not a repeating row. Falls back to a branded placeholder when the
  item has no thumbnail.

  @prop item  The content item to feature (usually items[0])
  @prop publishing    Whether publish toggle is in flight
  @prop onPublishToggle
-->
<script lang="ts">
  import type { ContentWithRelations } from '$lib/types';
  import {
    FilmIcon,
    MusicIcon,
    FileTextIcon,
    EditIcon,
  } from '$lib/components/ui/Icon';
  import Spinner from '$lib/components/ui/Feedback/Spinner/Spinner.svelte';
  import { formatRelativeTime } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    item: ContentWithRelations;
    publishing?: boolean;
    onPublishToggle: () => void;
  }

  const { item, publishing = false, onPublishToggle }: Props = $props();

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

  const statusMeta = $derived.by(() => {
    switch (item.status) {
      case 'published':
        return { label: m.studio_content_status_published(), variant: 'published' as const };
      case 'archived':
        return { label: m.studio_content_status_archived(), variant: 'archived' as const };
      default:
        return { label: m.studio_content_status_draft(), variant: 'draft' as const };
    }
  });

  // TODO i18n — studio_content_slab_eyebrow = "Featured · Most recent"
  const eyebrow = 'Featured';

  // TODO i18n — studio_content_updated_prefix = "Updated"
  const updatedLabel = $derived(`Updated ${formatRelativeTime(item.updatedAt)}`);

  // Narrative strapline — "4-word strap or description fallback"
  const strap = $derived(
    item.description && item.description.trim().length > 0
      ? item.description.slice(0, 160)
      : // TODO i18n — studio_content_slab_no_desc = "No description yet — add one so it reads well in search and share cards."
        'No description yet — add one so it reads well in search and share cards.'
  );
</script>

<article class="slab" data-status={statusMeta.variant}>
  <a class="slab-thumb" href="/studio/content/{item.id}/edit" aria-label="Open {item.title}">
    {#if item.thumbnailUrl}
      <img src={item.thumbnailUrl} alt="" class="thumb-img" loading="lazy" />
    {:else}
      <span class="thumb-placeholder" aria-hidden="true">
        <typeMeta.icon size={36} />
      </span>
    {/if}
    <span class="thumb-type-chip" aria-hidden="true">
      <typeMeta.icon size={14} />
      <span>{typeMeta.label}</span>
    </span>
  </a>

  <div class="slab-body">
    <header class="slab-header">
      <span class="slab-ordinal" aria-hidden="true">01</span>
      <span class="slab-eyebrow">{eyebrow}</span>
      <span class="slab-status-pill" data-status={statusMeta.variant}>
        <span class="slab-status-dot" aria-hidden="true"></span>
        {statusMeta.label}
      </span>
    </header>

    <h2 class="slab-title">
      <a href="/studio/content/{item.id}/edit" class="slab-title-link">
        {item.title}
      </a>
    </h2>

    <p class="slab-strap">{strap}</p>

    <dl class="slab-meta">
      <div class="meta-item">
        <dt class="meta-label">Updated</dt>
        <dd class="meta-value">{updatedLabel.replace(/^Updated /, '')}</dd>
      </div>
      {#if item.category}
        <div class="meta-item">
          <dt class="meta-label">Category</dt>
          <dd class="meta-value">{item.category}</dd>
        </div>
      {/if}
      <div class="meta-item">
        <dt class="meta-label">Access</dt>
        <dd class="meta-value meta-access" data-access={item.accessType}>
          {item.accessType}
        </dd>
      </div>
    </dl>

    <div class="slab-actions">
      <button
        type="button"
        class="action-btn"
        data-tone={statusMeta.variant === 'published' ? 'muted' : 'primary'}
        disabled={publishing}
        onclick={onPublishToggle}
      >
        {#if publishing}
          <Spinner size="sm" />
        {:else if statusMeta.variant === 'published'}
          {m.studio_content_form_unpublish()}
        {:else}
          {m.studio_content_form_publish()}
        {/if}
      </button>
      <a class="action-link" href="/studio/content/{item.id}/edit">
        <EditIcon size={14} />
        {m.studio_content_edit()}
      </a>
    </div>
  </div>
</article>

<style>
  .slab {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--space-6);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background:
      radial-gradient(
        140% 90% at 100% 0%,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 6%, transparent),
        transparent 60%
      ),
      var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    position: relative;
    overflow: hidden;
  }

  @media (--below-md) {
    .slab {
      grid-template-columns: 1fr;
      gap: var(--space-4);
      padding: var(--space-4);
    }
  }

  /* ── Thumbnail ──────────────────────────────────────────── */
  .slab-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 20%, var(--color-surface-secondary)),
        var(--color-surface-secondary)
      );
    text-decoration: none;
    transition:
      transform var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
    box-shadow:
      0 var(--space-1) var(--space-3) color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  .slab-thumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .slab-thumb:hover {
      transform: translateY(-2px);
      box-shadow:
        0 var(--space-2) var(--space-6) color-mix(in srgb, var(--color-text) 10%, transparent);
    }
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
    color: color-mix(in srgb, var(--color-brand-primary, var(--color-interactive)) 60%, var(--color-text-muted));
  }

  .thumb-type-chip {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2-5);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text);
    background: color-mix(in srgb, var(--color-surface) 86%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
  }

  /* ── Body ───────────────────────────────────────────────── */
  .slab-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .slab-header {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .slab-ordinal {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    line-height: var(--leading-none);
    padding-right: var(--space-3);
    border-right: var(--border-width) var(--border-style) var(--color-border);
  }

  .slab-eyebrow {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-brand-primary, var(--color-interactive));
  }

  .slab-status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-0-5) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .slab-status-dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full, 9999px);
    background-color: currentColor;
  }

  .slab-status-pill[data-status='published'] {
    color: var(--color-success-700);
    background: var(--color-success-50);
    border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .slab-status-pill[data-status='draft'] {
    color: var(--color-warning-700);
    background: var(--color-warning-50);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
  }

  /* ── Title + strap ──────────────────────────────────────── */
  .slab-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: clamp(var(--text-xl), 1.6vw + 1rem, var(--text-3xl));
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
    color: var(--color-text);
  }

  .slab-title-link {
    color: inherit;
    text-decoration: none;
    background-image: linear-gradient(
      currentColor,
      currentColor
    );
    background-repeat: no-repeat;
    background-size: 0% 1px;
    background-position: 0 100%;
    transition: background-size var(--duration-normal) var(--ease-out);
  }

  .slab-title-link:hover {
    background-size: 100% 1px;
    color: var(--color-interactive);
  }

  .slab-title-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .slab-strap {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Meta row ───────────────────────────────────────────── */
  .slab-meta {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .meta-label {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .meta-value {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    text-transform: capitalize;
  }

  .meta-access[data-access='paid'] { color: var(--color-brand-primary, var(--color-interactive)); }
  .meta-access[data-access='subscribers'] { color: var(--color-brand-primary, var(--color-interactive)); }

  /* ── Actions ────────────────────────────────────────────── */
  .slab-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: calc(var(--space-8) + var(--space-1));
    padding: 0 var(--space-4);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out);
  }

  .action-btn[data-tone='primary'] {
    background: var(--color-success);
    color: var(--color-text-inverse, var(--color-surface));
    border-color: var(--color-success);
  }

  .action-btn[data-tone='primary']:hover:not(:disabled) {
    background: var(--color-success-600);
    border-color: var(--color-success-600);
  }

  .action-btn[data-tone='muted'] {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .action-btn[data-tone='muted']:hover:not(:disabled) {
    background: var(--color-surface-secondary);
    color: var(--color-text);
    border-color: var(--color-text-secondary);
  }

  .action-btn:disabled {
    opacity: var(--opacity-60, 0.6);
    cursor: not-allowed;
  }

  .action-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .action-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: calc(var(--space-8) + var(--space-1));
    padding: 0 var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    border-radius: var(--radius-full, 9999px);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .action-link:hover {
    background-color: var(--color-interactive-subtle);
  }

  .action-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
