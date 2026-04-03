<!--
  @component OrgLandingPage

  Organization landing page with hero section, featured content grid, and org branding.
  Displays the org's identity and up to 6 newest content items.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { hydrateIfNeeded } from '$lib/collections';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Seed content collection with SSR data so subsequent navigations
  // (e.g., content detail → back) find metadata already cached.
  onMount(() => {
    if (data.featuredContent?.length) {
      hydrateIfNeeded('content', data.featuredContent);
    }
  });

  const brandPrimary = $derived(data.org?.brandColors?.primary ?? '#6366f1');
  const brandSecondary = $derived(data.org?.brandColors?.secondary ?? '#4f46e5');
  const orgName = $derived(data.org?.name ?? 'Organization');
  const orgDescription = $derived(data.org?.description ?? '');
  const logoUrl = $derived(data.org?.logoUrl ?? '');
  const featuredContent = $derived(data.featuredContent ?? []);
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
  <!-- Hero Section -->
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
      <a href="/explore" class="hero__cta">
        {m.org_hero_explore()}
      </a>
    </div>
  </section>

  <!-- Featured Content Section -->
  <section class="featured">
    <div class="featured__header">
      <h2 class="featured__title">{m.org_featured_content()}</h2>
      {#if featuredContent.length > 0}
        <a href="/explore" class="featured__view-all">
          {m.org_view_all_content()} &rarr;
        </a>
      {/if}
    </div>

    {#if featuredContent.length > 0}
      <div class="featured__grid">
        {#each featuredContent as item (item.id)}
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
      <div class="featured__empty">
        <p>{m.org_no_content_yet()}</p>
      </div>
    {/if}
  </section>
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
    padding: var(--space-16, 4rem) var(--space-6, 1.5rem);
    background: linear-gradient(135deg, var(--color-brand-primary, #6366f1), var(--color-brand-secondary, #4f46e5));
    color: var(--color-text-on-brand);
    text-align: center;
    overflow: hidden;
  }

  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, white 15%, transparent) 0%, transparent 70%);
    pointer-events: none;
  }

  .hero__inner {
    position: relative;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4, 1rem);
  }

  .hero__logo {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-full, 9999px);
    object-fit: cover;
    border: 3px solid color-mix(in srgb, white 30%, transparent);
    box-shadow: var(--shadow-lg);
  }

  .hero__title {
    margin: 0;
    font-size: var(--text-4xl, 2.25rem);
    font-weight: var(--font-bold, 700);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
  }

  .hero__description {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
    line-height: var(--leading-normal);
    opacity: var(--opacity-90);
    max-width: 560px;
  }

  .hero__cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    margin-top: var(--space-4, 1rem);
    padding: var(--space-3, 0.75rem) var(--space-6, 1.5rem);
    background: var(--color-brand-accent-subtle, color-mix(in srgb, white 20%, transparent));
    color: var(--color-text-on-brand);
    font-size: var(--text-base, 1rem);
    font-weight: var(--font-semibold, 600);
    border: var(--border-width-thick) solid color-mix(in srgb, white 40%, transparent);
    border-radius: var(--radius-button, var(--radius-lg, 0.5rem));
    text-decoration: none;
    transition: background-color var(--duration-normal) var(--ease-default), border-color var(--duration-normal) var(--ease-default), transform var(--duration-fast) var(--ease-default);
  }

  .hero__cta:hover {
    background: var(--color-brand-accent, color-mix(in srgb, white 30%, transparent));
    border-color: color-mix(in srgb, white 60%, transparent);
    transform: translateY(-1px);
  }

  .hero__cta:active {
    transform: translateY(0);
  }

  /* ── Featured Content Section ── */
  .featured {
    padding: var(--space-12, 3rem) var(--space-6, 1.5rem);
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
  }

  .featured__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4, 1rem);
    margin-bottom: var(--space-8, 2rem);
  }

  .featured__title {
    margin: 0;
    font-size: var(--text-2xl, 1.5rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text-primary);
  }

  .featured__view-all {
    font-size: var(--text-sm, 0.875rem);
    font-weight: var(--font-medium, 500);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-default);
  }

  .featured__view-all:hover {
    color: var(--color-interactive-hover);
  }

  .featured__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6, 1.5rem);
  }

  @media (--breakpoint-sm) {
    .featured__grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .featured__grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .featured__empty {
    text-align: center;
    padding: var(--space-16, 4rem) var(--space-4, 1rem);
    color: var(--color-text-muted);
  }

  .featured__empty p {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
  }
  /* ── Responsive Hero ── */
  @media (--below-sm) {
    .hero {
      padding: var(--space-10, 2.5rem) var(--space-4, 1rem);
    }

    .hero__title {
      font-size: var(--text-2xl, 1.5rem);
    }

    .hero__description {
      font-size: var(--text-base, 1rem);
    }

    .hero__logo {
      width: 64px;
      height: 64px;
    }
  }
</style>
