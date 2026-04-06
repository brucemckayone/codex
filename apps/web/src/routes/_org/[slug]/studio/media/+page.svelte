<script lang="ts">
  import { page } from '$app/state';
  import { listMedia } from '$lib/remote/media.remote';
  import StudioMediaPage from '$lib/components/studio/StudioMediaPage.svelte';

  let { data } = $props();

  // Reactive URL params
  const urlPage = $derived(Number(page.url.searchParams.get('page') ?? '1'));
  const urlStatus = $derived(page.url.searchParams.get('status') as
    | 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
    | null);
  const urlMediaType = $derived(page.url.searchParams.get('mediaType') as
    | 'video' | 'audio'
    | null);

  // $derived query re-runs when URL params change
  const mediaQuery = $derived(listMedia({
    organizationId: data.org.id,
    page: urlPage,
    limit: 12,
    ...(urlStatus && { status: urlStatus }),
    ...(urlMediaType && { mediaType: urlMediaType }),
  }));

  const mediaData = $derived({
    mediaItems: mediaQuery.current?.items ?? [],
    pagination: {
      page: mediaQuery.current?.pagination?.page ?? urlPage,
      totalPages: mediaQuery.current?.pagination?.totalPages ?? 0,
    },
    filters: {
      status: urlStatus ?? 'all',
      mediaType: urlMediaType ?? 'all',
    },
    org: data.org,
  });
</script>

{#if mediaQuery.loading && (mediaQuery.current?.items ?? []).length === 0}
  <div class="media-skeleton">
    <div class="media-skeleton-header">
      <div class="skeleton" style="width: 140px; height: var(--text-2xl);"></div>
      <div class="skeleton" style="width: 120px; height: var(--space-8);"></div>
    </div>
    <div class="media-skeleton-grid">
      {#each Array(6) as _}
        <div class="media-skeleton-card">
          <div class="skeleton media-skeleton-thumb"></div>
          <div class="media-skeleton-meta">
            <div class="skeleton" style="width: 75%; height: var(--text-sm);"></div>
            <div class="skeleton" style="width: 50%; height: var(--text-xs);"></div>
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <StudioMediaPage data={mediaData} studioName={data.org.name} />
{/if}

<style>
  .media-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-1);
  }

  .media-skeleton-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .media-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(1, 1fr);
    gap: var(--space-4);
  }

  @media (--breakpoint-sm) {
    .media-skeleton-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (--breakpoint-lg) {
    .media-skeleton-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .media-skeleton-card {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-surface);
  }

  .media-skeleton-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 0;
  }

  .media-skeleton-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

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

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
