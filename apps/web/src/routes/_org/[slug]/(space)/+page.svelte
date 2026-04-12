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
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { Badge } from '$lib/components/ui/Badge';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { HeroInlineVideo } from '$lib/components/ui/HeroInlineVideo';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { hydrateIfNeeded } from '$lib/collections';
  import type { SubscriptionTier } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let videoActive = $state(false);
  let isDesktop = $state(false);

  onMount(() => {
    if (data.newReleases?.length) {
      hydrateIfNeeded('content', data.newReleases);
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
  const newReleases = $derived(data.newReleases ?? []);
  const stats = $derived(data.stats);
  const user = $derived(data.user);
  const introVideoUrl = $derived(data.org?.introVideoUrl ?? null);

  // Subscription context for "Included" badges — streamed from layout
  let resolvedSubCtx = $state<{ userTierSortOrder: number | null; tiers: SubscriptionTier[] } | null>(null);
  $effect(() => {
    if (data.subscriptionContext) {
      // data.subscriptionContext may be a promise (streamed) or already resolved
      Promise.resolve(data.subscriptionContext)
        .then((ctx) => { resolvedSubCtx = ctx; })
        .catch(() => { resolvedSubCtx = null; });
    }
  });

  /**
   * Determine if a content item is covered by the user's subscription.
   * Returns true only for subscriber-gated content that the user's tier covers.
   */
  function isIncluded(item: { accessType: string; minimumTierId: string | null }): boolean {
    if (!resolvedSubCtx?.userTierSortOrder) return false;
    if (item.accessType !== 'subscribers') return false;
    if (!item.minimumTierId) return true; // Any tier covers it
    const minTier = resolvedSubCtx.tiers.find((t) => t.id === item.minimumTierId);
    return minTier ? resolvedSubCtx.userTierSortOrder >= minTier.sortOrder : false;
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
  <meta property="og:title" content={orgName} />
  {#if orgDescription}
    <meta property="og:description" content={orgDescription} />
    <meta name="description" content={orgDescription} />
  {/if}
  <meta property="og:type" content="website" />
  {#if logoUrl}
    <meta property="og:image" content={logoUrl} />
  {/if}
  <meta name="twitter:card" content={logoUrl ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={orgName} />
  {#if orgDescription}
    <meta name="twitter:description" content={orgDescription} />
  {/if}
</svelte:head>

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
          <img src={logoUrl} alt="{orgName} logo" class="hero__logo" loading="eager" />
        </div>
      {/if}

      <!-- Description -->
      {#if orgDescription}
        <p class="hero__description">{orgDescription}</p>
      {/if}

      <!-- Content type + category pills -->
      {#if stats?.content?.total > 0 || (stats?.categories?.length ?? 0) > 0}
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
          {#if (stats?.categories?.length ?? 0) > 0}
            <span class="hero__pills-sep"></span>
          {/if}
          {#each stats?.categories ?? [] as category}
            <a href="/explore?category={encodeURIComponent(category)}" class="hero__pill hero__pill--category">
              {category}
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
  <!-- Continue Watching -->
  {#await data.continueWatching}
    <section class="section">
      <div class="section__header">
        <div class="skeleton" style="width: 220px; height: var(--text-2xl);"></div>
      </div>
      <div class="content-grid">
        {#each Array(3) as _}
          <div class="skeleton-content-card">
            <div class="skeleton skeleton-thumbnail"></div>
            <div class="skeleton" style="width: 80%; height: var(--text-base);"></div>
            <div class="skeleton" style="width: 50%; height: var(--text-sm);"></div>
          </div>
        {/each}
      </div>
    </section>
  {:then continueWatching}
    {#if continueWatching && continueWatching.length > 0}
      <section class="section">
        <div class="section__header">
          <h2 class="section__title">{m.org_continue_watching_title()}</h2>
          <a href="/library" class="section__view-all">
            {m.org_continue_watching_view_library()} &rarr;
          </a>
        </div>
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
  {/await}

  <!-- New Releases -->
  <section class="section">
    <div class="section__header">
      <h2 class="section__title">{m.org_new_releases_title()}</h2>
      {#if newReleases.length > 0}
        <a href="/explore" class="section__view-all">
          {m.org_view_all_content()} &rarr;
        </a>
      {/if}
    </div>
    {#if newReleases.length > 0}
      <div class="content-grid">
        {#each newReleases as item (item.id)}
          <ContentCard
            id={item.id}
            title={item.title}
            thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
            description={item.description}
            contentType={item.contentType === 'written' ? 'article' : item.contentType}
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
            contentAccessType={item.accessType}
            included={isIncluded(item)}
          />
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <p>{m.org_no_content_yet()}</p>
      </div>
    {/if}
  </section>

  <!-- Creator Preview -->
  {#await data.creators}
    <section class="section">
      <div class="section__header">
        <div class="skeleton" style="width: 200px; height: var(--text-2xl);"></div>
      </div>
      <div class="creators-grid">
        {#each Array(3) as _}
          <div class="creator-card skeleton-card">
            <div class="skeleton skeleton-circle"></div>
            <div class="skeleton" style="width: 120px; height: var(--text-base);"></div>
            <div class="skeleton" style="width: 80px; height: var(--text-sm);"></div>
          </div>
        {/each}
      </div>
    </section>
  {:then creators}
    {#if creators?.items?.length > 0}
      <section class="section">
        <div class="section__header">
          <h2 class="section__title">{m.org_creators_preview_title()}</h2>
          {#if (creators?.total ?? 0) > 3}
            <a href="/creators" class="section__view-all">
              {m.org_creators_preview_view_all()} &rarr;
            </a>
          {/if}
        </div>
        <div class="creators-grid">
          {#each creators.items as creator (creator.name)}
            <div class="creator-card">
              <Avatar class="creator-card__avatar">
                <AvatarImage src={creator.avatarUrl} alt={creator.name} />
                <AvatarFallback>{creator.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span class="creator-card__name">{creator.name}</span>
              <Badge variant="neutral">{creator.role}</Badge>
              <span class="creator-card__count">
                {m.org_creators_content_count({ count: String(creator.contentCount) })}
              </span>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/await}
  </div>
</div>

{#if introVideoUrl && videoActive && !isDesktop}
  <IntroVideoModal open={true} src={introVideoUrl} onclose={() => { videoActive = false; }} />
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
    color: white;
  }

  /* Brand-tinted gradient — darkens the bottom 50% where text lives.
     Dark base (30% brand, 70% black) at the bottom guarantees white-text
     contrast regardless of brand hue. Fades to transparent by 50% height
     so the title above stays clear for mix-blend-mode: difference to
     composite against the shader canvas. */
  .hero::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--color-brand-primary, black) 30%, black) 0%,
      color-mix(in srgb, var(--color-brand-primary, black) 50%, black) 15%,
      color-mix(in srgb, var(--color-brand-primary, black) 70%, black) 28%,
      color-mix(in srgb, var(--color-brand-primary, black) 8%, transparent) 40%,
      transparent 50%
    );
    pointer-events: none;
    transition: opacity var(--duration-slow) var(--ease-out);
  }

  .hero__content {
    position: relative;
    z-index: 1;
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
    width: var(--space-14);
    height: var(--space-14);
    border-radius: var(--radius-full);
    object-fit: cover;
    border: var(--border-width-thick) solid color-mix(in srgb, white 30%, transparent);
    box-shadow: var(--shadow-lg);
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
    color: white;
    mix-blend-mode: difference;
  }

  .hero__description {
    margin: 0;
    font-size: var(--text-xl);
    line-height: var(--leading-relaxed);
    max-width: 40ch;
    color: color-mix(in srgb, white 80%, transparent);
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
    background: color-mix(in srgb, white 15%, transparent);
    border: var(--border-width) solid color-mix(in srgb, white 20%, transparent);
    border-radius: var(--radius-base);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: white;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .hero__pill--category {
    text-decoration: none;
    text-transform: none;
    font-weight: var(--font-normal);
    letter-spacing: normal;
    color: color-mix(in srgb, white 75%, transparent);
    border-color: color-mix(in srgb, white 15%, transparent);
    background: transparent;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .hero__pill--category:hover {
    color: white;
  }

  /* Separator dot between content pills and category pills */
  .hero__pills-sep {
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, white 40%, transparent);
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
    background: white;
    color: var(--color-brand-primary);
    box-shadow: var(--shadow-md);
  }

  .hero__cta--primary:hover {
    box-shadow: var(--shadow-xl);
  }

  .hero__cta--glass {
    background: color-mix(in srgb, white 12%, transparent);
    color: white;
    border: var(--border-width) solid color-mix(in srgb, white 25%, transparent);
  }

  .hero__cta--glass:hover {
    background: color-mix(in srgb, white 20%, transparent);
    box-shadow: var(--shadow-md);
  }

  .hero__play {
    gap: var(--space-2);
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
      background: color-mix(in srgb, white 12%, transparent);
      border: var(--border-width) solid color-mix(in srgb, white 25%, transparent);
      backdrop-filter: blur(var(--blur-md));
      -webkit-backdrop-filter: blur(var(--blur-md));
      color: white;
      cursor: pointer;
      transition: transform var(--duration-normal) var(--ease-out),
        background var(--duration-fast) var(--ease-default),
        box-shadow var(--duration-normal) var(--ease-default);
      animation: hero-play-pulse 3s ease-in-out infinite;
    }

    .hero__play-center:hover {
      transform: translate(-50%, -50%) scale(1.1);
      background: color-mix(in srgb, white 20%, transparent);
      box-shadow: 0 0 0 var(--space-3) color-mix(in srgb, white 8%, transparent);
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
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, white 15%, transparent); }
    50% { box-shadow: 0 0 0 var(--space-4) color-mix(in srgb, white 0%, transparent); }
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
    border-top: var(--border-width) solid color-mix(in srgb, white 25%, transparent);
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
    color: white;
  }

  .hero__stat-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: color-mix(in srgb, white 62%, transparent);
  }

  /* ══════════════════════════════════════════
     CONTENT AREA
     ══════════════════════════════════════════ */
  .content-area {
    position: relative;
    /* Blur handled by fixed overlay — only tint here */
    background: color-mix(in srgb, var(--color-background) 80%, transparent);
  }

  /* Transition gradient — blends from the hero's brand-tinted dark base
     into the content area's frosted background. 600px tall for a very
     gradual fade with no hard edge. */
  .content-area::before {
    content: '';
    position: absolute;
    top: -600px;
    left: 0;
    right: 0;
    height: 600px;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      color-mix(in srgb, var(--color-brand-primary, black) 15%, transparent) 25%,
      color-mix(in srgb, var(--color-brand-primary, black) 20%, transparent) 45%,
      color-mix(in srgb, var(--color-background) 40%, transparent) 65%,
      color-mix(in srgb, var(--color-background) 65%, transparent) 85%,
      color-mix(in srgb, var(--color-background) 80%, transparent) 100%
    );
    pointer-events: none;
  }

  .section {
    padding: var(--space-12) var(--space-6);
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }

  .section__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-8);
  }

  .section__title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
  }

  .section__view-all {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .section__view-all:hover {
    color: var(--color-interactive-hover);
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

  .creators-grid {
    display: flex;
    justify-content: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  .creator-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    min-width: 180px;
    max-width: 240px;
    text-align: center;
    transition: var(--transition-shadow);
  }

  .creator-card:hover {
    box-shadow: var(--shadow-md);
  }

  :global(.creator-card__avatar) {
    width: var(--space-12);
    height: var(--space-12);
    font-size: var(--text-lg);
  }

  .creator-card__name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .creator-card__count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ══════════════════════════════════════════
     RESPONSIVE
     ══════════════════════════════════════════ */
  @media (--below-md) {
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
      width: var(--space-11);
      height: var(--space-11);
    }

    .hero__stats {
      gap: var(--space-5);
    }
  }

  /* ── Skeletons ── */
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-md);
  }

  .skeleton-circle {
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-full);
  }

  .skeleton-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
  }

  .skeleton-content-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .skeleton-thumbnail {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-lg);
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
