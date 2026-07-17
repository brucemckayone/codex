<!--
  @component BrowseModule

  The hybrid "Browse everything" catalogue module (WP-10). A filter bar (type
  tabs + a clearable active-topic chip) sits over a body that switches shape:

    UNFILTERED (type='all' AND no category)  → per-TYPE RAILS
      Videos (16:9), Audio (1:1), Articles (1:1); an empty rail is omitted.
    FILTERED (type≠'all' OR a category set)  → a single 1:1 catalogue GRID
      of the items matching BOTH the active type and the active topic.

  CONTROLLED component — it owns no filter state. `type` and `category` are
  props; every interaction calls `onTypeChange` / `onCategoryChange` and the
  owner (WP-11) feeds the new value back in. This makes the whole module a pure
  function of its props: filtering and the rails↔grid decision are `$derived`,
  so the same inputs always render the same output (and SSR renders the correct
  initial view for a deep-linked `?type`/`?category`).

  Reuses `ContentCard` (WP-7) with the per-section shape + `chrome='transparent'`
  and `Carousel` (the arrow rail) for each type rail. No observers, no lifecycle:
  the only browser-only behaviour lives inside those children, so this component
  is SSR-safe by construction.

  @prop {BrowseItem[]} items - The full catalogue to browse (all types).
  @prop {BrowseCategory[]} categories - Curated topics; used to resolve the
    active category slug to its display name for the chip.
  @prop {BrowseType} type - Active type filter ('all' = no type narrowing).
  @prop {string | null} category - Active topic slug, or null when none.
  @prop {(type: BrowseType) => void} onTypeChange - Type-tab / rail "view all".
  @prop {(slug: string | null) => void} onCategoryChange - Chip clear (null).
-->
<script lang="ts">
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import type {
    BrowseCategory,
    BrowseItem,
    BrowseType,
  } from './browse-module.types';

  interface Props {
    items: BrowseItem[];
    categories: BrowseCategory[];
    type: BrowseType;
    category: string | null;
    onTypeChange: (type: BrowseType) => void;
    onCategoryChange: (slug: string | null) => void;
  }

  const {
    items,
    categories,
    type,
    category,
    onTypeChange,
    onCategoryChange,
  }: Props = $props();

  /** Per-instance id base so multiple modules never collide on tab/panel ids. */
  const uid = $props.id();

  // The type tabs. Plural labels match the rail headings + the WP task spec.
  const TYPE_TABS: { value: BrowseType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'video', label: 'Videos' },
    { value: 'audio', label: 'Audio' },
    { value: 'article', label: 'Articles' },
  ];

  // Rails show only in the fully-unfiltered state; any active filter → grid.
  const showRails = $derived(type === 'all' && !category);

  // Grid contents: items matching the active type AND the active topic.
  const filtered = $derived(
    items.filter(
      (i) =>
        (type === 'all' || i.contentType === type) &&
        (!category || (i.categorySlugs?.includes(category) ?? false))
    )
  );

  // Rails render from the full item set grouped by type. They are only visible
  // when no filter is active, so no per-rail filtering is needed here. Each
  // rail carries the shape its section reads in (video 16:9, audio/article 1:1)
  // and an empty rail is dropped so the section never shows a bare heading.
  const rails = $derived(
    (
      [
        { type: 'video', label: 'Videos', shape: '16:9' },
        { type: 'audio', label: 'Audio', shape: '1:1' },
        { type: 'article', label: 'Articles', shape: '1:1' },
      ] as const
    )
      .map((rail) => ({
        ...rail,
        items: items.filter((i) => i.contentType === rail.type),
      }))
      .filter((rail) => rail.items.length > 0)
  );

  // Resolve the active slug to its curator name for the chip; fall back to the
  // raw slug if the category list hasn't loaded a match (defensive, never blank).
  const activeCategoryName = $derived(
    category
      ? (categories.find((c) => c.slug === category)?.name ?? category)
      : null
  );

  // Body is empty either way when there's nothing to show — an empty catalogue
  // (unfiltered, no rails) and a filter that matches nothing both surface a
  // message rather than a silent blank div. The copy differs so the reason is
  // clear: nothing published yet vs. nothing matching the current filter.
  const isEmpty = $derived(showRails ? rails.length === 0 : filtered.length === 0);
  const emptyMessage = $derived(
    showRails
      ? 'No content yet.'
      : 'No matching content. Try a different filter.'
  );

  let tablistEl = $state<HTMLDivElement | null>(null);

  function focusTab(index: number) {
    tablistEl
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [index]?.focus();
  }

  // Standard WAI-ARIA tabs keyboard model: arrows move + activate (automatic
  // activation), Home/End jump to the ends, and focus wraps.
  function onTabKeydown(event: KeyboardEvent, index: number) {
    const last = TYPE_TABS.length - 1;
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    onTypeChange(TYPE_TABS[next].value);
    focusTab(next);
  }
