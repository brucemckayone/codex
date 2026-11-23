<!--
  @component BrowseModule

  The "Browse everything" catalogue module, and the host of the org's topic
  selector (Codex-8swlj.4). From the top: the brand-chosen topic selector, the
  type tabs, a result head for the active topic, and one uniform 1:1 grid,
  newest-first. Each card's own design (video play glyph, audio waveform,
  article title-in-cover) makes its type legible, so there are no per-type
  rails.

  CONTROLLED component: it owns no filter state. `type` and `category` are
  props; every interaction calls `onTypeChange` / `onCategoryChange` and the
  owner feeds the new value back in (and mirrors it to `?type` / `?category`).

  THE SELECTOR SLOT. `topicStyle` (the brand's `topics-style`, already
  whitelisted by `resolveTopicsStyle`) picks TopicBar (One bar, the default and
  the fallback for anything unknown), TopicWindows or TopicChannels. All three
  share one contract: `{ topics, active, onSelect }`; Channels also takes the
  loaded `items` for its mini cards.

  FILTERING THAT IS CORRECT BEYOND THE LOADED CATALOGUE. The owner loads only
  the newest page of the catalogue (`items`), of `catalogueTotal` in all.
    - Complete catalogue (`catalogueTotal <= items.length`): filter here.
    - Truncated catalogue with a topic active: ask the server
      (`getPublicContent`, `TOPIC_PAGE_SIZE` rows). Until it answers, the grid
      shows the client subset; both lists are newest-first, so the swap only
      adds rows. Over `TOPIC_PAGE_SIZE`, a "See all N in Explore" link follows.
    - A FAILED read keeps the client subset and offers an inline Retry. It is
      judged by `current === undefined && error`, never by `loading`: a
      rejected kit query is `loading: false` with no value, which a loading
      gate would render as the empty state.
    - Only in the browser: the server render (a deep-linked `?category=`)
      shows the client subset and the client fetches the rest (plan §10).
  No polling: one read per (topic, type), and one per Retry press.

  @prop {BrowseItem[]} items - The loaded catalogue (all types), newest-first.
  @prop {TopicItem[]} topics - The org's curated topics, in curator order.
  @prop {TopicsStyle} topicStyle - Which topic selector to render.
  @prop {number} catalogueTotal - How many published pieces the org has in all.
  @prop {string} orgId - The org, for the server-backed topic filter.
  @prop {(row: PublicContentRow) => BrowseItem} toBrowseItem - Flattens a
    server row the same way the owner flattened `items`.
  @prop {BrowseType} type - Active type filter ('all' = no type narrowing).
  @prop {string | null} category - Active topic slug, or null when none.
  @prop {(type: BrowseType) => void} onTypeChange - Type-tab change.
  @prop {(slug: string | null) => void} onCategoryChange - Topic pick or clear.
