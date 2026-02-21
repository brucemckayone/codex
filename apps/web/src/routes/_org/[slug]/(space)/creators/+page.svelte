<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { CreatorCard } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { PageContainer } from '$lib/components/ui';

  const { data }: { data: PageData } = $props();

  function handlePageChange(page: number) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(page));
    goto(url.toString());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const hasCreators = $derived(data.items.length > 0);
</script>

<svelte:head>
  <title>{m.org_creators_title()} | {data.org?.name ?? 'Organization'}</title>
  <meta name="description" content={m.org_creators_subtitle()} />
</svelte:head>

<PageContainer>
  <header class="page-header">
    <h1>{m.org_creators_title()}</h1>
    <p class="subtitle">{m.org_creators_subtitle()}</p>
  </header>

  {#if hasCreators}
    <div class="creators-grid">
      {#each data.items as creator (creator.id)}
        <CreatorCard
          username={creator.username}
          displayName={creator.name}
          avatar={creator.avatarUrl}
          bio={creator.bio}
          contentCount={creator.contentCount ?? 0}
        />
      {/each}
    </div>

    {#if data.totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          currentPage={data.page}
          totalPages={data.totalPages}
          onPageChange={handlePageChange}
        />
      </div>
    {/if}
  {:else}
    <div class="empty-state">
      <p>{m.org_creators_empty()}</p>
    </div>
  {/if}
</PageContainer>

<style>
  .page-header {
    margin-bottom: var(--space-8);
    text-align: center;
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    font-family: var(--font-heading);
    color: var(--color-text);
  }

  .subtitle {
    margin-top: var(--space-2);
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .creators-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
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

  .pagination-wrapper {
    display: flex;
    justify-content: center;
    margin-top: var(--space-8);
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
