<!--
  @component CategoryList

  Presentational list of an org's topic categories for the studio management
  page. Pure props + callbacks — NO remote imports — so it renders and is unit
  testable in isolation (the page owns the remote data and the create/edit/cover
  forms, which now live in a sibling inspector pane rather than inline).

  Row anatomy, left to right: the reorder column (accessible up/down around the
  1-based position), then the row SELECTOR — a single button carrying the cover
  thumb, name, slug and blurb, which loads the topic into the inspector — then
  delete. The selector is a real `<button>` rather than a click handler on the
  `<li>` so the row is keyboard reachable and announces its selected state via
  `aria-pressed`; reorder and delete sit OUTSIDE it, because nesting interactive
  elements inside a button is invalid and unreachable by keyboard.

  The thumb repeats the public topic card's 16:9 plate shape, and falls back to
  the topic's initial — never to the `categories.icon` emoji, which the public
  card no longer renders (an emoji is drawn by the platform's colour-emoji font
  and answers to no design token).

  Renders an empty state when there are no categories.
-->
<script lang="ts">
  import type { StudioCategory } from '$lib/remote/categories.types';
  import { Button, EmptyState } from '$lib/components/ui';
  import {
    ChevronDownIcon,
    ChevronUpIcon,
    ImageIcon,
    TagIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';

  interface Props {
    categories: StudioCategory[];
    /** Id of the row loaded in the inspector (drives the selected state). */
    activeId?: string | null;
    /** Disables reorder controls while a reorder request is in flight. */
    reorderPending?: boolean;
    /** Resolves a session cover URL for a row (null → initial/placeholder). */
    coverUrlFor?: (cat: StudioCategory) => string | null;
    /** Load this topic into the inspector. */
    onselect: (cat: StudioCategory) => void;
    ondelete: (cat: StudioCategory) => void;
    /** Move the row at `index` by `dir` (-1 up, +1 down). */
    onmove: (index: number, dir: -1 | 1) => void;
  }

  const {
    categories,
    activeId = null,
    reorderPending = false,
    coverUrlFor,
    onselect,
    ondelete,
    onmove,
  }: Props = $props();

  // Session upload URL (freshest) wins over the persisted list URL.
  function coverUrl(cat: StudioCategory): string | null {
    return coverUrlFor?.(cat) ?? cat.coverImageUrl ?? null;
  }

  // "Cover set" badge only when a cover exists but can't be rendered (no
  // resolved URL — e.g. no CDN base configured). When the URL resolves, the
  // tile shows the image instead.
  function coverUnavailable(cat: StudioCategory): boolean {
    return Boolean(cat.coverImageKey) && !coverUrl(cat);
  }

  /** Typographic stand-in on a coverless row — mirrors the public card's mark. */
  function initial(cat: StudioCategory): string {
    return cat.name.trim().charAt(0).toUpperCase();
  }
</script>

{#if categories.length === 0}
  <EmptyState
    icon={TagIcon}
    title="No topics yet"
    description="Name your first topic in the New topic panel. Topics become the Browse by topic rail on your landing page."
  />
{:else}
  <ul class="category-list" role="list">
    {#each categories as cat, index (cat.id)}
      {@const isActive = activeId === cat.id}
      <li class="category-row" class:category-row--active={isActive}>
        <!-- Reorder (accessible up/down around the 1-based position) -->
        <div class="reorder-controls">
          <button
            type="button"
            class="icon-button"
            aria-label="Move {cat.name} up"
            onclick={() => onmove(index, -1)}
            disabled={index === 0 || reorderPending}
          >
            <ChevronUpIcon size={14} />
          </button>
          <span class="order-index" aria-hidden="true">{index + 1}</span>
          <button
            type="button"
            class="icon-button"
            aria-label="Move {cat.name} down"
            onclick={() => onmove(index, 1)}
            disabled={index === categories.length - 1 || reorderPending}
          >
            <ChevronDownIcon size={14} />
          </button>
        </div>

        <!-- Row selector: the whole info block is one button -->
        <button
          type="button"
          class="category-select"
          aria-pressed={isActive}
          onclick={() => onselect(cat)}
        >
          <span class="cover-tile">
            {#if coverUrl(cat)}
              <img src={coverUrl(cat)} alt="" class="cover-image" />
            {:else if initial(cat)}
              <span class="cover-initial" aria-hidden="true">{initial(cat)}</span>
            {:else}
              <ImageIcon size={18} />
            {/if}
          </span>

          <span class="category-meta">
            <span class="category-name">{cat.name}</span>
            <span class="category-sub">
              <span class="category-slug">/{cat.slug}</span>
              {#if coverUnavailable(cat)}
                <span class="category-badge">Cover set</span>
              {:else if !coverUrl(cat)}
                <span class="category-badge category-badge--warn">No cover</span>
              {/if}
            </span>
            {#if cat.description}
              <span class="category-description">{cat.description}</span>
            {:else}
              <span class="category-description category-description--empty">
                No blurb yet
              </span>
            {/if}
          </span>
        </button>

        <div class="row-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete {cat.name}"
            onclick={() => ondelete(cat)}
          >
            <TrashIcon size={16} />
          </Button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .category-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .category-row {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    padding-right: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .category-row:hover {
    border-color: var(--color-border-strong);
  }

  /* Selected row: a brand ring plus a thicker inset left edge, so the
     inspector's subject is unambiguous while scanning a long list. */
  .category-row--active {
    border-color: var(--color-interactive);
    box-shadow: inset var(--space-0-5) 0 0 0 var(--color-interactive);
  }

  /* ── Reorder column ── */
  .reorder-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-0-5);
    flex-shrink: 0;
    padding-left: var(--space-2);
  }

  .order-index {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .icon-button:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .icon-button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
  }

  .icon-button:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  /* ── Row selector ── */
  .category-select {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) 0;
    border: none;
    background: transparent;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
    border-radius: var(--radius-md);
  }

  .category-select:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset-inset);
  }

  .cover-tile {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /* Repeats the public topic plate's 16:9 shape, so the thumb previews the
       real crop rather than a square that lies about it. Keep these in step —
       if TopicCard's aspect-ratio changes, this must follow or the studio
       shows a crop the landing page never renders. */
    width: var(--space-20);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface-secondary);
    overflow: hidden;
    color: var(--color-text-muted);
  }

  .cover-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-initial {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    line-height: var(--leading-none);
    color: var(--color-text-muted);
  }

  .category-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    flex: 1;
  }

  .category-name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .category-sub {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .category-slug {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono, monospace);
  }

  .category-badge {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    white-space: nowrap;
  }

  /* A coverless topic still renders (the card paints its brand gradient), so
     this is guidance, not an error state. */
  .category-badge--warn {
    color: var(--color-text-muted);
  }

  .category-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category-description--empty {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .row-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
</style>