-->
<script lang="ts">
  import type { TopicsStyle } from '@codex/validation';
  import { browser } from '$app/environment';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { getPublicContent } from '$lib/remote/content.remote';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import * as m from '$paraglide/messages';
  import type {
    BrowseItem,
    BrowseType,
    PublicContentRow,
  } from './browse-module.types';
  import TopicBar from './topics/TopicBar.svelte';
  import TopicChannels from './topics/TopicChannels.svelte';
  import TopicWindows from './topics/TopicWindows.svelte';

  interface Props {
    items: BrowseItem[];
    topics: TopicItem[];
    topicStyle: TopicsStyle;
    catalogueTotal: number;
    orgId: string;
    toBrowseItem: (row: PublicContentRow) => BrowseItem;
    type: BrowseType;
    category: string | null;
    onTypeChange: (type: BrowseType) => void;
    onCategoryChange: (slug: string | null) => void;
  }

  const {
    items,
    topics,
    topicStyle,
    catalogueTotal,
    orgId,
    toBrowseItem,
    type,
    category,
    onTypeChange,
    onCategoryChange,
  }: Props = $props();

  /** Rows the server-backed topic filter asks for. */
  const TOPIC_PAGE_SIZE = 24;

  /** Per-instance id base so multiple modules never collide on tab/panel ids. */
  const uid = $props.id();

  // The type tabs. Plural labels match the rail headings + the WP task spec.
  const TYPE_TABS: { value: BrowseType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'video', label: 'Videos' },
    { value: 'audio', label: 'Audio' },
    { value: 'article', label: 'Articles' },
  ];

  // Anything but the two other styles is the default One bar, so a value that
  // slipped past the reader's whitelist still renders a working selector.
  const selector = $derived<TopicsStyle>(
    topicStyle === 'windows' || topicStyle === 'channels' ? topicStyle : 'bar'
  );

  // The API's vocabulary: articles are stored as 'written'; 'all' sends none.
  const apiType = $derived(
    type === 'all' ? undefined : type === 'article' ? 'written' : type
  );

  // Every loaded item matching the active type AND the active topic, in the
  // owner's (newest-first) order.
  const clientSubset = $derived(
    items.filter(
      (i) =>
        (type === 'all' || i.contentType === type) &&
        (!category || (i.categorySlugs?.includes(category) ?? false))
    )
  );

  const catalogueComplete = $derived(catalogueTotal <= items.length);

  const topicQuery = $derived(
    browser && category && !catalogueComplete
      ? getPublicContent({
          orgId,
          category,
          contentType: apiType,
          limit: TOPIC_PAGE_SIZE,
        })
      : null
  );
  const serverPage = $derived(topicQuery?.current);
  const topicLoadFailed = $derived(
    topicQuery !== null &&
      serverPage === undefined &&
      queryErrorMessage(topicQuery.error) !== null
  );
  const topicLoading = $derived(
    topicQuery !== null && serverPage === undefined && !topicLoadFailed
  );

  const shown = $derived(
    serverPage ? serverPage.items.map(toBrowseItem) : clientSubset
  );

  const activeTopic = $derived(
    category ? topics.find((t) => t.slug === category) : undefined
  );
  // Never blank: before the streamed topics arrive, the raw slug stands in.
  const activeTopicName = $derived(activeTopic?.name ?? category);

  // The head's count is the number of pieces that match, so it is shown only
  // when it is exact: the whole subset of a complete catalogue, the server's
  // total, or (until the server answers) the topic's own count when no type
  // narrows it. A missing count is hidden, never shown as 0.
  const resultCount = $derived.by<number | null>(() => {
    if (catalogueComplete) return clientSubset.length;
    if (serverPage) return serverPage.pagination.total;
    return type === 'all' ? (activeTopic?.contentCount ?? null) : null;
  });

  const seeAllCount = $derived(
    serverPage && serverPage.pagination.total > TOPIC_PAGE_SIZE
      ? serverPage.pagination.total
      : null
  );

  const exploreHref = $derived.by(() => {
    if (!category) return '/explore';
    const params = new URLSearchParams({ category });
    if (apiType) params.set('type', apiType);
    return `/explore?${params}`;
  });

  // Empty state surfaces a message rather than a silent blank grid. The copy
  // differs by cause: nothing published yet (no filter active) vs. nothing
  // matching the current type/topic filter.
  const isFiltering = $derived(type !== 'all' || !!category);
  const emptyMessage = $derived(
    isFiltering
      ? 'No matching content. Try a different filter.'
      : 'No content yet.'
  );

  /**
   * Read the topic again after a failure. A query whose FIRST read failed is
   * dropped from kit's cache, so this re-runs `topicQuery` and the module is
   * handed a new query, still loading; everything above reads the query it
   * holds, never the orphan this promise belongs to.
   */
  function retryTopic() {
    topicQuery?.refresh().catch(() => {});
  }

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
    titleInCover
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
  {#if topics.length > 0}
    <!-- A full-width block for every style (see the CSS), except One bar's
         `display: contents`. -->
    <div class="browse__topics" data-topic-style={selector}>
      {#if selector === 'windows'}
        <TopicWindows {topics} active={category} onSelect={onCategoryChange} />
      {:else if selector === 'channels'}
        <TopicChannels
          {topics}
          {items}
          active={category}
          onSelect={onCategoryChange}
        />
      {:else}
        <TopicBar {topics} active={category} onSelect={onCategoryChange} />
      {/if}
    </div>
  {/if}

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
  </div>

  <!-- The panel is intentionally NOT `tabindex="0"`: per the WAI-ARIA APG a
       tabpanel is only made focusable when it has no focusable content, and
       this one always holds focusable children (card links, the head's
       controls). -->
  <div
    class="browse__body"
    role="tabpanel"
    id={`${uid}-panel`}
    aria-labelledby={`${uid}-tab-${type}`}
  >
    {#if activeTopicName}
      <div class="browse__head">
        <h3 class="browse__head-name">{activeTopicName}</h3>
        {#if resultCount !== null}
          <span class="browse__head-count">
            {resultCount === 1
              ? m.browse_topic_count_one()
              : m.browse_topic_count_other({ count: resultCount })}
          </span>
        {/if}
        <button
          type="button"
          class="browse__head-clear"
          aria-label={m.browse_topic_clear_label({ name: activeTopicName })}
          onclick={() => onCategoryChange(null)}
        >
          {m.browse_topic_clear()} <span aria-hidden="true">✕</span>
        </button>
        <a class="browse__head-explore" href={exploreHref}>
          {m.browse_topic_open_explore()} <span aria-hidden="true">→</span>
        </a>
      </div>
    {/if}

    {#if topicLoadFailed}
      <div class="browse__notice">
        <p class="browse__notice-text" role="status">
          {m.browse_topic_load_failed()}
        </p>
        <button type="button" class="browse__notice-retry" onclick={retryTopic}>
          {m.browse_topic_retry()}
        </button>
      </div>
    {/if}

    {#if shown.length > 0}
      <div class="content-grid">
        {#each shown as item (item.id)}
          {@render browseCard(item, '1:1')}
        {/each}
      </div>
    {:else if topicLoading}
      <!-- Nothing loaded matches yet, and the server has not answered: an
           empty-state here would claim the topic is empty before it knows. -->
      <p class="browse__status" role="status">{m.browse_topic_loading()}</p>
    {:else if !topicLoadFailed}
      <p class="browse__empty">{emptyMessage}</p>
    {/if}

    {#if seeAllCount !== null}
      <a class="browse__see-all" href={exploreHref}>
        {m.browse_topic_see_all({ count: seeAllCount })}
        <span aria-hidden="true">→</span>
      </a>
    {/if}
  </div>
</div>

<style>
  .browse {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  /* The selector slot is a full-width block: Windows and Channels size
     themselves with container queries (`container-type: inline-size`), which
     collapse to zero width in a shrink-to-fit parent. */
  .browse__topics {
    display: block;
    inline-size: 100%;
  }

  /* One bar is sticky, and a sticky box only travels inside its parent: in a
     wrapper its own height it would never stick. `contents` drops the wrapper
     so the bar sticks within the whole module. */
  .browse__topics[data-topic-style='bar'] {
    display: contents;
  }

  /* Filter bar — the segmented type tabs. Top border + padding echoes the
     mockup's `.filterbar` rhythm. */
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

  .browse__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Result head: the active topic's name, its count, Clear and the Explore
     link, baseline-aligned on one wrapping row. */
  .browse__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .browse__head-name {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    line-height: var(--leading-tight);
    color: var(--color-text);
  }

  /* `--color-text-secondary`, not tertiary: tertiary's lightness clamp sits
     near 3.5:1 on light org grounds (see FilterDrawer's heading note). */
  .browse__head-count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .browse__head-clear,
  .browse__notice-retry {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--space-8);
    font: inherit;
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .browse__head-clear:hover,
  .browse__notice-retry:hover {
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }

  .browse__head-explore,
  .browse__see-all {
    font-size: var(--text-sm);
    color: var(--color-link);
    text-decoration: none;
  }

  .browse__head-explore:hover,
  .browse__see-all:hover {
    text-decoration: underline;
  }

  .browse__head-clear:focus-visible,
  .browse__notice-retry:focus-visible,
  .browse__head-explore:focus-visible,
  .browse__see-all:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .browse__see-all {
    align-self: center;
  }

  .browse__notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .browse__notice-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .browse__empty,
  .browse__status {
    margin: 0;
    padding: var(--space-8) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
