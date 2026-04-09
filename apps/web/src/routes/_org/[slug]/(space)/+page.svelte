<!--
  @component OrgLandingPage

  Organization landing page with branded hero, continue watching rail (auth only),
  new releases grid, and creator preview section.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { Avatar, AvatarImage, AvatarFallback } from '$lib/components/ui/Avatar';
  import { Badge } from '$lib/components/ui/Badge';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { hydrateIfNeeded } from '$lib/collections';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Seed content collection with SSR data so subsequent navigations find metadata cached
  onMount(() => {
    if (data.newReleases?.length) {
      hydrateIfNeeded('content', data.newReleases);
    }
  });

  const orgName = $derived(data.org?.name ?? 'Organization');
  const orgDescription = $derived(data.org?.description ?? '');
  const logoUrl = $derived(data.org?.logoUrl ?? '');
  const newReleases = $derived(data.newReleases ?? []);
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
  <!-- 1. Hero Section -->
  <section class="hero">
    <div class="hero__inner">
      {#if logoUrl}
        <img
          src={logoUrl}
          alt="{orgName} logo"
          class="hero__logo"
          loading="eager"
        />
      {/if}
      <h1 class="hero__title">{orgName}</h1>
      {#if orgDescription}
        <p class="hero__description">{orgDescription}</p>
      {/if}
      <div class="hero__actions">
        <a href="/explore" class="hero__cta">
          {m.org_hero_explore()}
        </a>
        <a href="/creators" class="hero__cta hero__cta--secondary">
          {m.org_creators_preview_view_all()}
        </a>
      </div>
    </div>
  </section>

  <div class="content-area">
  <!-- 2. Continue Watching (streamed, auth + has items only) -->
  {#await data.continueWatching}
    <section class="section continue-watching">
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
      <section class="section continue-watching">
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

  <!-- 3. New Releases -->
  <section class="section new-releases">
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
          />
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <p>{m.org_no_content_yet()}</p>
      </div>
    {/if}
  </section>

  <!-- 4. Creator Preview (streamed) -->
  {#await data.creators}
    <section class="section creators-preview">
      <div class="section__header">
        <div class="skeleton" style="width: 200px; height: var(--text-2xl);"></div>
      </div>
      <div class="creators-preview__grid">
        {#each Array(3) as _}
          <div class="creator-preview-card skeleton-card">
            <div class="skeleton skeleton-circle"></div>
            <div class="skeleton" style="width: 120px; height: var(--text-base);"></div>
            <div class="skeleton" style="width: 80px; height: var(--text-sm);"></div>
          </div>
        {/each}
      </div>
    </section>
  {:then creators}
    {#if creators.items.length > 0}
      <section class="section creators-preview">
        <div class="section__header">
          <h2 class="section__title">{m.org_creators_preview_title()}</h2>
          {#if creators.total > 3}
            <a href="/creators" class="section__view-all">
              {m.org_creators_preview_view_all()} &rarr;
            </a>
          {/if}
        </div>
        <div class="creators-preview__grid">
          {#each creators.items as creator (creator.name)}
            <div class="creator-preview-card">
              <Avatar class="creator-preview-card__avatar">
                <AvatarImage src={creator.avatarUrl} alt={creator.name} />
                <AvatarFallback>{creator.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span class="creator-preview-card__name">{creator.name}</span>
              <Badge variant="neutral">{creator.role}</Badge>
              <span class="creator-preview-card__count">
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

<style>
  /* ── Layout ── */
  .org-landing {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  /* ── Hero Section ── */
  .hero {
    position: relative;
    min-height: 70vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-16) var(--space-6);
    background: transparent;
    color: var(--color-text-on-brand);
    text-align: center;
    overflow: hidden;
  }

  .hero__inner {
    position: relative;
    z-index: 1;
    max-width: 800px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
  }

  .hero__logo {
    width: var(--space-24);
    height: var(--space-24);
    border-radius: var(--radius-full);
    object-fit: cover;
    border: var(--border-width-thick) solid color-mix(in srgb, white 30%, transparent);
    box-shadow:
      var(--shadow-xl),
      0 0 60px color-mix(in srgb, var(--color-brand-primary) 25%, transparent);
  }

  .hero__title {
    margin: 0;
    font-size: var(--text-5xl);
    font-weight: var(--font-extrabold);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-tight);
    text-shadow: 0 2px 20px color-mix(in srgb, black 40%, transparent);
  }

  .hero__description {
    margin: 0;
    font-size: var(--text-xl);
    line-height: var(--leading-relaxed);
    opacity: var(--opacity-90);
    max-width: 600px;
    text-shadow: 0 1px 8px color-mix(in srgb, black 30%, transparent);
  }

  .hero__actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }

  .hero__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3-5) var(--space-8);
    background: color-mix(in srgb, white 15%, transparent);
    color: var(--color-text-on-brand);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    border: var(--border-width-thick) solid color-mix(in srgb, white 30%, transparent);
    border-radius: var(--radius-full);
    text-decoration: none;
    backdrop-filter: blur(12px);
    transition: background-color var(--duration-normal) var(--ease-default),
      border-color var(--duration-normal) var(--ease-default),
      transform var(--duration-fast) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default);
  }

  .hero__cta:hover {
    background: color-mix(in srgb, white 25%, transparent);
    border-color: color-mix(in srgb, white 50%, transparent);
    transform: translateY(-2px);
    box-shadow: 0 8px 32px color-mix(in srgb, black 20%, transparent);
  }

  .hero__cta:active {
    transform: translateY(0);
  }

  .hero__cta--secondary {
    background: transparent;
    border-color: color-mix(in srgb, white 20%, transparent);
  }

  .hero__cta--secondary:hover {
    background: color-mix(in srgb, white 10%, transparent);
    border-color: color-mix(in srgb, white 35%, transparent);
  }

  /* ── Shared Section Styles ── */
  .section {
    position: relative;
    padding: var(--space-12) var(--space-6);
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }

  /* ── Content backdrop — soft frosted glass over full-page shader ── */
  .content-area {
    position: relative;
    background: color-mix(in srgb, var(--color-background) 55%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }

  /* Gradient fade from transparent hero into frosted content */
  .content-area::before {
    content: '';
    position: absolute;
    top: -200px;
    left: 0;
    right: 0;
    height: 200px;
    background: linear-gradient(
      to bottom,
      transparent 0%,
      color-mix(in srgb, var(--color-background) 8%, transparent) 20%,
      color-mix(in srgb, var(--color-background) 20%, transparent) 45%,
      color-mix(in srgb, var(--color-background) 40%, transparent) 70%,
      color-mix(in srgb, var(--color-background) 55%, transparent) 100%
    );
    pointer-events: none;
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

  /* ── Empty State ── */
  .empty-state {
    text-align: center;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-muted);
  }

  .empty-state p {
    margin: 0;
    font-size: var(--text-lg);
  }

  /* ── Creator Preview ── */
  .creators-preview__grid {
    display: flex;
    justify-content: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  .creator-preview-card {
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

  .creator-preview-card:hover {
    box-shadow: var(--shadow-md);
  }

  :global(.creator-preview-card__avatar) {
    width: var(--space-12);
    height: var(--space-12);
    font-size: var(--text-lg);
  }

  .creator-preview-card__name {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .creator-preview-card__count {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ── Responsive Hero ── */
  @media (--below-sm) {
    .hero {
      min-height: 55vh;
      padding: var(--space-12) var(--space-4);
    }

    .hero__title {
      font-size: var(--text-3xl);
    }

    .hero__description {
      font-size: var(--text-base);
    }

    .hero__logo {
      width: var(--space-20);
      height: var(--space-20);
    }

    .hero__actions {
      flex-direction: column;
      width: 100%;
      gap: var(--space-3);
    }

    .hero__cta {
      width: 100%;
      justify-content: center;
    }
  }

  /* ── Skeleton Loading States ── */
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
