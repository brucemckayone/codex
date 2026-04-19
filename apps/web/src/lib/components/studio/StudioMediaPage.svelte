<!--
  @component StudioMediaPage

  Shared media management page for both personal Creator Studio and
  Org Studio. Displays an upload zone and a grid of existing media items
  with pagination. Supports edit metadata and delete actions with
  server-side filtering by media type and status.
-->
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import MediaUpload from '$lib/components/studio/MediaUpload.svelte';
  import MediaGrid from '$lib/components/studio/MediaGrid.svelte';
  import EditMediaDialog from '$lib/components/studio/EditMediaDialog.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { deleteMedia, updateMedia } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import type { MediaItemWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { Button, PageHeader } from '$lib/components/ui';

  interface Props {
    /** Page data containing mediaItems, pagination, and filters */
    data: {
      mediaItems: MediaItemWithRelations[];
      pagination: { page: number; totalPages: number };
      filters: { status: string; mediaType: string };
    };
    /** Studio name shown in the browser tab (e.g., "My Studio" or org name) */
    studioName: string;
    /** Optional class forwarded to the root for layout composition (R13) */
    class?: string;
  }

  const { data, studioName, class: className }: Props = $props();

  // Delete state
  let showDeleteConfirm = $state(false);
  let deleteTargetId: string | null = $state(null);
  let isDeleting = $state(false);

  // Edit state
  let showEditDialog = $state(false);
  let editTarget = $state<MediaItemWithRelations | null>(null);

  const currentPage = $derived(data.pagination.page);
  const totalPages = $derived(data.pagination.totalPages);

  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.filters.status !== 'all') params.set('status', data.filters.status);
    if (data.filters.mediaType !== 'all') params.set('mediaType', data.filters.mediaType);
    const qs = params.toString();
    return `/studio/media${qs ? `?${qs}` : ''}`;
  });

  const activeMediaType = $derived(data.filters.mediaType);
  const activeStatus = $derived(data.filters.status);

  const mediaTypeOptions = [
    { value: 'all', label: m.media_filter_all_types() },
    { value: 'video', label: m.media_type_video() },
    { value: 'audio', label: m.media_type_audio() },
  ];

  const statusOptions = [
    { value: 'all', label: m.media_filter_all_status() },
    { value: 'ready', label: m.media_status_ready() },
    { value: 'transcoding', label: m.media_status_processing() },
    { value: 'failed', label: m.media_status_failed() },
  ];

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page');
    const qs = params.toString();
    void goto(`/studio/media${qs ? `?${qs}` : ''}`, { invalidateAll: true });
  }

  function handleUploadComplete() {
    void invalidateAll();
  }

  function handleEdit(id: string) {
    const media = data.mediaItems.find((item) => item.id === id);
    if (!media) return;
    editTarget = media;
    showEditDialog = true;
  }

  async function handleSave(id: string, updateData: { title?: string; description?: string | null }) {
    await updateMedia({ id, data: updateData });
    void invalidateAll();
  }

  function handleDelete(id: string) {
    deleteTargetId = id;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    if (!deleteTargetId) return;
    isDeleting = true;
    try {
      await deleteMedia(deleteTargetId);
      showDeleteConfirm = false;
      deleteTargetId = null;
      void invalidateAll();
    } catch (error) {
      logger.error('Failed to delete media', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      isDeleting = false;
    }
  }

  function handleDeleteDialogChange(isOpen: boolean) {
    showDeleteConfirm = isOpen;
    if (!isOpen) {
      deleteTargetId = null;
    }
  }
</script>

<svelte:head>
  <title>{m.media_title()} | {studioName}</title>
</svelte:head>

<div class="media-page {className ?? ''}">
  <PageHeader title={m.media_title()} description={m.media_subtitle()} />

  <section class="upload-section">
    <MediaUpload onUploadComplete={handleUploadComplete} />
  </section>

  <section class="filters-section">
    <div class="filters-row">
      <div class="filter-group">
        {#each mediaTypeOptions as option (option.value)}
          <button
            class="filter-btn"
            class:filter-btn--active={activeMediaType === option.value}
            aria-pressed={activeMediaType === option.value}
            onclick={() => setFilter('mediaType', option.value)}
            type="button"
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div class="filter-group">
        {#each statusOptions as option (option.value)}
          <button
            class="filter-btn"
            class:filter-btn--active={activeStatus === option.value}
            aria-pressed={activeStatus === option.value}
            onclick={() => setFilter('status', option.value)}
            type="button"
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  </section>

  <!-- Live-region wraps the grid + pagination so SPA-mode route loads announce
       when content refreshes after a filter change (studio runs ssr=false). -->
  <div class="media-status-region" role="status" aria-live="polite" aria-busy={!data}>
    <section class="media-section">
      <MediaGrid
        items={data.mediaItems}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {#if totalPages > 1}
        <div class="pagination-container">
          <Pagination
            currentPage={currentPage}
            {totalPages}
            baseUrl={paginationBaseUrl}
            paramName="page"
          />
        </div>
      {/if}
    </section>
  </div>
</div>

<!-- Edit Media Dialog -->
<EditMediaDialog
  bind:open={showEditDialog}
  media={editTarget}
  onSave={handleSave}
/>

<!-- Delete Confirmation Dialog -->
<Dialog.Root bind:open={showDeleteConfirm} onOpenChange={handleDeleteDialogChange}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{m.media_delete_title()}</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      <p class="delete-description">{m.media_delete_confirm()}</p>
    </Dialog.Body>
    <Dialog.Footer>
      <Button
        variant="secondary"
        onclick={() => handleDeleteDialogChange(false)}
        disabled={isDeleting}
      >
        {m.common_cancel()}
      </Button>
      <Button variant="destructive" onclick={confirmDelete} disabled={isDeleting} loading={isDeleting}>
        {isDeleting ? m.common_loading() : m.media_delete_button()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .media-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .filters-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .filters-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .filters-row {
      flex-direction: row;
      gap: var(--space-4);
    }
  }

  .filter-group {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
    white-space: nowrap;
  }

  .filter-btn:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text);
  }

  .filter-btn--active {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  .filter-btn--active:hover {
    background-color: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
    color: var(--color-text-inverse);
  }

  .filter-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--border-width-thick);
  }

  .media-status-region {
    display: contents;
  }

  .media-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .pagination-container {
    display: flex;
    justify-content: center;
    margin-top: var(--space-2);
  }

  .delete-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

</style>
