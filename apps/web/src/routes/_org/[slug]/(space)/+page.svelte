<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { PageContainer } from '$lib/components/ui';

  const { data }: { data: PageData } = $props();

  const featuredContent = $derived(data.featuredContent ?? []);
  const primaryColor = $derived(data.org?.brandColors?.primary ?? 'var(--color-brand-primary)');
</script>

<svelte:head>
  <title>{data.org?.name ?? 'Organization'} | Revelations</title>
  <meta name="description" content={data.org?.description ?? m.org_landing_subtitle()} />
  <meta property="og:title" content={data.org?.name ?? 'Organization'} />
  <meta property="og:description" content={data.org?.description ?? ''} />
  <meta property="og:type" content="website" />
</svelte:head>

<PageContainer>
  <section class="org-hero" style:--brand-color={primaryColor}>
    <div class="hero-content">
      {#if data.org?.logoUrl}
        <img src={data.org.logoUrl} alt="{data.org.name} logo" class="hero-logo" />
      {/if}
      <h1 class="hero-title">{m.org_landing_title({ orgName: data.org?.name ?? 'Organization' })}</h1>
      <p class="hero-subtitle">{m.org_landing_subtitle()}</p>
      <div class="hero-actions">
        <a href="/explore" class="cta-button">{m.org_landing_explore_cta()}</a>
      </div>
    </div>
  </section>

  <section class="featured-section">
    <div class="section-header">
      <h2 class="section-title">{m.org_landing_featured_title()}</h2>
    </div>

    {#if featuredContent().length > 0}
      <div class="content-grid">
        {#each featuredContent() as item (item.id)}
          <ContentCard
            id={item.id}
            title={item.title}
            thumbnail={item.thumbnail}
            description={item.description}
            contentType={item.contentType ?? 'video'}
            duration={item.duration}
            creator={item.creator}
            href={`/content/${item.id}`}
          />
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <p>{m.org_landing_featured_empty()}</p>
      </div>
    {/if}
  </section>
</PageContainer>

<style>
  .org-hero {
    text-align: center;
    padding: var(--space-20) var(--space-4);
    background: linear-gradient(135deg, color-mix(in srgb, var(--brand-color, var(--color-brand-primary)) 10%, transparent), color-mix(in srgb, var(--brand-color, var(--color-brand-primary)) 5%, transparent));
    border-radius: var(--radius-2xl);
    margin-bottom: var(--space-12);
  }

  .hero-content {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .hero-logo {
    width: var(--space-16);
    height: var(--space-16);
    object-fit: contain;
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-6);
  }

  .hero-title {
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-4);
  }

  .hero-subtitle {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
    max-width: 64ch;
    margin: 0 auto var(--space-8);
  }

  .cta-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.75rem;
    padding-inline: var(--space-5);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    background-color: var(--brand-color, var(--color-primary-500));
    color: var(--color-text-inverse);
    text-decoration: none;
    transition: var(--transition-colors), var(--transition-shadow);
    cursor: pointer;
    white-space: nowrap;
  }

  .cta-button:hover {
    background-color: color-mix(in srgb, var(--brand-color, var(--color-primary-500)) 85%, black);
    box-shadow: var(--shadow-md);
  }

  .cta-button:focus-visible {
    outline: 2px solid var(--brand-color, var(--color-primary-500));
    outline-offset: 2px;
  }

  .featured-section {
    margin-bottom: var(--space-12);
  }

  .section-header {
    margin-bottom: var(--space-6);
  }

  .section-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin: 0;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (min-width: 640px) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .empty-state {
    text-align: center;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-secondary);
  }

  .empty-state p {
    margin: 0;
  }

  /* Dark mode - semantic tokens automatically adapt via theme files */
</style>