</script>

{#snippet browseCard(item: BrowseItem, shape: '16:9' | '1:1')}
  <ContentCard
    variant="grid"
    {shape}
    chrome="transparent"
    id={item.id}
    title={item.title}
    href={item.href}
    thumbnail={item.thumbnail}
    description={item.description}
    contentType={item.contentType}
    duration={item.duration}
    creator={item.creator}
    price={item.price}
    category={item.category}
    featured={item.featured}
    contentAccessType={item.contentAccessType}
    included={item.included}
    isFollower={item.isFollower}
    tierName={item.tierName}
  />
{/snippet}

<div class="browse">
  <div class="browse__filterbar">
    <div
      class="browse__tabs"
      role="tablist"
      aria-label="Filter by content type"
      bind:this={tablistEl}
    >
      {#each TYPE_TABS as tab, i (tab.value)}
        <button
          type="button"
          role="tab"
          id={`${uid}-tab-${tab.value}`}
          class="browse__tab"
          aria-selected={type === tab.value}
          aria-controls={`${uid}-panel`}
          tabindex={type === tab.value ? 0 : -1}
          onclick={() => onTypeChange(tab.value)}
          onkeydown={(e) => onTabKeydown(e, i)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    {#if activeCategoryName}
      <div class="browse__chips">
        <button
          type="button"
          class="browse__chip"
          aria-current="true"
          aria-label={`Clear topic filter: ${activeCategoryName}`}
          onclick={() => onCategoryChange(null)}
        >
          <span class="browse__chip-label">{activeCategoryName}</span>
          <span class="browse__chip-x" aria-hidden="true">✕</span>
        </button>
      </div>
    {/if}
  </div>

  <!-- The panel is intentionally NOT `tabindex="0"`: per the WAI-ARIA APG a
       tabpanel is only made focusable when it has no focusable content, and
       this one always holds focusable children (card links, rail "View all",
       carousel arrows). -->
  <div
    class="browse__body"
    role="tabpanel"
    id={`${uid}-panel`}
    aria-labelledby={`${uid}-tab-${type}`}
  >
    {#if isEmpty}
      <p class="browse__empty">{emptyMessage}</p>
    {:else if showRails}
      <div class="browse__rails">
        {#each rails as rail (rail.type)}
          <div class="browse__rail">
            <div class="browse__rail-head">
              <h3 class="browse__rail-title">{rail.label}</h3>
              <button
                type="button"
                class="browse__rail-viewall"
                onclick={() => onTypeChange(rail.type)}
              >
                View all &rarr;
              </button>
            </div>
            <Carousel items={rail.items} ariaLabel={rail.label}>
              {#snippet renderItem(item)}
                {@render browseCard(item, rail.shape)}
              {/snippet}
            </Carousel>
          </div>
        {/each}
      </div>
    {:else}
      <div class="content-grid">
        {#each filtered as item (item.id)}
          {@render browseCard(item, '1:1')}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .browse {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  /* Filter bar — segmented type tabs on the left, active-topic chip beside them.
     Top border + padding echoes the mockup's `.filterbar` rhythm. */
  .browse__filterbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding-top: var(--space-6);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  /* Segmented control. No `overflow: hidden` (unlike the mockup) so an inner
     tab's focus ring is never clipped — the container pads instead and each
     tab rounds itself. */
  .browse__tabs {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
  }

  .browse__tab {
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .browse__tab:hover {
    color: var(--color-text-primary);
  }

  .browse__tab[aria-selected='true'] {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .browse__tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .browse__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* The chip only appears when a topic is active, so it is always the "current"
     filter — brand-filled, with a decorative ✕ and an accessible clear action. */
  .browse__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
    font: inherit;
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-4);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .browse__chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .browse__chip-x {
    font-size: var(--text-xs);
    line-height: 1;
  }

  .browse__rails {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
  }

  .browse__rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .browse__rail-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .browse__rail-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
  }

  /* Rendered as a button (not an anchor): it narrows the type filter via the
     controlled `onTypeChange` contract — there is no URL to link to here (WP-11
     owns URL sync). Styled to read as the mockup's `.lede__link`. */
  .browse__rail-viewall {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .browse__rail-viewall:hover {
    color: var(--color-interactive-hover);
  }

  .browse__rail-viewall:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .browse__empty {
    margin: 0;
    padding: var(--space-8) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
