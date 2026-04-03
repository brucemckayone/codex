<!--
  @component OrgCreatorsPage

  Organization creators directory page with a responsive grid of CreatorCard
  components and pagination. Displays public creator profiles for the org.
-->
<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { CreatorCard } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { UsersIcon } from '$lib/components/ui/Icon';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');
  const items = $derived(data.creators?.items ?? []);
  const total = $derived(data.creators?.total ?? 0);
  const currentPage = $derived(data.pagination?.page ?? 1);
  const limit = $derived(data.pagination?.limit ?? 20);
  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));

  /**
   * Build the baseUrl for Pagination links, preserving current path
   * but without the 'page' param (Pagination adds it).
   */
  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });
</script>

<svelte:head>
  <title>{m.org_creators_title()} | {orgName}</title>
  <meta name="description" content="{m.org_creators_subtitle()}" />
  <meta property="og:title" content="{m.org_creators_title()} | {orgName}" />
  <meta property="og:description" content={m.org_creators_subtitle()} />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="creators">
  <!-- Header -->
  <header class="creators__header">
    <h1 class="creators__title">{m.org_creators_title()}</h1>
    <p class="creators__subtitle">{m.org_creators_subtitle()}</p>
  </header>

  <!-- Creators Grid -->
  {#if items.length > 0}
    <div class="creators__grid">
      {#each items as creator (creator.name + creator.joinedAt)}
        <CreatorCard
          username={creator.name.toLowerCase().replace(/\s+/g, '-')}
          displayName={creator.name}
          avatar={creator.avatarUrl}
          contentCount={creator.contentCount}
        />
      {/each}
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
      <div class="creators__pagination">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else}
    <!-- Empty State -->
    <div class="creators__empty">
      <UsersIcon size={48} class="creators__empty-icon" stroke-width="1.5" />
      <p class="creators__empty-text">{m.org_creators_empty()}</p>
    </div>
  {/if}
</div>

<style>
  /* ── Layout ── */
  .creators {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
    display: flex;
    flex-direction: column;
    gap: var(--space-8, 2rem);
  }

  /* ── Header ── */
  .creators__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }

  .creators__title {
    margin: 0;
    font-size: var(--text-3xl, 1.875rem);
    font-weight: var(--font-bold, 700);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  .creators__subtitle {
    margin: 0;
    font-size: var(--text-base, 1rem);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  /* ── Grid ── */
  .creators__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6, 1.5rem);
  }

  @media (--breakpoint-sm) {
    .creators__grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .creators__grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  /* ── Pagination ── */
  .creators__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4, 1rem);
  }

  /* ── Empty State ── */
  .creators__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4, 1rem);
    padding: var(--space-16, 4rem) var(--space-4, 1rem);
    text-align: center;
  }

  .creators__empty-icon {
    color: var(--color-text-muted);
    opacity: var(--opacity-60);
  }

  .creators__empty-text {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
    color: var(--color-text-muted);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .creators {
      padding: var(--space-6, 1.5rem) var(--space-4, 1rem);
      gap: var(--space-6, 1.5rem);
    }

    .creators__title {
      font-size: var(--text-2xl, 1.5rem);
    }
  }

  /* ── Dark Mode ── */
  :global([data-theme='dark']) .creators__title {
    color: var(--color-text-primary, #f1f5f9);
  }

  :global([data-theme='dark']) .creators__subtitle {
    color: var(--color-text-secondary, #94a3b8);
  }

  :global([data-theme='dark']) .creators__empty-text {
    color: var(--color-text-muted, #94a3b8);
  }

  :global([data-theme='dark']) .creators__empty-icon {
    color: var(--color-text-muted, #94a3b8);
  }
</style>
