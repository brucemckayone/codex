<!--
  @component OrgLandingPage

  Organization landing page with dramatic hero section over shader background.
  Content anchored bottom-left, editorial layout with big stat numbers.
  Structure adapts to any brand via design tokens.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { CreatorCarouselCard, SkeletonCreatorCard } from '$lib/components/ui/CreatorCard';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import Spotlight from '$lib/components/content/Spotlight.svelte';
  import AudioWall from '$lib/components/content/AudioWall.svelte';
  import ArticleEditorial from '$lib/components/content/ArticleEditorial.svelte';
  import DiscoverMix from '$lib/components/content/DiscoverMix.svelte';
  import SubscribeCTA from '$lib/components/subscription/SubscribeCTA.svelte';
  import SubscribeStickyBar from '$lib/components/subscription/SubscribeStickyBar.svelte';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { HeroInlineVideo } from '$lib/components/ui/HeroInlineVideo';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { getThumbnailUrl, getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';
  import {
    eq,
    hydrateIfNeeded,
    libraryCollection,
    loadSubscriptionFromServer,
    subscriptionCollection,
    useLiveQuery,
    type LibraryItem,
    type SubscriptionItem,
  } from '$lib/collections';
  import { filterLibraryItemsByOrg } from '$lib/library/filter-by-org';
  import { followingStore } from '$lib/client/following.svelte';
  import {
    followOrganization,
    getMyMembership,
    unfollowOrganization,
  } from '$lib/remote/org.remote';
  import { useAccessContext } from '$lib/utils/access-context.svelte';
  import { StructuredData } from '$lib/components/seo';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let videoActive = $state(false);
  let isDesktop = $state(false);

  // Category-bar sticky detection — IntersectionObserver watches a
  // 1px sentinel placed above the bar. When the sentinel scrolls out
  // of the viewport the bar has reached top: 0 and we toggle the
  // stuck class so the frosted backdrop fades in.
  let categoryBarStuck = $state(false);
  let categorySentinelEl: HTMLDivElement | undefined = $state();

  // URL-driven active category so the pill bar reflects which filter the
  // user is about to land on. When absent, the "All" pill is active.
  const activeCategory = $derived(page.url.searchParams.get('category'));

  $effect(() => {
    if (!categorySentinelEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        categoryBarStuck = !entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(categorySentinelEl);
    return () => observer.disconnect();
  });

  onMount(() => {
    // Hydrate the org-scoped TanStack DB cache with whatever content we
    // already rendered server-side so client navigations feel instant.
    // The cache key is ['content', orgId] — different orgs get separate
    // cache entries, preventing cross-org leakage.
    if (data.allContent?.length && data.org?.id) {
      hydrateIfNeeded(
        { kind: 'content', orgId: data.org.id },
        data.allContent
      );
    }

    // Track desktop breakpoint for inline vs modal video
    const mql = window.matchMedia('(min-width: 48rem)');
    isDesktop = mql.matches;
    const handler = (e: MediaQueryListEvent) => {
      isDesktop = e.matches;
      // Close inline video if viewport shrinks to mobile
      if (!e.matches && videoActive) videoActive = false;
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  const orgName = $derived(data.org?.name ?? 'Organization');
  const orgDescription = $derived(data.org?.description ?? '');
  const logoUrl = $derived(data.org?.logoUrl ?? '');
  const stats = $derived(data.stats);
  const feedCategories = $derived(data.feedCategories ?? []);
  const user = $derived(data.user);
  const introVideoUrl = $derived(data.org?.introVideoUrl ?? null);

  // Anchor the Subscribe CTA banner after the content-richest reading section
  // in the feed. We prefer inserting after Articles (the editorial anchor);
  // if there are no articles, fall back to Audio, then Videos. Returns null
  // when no section would make sense — in that case the banner is skipped.
  const subscribeAnchorId = $derived(
    data.sections.find((s) => s.id === 'articles')?.id ??
      data.sections.find((s) => s.id === 'audio')?.id ??
      data.sections.find((s) => s.id === 'videos')?.id ??
      null
  );

  // Preview strip for the SubscribeCTA — member-only items ("You'll unlock:").
  // Filter allContent to subscriber/follower-gated items, cap at 5, and map
  // to the lightweight primitive shape SubscribeCTA expects. This is the
  // "honest fallback" path — if the org has no gated content, the strip
  // hides gracefully (the component checks `previewContent?.length > 0`).
  const subscribeGatedContent = $derived(
    data.allContent.filter(
      (c) => c.accessType === 'subscribers' || c.accessType === 'followers'
    )
  );

  const subscribePreview = $derived(
    subscribeGatedContent.slice(0, 5).map((c) => ({
      id: c.id,
      title: c.title,
      thumbnail: c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl ?? null,
      href: buildContentUrl(page.url, c),
    }))
  );

  // Total gated items — SubscribeCTA uses this to render "+N more" when
  // the full catalogue exceeds the visible 5 tiles.
  const subscribePreviewTotal = $derived(subscribeGatedContent.length);

  // Canonical URL is the org's own subdomain origin. Prevents SEO
  // duplicate-content issues if the platform ever links to the same org
  // via a different path shape.
  const canonicalUrl = $derived(`${page.url.origin}${page.url.pathname}`);

  // Organization schema for rich search results — helps Google show the
  // org name, logo, and description in SERP knowledge panels.
  const orgSchema = $derived<Record<string, unknown>>({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: orgName,
    url: page.url.origin,
    ...(orgDescription && { description: orgDescription }),
    ...(logoUrl && { logo: logoUrl, image: logoUrl }),
  });

  // Continue watching — live query over localStorage-backed libraryCollection.
  // On return visits: instant from localStorage. On first visit: empty until staleness detection loads data.
  const libraryQuery = useLiveQuery(
    (q) =>
      q
        .from({ item: libraryCollection })
        .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc'),
    undefined,
    { ssrData: [] as LibraryItem[] }
  );

  // Scope to this org by organizationId via the shared helper (prevents
  // cross-org bleed; see $lib/library/filter-by-org.ts), then narrow to
  // in-progress items only.
  const continueWatching = $derived(
    filterLibraryItemsByOrg(
      (libraryQuery.data ?? []) as LibraryItem[],
      data.org.id
    )
      .filter(
        (item) =>
          item.progress &&
          !item.progress.completed &&
          item.progress.positionSeconds > 0
      )
      .slice(0, 6)
  );

  // Access context — tiers from server, subscription from client store (subscriptionCollection)
  const access = useAccessContext(() => ({
    subscriptionContext: data.subscriptionContext,
    isFollowing: followingStore.get(data.org.id),
    orgId: data.org.id,
  }));

  // Org-access gate. The org's public layout doesn't load membership info
  // (only studio does), so we probe `getMyMembership` + subscription state
  // client-side and combine them. Without this, owners and team members —
  // who never carry a subscription record — would see the Subscribe CTA on
  // their own org's landing page.
  //
  // `accessChecked` defers rendering the CTA until both probes settle, so
  // a logged-in subscriber doesn't see a flash of the bar during the brief
  // verification window. Logged-out users skip the probes entirely.
  let accessChecked = $state(false);
  let hasActiveMembership = $state(false);

  // Subscription presence is sourced from TanStack DB so it participates in
  // collection reactivity (live updates after checkout/cancellation flows
  // propagate without the parent needing to manually re-read state).
  const subQuery = useLiveQuery(
    (q) =>
      q
        .from({ s: subscriptionCollection })
        .where(({ s }) => eq(s.organizationId, data.org.id)),
    [() => data.org?.id],
    { ssrData: [] as SubscriptionItem[] }
  );

  const hasActiveSubscription = $derived(
    (subQuery.data ?? []).some(
      (s) => s.status === 'active' || s.status === 'cancelling'
    )
  );

  const hasOrgAccess = $derived(
    !!browser &&
      !!data.org?.id &&
      !!user &&
      (hasActiveMembership || hasActiveSubscription)
  );

  const shouldShowSubscribeCTA = $derived(
    !!data.org?.id && accessChecked && !hasOrgAccess
  );

  $effect(() => {
    if (!browser || !data.org?.id) return;
    // Reset on org change (cross-org navigation re-runs this effect).
    accessChecked = false;
    hasActiveMembership = false;

    if (!data.user) {
      // Logged-out users can't have access — flip the gate immediately so
      // the CTA renders without a round-trip.
      accessChecked = true;
      return;
    }

    const orgId = data.org.id;
    const orgSlug = data.org.slug;
    let cancelled = false;

    void Promise.allSettled([
      getMyMembership(orgId).then((m) => {
        if (cancelled) return;
        // 'invited' members haven't accepted yet — still treat them as
        // outsiders for CTA purposes.
        hasActiveMembership = !!m?.role && m.status === 'active';
      }),
      loadSubscriptionFromServer(orgId, orgSlug),
    ]).then(() => {
      if (!cancelled) accessChecked = true;
    });

    return () => {
      cancelled = true;
    };
  });

  // Follow toggle — reads from followingStore (localStorage-backed, reactive)
  const isFollowing = $derived(followingStore.get(data.org.id));
  let followLoading = $state(false);

  async function handleFollowToggle() {
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent(page.url.pathname)}`;
      return;
    }
    followLoading = true;
    try {
      if (isFollowing) {
        await unfollowOrganization(data.org.id);
        followingStore.set(data.org.id, false);
      } else {
        await followOrganization(data.org.id);
        followingStore.set(data.org.id, true);
      }
    } catch {
      // Silently fail — store retains previous state
    } finally {
      followLoading = false;
    }
  }
  let videoOriginX = $state(50);
  let videoOriginY = $state(38);

  function handlePlayClick(e: MouseEvent) {
    const hero = (e.currentTarget as HTMLElement).closest('.hero');
    if (!hero) { videoActive = true; return; }
    const heroRect = hero.getBoundingClientRect();
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    videoOriginX = ((btnRect.left + btnRect.width / 2 - heroRect.left) / heroRect.width) * 100;
    videoOriginY = ((btnRect.top + btnRect.height / 2 - heroRect.top) / heroRect.height) * 100;
    videoActive = true;
  }

  function formatHours(totalSeconds: number): string {
    if (totalSeconds <= 0) return '0';
    const hours = totalSeconds / 3600;
    if (hours < 1) return `${Math.round(totalSeconds / 60)}m`;
    return hours % 1 === 0 ? `${Math.round(hours)}` : `${hours.toFixed(1)}`;
  }
</script>

<svelte:head>
  <title>{orgName} | Revelations</title>
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={orgName} />
  {#if orgDescription}
    <meta property="og:description" content={orgDescription} />
    <meta name="description" content={orgDescription} />
  {/if}
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonicalUrl} />
  {#if logoUrl}
    <meta property="og:image" content={logoUrl} />
    <!-- LCP: the hero logo is the above-the-fold image. Preload signals
         to the browser to fetch it alongside the critical chain, not
         after the main stylesheet resolves. fetchpriority reinforces. -->
    <link rel="preload" as="image" href={logoUrl} fetchpriority="high" />
  {/if}
  <meta name="twitter:card" content={logoUrl ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={orgName} />
  {#if orgDescription}
    <meta name="twitter:description" content={orgDescription} />
  {/if}
</svelte:head>

<StructuredData data={orgSchema} />

<div class="org-landing">
  <!-- Hero: full viewport, content anchored bottom-left, editorial -->
  <section class="hero" class:hero--video-playing={videoActive && isDesktop}>
    <!-- Title lives OUTSIDE hero__content so it has no z-index isolation
         and mix-blend-mode: difference can reach the shader canvas -->
    <h1 class="hero__title">{orgName}</h1>

    <!-- Desktop: centered play button in hero -->
    {#if introVideoUrl && isDesktop && !videoActive}
      <button
        class="hero__play-center"
        onclick={handlePlayClick}
        aria-label={m.org_hero_watch_intro()}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path d="M14 8L34 20L14 32V8Z" fill="white" opacity="0.9" />
        </svg>
      </button>
    {/if}

    <!-- Desktop: inline video within hero -->
    {#if introVideoUrl && videoActive && isDesktop}
      <HeroInlineVideo
        src={introVideoUrl}
        active={true}
        originX={videoOriginX}
        originY={videoOriginY}
        onclose={() => { videoActive = false; }}
      />
    {/if}

    <div class="hero__content">
      <!-- Logo badge -->
      {#if logoUrl}
        <div class="hero__logo-wrap">
          <img
            src={logoUrl}
            alt="{orgName} logo"
            class="hero__logo"
            loading="eager"
            fetchpriority="high"
            decoding="async"
          />
        </div>
      {/if}

      <!-- Description -->
      {#if orgDescription}
        <p class="hero__description">{orgDescription}</p>
      {/if}

      <!-- Content type + category pills -->
      {#if stats?.content?.total > 0 || feedCategories.length > 0}
        <div class="hero__pills">
          {#if stats?.content?.video > 0}
            <span class="hero__pill">{m.org_hero_video_count({ count: String(stats.content.video) })}</span>
          {/if}
          {#if stats?.content?.audio > 0}
            <span class="hero__pill">{m.org_hero_audio_count({ count: String(stats.content.audio) })}</span>
          {/if}
          {#if stats?.content?.written > 0}
            <span class="hero__pill">{m.org_hero_written_count({ count: String(stats.content.written) })}</span>
          {/if}
          {#if feedCategories.length > 0}
            <span class="hero__pills-sep"></span>
          {/if}
          {#each feedCategories as category}
            <a href="/explore?category={encodeURIComponent(category.name)}" class="hero__pill hero__pill--category">
              {category.name}
            </a>
          {/each}
        </div>
      {/if}

      <!-- CTAs -->
      <div class="hero__actions">
        {#if user}
          <a href="/explore" class="hero__cta hero__cta--primary">{m.org_hero_browse()}</a>
          <a href="/library" class="hero__cta hero__cta--glass">{m.org_hero_my_library()}</a>
        {:else}
          <a href="/explore" class="hero__cta hero__cta--primary">{m.org_hero_explore()}</a>
          <a href="/creators" class="hero__cta hero__cta--glass">{m.org_hero_meet_creators()}</a>
        {/if}
        <button
          class="hero__cta hero__cta--glass hero__follow"
          class:hero__follow--active={isFollowing}
          onclick={handleFollowToggle}
          disabled={followLoading}
        >
          {isFollowing ? m.org_following() : m.org_follow()}
        </button>
        {#if introVideoUrl}
          <button class="hero__cta hero__cta--glass hero__play" onclick={() => { videoActive = true; }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.5L13 8L4 13.5V2.5Z" />
            </svg>
            {m.org_hero_watch_intro()}
          </button>
        {/if}
      </div>

      <!-- Stats — big numbers, separated by border -->
      {#if stats?.content?.total > 0}
        <div class="hero__stats">
          <div class="hero__stat">
            <span class="hero__stat-number">{stats.content.total}</span>
            <span class="hero__stat-label">{stats.content.total === 1 ? 'Item' : 'Items'}</span>
          </div>
          {#if stats.creators > 0}
            <div class="hero__stat">
              <span class="hero__stat-number">{stats.creators}</span>
              <span class="hero__stat-label">{stats.creators === 1 ? 'Creator' : 'Creators'}</span>
            </div>
          {/if}
          {#if stats.totalDurationSeconds > 0}
            <div class="hero__stat">
              <span class="hero__stat-number">{formatHours(stats.totalDurationSeconds)}</span>
              <span class="hero__stat-label">Hours</span>
            </div>
          {/if}
          {#if stats.totalViews > 0}
            <div class="hero__stat">
              <span class="hero__stat-number">{stats.totalViews.toLocaleString()}</span>
              <span class="hero__stat-label">Views</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <div class="content-area">
  <!-- Continue Watching — client-side from localStorage libraryCollection -->
  {#if continueWatching.length > 0}
    <section class="section">
      <header class="lede">
        <p class="lede__eyebrow">Your library</p>
        <hr class="lede__rule" aria-hidden="true" />
        <div class="lede__title-row">
          <h2 class="lede__title">{m.org_continue_watching_title()}</h2>
          <a href="/library" class="lede__view-all">
            {m.org_continue_watching_view_library()} <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>
      <div class="content-grid">
        {#each continueWatching as item (item.content.id)}
          <ContentCard
            id={item.content.id}
            title={item.content.title}
            thumbnail={item.content.thumbnailUrl}
            description={item.content.description}
            contentType={item.content.contentType === 'written' ? 'article' : item.content.contentType}
            duration={item.content.durationSeconds ?? null}
            href={buildContentUrl(page.url, { slug: item.content.slug, id: item.content.id })}
            progress={item.progress ? {
              positionSeconds: item.progress.positionSeconds,
              durationSeconds: item.progress.durationSeconds,
              completed: item.progress.completed,
              percentComplete: item.progress.percentComplete,
            } : null}
          />
        {/each}
      </div>
    </section>
  {/if}

  <!--
    Category pills — a sticky quick-nav bar at the top of the feed.
    Sticks to viewport top when scrolled past, so category navigation
    is always reachable. Full-bleed bar with a frosted backdrop so
    feed content reads cleanly underneath while it's stuck. Driven by
    `feedCategories` (derived from allContent) so counts always reflect
    what's loaded on this page.
  -->
  {#if feedCategories.length > 0}
    <!-- 1px sentinel sits above the sticky bar; when it scrolls out of
         the viewport we know the bar has reached top: 0. -->
    <div class="category-bar__sentinel" bind:this={categorySentinelEl} aria-hidden="true"></div>
    <nav
      class="category-bar"
      class:category-bar--stuck={categoryBarStuck}
      aria-label="Browse by category"
    >
      <div class="category-bar__inner">
        <!-- The parent <nav aria-label="Browse by category"> already
             provides semantic structure. `role="list"` on a div forces a
             required child `role="listitem"` on each child — but listitem
             is a non-interactive role incompatible with <a> (Lighthouse
             ARIA audit flags this). Dropping both roles lets the anchors
             announce as links inside a navigation landmark, which is
             correct semantics without the conflict. -->
        <div class="category-pills__row">
          <a
            href="/explore"
            class="category-pills__pill category-pills__pill--all"
            class:category-pills__pill--active={activeCategory === null}
            aria-current={activeCategory === null ? 'page' : undefined}
          >
            <span class="category-pills__label">All</span>
          </a>
          {#each feedCategories as category}
            {@const isActive = activeCategory === category.name}
            <a
              href="/explore?category={encodeURIComponent(category.name)}"
              class="category-pills__pill"
              class:category-pills__pill--active={isActive}
              aria-current={isActive ? 'page' : undefined}
            >
              <span class="category-pills__label">{category.name.charAt(0).toUpperCase() + category.name.slice(1)}</span>
              <span class="category-pills__count" aria-label="{category.count} {category.count === 1 ? 'item' : 'items'}">
                {category.count}
              </span>
            </a>
          {/each}
        </div>
      </div>
    </nav>
  {/if}

  <!--
    Per-domain feed — a stack of sections composed server-side in
    feed-types.ts. Featured items live in the Spotlight section at the
    top (single anchor when one item is featured, scrollable carousel
    when multiple are). Below the spotlight: Recent releases, then per-
    type sections (Videos / Audio / Articles), optional Discover Mix,
    and Free samples.
  -->

  <!-- ContentCard for grid cells + non-hero carousel tiles. The optional
       `normalizeRatio` forces 16:9 thumbs so mixed-type rows (Free samples,
       per-category) read as one rhythm instead of jagged per-type ratios. -->
  {#snippet gridCard(c, variant, normalizeRatio = false)}
    <ContentCard
      {variant}
      {normalizeRatio}
      autoPromoteAudio
      id={c.id}
      title={c.title}
      thumbnail={c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl ?? null}
      description={c.description}
      contentType={c.contentType === 'written' ? 'article' : c.contentType}
      duration={c.mediaItem?.durationSeconds ?? null}
      creator={c.creator ? {
        username: c.creator.name ?? undefined,
        displayName: c.creator.name ?? undefined,
      } : undefined}
      href={buildContentUrl(page.url, c)}
      price={c.priceCents != null ? {
        amount: c.priceCents,
        currency: 'GBP',
      } : null}
      contentAccessType={c.accessType}
      included={access.isIncluded(c)}
      isFollower={access.isFollowing}
      tierName={access.getTierName(c)}
      category={c.category ?? null}
      featured={c.featured ?? false}
    />
  {/snippet}

  {#each data.sections as section (section.id)}
    {#if section.layout === 'spotlight' && section.items[0]}
      <!-- Anchor beat — full-bleed featured item on shader backdrop.
           No surrounding .feed-section/.lede header; Spotlight renders
           its own section wrapper with an internal h2.
           When the org has flagged 2+ items as featured, wrap them in a
           Carousel that pages one slide at a time at full viewport
           width (`itemMinWidth: 100%`, `gap: 0`). The Spotlight inside
           self-constrains via its own `.spotlight__container` max-width
           so content stays readable on huge monitors while the slide
           pagination remains edge-to-edge clean. Single-item case stays
           unwrapped to keep the DOM minimal and avoid carousel ARIA
           noise. -->
      {#if section.items.length === 1}
        <Spotlight item={section.items[0]} />
      {:else}
        <div class="spotlight-carousel">
          <Carousel
            items={section.items}
            itemMinWidth="100%"
            gap="0"
            ariaLabel={section.title}
            showArrows
          >
            {#snippet renderItem(item)}
              <Spotlight {item} />
            {/snippet}
          </Carousel>
        </div>
      {/if}
    {:else}
      <section class="feed-section" data-layout={section.layout}>
        <header class="lede">
          <hr class="lede__rule" aria-hidden="true" />
          <div class="lede__title-row">
            <h2 class="lede__title">{section.title}</h2>
            {#if section.viewAllHref}
              <a href={section.viewAllHref} class="lede__view-all">
                {section.viewAllLabel ?? m.org_view_all_content()}
                <span aria-hidden="true">→</span>
              </a>
            {/if}
          </div>
        </header>

        {#if section.layout === 'mosaic'}
          <!-- Audio wall — responsive square mosaic, caps to 8 tiles -->
          <AudioWall items={section.items} {access} />
        {:else if section.layout === 'editorial'}
          <!-- Articles — 60/40 split: lead article + vertical list -->
          <ArticleEditorial items={section.items} {access} />
        {:else if section.layout === 'bento'}
          <!-- Discover Mix — varied-tile grid with 1 hero + 4 minor + 1 wide -->
          <DiscoverMix items={section.items} {access} />
        {:else if section.layout === 'carousel' && section.items.length === 2}
          <!-- Exactly 2 carousel items fill the row as a grid (no chrome) -->
          <div class="feed-pair">
            {#each section.items as item (item.id)}
              {@render gridCard(item, 'grid', section.mixedTypes ?? false)}
            {/each}
          </div>
        {:else}
          <!-- Default: horizontally-scrolling carousel. Mixed-type rows
               render heterogeneously — audio uses ContentCard's auto-
               promote row, video/article keep the vertical tile. -->
          <Carousel
            items={section.items}
            itemMinWidth="16rem"
            gap="var(--space-4)"
            ariaLabel={section.title}
          >
            {#snippet renderItem(c)}
              {@render gridCard(c, 'grid', section.mixedTypes ?? false)}
            {/snippet}
          </Carousel>
        {/if}
      </section>
    {/if}

    <!-- Subscribe CTA — anchor beat inserted once, right after the section
         chosen by `subscribeAnchorId` (typically Articles). Falls back if
         the org has no articles section so the banner still appears.

         Pricing is streamed (subscriptionPricing promise): the banner
         renders immediately with the value-prop grid + proof strip + CTA
         + fallback "Cancel anytime" microcopy. When pricing resolves the
         banner re-renders with "From £X/mo" swapped in. No skeleton is
         needed — the price row is additive; its absence is a valid state.
         previewContent + memberCount props are wired even when undefined,
         so SubscribeCTA's internal guards decide whether to render each row. -->
    {#if section.id === subscribeAnchorId && shouldShowSubscribeCTA}
      {@const orgId = data.org.id}
      {@const orgDisplayName = data.org.name ?? 'us'}
      {@const previewProp =
        subscribePreview.length > 0 ? subscribePreview : undefined}
      {#await data.subscriptionPricing}
        <!-- Pending: banner without pricing. Reads as the legacy CTA
             with the new grid/proof/preview — price swaps in on resolve. -->
        <SubscribeCTA
          organizationId={orgId}
          orgName={orgDisplayName}
          isAuthenticated={!!user}
          previewContent={previewProp}
          totalPreviewCount={subscribePreviewTotal}
        />
      {:then pricing}
        <SubscribeCTA
          organizationId={orgId}
          orgName={orgDisplayName}
          isAuthenticated={!!user}
          startingPriceCents={pricing?.startingPriceCents}
          monthlyPriceCents={pricing?.monthlyPriceCents}
          annualPriceCents={pricing?.annualPriceCents}
          currency={pricing?.currency}
          previewContent={previewProp}
          totalPreviewCount={subscribePreviewTotal}
        />
      {:catch}
        <!-- Pricing fetch failed — render without price, log nothing
             (the error is non-critical to the banner). -->
        <SubscribeCTA
          organizationId={orgId}
          orgName={orgDisplayName}
          isAuthenticated={!!user}
          previewContent={previewProp}
          totalPreviewCount={subscribePreviewTotal}
        />
      {/await}
    {/if}
  {/each}

  <!-- Bottom catalogue — flat grid of every published item. Carries the
       page forward from curated carousels → exhaustive browse. -->
  {#if data.allContent.length > 0}
    <section class="feed-section feed-section--catalogue">
      <header class="lede">
        <p class="lede__eyebrow">The Catalogue</p>
        <hr class="lede__rule" aria-hidden="true" />
        <div class="lede__title-row">
          <h2 class="lede__title">All content</h2>
          <a href="/explore" class="lede__view-all">
            {m.org_view_all_content()}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>
      <!-- Masonry packs audio rows alongside taller video/article tiles
           via the shared utility — each item keeps its native aspect
           rather than being normalised to one rhythm. -->
      <div class="content-grid content-grid--masonry">
        {#each data.allContent as item (item.id)}
          {@render gridCard(item, 'grid', false)}
        {/each}
      </div>
    </section>
  {:else}
    <div class="empty-state">
      <p>{m.org_no_content_yet()}</p>
    </div>
  {/if}

  <!--
    Contributors masthead — kept as a dedicated section below the main
    feed so creator discovery remains a first-class surface. Treatment:
    magazine masthead (small-caps eyebrow, display title, hairline,
    horizontal carousel). Streamed so it doesn't delay first paint.
  -->
  <section class="section section--stacked">
    <header class="lede">
      <p class="lede__eyebrow">The Contributors</p>
      <hr class="lede__rule" aria-hidden="true" />
      <div class="lede__title-row">
        <h2 class="lede__title">{m.org_creators_preview_title()}</h2>
        {#await data.creators then creators}
          {#if (creators?.total ?? 0) > (creators?.items?.length ?? 0)}
            <a href="/creators" class="lede__view-all">
              View all {creators?.total ?? 0}
              <span aria-hidden="true">→</span>
            </a>
          {/if}
        {/await}
      </div>
    </header>

    {#await data.creators}
      <div class="creators-skeleton">
        {#each Array(4) as _}
          <SkeletonCreatorCard />
        {/each}
      </div>
    {:then creators}
      {#if creators?.items?.length > 0}
        <Carousel
          items={creators.items}
          itemMinWidth="calc(var(--space-24) * 3)"
          gap="var(--space-6)"
          ariaLabel={m.org_creators_preview_title()}
        >
          {#snippet renderItem(creator: typeof creators.items[number])}
            <CreatorCarouselCard
              name={creator.name}
              username={creator.username}
              avatarUrl={creator.avatarUrl}
              bio={creator.bio}
              role={creator.role}
            />
          {/snippet}
        </Carousel>
      {/if}
    {/await}
  </section>

  </div>
</div>

{#if introVideoUrl && videoActive && !isDesktop}
  <IntroVideoModal open={true} src={introVideoUrl} onclose={() => { videoActive = false; }} />
{/if}

<!-- Sticky subscribe CTA — appears once the hero has scrolled above the
     viewport (mirrors the audio mini-player's appearance pattern). Hidden
     for users who are already subscribed to this org, and dismissable with
     a 4-day TTL via the dismissalCollection. -->
{#if shouldShowSubscribeCTA && data.org?.id}
  <SubscribeStickyBar
    orgName={orgName}
    dismissKey={`subscribe-cta:${data.org.id}`}
  />
{/if}

<style>
  .org-landing {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  /* ══════════════════════════════════════════
     HERO — full viewport, bottom-left editorial
     Brand gradient overlay guarantees text contrast
     regardless of shader brightness.
     ══════════════════════════════════════════ */
  .hero {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    color: var(--brand-hero-text, white);
  }

  /* Bottom-weighted darken over the shader for stat/CTA legibility. Sits
     ABOVE the title (z-index 1 > title's implicit 0) so it adds contrast
     to the content block sitting at the bottom of the hero. Intentionally
     subtle — orgs WITH a shader want the shader to breathe.
     Uses `hsl(0 0% 0% / α)` direct (same pattern as player.css) — semantic
     surface tokens flip to light in dark-theme orgs, which would invert
     the intended darkening effect. */
  .hero::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent 0%,
      transparent 35%,
      hsl(0 0% 0% / 0.12) 55%,
      hsl(0 0% 0% / 0.38) 80%,
      hsl(0 0% 0% / 0.55) 100%
    );
  }

  /* Shader-absent fallback backdrop — paints the hero with the org's
     brand background so the section reads as integrated with the rest
     of the page rather than a darkened plate. Rendered as `::before`
     (DOM-order sibling, no explicit z-index) so it sits BEFORE the
     title in the same stacking level — making it the title's actual
     blend backdrop. Scoped via `[data-hero-shader-active]` on
     `.org-layout` (set in the parent layout from
     `tokenOverrides['shader-preset']`) so orgs WITH a shader keep their
     current look. Title's `mix-blend-mode: difference` (set on
     `.hero__title`) gives auto-contrast against this brand-derived bg. */
  :global(.org-layout:not([data-hero-shader-active])) .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: var(--brand-bg, var(--color-background));
  }

  .hero__content {
    position: relative;
    z-index: 3;
    width: 100%;
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--space-8) var(--space-8) var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .hero__logo-wrap {
    display: inline-flex;
  }

  .hero__logo {
    --_logo-base: var(--space-14);
    height: calc(var(--_logo-base) * var(--brand-hero-logo-scale, 1));
    width: auto;
  }

  .hero__title {
    /* No z-index — lives outside hero__content so mix-blend-mode
       can composite directly against the shader canvas */
    position: relative;
    margin: 0;
    width: 100%;
    max-width: var(--container-max);
    margin-left: auto;
    margin-right: auto;
    padding: 0 var(--space-8);
    font-family: var(--font-heading);
    font-size: clamp(3.5rem, 8vw, 8rem);
    font-weight: var(--font-bold);
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: var(--brand-hero-title-color, white);
    mix-blend-mode: var(--brand-hero-title-blend, difference);
  }

  .hero__description {
    margin: 0;
    font-size: var(--text-xl);
    line-height: var(--leading-relaxed);
    max-width: 40ch;
    color: color-mix(in srgb, var(--brand-hero-text, white) 80%, transparent);
  }

  /* ── Content type pills ── */
  .hero__pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .hero__pill {
    padding: var(--space-1) var(--space-3);
    background: color-mix(in srgb, var(--brand-hero-border-tint, white) 15%, transparent);
    border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-border-tint, white) 20%, transparent);
    border-radius: var(--radius-base);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--brand-hero-text, white);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .hero__pill--category {
    text-decoration: none;
    text-transform: none;
    font-weight: var(--font-normal);
    letter-spacing: normal;
    color: color-mix(in srgb, var(--brand-hero-text-muted, white) 75%, transparent);
    border-color: color-mix(in srgb, var(--brand-hero-border-tint, white) 15%, transparent);
    background: transparent;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .hero__pill--category:hover {
    color: var(--brand-hero-text, white);
  }

  /* Separator dot between content pills and category pills */
  .hero__pills-sep {
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--brand-hero-border-tint, white) 40%, transparent);
  }

  /* ── CTAs ── */
  .hero__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .hero__cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-3) var(--space-7);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-base);
    text-decoration: none;
    transition: transform var(--duration-fast) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default),
      opacity var(--duration-fast) var(--ease-default);
  }

  .hero__cta:hover {
    transform: translateY(-2px);
  }

  .hero__cta:active {
    transform: translateY(0);
  }

  .hero__cta--primary {
    background: var(--brand-hero-cta-bg, white);
    /* Mix brand with black to guarantee WCAG AA contrast on white background */
    color: var(--brand-hero-cta-text, color-mix(in oklch, var(--color-brand-primary) 75%, black));
    box-shadow: var(--shadow-md);
  }

  .hero__cta--primary:hover {
    box-shadow: var(--shadow-xl);
  }

  .hero__cta--glass {
    background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 12%, transparent);
    color: var(--brand-hero-glass-text, white);
    border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
  }

  .hero__cta--glass:hover {
    background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 20%, transparent);
    box-shadow: var(--shadow-md);
  }

  .hero__play {
    gap: var(--space-2);
  }

  .hero__follow--active {
    background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
    border-color: color-mix(in srgb, var(--brand-hero-glass-tint, white) 40%, transparent);
  }

  /* ── Centered play button (desktop only) ──
     Large glass circle in the middle of the hero viewport.
     Replaces the small text button on desktop. */
  .hero__play-center {
    display: none;
  }

  @media (--breakpoint-md) {
    .hero__play-center {
      display: flex;
      position: absolute;
      top: 38%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
      align-items: center;
      justify-content: center;
      width: var(--space-24);
      height: var(--space-24);
      border-radius: var(--radius-base);
      background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 12%, transparent);
      border: var(--border-width) solid color-mix(in srgb, var(--brand-hero-glass-tint, white) 25%, transparent);
      backdrop-filter: blur(var(--blur-md));
      -webkit-backdrop-filter: blur(var(--blur-md));
      color: var(--brand-hero-glass-text, white);
      cursor: pointer;
      transition: transform var(--duration-normal) var(--ease-out),
        background var(--duration-fast) var(--ease-default),
        box-shadow var(--duration-normal) var(--ease-default);
      animation: hero-play-pulse 3s ease-in-out infinite;
    }

    .hero__play-center:hover {
      transform: translate(-50%, -50%) scale(1.1);
      background: color-mix(in srgb, var(--brand-hero-glass-tint, white) 20%, transparent);
      box-shadow: 0 0 0 var(--space-3) color-mix(in srgb, var(--brand-hero-glass-tint, white) 8%, transparent);
    }

    .hero__play-center:focus-visible {
      outline: var(--border-width-thick) solid var(--color-focus);
      outline-offset: var(--space-1);
    }

    .hero__play-center:active {
      transform: translate(-50%, -50%) scale(0.96);
    }

    /* Hide the small text "Watch Intro" button on desktop —
       replaced by the centered play button */
    .hero__play {
      display: none;
    }
  }

  @keyframes hero-play-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand-hero-glass-tint, white) 15%, transparent); }
    50% { box-shadow: 0 0 0 var(--space-4) color-mix(in srgb, var(--brand-hero-glass-tint, white) 0%, transparent); }
  }

  /* ── Hero video-playing state ──
     Fades out hero content when inline video is active.
     Title goes first (no delay), content follows (50ms stagger). */
  .hero__title,
  .hero__content {
    transition: opacity var(--duration-slow) var(--ease-out),
      transform var(--duration-slow) var(--ease-out);
  }

  .hero--video-playing .hero__title {
    opacity: 0;
    transform: translateY(var(--space-4));
    pointer-events: none;
  }

  .hero--video-playing .hero__content {
    opacity: 0;
    transform: translateY(var(--space-4));
    pointer-events: none;
    transition-delay: 50ms;
  }

  /* Reduce gradient overlay when video plays so it doesn't darken the video */
  .hero--video-playing::after {
    opacity: 0.3;
    transition: opacity var(--duration-slow) var(--ease-out);
  }

  @media (prefers-reduced-motion: reduce) {
    .hero__play-center {
      animation: none;
    }
  }

  /* ── Stats — big numbers ── */
  .hero__stats {
    display: flex;
    gap: var(--space-10);
    padding-top: var(--space-6);
    border-top: var(--border-width) solid color-mix(in srgb, var(--brand-hero-border-tint, white) 25%, transparent);
    margin-top: var(--space-2);
  }

  .hero__stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .hero__stat-number {
    font-family: var(--font-heading);
    font-size: clamp(2rem, 4vw, 3.5rem);
    font-weight: var(--font-bold);
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--brand-hero-text, white);
  }

  .hero__stat-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: color-mix(in srgb, var(--brand-hero-text-muted, white) 62%, transparent);
  }

  /* ══════════════════════════════════════════
     CONTENT AREA
     Overlaps hero via negative margin. Gradient background
     fades from transparent (blurred shader visible) to opaque.
     Mask fades the element in over the overlap zone so there
     is no hard edge at the hero/content boundary.
     ══════════════════════════════════════════ */
  .content-area {
    position: relative;
    z-index: 1;
    /* Pull up into hero for seamless overlap */
    margin-top: -250px;
    padding-top: 250px;
    /* Blur the fixed shader behind for frosted-glass effect */
    backdrop-filter: blur(var(--blur-2xl));
    -webkit-backdrop-filter: blur(var(--blur-2xl));
    /* Gradient: lightly tinted at top, becomes opaque to match
       content-page blur density further down */
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-brand-primary) 20%, color-mix(in srgb, var(--color-background) 40%, transparent)) 0%,
      color-mix(in srgb, var(--color-background) 55%, transparent) 300px,
      color-mix(in srgb, var(--color-background) 70%, transparent) 600px,
      color-mix(in srgb, var(--color-background) 80%, transparent) 900px,
      color-mix(in srgb, var(--color-background) 88%, transparent) 1200px
    );
    /* Mask fades entire element in over the overlap zone */
    mask-image: linear-gradient(to bottom, transparent 0%, black 250px);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 250px);
  }

  /*
    Generic page section shell — centered, gutter padding, capped at the
    project's --container-xl. Stacked sections use flex to space the header
    from the content grid below it.
  */
  .section {
    padding: var(--space-12) var(--space-6);
    max-width: var(--container-xl);
    width: 100%;
    margin: 0 auto;
  }

  .section--stacked {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    /* Contributors section is far below the fold. content-visibility: auto
       lets the browser skip its render/paint until it's scrolled near.
       contain-intrinsic-size reserves realistic space so the scroll bar
       and page layout stay stable. HTML remains in the DOM for SEO. */
    content-visibility: auto;
    contain-intrinsic-size: auto 400px;
  }

  /* ══════════════════════════════════════════
     FEED — per-domain section bands
     Each .feed-section renders lede + (spread(s) | carousel) stack.
     Format chosen by item count at render time. Page-background
     carries through; rhythm comes from vertical spacing and the
     lede rule.
     ══════════════════════════════════════════ */
  /* Spotlight carousel wrapper — sits OUTSIDE .feed-section so it can
     break out of the page's max-width and span the entire viewport.
     Each slide is `itemMinWidth: 100%` + `gap: 0`, so the scroll-snap
     pages one full-viewport-width slide at a time with zero edge peek.
     The Spotlight inside re-constrains its content via its own
     `.spotlight__container { max-width: var(--container-max) }`, so
     readable content centres within the full-bleed slide. Vertical
     padding only — no horizontal padding (would shrink the slide
     viewport and reintroduce the cutoff). */
  .spotlight-carousel {
    width: 100%;
    margin: 0;
    padding-block: var(--space-6);
  }

  /* Peek-style pagination: 90vw slide + 5vw track padding each side
     centres slide 1 at scroll-start (scroll-snap-align alone can't —
     the browser refuses to scroll past 0). vw not % because percentages
     resolve against the padded content box and shrink the slide. */
  .spotlight-carousel :global(.carousel__track) {
    padding-inline: 5vw;
    scroll-padding-inline: 0;
  }

  .spotlight-carousel :global(.carousel__item) {
    flex: 0 0 90vw;
    min-width: 0;
    max-width: 90vw;
    scroll-snap-align: center;
  }

  /* Desktop: 80vw / 10vw so the peek (~144px on a 1440 monitor) reads
     as visible content. Mobile's 5vw peek (~20px) is fine at thumb
     distance but gets misread as page gap on desktop. */
  @media (--breakpoint-md) {
    .spotlight-carousel :global(.carousel__track) {
      padding-inline: 10vw;
    }

    .spotlight-carousel :global(.carousel__item) {
      flex: 0 0 80vw;
      max-width: 80vw;
    }
  }

  /* Inset each slide's card so adjacent cards have a visible gutter at
     the peek boundary — without this, slide 1's right edge butts
     directly against slide 2's left edge and the cards read as one
     continuous strip. `--space-3` (12px) on each side composes to a
     24px visual gap between cards: registers as deliberate without
     eating the peek. width: 100% + min-width 0 prevents the section's
     intrinsic min-content from overshooting the slide width on mobile. */
  .spotlight-carousel :global(.spotlight) {
    width: 100%;
    min-width: 0;
    padding-inline: var(--space-3);
  }

  /* Let the spotlight card fill the slide. The single-spotlight case
     keeps its `max-width: calc(--space-24 * 10)` (~960px) cap to stay
     readable as a lone hero on huge monitors; in the carousel that cap
     would leave empty space on each side and break the peek illusion
     (peek would show empty padding rather than the next card). */
  .spotlight-carousel :global(.spotlight__card) {
    max-width: none;
  }

  .feed-section {
    width: 100%;
    max-width: var(--container-xl);
    margin: 0 auto;
    /* Block padding drives the gap between adjacent sections — tight
       enough that the page reads as one continuous feed, loose enough
       that each lede has room to breathe. */
    padding: var(--space-6) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    /* Below-fold feed sections skip render/paint until scroll brings
       them into range. HTML stays in DOM for SEO; visual rendering
       is deferred. Size hint matches typical lede + carousel height
       so the scroll bar and layout stay stable before first paint. */
    content-visibility: auto;
    contain-intrinsic-size: auto 600px;
  }

  .feed-section--catalogue {
    /* The catalogue earns a little more vertical air — it's the
       "continuing on" exhaustive browse band at the bottom of the
       page and benefits from separation from the carousel stack above. */
    padding-block: var(--space-10);
  }

  /* Flat tiled catalogue grid for non-masonry surfaces. The :not() guard
     lets `.content-grid--masonry` from utilities.css take over without
     specificity gymnastics. */
  .content-grid:not(.content-grid--masonry) {
    display: grid;
    grid-template-columns: repeat(
      auto-fill,
      minmax(min(100%, 22rem), 1fr)
    );
    gap: 0;
    align-items: stretch;
  }

  /* Flatten ContentCard chrome inside the catalogue grid + carousel tracks
     so adjacent cards merge via their inner thumbnail padding rather than
     doubled borders. Hover still lifts the card for feedback. */
  .content-grid :global(.cc),
  .feed-section :global(.carousel__item .cc),
  .feed-pair :global(.cc) {
    border-color: transparent;
    background: transparent;
  }

  .content-grid :global(.cc:hover),
  .content-grid :global(.cc:focus-within:has(:focus-visible)),
  .feed-section :global(.carousel__item .cc:hover),
  .feed-section :global(.carousel__item .cc:focus-within:has(:focus-visible)),
  .feed-pair :global(.cc:hover),
  .feed-pair :global(.cc:focus-within:has(:focus-visible)) {
    border-color: color-mix(in srgb, var(--color-border) 50%, transparent);
    background: color-mix(in srgb, var(--color-surface-card) 70%, transparent);
  }

  /* ══════════════════════════════════════════
     FEED PAIR — exactly-2-items section layout
     Two tiles side-by-side filling the row at 50/50 on desktop so
     the section doesn't leave a "carousel's worth" of empty space
     to the right of a short item list.
     ══════════════════════════════════════════ */
  .feed-pair {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
    align-items: stretch;
  }

  @media (--below-sm) {
    .feed-pair {
      grid-template-columns: 1fr;
    }
  }

  /* ══════════════════════════════════════════
     CATEGORY BAR — sticky quick-nav at top of feed
     Full-bleed bar that sticks to viewport top when scrolled past.
     Pills jump straight into /explore?category=X.

     The frosted backdrop + bottom border only appear when the bar is
     "stuck" (detected via IntersectionObserver on the sentinel above).
     Before sticking, the bar has no chrome so it blends into the
     hero/content-area gradient underneath.
     ══════════════════════════════════════════ */
  .category-bar__sentinel {
    /* 1px tall marker that sits just above the sticky bar. When it
       scrolls out of view, the observer flips categoryBarStuck. */
    height: 1px;
    width: 100%;
    pointer-events: none;
  }

  .category-bar {
    position: sticky;
    top: 0;
    z-index: 5;
  }

  /* Gradient overlay lives on a pseudo-element so it can fade in via
     opacity when the bar sticks — transitioning from "no background"
     to "linear-gradient" directly on the bar wouldn't animate (gradient
     is background-image, not background-color). Pseudo sits behind the
     pills in document order so no z-index wrangling needed. */
  .category-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-background) 92%, transparent) 0%,
      color-mix(in srgb, var(--color-background) 55%, transparent) 55%,
      transparent 100%
    );
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-normal) var(--ease-default);
  }

  .category-bar--stuck::before {
    opacity: 1;
  }

  .category-bar__inner {
    position: relative;
    z-index: 1;
    max-width: var(--container-xl);
    margin: 0 auto;
    padding: var(--space-3) var(--space-6);
  }

  .category-pills__row {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--space-2);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .category-pills__row::-webkit-scrollbar {
    display: none;
  }

  .category-pills__pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 55%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-card) 40%, transparent);
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.01em;
    line-height: 1.4;
    color: var(--color-text-primary);
    text-decoration: none;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .category-pills__pill:hover {
    background: var(--color-surface-card);
    border-color: var(--color-text-primary);
  }

  .category-pills__pill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Active pill reflects the /explore filter the user is about to land on
     (or the "All" pill when no ?category param is present). Inverted
     surface gives the row a clear anchor without depending on brand tint. */
  .category-pills__pill--active {
    background: var(--color-text-primary);
    border-color: var(--color-text-primary);
    color: var(--color-background);
  }

  .category-pills__pill--active:hover {
    background: var(--color-text-primary);
    border-color: var(--color-text-primary);
  }

  .category-pills__label {
    /* Capitalized on the server; label is intentionally a bare span so
       baseline alignment with the count stays predictable. */
    display: inline;
  }

  .category-pills__count {
    font-weight: var(--font-normal);
    font-variant-numeric: tabular-nums;
    color: color-mix(in oklch, currentColor 60%, transparent);
  }

  .category-pills__pill--active .category-pills__count {
    /* On the inverted active pill, currentColor is already --color-background,
       so mixing with transparent lightens it into a muted chip. */
    color: color-mix(in oklch, currentColor 70%, transparent);
  }

  @media (--below-md) {
    .category-bar__inner {
      padding: var(--space-3) var(--space-4);
    }
  }

  /* Tablet — 2 chunky columns for the catalogue grid */
  @media (--below-lg) {
    .content-grid {
      grid-template-columns: repeat(
        auto-fill,
        minmax(min(100%, 18rem), 1fr)
      );
    }
  }

  /* Mobile — stricter 2-column grid */
  @media (--below-md) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .feed-section {
      padding: var(--space-5) var(--space-4);
    }

    /* Align bookend sections (Continue Watching, Contributors) with the
       feed's 16px inline gutter so every row on the page shares one
       vertical edge on mobile. Matches explore/creators/library pages. */
    .section {
      padding: var(--space-8) var(--space-4);
    }
  }

  @media (--below-sm) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Mobile: feed carousels use a deliberate 80/20 split so the next
     tile is always peeking at the trailing edge — makes the row's
     scrollability unmistakable on a phone viewport. Scoped to feed
     sections so other carousels (Contributors) keep their sizing. */
  @media (--below-md) {
    .feed-section :global(.carousel__item) {
      min-width: 80%;
      max-width: 80%;
    }
  }

  /*
    .lede — shared editorial section-header used by every content block on
    the landing page. Structure (top to bottom):
      eyebrow   → small-caps contextual label
      rule      → short heavy hairline (decorative chapter mark)
      title-row → display-type section title + optional flush-right view-all
    Kept as a single component so every section on the page has the same
    editorial rhythm.
  */
  .lede {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .lede__eyebrow {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-tertiary);
  }

  .lede__rule {
    width: var(--space-10);
    height: 0;
    margin: 0;
    border: none;
    border-top: var(--border-width-thick) var(--border-style) var(--color-text-primary);
    opacity: var(--opacity-80);
  }

  .lede__title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .lede__title {
    margin: 0;
    font-family: var(--font-heading);
    /* Fluid display ramp anchored to typography tokens */
    font-size: clamp(var(--text-2xl), var(--_fluid-lede, 3.5vw), var(--text-4xl));
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tighter);
    color: var(--color-text-primary);
    /* Cap line length at a comfortable editorial measure */
    max-width: 32ch;
  }

  .lede__view-all {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .lede__view-all:hover {
    color: var(--color-text-primary);
  }

  .lede__view-all > span {
    display: inline-block;
    transition: transform var(--duration-normal) var(--ease-out);
  }

  .lede__view-all:hover > span {
    transform: translateX(var(--space-1));
  }

  .empty-state {
    text-align: center;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-muted);
  }

  .empty-state p {
    margin: 0;
    font-size: var(--text-lg);
  }

  /* Skeleton row used while the streamed creators promise resolves.
     overflow:hidden prevents skeletons bleeding past the section edge. */
  .creators-skeleton {
    display: flex;
    gap: var(--space-5);
    overflow: hidden;
  }

  .creators-skeleton :global(> *) {
    flex: 0 0 calc(var(--space-24) * 3);
  }

  /* ══════════════════════════════════════════
     RESPONSIVE
     ══════════════════════════════════════════ */
  @media (--below-md) {
    /* Replace expensive backdrop-filter blur with higher-opacity background
       on mobile — avoids per-frame GPU blur during scroll over WebGL canvas */
    .content-area {
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--color-brand-primary) 30%, color-mix(in srgb, var(--color-background) 50%, transparent)) 0%,
        color-mix(in srgb, var(--color-background) 70%, transparent) 300px,
        color-mix(in srgb, var(--color-background) 85%, transparent) 600px,
        var(--color-background) 900px
      );
    }

    .hero__content {
      padding: var(--space-6) var(--space-5) var(--space-8);
    }

    .hero__actions {
      flex-direction: column;
      width: 100%;
    }

    .hero__cta {
      width: 100%;
      justify-content: center;
    }

    .hero__stats {
      gap: var(--space-6);
      flex-wrap: wrap;
    }
  }

  @media (--below-sm) {
    .hero {
      min-height: 115vh;
      min-height: 115dvh;
    }

    .hero__content {
      padding: var(--space-4) var(--space-4) var(--space-10);
    }

    .hero__logo {
      --_logo-base: var(--space-11);
    }

    .hero__stats {
      gap: var(--space-5);
    }
  }

  /* Skeleton shimmer is provided by the SkeletonCreatorCard primitive,
     so no page-level skeleton CSS is needed here. */

  /* ══════════════════════════════════════════
     HERO LAYOUT VARIANTS
     Driven by data-hero-layout attribute on
     .org-layout (set by the org layout component).
     Layouts control POSITIONING only — element
     visibility is controlled separately via
     data-hero-hide-* attributes.
     ══════════════════════════════════════════ */

  /* ── Centered ── */
  :global([data-hero-layout="centered"]) .hero {
    justify-content: center;
    align-items: center;
  }

  :global([data-hero-layout="centered"]) .hero__title {
    text-align: center;
  }

  :global([data-hero-layout="centered"]) .hero__content {
    align-items: center;
    text-align: center;
  }

  :global([data-hero-layout="centered"]) .hero__description {
    margin-left: auto;
    margin-right: auto;
  }

  :global([data-hero-layout="centered"]) .hero__pills {
    justify-content: center;
  }

  :global([data-hero-layout="centered"]) .hero__actions {
    justify-content: center;
  }

  :global([data-hero-layout="centered"]) .hero__stats {
    justify-content: center;
  }

  /* ── Logo Hero ── positioning: centered, enlarged logo */
  :global([data-hero-layout="logo-hero"]) .hero {
    justify-content: center;
    align-items: center;
  }

  :global([data-hero-layout="logo-hero"]) .hero__content {
    align-items: center;
    text-align: center;
  }

  :global([data-hero-layout="logo-hero"]) .hero__logo {
    --_logo-base: var(--space-48);
  }

  :global([data-hero-layout="logo-hero"]) .hero__description {
    margin-left: auto;
    margin-right: auto;
  }

  :global([data-hero-layout="logo-hero"]) .hero__pills {
    justify-content: center;
  }

  :global([data-hero-layout="logo-hero"]) .hero__actions {
    justify-content: center;
  }

  :global([data-hero-layout="logo-hero"]) .hero__stats {
    justify-content: center;
  }

  /* ── Minimal ── positioning: title centered large, CTAs at bottom */
  :global([data-hero-layout="minimal"]) .hero {
    justify-content: center;
    align-items: center;
  }

  :global([data-hero-layout="minimal"]) .hero__title {
    text-align: center;
    font-size: clamp(4rem, 10vw, 10rem);
  }

  :global([data-hero-layout="minimal"]) .hero__content {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    max-width: var(--container-max);
    margin: 0 auto;
    padding: var(--space-8);
    align-items: center;
  }

  :global([data-hero-layout="minimal"]) .hero__pills {
    justify-content: center;
  }

  :global([data-hero-layout="minimal"]) .hero__actions {
    justify-content: center;
  }

  :global([data-hero-layout="minimal"]) .hero__stats {
    justify-content: center;
  }

  /* ── Split ── restrained luxury: content left half, canvas right half.
     padding-right reserves the right portion for the shader to breathe —
     no markup changes, no centring overrides. The title block keeps its
     container-centred alignment; its text simply wraps at 50%. */
  :global([data-hero-layout="split"]) .hero__title,
  :global([data-hero-layout="split"]) .hero__content {
    padding-right: 50%;
  }

  /* ── Magazine ── stats lifted to top-right as a vertical masthead.
     Title stays bottom-left classic. Description picks up small-caps
     treatment for a print-editorial feel.

     Making `.hero__content` static lets the stats' absolute positioning
     escape to `.hero` (the hero viewport) rather than anchoring to the
     bottom-aligned content column. */
  :global([data-hero-layout="magazine"]) .hero__content {
    position: static;
  }

  :global([data-hero-layout="magazine"]) .hero__stats {
    position: absolute;
    top: var(--space-10);
    right: var(--space-8);
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    gap: var(--space-5);
    border-top: none;
    border-right: var(--border-width) solid
      color-mix(in srgb, var(--brand-hero-border-tint, white) 30%, transparent);
    padding-top: 0;
    padding-right: var(--space-5);
    margin-top: 0;
    z-index: 3;
  }

  :global([data-hero-layout="magazine"]) .hero__stat-number {
    font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  }

  :global([data-hero-layout="magazine"]) .hero__description {
    font-variant-caps: all-small-caps;
    letter-spacing: var(--tracking-wider);
    font-size: var(--text-base);
  }

  /* ── Asymmetric ── title top-right, content bottom-left.

     Title is absolutely positioned at the top so toggling it off never
     affects content's flex-end position. A previous version used
     `justify-content: space-between` on `.hero`, which reflowed the
     sole remaining flex item (content) to the top when the title was
     hidden — the exact "things jump to the top" bug. */
  :global([data-hero-layout="asymmetric"]) .hero__title {
    position: absolute;
    top: var(--space-10);
    left: 0;
    right: 0;
    text-align: right;
    margin-top: 0;
  }

  /* ── Portrait ── everything right-aligned in a narrow right column.
     Mirror of default with text-align: right. Narrow via padding-left. */
  :global([data-hero-layout="portrait"]) .hero__title {
    text-align: right;
    padding-left: 55%;
  }

  :global([data-hero-layout="portrait"]) .hero__content {
    align-items: flex-end;
    text-align: right;
    padding-left: 55%;
  }

  :global([data-hero-layout="portrait"]) .hero__description {
    margin-left: auto;
  }

  :global([data-hero-layout="portrait"]) .hero__pills,
  :global([data-hero-layout="portrait"]) .hero__actions,
  :global([data-hero-layout="portrait"]) .hero__stats {
    justify-content: flex-end;
  }

  /* ── Gallery ── museum/cinema: huge title centred at top, content
     flows horizontally as a single strip at the bottom (row-wrap).

     Same fix as asymmetric — title absolutely positioned at the top
     so hiding it never shifts the content strip upward. */
  :global([data-hero-layout="gallery"]) .hero__title {
    position: absolute;
    top: var(--space-12);
    left: 0;
    right: 0;
    text-align: center;
    font-size: clamp(4rem, 10vw, 9rem);
    margin-top: 0;
  }

  :global([data-hero-layout="gallery"]) .hero__content {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-8);
  }

  :global([data-hero-layout="gallery"]) .hero__description {
    max-width: 30ch;
    margin: 0;
  }

  :global([data-hero-layout="gallery"]) .hero__stats {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
    gap: var(--space-6);
  }

  :global([data-hero-layout="gallery"]) .hero__stat-number {
    font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  }

  /* ── Stacked ── Swiss typographic: one word per line.
     `word-spacing: 100vw` is the classic CSS-only trick to force each
     word onto its own line without touching markup. */
  :global([data-hero-layout="stacked"]) .hero__title {
    word-spacing: 100vw;
    line-height: 0.9;
    font-size: clamp(3rem, 7vw, 6.5rem);
  }

  /* ══════════════════════════════════════════
     HERO ENTRANCE ANIMATIONS
     Staggered choreography on initial mount.

     Title uses `clip-path` (not opacity/transform) so it never creates
     a stacking context — preserving `mix-blend-mode: difference`
     against the shader canvas throughout the reveal.

     Content children use opacity + translateY (they have no blend-mode
     dependency). Reduced-motion is handled globally by motion.css — it
     collapses every duration to 0.01ms, so these animations vanish
     automatically for users who have the preference set.
     ══════════════════════════════════════════ */
  @keyframes hero-title-reveal {
    from { clip-path: inset(0 0 100% 0); }
    to { clip-path: inset(0 0 0 0); }
  }

  @keyframes hero-rise {
    from {
      opacity: 0;
      transform: translateY(var(--space-4));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .hero__title {
    animation: hero-title-reveal var(--duration-slower) var(--ease-smooth) backwards;
  }

  .hero__logo-wrap,
  .hero__description,
  .hero__pills,
  .hero__actions,
  .hero__stats {
    animation: hero-rise var(--duration-slower) var(--ease-smooth) backwards;
  }

  .hero__logo-wrap { animation-delay: 150ms; }
  .hero__description { animation-delay: 250ms; }
  .hero__pills { animation-delay: 350ms; }
  .hero__actions { animation-delay: 450ms; }
  .hero__stats { animation-delay: 550ms; }

  /* When the hero switches to video-playing mode we want the existing
     fade-out transition to own the animation — not the entrance keyframes.
     Setting `animation: none` on the playing state cedes control to the
     transition property already defined on .hero__title / .hero__content. */
  .hero--video-playing .hero__title,
  .hero--video-playing .hero__logo-wrap,
  .hero--video-playing .hero__description,
  .hero--video-playing .hero__pills,
  .hero--video-playing .hero__actions,
  .hero--video-playing .hero__stats {
    animation: none;
  }

  /* ── Layout mobile overrides ── */
  @media (--below-md) {
    :global([data-hero-layout="centered"]) .hero__actions,
    :global([data-hero-layout="logo-hero"]) .hero__actions,
    :global([data-hero-layout="minimal"]) .hero__actions,
    :global([data-hero-layout="split"]) .hero__actions,
    :global([data-hero-layout="magazine"]) .hero__actions,
    :global([data-hero-layout="asymmetric"]) .hero__actions,
    :global([data-hero-layout="portrait"]) .hero__actions,
    :global([data-hero-layout="gallery"]) .hero__actions,
    :global([data-hero-layout="stacked"]) .hero__actions {
      flex-direction: column;
      width: 100%;
    }

    :global([data-hero-layout="logo-hero"]) .hero__logo {
      --_logo-base: var(--space-32);
    }

    /* Collapse asymmetric splits on mobile — not enough horizontal room
       for the padding-reserved empty halves to feel intentional. */
    :global([data-hero-layout="split"]) .hero__title,
    :global([data-hero-layout="split"]) .hero__content,
    :global([data-hero-layout="portrait"]) .hero__title,
    :global([data-hero-layout="portrait"]) .hero__content {
      padding-right: var(--space-5);
      padding-left: var(--space-5);
    }

    :global([data-hero-layout="portrait"]) .hero__title,
    :global([data-hero-layout="portrait"]) .hero__content {
      text-align: left;
      align-items: flex-start;
    }

    :global([data-hero-layout="portrait"]) .hero__pills,
    :global([data-hero-layout="portrait"]) .hero__actions,
    :global([data-hero-layout="portrait"]) .hero__stats {
      justify-content: flex-start;
    }

    /* Magazine stats: re-flow inline at the bottom on mobile */
    :global([data-hero-layout="magazine"]) .hero__stats {
      position: static;
      flex-direction: row;
      align-items: flex-start;
      text-align: left;
      border-right: none;
      border-top: var(--border-width) solid
        color-mix(in srgb, var(--brand-hero-border-tint, white) 25%, transparent);
      padding-top: var(--space-6);
      padding-right: 0;
      margin-top: var(--space-2);
    }

    /* Gallery: drop the horizontal content strip back to column flow */
    :global([data-hero-layout="gallery"]) .hero__content {
      flex-direction: column;
      align-items: flex-start;
    }

    :global([data-hero-layout="asymmetric"]) .hero__title {
      text-align: left;
    }
  }

  /* ══════════════════════════════════════════
     HERO ELEMENT VISIBILITY
     Individual element toggles — independent of
     layout. Driven by data-hero-hide-* attributes
     on .org-layout.
     ══════════════════════════════════════════ */

  :global([data-hero-hide-stats]) .hero__stats {
    display: none;
  }

  :global([data-hero-hide-pills]) .hero__pills {
    display: none;
  }

  :global([data-hero-hide-description]) .hero__description {
    display: none;
  }

  :global([data-hero-hide-logo]) .hero__logo-wrap {
    display: none;
  }

  /* Title sr-only: visually hidden but stays in DOM for SEO/a11y */
  :global([data-hero-hide-title]) .hero__title {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
