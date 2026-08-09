<!--
  @component OrgExplorePage

  Organization explore page: a Portals rail over a searchable, filterable
  content grid with category pills, sorting, filter chips and pagination.

  EVERY facet is URL-backed and server-applied — search, type, category, sort,
  featured, creator, page. Type and category used to filter client-side over
  whichever page of 12 items happened to be loaded, which undercounted (3 of 5
  videos on a 22-item org), made the pager lie, and was wiped by any sibling
  URL write. One source of truth removes all four failures and makes every
  filter combination shareable, bookmarkable and reload-safe.

  URL writes are BATCHED through `updateFilters` — see its comment for why.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { deriveContentAccessKind } from '$lib/utils/content-access';
  import { CreatorExploreBanner } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { getContentCollection, hydrateCollection, useLiveQuery } from '$lib/collections';
  import { filterContentItemsByOrg } from '$lib/content/filter-by-org';
  import { followingStore } from '$lib/client/following.svelte';
  import { buildContentUrl, buildJourneyUrl } from '$lib/utils/subdomain';
  import JourneyRailCard from '$lib/components/explore/JourneyRailCard.svelte';
  import type { CourseCardSummary } from '$lib/journeys/types';
  import type { ContentWithRelations } from '$lib/types';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import { applyFilterPatch } from '$lib/utils/filter-url';
  import { SearchXIcon, FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import { StickyToolbar } from '$lib/components/ui/StickyToolbar';
  import { SearchPill } from '$lib/components/ui/SearchPill';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import {
    ActiveFiltersStrip,
    type ActiveFilterChip,
  } from '$lib/components/ui/ActiveFiltersStrip';
  import { useAccessContext } from '$lib/utils/access-context.svelte';
  import { StructuredData } from '$lib/components/seo';
  import ExploreFilterDrawer from '$lib/components/explore/ExploreFilterDrawer.svelte';
  import type { PageData } from './$types';

  // The public content collection carries a transcoded `mediaItem.thumbnailUrl`
  // at runtime; the base `MediaItem` type omits it, so widen it locally for the
  // grid's display-thumbnail lookup (matches getDisplayThumbnail's contract).
  type ExploreItem = ContentWithRelations & {
    mediaItem?:
      | (NonNullable<ContentWithRelations['mediaItem']> & {
          thumbnailUrl?: string | null;
        })
      | null;
  };

  const { data }: { data: PageData } = $props();

  // Access context — tiers from server, subscription from client store (subscriptionCollection)
  const access = useAccessContext(() => ({
    subscriptionContext: data.subscriptionContext,
    isFollowing: followingStore.get(data.org.id),
    orgId: data.org.id,
  }));

  // The server load is the source of truth for /explore. Always overwrite
  // the org-scoped ['content', orgId] cache on mount with the SSR payload
  // so cross-org cache contamination cannot mask the org catalogue.
  onMount(() => {
    if (data.content?.items && data.org?.id) {
      hydrateCollection(
        { kind: 'content', orgId: data.org.id },
        data.content.items
      );
    }
  });

  // Re-hydrate when server data changes (search/sort/page navigation).
  // Compare a stable signature, not array identity: on initial mount the
  // array reference and `prevSignature` are both seeded from the same
  // `data.content?.items`, and reference equality would always be true
  // there — but signature equality correctly recognises *content* changes
  // when navigating between filter combinations.
  // Plain variable (not $state) — read as a comparison key, not a reactive
  // dependency. $state() would wrap in a Proxy, breaking the comparison.
  // svelte-ignore state_referenced_locally
  let prevSignature = signatureOf(data.content?.items);
  $effect(() => {
    const currentItems = data.content?.items;
    const currentSignature = signatureOf(currentItems);
    if (currentItems && currentSignature !== prevSignature && data.org?.id) {
      hydrateCollection(
        { kind: 'content', orgId: data.org.id },
        currentItems
      );
      prevSignature = currentSignature;
    }
  });

  function signatureOf(items: readonly unknown[] | undefined): string {
    if (!items || items.length === 0) return '';
    const first = (items[0] as { id?: string } | undefined)?.id ?? '';
    const last = (items[items.length - 1] as { id?: string } | undefined)?.id ?? '';
    return `${items.length}:${first}:${last}`;
  }

  // Org-scoped content collection — keyed ['content', orgId] so visiting
  // another org cannot return this org's cached data and vice versa.
  const orgContentCollection = $derived(
    data.org?.id ? getContentCollection(data.org.id) : undefined
  );

  // Reactive query over the org-scoped collection for client-side filtering.
  // Re-runs when the org changes (cross-subdomain navigation) — deps is an
  // array of getter functions, not a single getter returning an array.
  const contentQuery = useLiveQuery(
    (q) => q.from({ item: orgContentCollection }),
    [() => data.org?.id],
    // ssrData is only read for the initial SSR render, so a one-time snapshot
    // is the intent here rather than a tracked dependency.
    // svelte-ignore state_referenced_locally
    { ssrData: (data.content?.items ?? []) as ExploreItem[] }
  );

  const orgName = $derived(data.org?.name ?? 'Organization');
  // Source-selection rule:
  // The live query reports `data: []` whenever the org-scoped collection
  // hasn't yet observed the latest `setQueryData` — TanStack Query's
  // observer notification is microtask-scheduled, so there is always a
  // window where the sync hydrate has landed but the live query still
  // reads as empty. This window re-opens on every sort/filter goto()
  // because the $effect re-hydrates the cache atomically.
  // Disambiguate by comparing to the SSR payload: if SSR has items but
  // the live query is empty, the collection is mid-hydrate — render SSR.
  // Only trust an empty live query when SSR is also empty (genuinely
  // empty result set).
  // The org-equality filter is defense in depth against cache poisoning
  // (mirrors filterLibraryItemsByOrg, Codex-q3zuf).
  const items = $derived.by(() => {
    const liveItems = (contentQuery.data ?? []) as ExploreItem[];
    const ssrItems = (data.content?.items ?? []) as ExploreItem[];
    const source = liveItems.length === 0 && ssrItems.length > 0
      ? ssrItems
      : liveItems;
    return sortToServerOrder(
      filterContentItemsByOrg(source, data.org?.id),
      ssrItems
    );
  });

  /**
   * Re-impose the SERVER'S order on the live-query result.
   *
   * The live query reads the org-scoped TanStack DB collection, and a
   * collection has no ORDER BY — it yields whatever internal order it happens
   * to hold, which is NOT the `ORDER BY` the server applied. So the chosen sort
   * was correct in SSR and then silently discarded the moment the client
   * hydrated: `?type=video&sort=oldest` rendered exactly REVERSED (i.e.
   * newest-first) and `?sort=title` was not alphabetical, nondeterministically
   * between runs. Sorting is a server facet like every other one on this page,
   * so the SSR payload's sequence is the authority.
   *
   * The SSR payload is exactly the page being displayed (the mount/navigate
   * `hydrateCollection` overwrites the whole org cache with it), so this is a
   * reindex rather than a re-sort. Anything the live query holds that SSR did
   * not return keeps its relative order and lands after the known items, so a
   * locally-inserted row can never be dropped.
   *
   * A plain id array + `indexOf` rather than a `Map`: the autofixer (rightly)
   * objects to a bare mutable `Map` in a rune file, and importing `SvelteMap`
   * for a value that never escapes this function would be worse. One page is
   * `PAGE_LIMIT` = 12 rows, so the quadratic term is 144 string compares.
   * Mirrors the same workaround the category derivation used for `Set`.
   */
  function sortToServerOrder(
    list: ExploreItem[],
    ssrItems: readonly ExploreItem[]
  ): ExploreItem[] {
    if (ssrItems.length === 0 || list.length < 2) return list;
    const serverIds = ssrItems.map((item) => item.id);
    const rankOf = (id: string) => {
      const index = serverIds.indexOf(id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return list
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          rankOf(a.item.id) - rankOf(b.item.id) || a.index - b.index
      )
      .map((entry) => entry.item);
  }
  const total = $derived(data.content?.total ?? 0);
  const filters = $derived(data.filters);
  const limit = $derived(data.limit ?? 12);
  const isAuthenticated = $derived(!!data.user);

  // ── Portals rail (SPEC §8.5) ──────────────────────────────────────
  // The org's PUBLISHED courses, loaded server-side (public read). A distinct
  // discovery surface ABOVE the content grid, hosted in the shared `Carousel`
  // primitive — the same treatment the org landing page gives these same
  // portals. It used to render into `.content-grid`, the 1→2→3-column grid
  // utility, so five portals produced a ragged 3+2 row 1269px tall (141% of a
  // 1440×900 viewport) and pushed the first content card 1.94 viewports down.
  // A rail shows every portal in 520px and scrolls its own track.
  const journeys = $derived<CourseCardSummary[]>(data.journeys ?? []);

  // Search narrows portals client-side by title/kicker/lede (mirrors the
  // prototype's title match); the content grid is narrowed server-side.
  const filteredJourneys = $derived.by(() => {
    const q = filters.q?.trim().toLowerCase();
    if (!q) return journeys;
    return journeys.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        (j.kicker?.toLowerCase().includes(q) ?? false) ||
        (j.lede?.toLowerCase().includes(q) ?? false)
    );
  });

  const showJourneysRail = $derived(filteredJourneys.length > 0);
  // Plurals follow the shipped `_one` / `_other` key convention rather than
  // ICU, matching discover_result_count_* elsewhere in the app.
  const portalsCountLabel = $derived(
    filteredJourneys.length === 1
      ? m.explore_portals_count_one()
      : m.explore_portals_count_other({ count: filteredJourneys.length })
  );
  const resultsCountLabel = $derived(
    total === 1
      ? m.explore_results_count_one()
      : m.explore_results_count_other({ count: String(total) })
  );

  // Link by the SELL PAGE, not the course (Codex-xzwl5). `/journeys/:slug`
  // resolves `landing_pages.slug`, so linking by `courses.slug` — which drifts
  // from the page's after a rename — resolved to a different URL than the
  // org-landing rail (which links by the page). Both surfaces now derive the
  // same identity; the course slug/id stay only as the last-resort fallback for
  // a published course with no published page found.
  function journeyHref(journey: CourseCardSummary): string {
    return buildJourneyUrl(
      page.url,
      {
        slug: journey.pageSlug ?? journey.slug,
        id: journey.pageId ?? journey.id,
      },
      { surface: 'sales' }
    );
  }

  // ── Category strip options ────────────────────────────────────────
  // The org's TAXONOMY, served by `+page.server.ts` — deliberately NOT scraped
  // from the loaded items. Each option carries a `name` to render and a `slug`
  // to put in the URL, because those are two different values and conflating
  // them broke all three of the following at once:
  //
  //   • `item.category` is a legacy free-text DISPLAY NAME, while both filter
  //     paths match `categories.slug`. Writing the name to `?category=` gave 0
  //     results for single-word categories ("Somatics" → 0, "somatics" → 7) and
  //     a full 400 error page for any containing a space or `&`, since
  //     `publicContentQueryParamsSchema` only accepts the slug charset.
  //   • `items` is server-filtered BY category, so options derived from it
  //     collapsed to just the active one on selection — lateral movement
  //     between categories cost a round trip through "All".
  //   • Options only reflected the 12 items on the current page, so any
  //     multi-page org under-reported its own taxonomy.
  //
  // Order is the curator's `sortOrder` (the endpoint applies it), so this
  // deliberately does NOT re-sort. The active slug is unioned in as a
  // last-resort escape hatch: if it isn't in the taxonomy (renamed or retired
  // category still live in someone's bookmark) the strip must still offer a way
  // back to "All" rather than hiding the state it's in.
  const categoryOptions = $derived.by(() => {
    const options = (data.categoryOptions ?? []).map((option) => ({
      name: option.name,
      slug: option.slug,
    }));
    if (
      filters.category &&
      !options.some((option) => option.slug === filters.category)
    ) {
      options.push({ name: filters.category, slug: filters.category });
    }
    return options;
  });

  /** Display name for the active category slug — falls back to the raw slug. */
  const activeCategoryName = $derived(
    categoryOptions.find((option) => option.slug === filters.category)?.name ??
      filters.category
  );

  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));

  // Auth-aware sort options
  const sortOptions = $derived([
    { value: 'newest', label: m.explore_sort_newest() },
    { value: 'oldest', label: m.explore_sort_oldest() },
    { value: 'title', label: m.explore_sort_title() },
    ...(isAuthenticated ? [
      { value: 'popular', label: m.explore_sort_popular() },
      { value: 'top-selling', label: m.explore_sort_top_selling() },
    ] : []),
  ]);

  // Filter chips — every facet is URL-backed, so every chip reads from
  // `filters` (or `data.creator`) and removes itself with one URL write.
  const activeFilterChips = $derived.by<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];

    if (filters.q) {
      chips.push({ key: 'q', label: m.explore_chip_search({ query: filters.q }) });
    }
    if (filters.type) {
      const typeLabel = typeOptions.find((o) => o.value === filters.type)?.label ?? filters.type;
      chips.push({ key: 'type', label: m.explore_chip_type({ value: typeLabel }) });
    }
    if (filters.category) {
      // The chip reads the DISPLAY NAME, not the slug the URL carries.
      chips.push({
        key: 'category',
        label: m.explore_chip_category({ value: activeCategoryName }),
      });
    }
    if (filters.sort && filters.sort !== 'newest') {
      const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? filters.sort;
      chips.push({ key: 'sort', label: m.explore_chip_sort({ value: sortLabel }) });
    }
    if (data.creator) {
      chips.push({ key: 'creator', label: m.explore_chip_creator({ value: data.creator.name }) });
    }
    if (filters.featured === true) {
      chips.push({ key: 'featured', label: m.explore_chip_featured() });
    }

    return chips;
  });

  function removeChip(chip: ActiveFilterChip) {
    updateFilters({ [chip.key]: null });
  }

  const hasActiveFilters = $derived(
    !!filters.q ||
      !!filters.type ||
      !!filters.category ||
      filters.sort !== 'newest' ||
      !!data.creator ||
      filters.featured === true
  );

  // ── Batched URL writes ────────────────────────────────────────────
  // Rebuilding the next URL from `page.url` per write LOSES facets whenever
  // two writes happen before the router has advanced. The drawer's mobile
  // Apply does exactly that — `onFilterChange` then `onSortChange` in one tick
  // — so staging "A-Z" + "Featured only" committed `?sort=title` and silently
  // dropped `featured`. Two rapid desktop clicks hit the same class of loss.
  //
  // So writes accumulate on ONE pending URL and flush once per microtask, and
  // that pending URL stays authoritative while its navigation is in flight so
  // a write arriving mid-flight builds on it rather than on a stale
  // `page.url`. One gesture → one navigation carrying every facet it touched.
  // The merge rules live in `applyFilterPatch` so they can be unit-tested.
  let pendingUrl: URL | null = null;
  let flushScheduled = false;

  function updateFilters(patch: Record<string, string | null>) {
    applyFilterPatch((pendingUrl ??= new URL(page.url)), patch);

    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushFilterUrl);
    }
  }

  async function flushFilterUrl() {
    flushScheduled = false;
    const url = pendingUrl;
    if (!url) return;
    const dispatched = url.search;
    try {
      // `keepFocus: true` is REQUIRED, not a nicety (WCAG 2.4.3). Without it
      // SvelteKit's `reset_focus` runs after every client-side navigation
      // whenever nothing moved focus during it (client.js:1874,
      // `if (!keepfocus && !changed_focus)`) and, with no hash and no
      // `[autofocus]`, re-points the sequential-focus start at the top of the
      // document. Every facet on this page is now a URL write, so activating a
      // category pill or a drawer sort row dropped `document.activeElement` on
      // `<body>` — outside the still-open drawer and its focus trap — and the
      // next Tab restarted at the page header. This is the house pattern: 11
      // other URL-writing surfaces pass it, including `(platform)/discover`,
      // the direct analogue.
      await goto(url.toString(), {
        replaceState: true,
        noScroll: true,
        keepFocus: true,
      });
    } finally {
      // Release the pending base only if nothing mutated it while we
      // navigated. `finally` so a rejected navigation cannot leave a stale
      // base that every later write would build on.
      if (pendingUrl && pendingUrl.search === dispatched) pendingUrl = null;
    }
  }

  function handleSearchSubmit(value: string) {
    const trimmed = value.trim();
    updateFilters({ q: trimmed || null });
  }

  /** Page-wide clear — every facet, including the ones the drawer doesn't own. */
  function clearFilters() {
    updateFilters({
      q: null,
      type: null,
      sort: null,
      category: null,
      creator: null,
      featured: null,
      page: null,
    });
  }

  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });

  const typeOptions = [
    { value: '', label: m.explore_filter_all() },
    { value: 'video', label: m.explore_filter_video() },
    { value: 'audio', label: m.explore_filter_audio() },
    { value: 'written', label: m.explore_filter_article() },
  ] as const;

  // Featured filter — backend publicContentQuerySchema supports `featured: boolean`.
  // Toggle exposes creator-flagged featured items only.
  const featuredActive = $derived(filters.featured === true);

  // ── Filter drawer ─────────────────────────────────────────────────
  // Drawer holds Sort + Type + Featured. Search stays in the toolbar;
  // Category strip stays inline (distinct horizontal discovery surface).
  let drawerOpen = $state(false);
  function setDrawerOpen(next: boolean) {
    if (drawerOpen === next) return; // Melt echo guard
    drawerOpen = next;
  }

  // Both drawer callbacks route through the batched writer, so the two the
  // shell fires back-to-back on mobile Apply commit as ONE navigation.
  function handleDrawerFilterChange(next: { type: string; featured: boolean }) {
    updateFilters({
      type: next.type || null,
      featured: next.featured ? 'true' : null,
    });
  }
  function handleDrawerSortChange(value: string | undefined) {
    updateFilters({ sort: value ?? null });
  }

  /**
   * In-drawer "Clear filters" resets only what the drawer owns. The page-wide
   * `clearFilters` also wiped `q` and `creator`, so the toolbar search box
   * visibly emptied while the drawer sat open over facets it doesn't show.
   * This also matches the shell's own mobile behaviour, which resets to
   * `defaultFilters` / `defaultSort` — i.e. drawer facets only.
   */
  function clearDrawerFilters() {
    updateFilters({ type: null, featured: null, sort: null, page: null });
  }

  // Filter button shows a dot when ANY non-default facet is active.
  // (Search, category, creator are also non-default but they have their
  // own UI; the dot reflects the in-drawer facet state specifically.)
  const drawerActiveCount = $derived(
    (filters.type ? 1 : 0) +
      (featuredActive ? 1 : 0) +
      (filters.sort !== 'newest' ? 1 : 0)
  );

  // ── SEO ──────────────────────────────────────────────────────────
  // Canonical URL strategy: preserve meaningful filter params (type,
  // category, creator) that represent distinct indexable collections.
  // Drop transient params (q, sort, page) which would otherwise explode
  // into thousands of low-value URL variants and dilute crawl budget.
  // `featured` is dropped too: it's a re-ordering of the same catalogue, so
  // indexing it would create a near-duplicate of the unfiltered page.
  const canonicalUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('sort');
    url.searchParams.delete('page');
    url.searchParams.delete('featured');
    return `${url.origin}${url.pathname}${url.search}`;
  });

  // Robots: noindex search result URLs (?q=…) to avoid crawl traps and
  // internal search appearing in SERPs. Filter/category/creator URLs
  // remain indexable since they link the canonical catalogue shape.
  const noindex = $derived(!!filters.q);

  // Build a human-friendly description that reflects the active filter
  // state. Generic fallback when browsing the full catalogue.
  const pageDescription = $derived.by(() => {
    const parts: string[] = [];
    if (filters.type) parts.push(filters.type);
    // The category's display name, not its URL slug — this is prose a human
    // (and a SERP snippet) reads.
    if (filters.category) parts.push(activeCategoryName);
    const scope = parts.length > 0 ? parts.join(' + ') : 'all';
    if (data.creator) {
      return `Content by ${data.creator.name} on ${orgName}`;
    }
    return `Browse ${scope} content from ${orgName}.`;
  });

  // CollectionPage JSON-LD — tells search engines this page is a
  // listing of items, helps with sitelinks and rich results.
  const collectionSchema = $derived<Record<string, unknown>>({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${m.explore_title()} | ${orgName}`,
    description: pageDescription,
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: orgName,
      url: page.url.origin,
    },
    ...(total > 0 && {
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: total,
      },
    }),
  });
</script>

<svelte:head>
  <title>{m.explore_title()} | {orgName}</title>
  <link rel="canonical" href={canonicalUrl} />
  {#if noindex}
    <meta name="robots" content="noindex, follow" />
  {/if}
  <meta name="description" content={pageDescription} />
  <meta property="og:title" content="{m.explore_title()} | {orgName}" />
  <meta property="og:description" content={pageDescription} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonicalUrl} />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="{m.explore_title()} | {orgName}" />
  <meta name="twitter:description" content={pageDescription} />
</svelte:head>

<StructuredData data={collectionSchema} />

<div class="explore">
  <!--
    Creator feature banner — rendered only when the page is filtered by
    creator (?creator=<username>). Acts as a profile spread for that
    contributor, with the filtered content grid below it serving as
    their catalogue. Avoids a separate /creators/[username] route.
  -->
  {#if data.creator}
    <CreatorExploreBanner
      name={data.creator.name}
      avatarUrl={data.creator.avatarUrl}
      bio={data.creator.bio}
      role={data.creator.role}
      contentCount={data.creator.contentCount}
      socialLinks={data.creator.socialLinks}
      onClear={() => updateFilters({ creator: null })}
    />
  {/if}

  <!-- Header -->
  <header class="explore__header">
    <h1 class="explore__title">{m.explore_title()}</h1>
    {#if total > 0}
      <p class="explore__count">{resultsCountLabel}</p>
    {/if}
  </header>

  <!-- Sticky command bar: search + filter trigger. Type, Featured and Sort
       live inside the drawer. -->
  <StickyToolbar>
    <SearchPill
      value={filters.q ?? ''}
      placeholder={m.explore_search_placeholder()}
      onSubmit={handleSearchSubmit}
    />

    <FilterTriggerButton
      activeCount={drawerActiveCount}
      onClick={() => setDrawerOpen(true)}
      expanded={drawerOpen}
      ariaLabel={drawerActiveCount > 0
        ? `${m.explore_filters_and_sort()} (${m.filters_active_count({ count: drawerActiveCount })})`
        : m.explore_filters_and_sort()}
      title={m.explore_filters_and_sort()}
    />
  </StickyToolbar>

  <!--
    Portals rail (SPEC §8.5) — the org's published courses as sales-linked
    discovery cards, above the content grid.

    The <section> is deliberately UNNAMED: `Carousel` emits its own
    role="region" with an accessible name, and naming the section too would
    announce two nested landmarks with near-identical names. An unnamed
    <section> is not a landmark, so this leaves exactly one. The h2 still
    anchors the heading outline.
  -->
  {#if showJourneysRail}
    <section class="explore__journeys">
      <div class="explore__journeys-head">
        <h2 class="explore__journeys-title">{m.explore_portals_title()}</h2>
        <span class="explore__journeys-count">{portalsCountLabel}</span>
      </div>
      {#if filteredJourneys.length > 1}
        <p class="explore__journeys-pathline">{m.explore_portals_pathline()}</p>
      {/if}
      <Carousel
        items={filteredJourneys}
        itemMinWidth="17rem"
        ariaLabel={m.explore_portals_rail_label()}
      >
        {#snippet renderItem(journey)}
          <JourneyRailCard {journey} href={journeyHref(journey)} />
        {/snippet}
      </Carousel>
    </section>
  {/if}

  <!-- Content section. The heading only earns its place in CONTRAST to the
       rail above it — with no rail rendered there is nothing for "everything"
       to be distinguished from, so it is gated on the rail, not on the org
       merely having portals. -->
  {#if showJourneysRail}
    <div class="explore__browse-head">
      <h2 class="explore__browse-title">{m.explore_browse_everything()}</h2>
    </div>
  {/if}

  <!-- Category Strip — label is the display NAME, URL value is the SLUG. -->
  {#if categoryOptions.length >= 2 || filters.category}
    <nav class="explore__categories" aria-label={m.explore_category_filter_label()}>
      <button
        type="button"
        class="explore__category-pill"
        class:explore__category-pill--active={!filters.category}
        onclick={() => updateFilters({ category: null })}
        aria-pressed={!filters.category}
      >
        {m.explore_filter_all()}
      </button>
      {#each categoryOptions as option (option.slug)}
        {@const active = filters.category === option.slug}
        <button
          type="button"
          class="explore__category-pill"
          class:explore__category-pill--active={active}
          onclick={() => updateFilters({ category: option.slug })}
          aria-pressed={active}
        >
          {option.name}
        </button>
      {/each}
    </nav>
  {/if}

  <!-- Active Filter Chips -->
  <ActiveFiltersStrip
    chips={activeFilterChips}
    onRemove={removeChip}
    onClearAll={clearFilters}
    clearAllLabel={m.explore_clear_filters()}
    requireMultipleForClear
  />

  <!-- Content Grid -->
  {#if items.length > 0}
    <div class="content-grid">
      {#each items as item (item.id)}
        <ContentCard
          variant="grid"
          shape="3:4"
          titleInCover={true}
          chrome="transparent"
          id={item.id}
          title={item.title}
          thumbnail={getDisplayThumbnail(item)}
          description={item.description}
          contentType={(item.contentType === 'written' ? 'article' : item.contentType) as 'video' | 'audio' | 'article'}
          duration={item.mediaItem?.durationSeconds ?? null}
          creator={item.creator ? {
            username: item.creator.name ?? undefined,
            displayName: item.creator.name ?? undefined,
          } : undefined}
          href={buildContentUrl(page.url, item)}
          price={item.priceCents != null ? {
            amount: item.priceCents,
            currency: 'GBP',
          } : null}
          contentAccessType={deriveContentAccessKind(item)}
          included={access.isIncluded(item)}
          isFollower={access.isFollowing}
          tierName={access.getTierName(item)}
          category={item.category ?? null}
          featured={item.featured ?? false}
        />
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="explore__pagination">
        <Pagination
          currentPage={filters.page}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else if hasActiveFilters}
    <EmptyState title={m.explore_no_results()} icon={SearchXIcon}>
      {#snippet action()}
        <button type="button" class="explore__clear-btn" onclick={clearFilters}>
          {m.explore_clear_filters()}
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.explore_no_content()} description={m.explore_no_content_description()} icon={FileIcon} />
  {/if}
</div>

<ExploreFilterDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  filters={{ type: filters.type, featured: featuredActive }}
  sort={filters.sort}
  {sortOptions}
  {typeOptions}
  onFilterChange={handleDrawerFilterChange}
  onSortChange={handleDrawerSortChange}
  onClearAll={clearDrawerFilters}
  activeCount={drawerActiveCount}
/>

<BackToTop />

<style>
  /* ── Layout ──
     Full-bleed SURFACE, capped CONTENT. The page inherits the semantic theme
     tokens so it respects the org's light OR dark theme with no per-page
     palette override — that is what "full width" was originally asked for, and
     it does not require the content column to be uncapped too. Uncapped, the
     browse grid stretched edge-to-edge on a wide display; `--container-max`
     (80rem) is the platform's one content-width token and matches the org
     landing page. */
  .explore {
    width: 100%;
    max-width: var(--container-max);
    margin-inline: auto;
    padding: var(--space-8) var(--space-8) var(--space-16);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── Portals rail ── */
  .explore__journeys {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-block: var(--space-6);
  }

  .explore__journeys-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .explore__journeys-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-medium);
    /* Match the page h1 (.explore__title) — consistent heading colour in the
       org's theme, whatever it is. */
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  /* `--color-text-secondary`, not tertiary: under `[data-org-bg]` tertiary's
     clamp saturates at L=0.6 on ANY light brand background, which measured
     3.46:1 for this 14.26px line against the page — a WCAG 1.4.3 AA fail.
     Secondary is the token org-brand.css documents as measured to clear AA at
     both ends of the brand range. */
  .explore__journeys-count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .explore__journeys-pathline {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    max-width: 60ch;
  }

  /* ── Browse-everything section heading (only when portals present) ── */
  .explore__browse-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .explore__browse-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  /* ── Header ── */
  .explore__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .explore__title {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  .explore__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Category Strip ── */
  .explore__categories {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-1) 0;
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--space-4),
      black calc(100% - var(--space-4)),
      transparent 100%
    );
  }

  .explore__categories::-webkit-scrollbar {
    display: none;
  }

  /* Ghost pills — transparent by default with a hairline border, so the strip
     whispers and lets the content grid lead. Only the ACTIVE pill takes a fill;
     see the `--active` rule for why it has to be a real one.
     `min-height: --space-11` (44px) matches the drawer's controls: these are the
     page's only inline filter, six abreast in a horizontal scroller at 390 wide,
     where a mis-tap scrolls the strip instead of selecting. Padding-block stays
     at --space-1-5 so min-height grows the box without changing type rhythm. */
  .explore__category-pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    min-height: var(--space-11);
    padding: var(--space-1-5) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  .explore__category-pill:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  .explore__category-pill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  /* Active state uses the drawer's own recipe — `--color-interactive` fill with
     `--color-text-on-brand` — for two reasons.
     WCAG 1.4.11: the previous `--color-surface-elevated` fill is derived as
     `calc(l + 0.02)` from the page background, so on any `[data-org-bg]` org it
     is ~1:1 against the page BY CONSTRUCTION (measured 1.06:1 light, 1.12:1
     dark), and `--color-border-strong` gave the outline only 1.49:1. A state
     indicator needs 3:1, so the selected pill was effectively invisible — and
     with `category` now a server facet, discovering that state costs a
     navigation. The brand fill measures 4.90:1 for its text.
     And the semibold step means state is not signalled by colour ALONE, which
     the old rule's text-colour-only cue was. */
  .explore__category-pill--active {
    color: var(--color-text-on-brand);
    font-weight: var(--font-semibold);
    background: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  /* The ACTIVE pill deliberately does NOT lighten on hover. `--color-text-on-brand`
     is derived from `--color-interactive`, not from `--color-interactive-hover`
     (dark theme lightens by `calc(l + 0.08)`), so hovering pushed the fill past
     the point where white text still clears AA while the text colour stayed put:
     measured 4.67:1 resting → 3.36:1 hovered on of-blood-and-bones dark. There
     is also nothing for hover to communicate here — the pill is already
     selected — so it holds its state instead. Mirrors the previous rule, which
     likewise pinned the active background against hover. */
  .explore__category-pill--active:hover {
    color: var(--color-text-on-brand);
    background: var(--color-interactive);
    border-color: var(--color-interactive);
  }

  /* ── Pagination ── */
  .explore__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
  }

  /* ── Empty States ── */
  .explore__clear-btn {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .explore__clear-btn:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  /* R14 — this was the only interactive element on the page with no
     focus-visible rule, so keyboard users had whatever the UA happened to
     draw over a brand-coloured outline (often nothing). */
  .explore__clear-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .explore {
      padding: var(--space-6) var(--space-4);
    }

    .explore__title {
      font-size: var(--text-2xl);
    }
  }
</style>
