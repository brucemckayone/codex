<!--
  @component Creator Studio Content Management Page

  Lists personal content in a table with status badges, type indicators and
  a draft's progress (Codex-a6ofh.2.6), filtered by `?status=` and paged by
  `?page=`. The New menu offers the newest drafts first. A read that failed
  says so with Retry, never "no content".
-->
<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$paraglide/messages';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import ContentTable from '$lib/components/studio/ContentTable.svelte';
  import LoadFailedAlert from '$lib/components/studio/LoadFailedAlert.svelte';
  import { loadRead } from '$lib/components/studio/alert-read';
  import ContentStatusTabs from '$lib/components/studio/content-list/ContentStatusTabs.svelte';
  import NewContentMenu from '$lib/components/studio/content-list/NewContentMenu.svelte';
  import {
    readStatusFilter,
    type ContentStatusFilter,
  } from '$lib/components/studio/content-list/content-status';
  import { createPayoutsRead } from '$lib/components/studio/payouts-read.svelte';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { FileIcon, SearchIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { filterHref } from '$lib/utils/filter-url';

  let { data }: { data: PageData } = $props();

  const status = $derived(readStatusFilter(page.url));
  const currentPage = $derived(data.content.pagination.page);
  const totalPages = $derived(
    Math.max(1, data.content.pagination.totalPages)
  );
  const hasContent = $derived(data.content.items.length > 0 || currentPage > 1);

  // The load's read: Retry reruns the load, and ends when its data changes.
  const listRead = $derived(
    loadRead({
      current: data.failed ? undefined : data.content,
      error: data.failed ? m.studio_content_load_failed() : undefined,
      refresh: () => invalidate('cache:studio-page:content'),
    })
  );

  // The page's one payouts read, for every draft's step and the New menu's.
  const payouts = createPayoutsRead('studio_content.connect_unread', () => ({
    studio: 'personal',
  }));

  function setStatus(next: ContentStatusFilter) {
    // A new filter starts at its first page.
    goto(filterHref(page.url, { status: next }, { status: 'all' }), {
      keepFocus: true,
      noScroll: true,
    });
  }
</script>

<svelte:head>
  <title>{m.studio_content_title()} | My Studio</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-page">
  <PageHeader title={m.studio_content_title()}>
    {#snippet actions()}
      <NewContentMenu organizationId={null} payouts={payouts.current} />
    {/snippet}
  </PageHeader>

  <!-- A block, so the filter keeps its own width in the page's column. -->
  <div>
    <ContentStatusTabs selected={status} onChange={setStatus} />
  </div>

  <!-- Mounted unconditionally: it renders nothing until the read fails. -->
  <LoadFailedAlert
    query={listRead}
    message={m.studio_content_load_failed()}
    againMessage={m.studio_content_load_failed_again()}
    loadedMessage={m.studio_content_load_retry_ok()}
    data-testid="content-list-load-error"
  />

  {#if data.failed}
    <!-- The alert above stands in for the list. -->
  {:else if hasContent}
    <ContentTable items={data.content.items} payouts={payouts.current} />

    {#if totalPages > 1}
      <div class="pagination-wrapper">
        <Pagination
          {currentPage}
          {totalPages}
          baseUrl="/studio/content{page.url.search}"
        />
      </div>
    {/if}
  {:else if status !== 'all'}
    <EmptyState
      title={m.studio_content_search_empty()}
      icon={SearchIcon}
    >
      {#snippet action()}
        <button type="button" class="empty-cta" onclick={() => setStatus('all')}>
          {m.studio_content_filter_show_all()}
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState
      title={m.studio_content_empty_title()}
      description={m.studio_content_empty_how()}
      icon={FileIcon}
    >
      {#snippet action()}
        <a href="/studio/content/new" class="empty-cta">
          {m.studio_content_create()}
        </a>
      {/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .content-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .pagination-wrapper {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .empty-cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-link);
    background: transparent;
    border: none;
    text-decoration: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .empty-cta:hover {
    background-color: var(--color-interactive-subtle);
    color: var(--color-link-hover);
  }

  .empty-cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
