<!--
  @component CategoryList

  Presentational list of an org's topic categories for the studio management
  page. Pure props + callbacks — NO remote imports — so it renders and is unit
  testable in isolation (the page owns the remote data + the create/edit/cover
  forms, passing the per-row edit panel in as a snippet).

  Renders an empty state when there are no categories, otherwise a row per
  category with: cover thumb (or glyph/placeholder), name, slug, a "cover set"
  badge, optional description, an accessible up/down reorder control, and
  Edit/Delete actions. When `activeId` matches a row and an `editPanel` snippet
  is supplied, the panel renders inline beneath that row.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
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
    /** Id of the row currently being edited (renders `editPanel` inline). */
    activeId?: string | null;
    /** Disables reorder controls while a reorder request is in flight. */
    reorderPending?: boolean;
    /** Resolves a session cover URL for a row (null → glyph/placeholder). */
    coverUrlFor?: (cat: StudioCategory) => string | null;
    onedit: (cat: StudioCategory) => void;
    ondelete: (cat: StudioCategory) => void;
    /** Move the row at `index` by `dir` (-1 up, +1 down). */
    onmove: (index: number, dir: -1 | 1) => void;
    /** Inline edit panel for the active row (owned by the page). */
    editPanel?: Snippet<[StudioCategory]>;
  }

  const {
    categories,
    activeId = null,
    reorderPending = false,
    coverUrlFor,
    onedit,
    ondelete,
    onmove,
    editPanel,
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
</script>

{#if categories.length === 0}
  <EmptyState
    icon={TagIcon}
    title="No categories yet"
    description="Create your first topic above to start organising your landing page."
  />
{:else}
  <ul class="category-list" role="list">
    {#each categories as cat, index (cat.id)}
      <li class="category-row" class:category-row--active={activeId === cat.id}>
        <div class="category-main">
          <!-- Cover / glyph tile -->
          <div class="cover-tile" aria-hidden="true">
            {#if coverUrl(cat)}
              <img src={coverUrl(cat)} alt="" class="cover-image" />
            {:else if cat.icon}
              <span class="cover-glyph">{cat.icon}</span>
            {:else}
              <ImageIcon size={20} class="cover-placeholder-icon" />
            {/if}
          </div>

          <div class="category-meta">
            <span class="category-name">{cat.name}</span>
            <span class="category-sub">
              <span class="category-slug">/{cat.slug}</span>
              {#if coverUnavailable(cat)}
                <span class="category-badge">Cover set</span>
              {/if}
            </span>
            {#if cat.description}
              <span class="category-description">{cat.description}</span>
            {/if}
          </div>

          <!-- Reorder (accessible up/down) -->
          <div class="reorder-controls">
            <button
              type="button"
              class="icon-button"
              aria-label="Move {cat.name} up"
              onclick={() => onmove(index, -1)}
              disabled={index === 0 || reorderPending}
            >
              <ChevronUpIcon size={16} />
            </button>
            <span class="order-index" aria-hidden="true">{index + 1}</span>
            <button
              type="button"
              class="icon-button"
              aria-label="Move {cat.name} down"
              onclick={() => onmove(index, 1)}
              disabled={index === categories.length - 1 || reorderPending}
            >
              <ChevronDownIcon size={16} />
            </button>
          </div>

          <!-- Row actions -->
          <div class="row-actions">
            <Button
              variant={activeId === cat.id ? 'ghost' : 'secondary'}
              size="sm"
              onclick={() => onedit(cat)}
            >
              {activeId === cat.id ? 'Close' : 'Edit'}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              aria-label="Delete {cat.name}"
              onclick={() => ondelete(cat)}
            >
              <TrashIcon size={16} />
            </Button>
          </div>
        </div>

        {#if activeId === cat.id && editPanel}
          {@render editPanel(cat)}
        {/if}
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
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .category-row--active {
    border-color: var(--color-border-focus, var(--color-interactive));
  }

  .category-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .cover-tile {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
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

  .cover-glyph {
    font-size: var(--text-xl);
    line-height: var(--leading-none);
  }

  .category-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    flex: 1;
  }

  .category-name {
    font-size: var(--text-sm);
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
  }

  .category-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reorder-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
    flex-shrink: 0;
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
    height: var(--space-6);
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

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
</style>
