<!--
  @component NewContentPage

  Page wrapper for creating new content. Passes organizationId
  and available media items to the ContentForm component.
  Fetches media items client-side to avoid __data.json round-trips.
-->
<script lang="ts">
  import { listMedia } from '$lib/remote/media.remote';
  import { listTiers } from '$lib/remote/subscription.remote';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data } = $props();

  const organizationId = $derived(data.org.id);
  const orgSlug = $derived(data.org.slug);

  const breadcrumbs = [
    { label: 'Content', href: '/studio/content' },
    { label: 'New Content' },
  ];

  const mediaQuery = $derived(listMedia({
    organizationId: data.org.id,
    status: 'ready',
    limit: 50,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  }));

  const tiersQuery = $derived(listTiers(data.org.id));
</script>

<svelte:head>
  <title>New Content | Studio</title>
</svelte:head>

<div class="new-content-page">
  <Breadcrumb items={breadcrumbs} />
  {#if mediaQuery.loading}
    <div class="form-skeleton">
      <div class="form-skeleton-main">
        <div class="skeleton" style="width: 60%; height: var(--space-10);"></div>
        <div class="skeleton" style="width: 100%; height: var(--space-32);"></div>
        <div class="form-skeleton-row">
          <div class="skeleton" style="width: 45%; height: var(--space-10);"></div>
          <div class="skeleton" style="width: 45%; height: var(--space-10);"></div>
        </div>
        <div class="skeleton" style="width: 100%; height: var(--space-24);"></div>
      </div>
      <div class="form-skeleton-sidebar">
        <div class="skeleton" style="width: 100%; height: var(--space-10);"></div>
        <div class="skeleton" style="width: 100%; height: var(--space-10);"></div>
        <div class="skeleton" style="width: 60%; height: var(--space-8);"></div>
      </div>
    </div>
  {:else}
    <ContentForm {organizationId} {orgSlug} mediaItems={mediaQuery.current?.items ?? []} tiers={tiersQuery.current ?? []} />
  {/if}
</div>

<style>
  .new-content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-skeleton {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (--breakpoint-md) {
    .form-skeleton {
      grid-template-columns: 2fr 1fr;
    }
  }

  .form-skeleton-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-skeleton-row {
    display: flex;
    gap: var(--space-4);
  }

  .form-skeleton-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
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
