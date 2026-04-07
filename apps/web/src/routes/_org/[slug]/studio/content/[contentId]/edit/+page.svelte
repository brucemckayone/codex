<!--
  @component Studio Content Edit Page

  Renders the content form in edit mode with existing content data.
  Fetches content and media items client-side to avoid __data.json round-trips.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { getContent } from '$lib/remote/content.remote';
  import { listMedia } from '$lib/remote/media.remote';
  import { listTiers } from '$lib/remote/subscription.remote';
  import { ErrorBoundary } from '$lib/components/ui';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import ContentForm from '$lib/components/studio/ContentForm.svelte';

  let { data } = $props();

  const orgSlug = $derived(page.params.slug);
  const contentId = $derived(page.params.contentId);

  const contentQuery = $derived(getContent(contentId));
  const mediaQuery = $derived(listMedia({
    organizationId: data.org.id,
    status: 'ready',
    limit: 50,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  }));

  const tiersQuery = $derived(listTiers(data.org.id));

  const loading = $derived(contentQuery.loading || mediaQuery.loading);
  const content = $derived(contentQuery.current ?? null);
  const error = $derived(contentQuery.error ? 'Content not found' : null);

  const breadcrumbs = $derived([
    { label: 'Content', href: '/studio/content' },
    { label: content?.title ?? 'Edit' },
  ]);
</script>

<svelte:head>
  <title>{content ? `${m.studio_content_form_edit_title()} - ${content.title}` : 'Edit'} | {orgSlug}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="edit-page">
  <Breadcrumb items={breadcrumbs} />

  {#if loading}
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
  {:else if error}
    <p class="error-text">{error}</p>
  {:else if content}
    <ErrorBoundary>
      <ContentForm
        {content}
        organizationId={data.org.id}
        orgSlug={data.org.slug}
        mediaItems={mediaQuery.current?.items ?? []}
        tiers={tiersQuery.current ?? []}
      />
    </ErrorBoundary>
  {/if}
</div>

<style>
  .edit-page {
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

  .error-text {
    color: var(--color-error-700);
    font-size: var(--text-sm);
    padding: var(--space-8);
    text-align: center;
  }
</style>
