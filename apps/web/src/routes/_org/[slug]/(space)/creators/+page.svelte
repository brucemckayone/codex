<script lang="ts">
  import { goto } from '$app/navigation';
  import { invalidateAll } from '$app/runtime';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { CreatorCard } from '$lib/components/ui/CreatorCard';

  const { data }: { data: PageData } = $props();

  function handlePageChange(newPage: number) {
    goto(`?page=${newPage}`);
  }

  function handleRetry() {
    invalidateAll();
  }
</script>

<svelte:head>
  <title>{m.org_creators_title()} | {data.org?.name ?? 'Organization'}</title>
  <meta name="description" content={m.org_creators_subtitle()} />
</svelte:head>

<div class="org-creators-page">
  <header class="page-header">
    <h1>{m.org_creators_title()}</h1>
    <p>{m.org_creators_subtitle()}</p>
  </header>

  {#if data.error}
    <div class="error-state" role="alert">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <h2>Failed to load creators</h2>
      <button onclick={handleRetry} class="btn btn-primary">{m.common_try_again()}</button>
    </div>
  {:else if data.creators.length === 0}
    <div class="empty-state" role="status">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
      <h2>{m.org_creators_empty()}</h2>
    </div>
  {:else}
    <div class="creators-grid" role="list">
      {#each data.creators as creator (creator.id)}
        <CreatorCard
          username={creator.username}
          displayName={creator.name}
          avatar={creator.image}
          bio={creator.bio}
          contentCount={creator.contentCount}
          socialLinks={creator.socialLinks}
          profileHref="/creators/{creator.username}"
          role="listitem"
        />
      {/each}
    </div>

    {#if data.pagination.totalPages > 1}
      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.totalPages}
        onPageChange={handlePageChange}
      />
    {/if}
  {/if}
</div>

<style>
  .page-header {
    text-align: center;
    margin-bottom: var(--space-8);
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
  }

  .page-header p {
    font-size: var(--text-lg);
    color: var(--color-text-secondary);
  }

  .creators-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
    margin-bottom: var(--space-8);
  }

  @media (min-width: 640px) {
    .creators-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .creators-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .error-state,
  .empty-state {
    text-align: center;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-secondary);
  }

  .error-state svg,
  .empty-state svg {
    width: var(--space-12);
    height: var(--space-12);
    margin: 0 auto var(--space-4);
    color: var(--color-text-muted);
  }

  .error-state h2,
  .empty-state h2 {
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-2);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    background: var(--color-primary-500);
    color: #ffffff;
    border: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .btn:hover {
    background: var(--color-primary-600);
  }

  /* Dark mode */
  [data-theme='dark'] .error-state,
  [data-theme='dark'] .empty-state {
    color: var(--color-text-secondary-dark);
  }
</style>
