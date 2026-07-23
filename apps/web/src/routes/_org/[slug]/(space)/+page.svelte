<!--
  @component OrgLandingPage

  Organization landing page with dramatic hero section over shader background.
  Content anchored bottom-left, editorial layout with big stat numbers.
  Structure adapts to any brand via design tokens.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { deriveContentAccessKind } from '$lib/utils/content-access';
  import { CreatorCarouselCard, SkeletonCreatorCard } from '$lib/components/ui/CreatorCard';
  import Carousel from '$lib/components/carousel/Carousel.svelte';
  import FeatureCarousel from '$lib/components/carousel/FeatureCarousel.svelte';
  import type { FeatureItem } from '$lib/components/carousel/feature-carousel.types';
  import TopicGrid from '$lib/components/topic/TopicGrid.svelte';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';
  import BrowseModule from '$lib/components/browse/BrowseModule.svelte';
  import type {
    BrowseCategory,
    BrowseItem,
    BrowseType,
  } from '$lib/components/browse/browse-module.types';
  import SubscribeCTA from '$lib/components/subscription/SubscribeCTA.svelte';
  import SubscribeStickyBar from '$lib/components/subscription/SubscribeStickyBar.svelte';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { HeroInlineVideo } from '$lib/components/ui/HeroInlineVideo';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { extractPlainText } from '@codex/validation';
  import {
    eq,
    hydrateIfNeeded,
    loadSubscriptionFromServer,
    subscriptionCollection,
    useLiveQuery,
    type SubscriptionItem,
  } from '$lib/collections';
  import { followingStore } from '$lib/client/following.svelte';
  import {
    followOrganization,
    getMyMembership,
    unfollowOrganization,
  } from '$lib/remote/org.remote';
  import { useAccessContext } from '$lib/utils/access-context.svelte';
  import { shouldShowSubscribeCta } from '$lib/utils/subscribe-cta';
  import { StructuredData } from '$lib/components/seo';
  import type { ContentItem } from './feed-types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let videoActive = $state(false);
  let isDesktop = $state(false);

  // Browse-everything filter state. The active type/topic live in LOCAL $state
  // so a tab/chip tap updates the grid SYNCHRONOUSLY — SvelteKit's shallow
  // routing (replaceState) updates history but does NOT reliably re-fire a
  // `$derived` reading `page.url.searchParams` without a load, so relying on
  // URL-as-source-of-truth left taps only taking effect on refresh (R1 bug).
  // We treat local state as authoritative and MIRROR it to the URL for
  // deep-linking/SSR; the initial values are read from the URL once (covers a
  // server render and a shared `?type`/`?category` link).
  function readActiveType(url: URL): BrowseType {
    const raw = url.searchParams.get('type');
    return raw === 'video' || raw === 'audio' || raw === 'article'
      ? raw
      : 'all';
  }
  let activeType = $state<BrowseType>(readActiveType(page.url));
  let activeCategory = $state<string | null>(
    page.url.searchParams.get('category')
  );

  /** Mirror the active filter into the URL without navigating/refetching. */
  function syncBrowseUrl() {
    if (!browser) return;
    const url = new URL(page.url);
    if (activeType !== 'all') url.searchParams.set('type', activeType);
    else url.searchParams.delete('type');
    if (activeCategory) url.searchParams.set('category', activeCategory);
    else url.searchParams.delete('category');
    replaceState(url, {});
  }

  const handleTypeChange = (type: BrowseType) => {
    activeType = type;
    syncBrowseUrl();
  };
  const handleCategoryChange = (slug: string | null) => {
    activeCategory = slug;
    syncBrowseUrl();
  };

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

  // ── Landing sections derived from the single catalogue fetch ──────────
  // Editor's picks: creator-flagged items → full-bleed feature slides.
  const featureItems = $derived<FeatureItem[]>(
    data.allContent
      .filter((c) => c.featured)
      .map((c) => ({
        id: c.id,
        title: c.title,
        kind: "Editor's pick",
        contentType: c.contentType === 'written' ? 'article' : c.contentType,
        // Flatten any stored ProseMirror/TipTap doc JSON to plain text so an
        // article pick never shows raw `{"type":"doc",…}` in its summary (R3 ②).
        description: extractPlainText(c.description),
        href: buildContentUrl(page.url, c),
        image: c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl ?? null,
      }))
  );

  // New this week: most-recent items minus anything already promoted in
  // Editor's picks (dedupe). `allContent` is server-sorted newest-first.
  const NEW_THIS_WEEK_MAX = 12;
  const newThisWeek = $derived(
    data.allContent.filter((c) => !c.featured).slice(0, NEW_THIS_WEEK_MAX)
  );

  // Curated topics (streamed). Resolved into state so "Browse by topic" and the
  // browse module's active-topic chip read it synchronously without gating the
  // awaited catalogue on the (secondary) categories promise. Effects run only
  // in the browser, so SSR renders the topic grid empty and hydration fills it.
  let resolvedCategories = $state<TopicItem[]>([]);
  $effect(() => {
    let cancelled = false;
    Promise.resolve(data.categories)
      .then((cats) => {
        if (!cancelled) resolvedCategories = cats;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });
  const browseCategories = $derived<BrowseCategory[]>(
    resolvedCategories.map((c) => ({ slug: c.slug, name: c.name }))
  );

  // Preview strip for the SubscribeCTA — member-only items ("You'll unlock:").
  // Filter allContent to subscriber/follower-gated items, cap at 5, and map
  // to the lightweight primitive shape SubscribeCTA expects. This is the
  // "honest fallback" path — if the org has no gated content, the strip
  // hides gracefully (the component checks `previewContent?.length > 0`).
  const subscribeGatedContent = $derived(
    data.allContent.filter(
      (c) => c.includedInTierId != null || c.isFollowerGated === true
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

  // Access context — tiers from server, subscription from client store (subscriptionCollection)
  const access = useAccessContext(() => ({
    subscriptionContext: data.subscriptionContext,
    isFollowing: followingStore.get(data.org.id),
    orgId: data.org.id,
  }));

  // Browse everything: the whole catalogue flattened to the browse-card shape
  // (written → article; href resolved; categorySlugs carry the topic filter).
  // Declared after `access` so the per-item access derivations resolve.
  const browseItems = $derived<BrowseItem[]>(
    data.allContent.map((c) => ({
      id: c.id,
      title: c.title,
      href: buildContentUrl(page.url, c),
      contentType: c.contentType === 'written' ? 'article' : c.contentType,
      thumbnail: c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl ?? null,
      description: c.description,
      duration: c.mediaItem?.durationSeconds ?? null,
      creator: c.creator
        ? {
            username: c.creator.name ?? undefined,
            displayName: c.creator.name ?? undefined,
          }
        : undefined,
      price:
        c.priceCents != null ? { amount: c.priceCents, currency: 'GBP' } : null,
      category: c.category ?? null,
      categorySlugs: c.categorySlugs ?? [],
      featured: c.featured ?? false,
      contentAccessType: deriveContentAccessKind(c),
      included: access.isIncluded(c),
      isFollower: access.isFollowing,
      tierName: access.getTierName(c),
    }))
  );

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

  // Only surface the Subscribe CTA when the org actually has something to
  // subscribe to. Gating on active tiers + the enableSubscriptions flag (in
  // addition to the existing "visitor lacks access" checks) stops orgs with
  // zero tiers / no Stripe account from advertising a dead /pricing page.
  // access.tiers defaults to [] and resolves async, so hasActiveTiers starts
  // false and the CTA simply defers until tiers are known — matching the
  // accessChecked-defers-render philosophy.
  const subscriptionsEnabled = $derived(data.enableSubscriptions ?? true);
  const hasActiveTiers = $derived(access.tiers.length > 0);

  const shouldShowSubscribeCTA = $derived(
    shouldShowSubscribeCta({
      hasOrgId: !!data.org?.id,
      subscriptionsEnabled,
      hasActiveTiers,
      accessChecked,
      hasOrgAccess,
    })
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
  <!-- Continue watching — server-backed cross-device resume rail (WP-6).
       Streamed; hidden when empty (logged-out visitors get an empty list). -->
  {#await data.continueWatching then resume}
    {#if resume.length > 0}
      <section class="section section--tight">
        <header class="lede">
          <p class="lede__eyebrow">Jump back in</p>
          <div class="lede__title-row">
            <h2 class="lede__title">{m.org_continue_watching_title()}</h2>
            <a href="/library" class="lede__view-all">
              {m.org_continue_watching_view_library()}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </header>
        <Carousel
          items={resume}
          itemMinWidth="18rem"
          gap="var(--space-4)"
          showArrows={false}
          ariaLabel={m.org_continue_watching_title()}
        >
          {#snippet renderItem(item)}
            <ContentCard
              variant="resume"
              shape="16:9"
              chrome="transparent"
              id={item.id}
              title={item.title}
              thumbnail={item.thumbnail}
              contentType={item.contentType}
              duration={item.duration}
              href={buildContentUrl(page.url, {
                slug: item.slug,
                id: item.id,
                organizationSlug: item.organizationSlug,
              })}
              progress={item.progress}
            />
          {/snippet}
        </Carousel>
      </section>
    {/if}
  {/await}

  <!-- Shared grid/carousel tile. `shape` drives the per-section aspect ratio
       (WP-7); chrome="transparent" lets a tile sit on the section background
       and earn chrome only on hover. -->
  {#snippet gridCard(c: ContentItem, shape: '16:9' | '1:1' | '3:4' | '3:2')}
    <ContentCard
      variant="grid"
      {shape}
      titleInCover
      chrome="transparent"
      id={c.id}
      title={c.title}
      thumbnail={c.mediaItem?.thumbnailUrl ?? c.thumbnailUrl ?? null}
      description={c.description}
      contentType={c.contentType === 'written' ? 'article' : c.contentType}
      duration={c.mediaItem?.durationSeconds ?? null}
      creator={c.creator
        ? {
            username: c.creator.name ?? undefined,
            displayName: c.creator.name ?? undefined,
          }
        : undefined}
      href={buildContentUrl(page.url, c)}
      price={c.priceCents != null
        ? { amount: c.priceCents, currency: 'GBP' }
        : null}
      contentAccessType={deriveContentAccessKind(c)}
      included={access.isIncluded(c)}
      isFollower={access.isFollowing}
      tierName={access.getTierName(c)}
      category={c.category ?? null}
      featured={c.featured ?? false}
    />
  {/snippet}

  <!-- Editor's picks — contained multi-feature carousel over content.featured
       (R3 ⑥: sits within the page's content column, not edge-to-edge). -->
  {#if featureItems.length > 0}
    <section class="section">
      <header class="lede">
        <p class="lede__eyebrow">Editor's picks</p>
      </header>
      <FeatureCarousel items={featureItems} ariaLabel="Editor's picks" />
    </section>
  {/if}

  <!-- Browse by topic — image-led curated-category grid (streamed). Each topic
       is a curated on-ramp into the Explore page's dynamic filter: clicking one
       navigates to /explore?category=<slug> (R4 ⑬), not an inline landing
       filter. -->
  {#if resolvedCategories.length > 0}
    <section class="section section--tight">
      <header class="lede">
        <p class="lede__eyebrow">Explore</p>
        <hr class="lede__rule" aria-hidden="true" />
        <div class="lede__title-row">
          <h2 class="lede__title">Browse by topic</h2>
          <a href="/explore" class="lede__view-all">
            All topics <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>
      <TopicGrid
        items={resolvedCategories}
        hrefFor={(slug) => `/explore?category=${encodeURIComponent(slug)}`}
      />
    </section>
  {/if}

  <!-- New this week — 3:4 portrait rail of recent items (featured excluded). -->
  {#if newThisWeek.length > 0}
    <section class="section section--tight">
      <header class="lede">
        <p class="lede__eyebrow">New</p>
        <hr class="lede__rule" aria-hidden="true" />
        <div class="lede__title-row">
          <h2 class="lede__title">New this week</h2>
          <a href="/explore?sort=newest" class="lede__view-all">
            All new <span aria-hidden="true">→</span>
          </a>
        </div>
      </header>
      <Carousel
        items={newThisWeek}
        itemMinWidth="24rem"
        gap="var(--space-4)"
        showArrows={false}
        ariaLabel="New this week"
      >
        {#snippet renderItem(c)}
          {@render gridCard(c, '3:4')}
        {/snippet}
      </Carousel>
    </section>
  {/if}

  <!-- Browse everything — hybrid module: type tabs + active-topic chip over a
       single uniform grid (R1). Controlled — it owns no state; the landing
       threads {type, category} from local state + handlers. -->
  <section class="section">
    <header class="lede">
      <p class="lede__eyebrow">The catalogue</p>
      <hr class="lede__rule" aria-hidden="true" />
      <div class="lede__title-row">
        <h2 class="lede__title">Browse everything</h2>
      </div>
    </header>
    {#if browseItems.length > 0}
      <BrowseModule
        items={browseItems}
        categories={browseCategories}
        type={activeType}
        category={activeCategory}
        onTypeChange={handleTypeChange}
        onCategoryChange={handleCategoryChange}
      />
    {:else}
      <div class="empty-state">
        <p>{m.org_no_content_yet()}</p>
      </div>
    {/if}
  </section>

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
          showArrows={false}
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

  <!-- Subscribe CTA — quiet closing banner at the very bottom of the feed
       (R4 ⑤): moved here so it never interrupts the content flow. Pricing is
       streamed; it renders immediately and swaps "From £X/mo" in on resolve.
       The persistent SubscribeStickyBar below is intentionally kept as the
       always-visible prompt. -->
  {#if shouldShowSubscribeCTA}
    {@const orgId = data.org.id}
    {@const orgDisplayName = data.org.name ?? 'us'}
    {@const previewProp =
      subscribePreview.length > 0 ? subscribePreview : undefined}
    {#await data.subscriptionPricing}
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
      <SubscribeCTA
        organizationId={orgId}
        orgName={orgDisplayName}
        isAuthenticated={!!user}
        previewContent={previewProp}
        totalPreviewCount={subscribePreviewTotal}
      />
    {/await}
  {/if}

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
     Scoped to `[data-hero-shader-active]` so shader-less orgs show their
     natural brand background instead of a dark overlay.
     Uses `hsl(0 0% 0% / α)` direct (same pattern as player.css) — semantic
     surface tokens flip to light in dark-theme orgs, which would invert
     the intended darkening effect. */
  :global(.org-layout[data-hero-shader-active]) .hero::after {
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
     LANDING SECTION MODIFIERS
     The redesigned landing composes its bands from self-styled
     primitives (FeatureCarousel / TopicGrid / BrowseModule / Carousel),
     so the page only needs section-rhythm modifiers here. Per-section
     card shape + transparent-until-hover chrome is now driven by the
     ContentCard `shape`/`chrome` props (WP-7), not page-level overrides.
     ══════════════════════════════════════════ */

  /* Curated rails (continue watching, browse-by-topic, new-this-week) sit
     closer together than the default section rhythm so they read as one
     continuous discovery flow. */
  .section--tight {
    padding-block: var(--space-8);
  }

  /* Align sections with the site's 16px inline gutter on mobile so every
     row shares one vertical edge (matches explore / creators / library). */
  @media (--below-md) {
    .section {
      padding: var(--space-8) var(--space-4);
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
