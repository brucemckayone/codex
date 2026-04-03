<!--
  @component StudioMediaPage

  Media management page in Studio. Displays an upload zone and a grid of
  existing media items with pagination. Supports edit metadata and delete actions.
  Includes server-side filtering by media type and status.
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

  let { data } = $props();

  // Delete state
  let showDeleteConfirm = $state(false);
  let deleteTargetId: string | null = $state(null);
  let isDeleting = $state(false);

  // Edit state
  let showEditDialog = $state(false);
  let editTarget = $state<MediaItemWithRelations | null>(null);

  const currentPage = $derived(data.pagination.page);
  const totalPages = $derived(data.pagination.totalPages);

  // Build pagination baseUrl that preserves current filter params
  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.filters.status !== 'all') params.set('status', data.filters.status);
    if (data.filters.mediaType !== 'all') params.set('mediaType', data.filters.mediaType);
    const qs = params.toString();
    return `/studio/media${qs ? `?${qs}` : ''}`;
  });

  // Filter state (derived from URL)
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

  /**
   * Navigate with updated filter params, resetting page to 1
   */
  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page'); // Reset to page 1 on filter change
    const qs = params.toString();
    void goto(`/studio/media${qs ? `?${qs}` : ''}`, { invalidateAll: true });
  }

  /**
   * Handle successful upload: refresh the media list
   */
  function handleUploadComplete() {
    void invalidateAll();
  }

  /**
   * Handle edit media: open edit dialog
   */
  function handleEdit(id: string) {
    const media = data.mediaItems.find((item) => item.id === id);
    if (!media) return;
    editTarget = media;
    showEditDialog = true;
  }

  /**
   * Save edited media metadata
   */
  async function handleSave(id: string, updateData: { title?: string; description?: string | null }) {
    await updateMedia({ id, data: updateData });
    void invalidateAll();
  }

  /**
   * Confirm delete media
   */
  function handleDelete(id: string) {
    deleteTargetId = id;
    showDeleteConfirm = true;
  }

  /**
   * Execute the delete operation
   */
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

  /**
   * Handle delete dialog close
   */
  function handleDeleteDialogChange(isOpen: boolean) {
    showDeleteConfirm = isOpen;
    if (!isOpen) {
      deleteTargetId = null;
    }
  }

  /**
   * Handle page change via URL navigation
   */
  function handlePageChange(newPage: number) {
    void newPage;
  }
</script>

<svelte:head>
  <title>{m.media_title()} | {data.org.name}</title>
</svelte:head>

<div class="media-page">
  <header class="page-header">
    <h1 class="page-title">{m.media_title()}</h1>
    <p class="page-subtitle">{m.media_subtitle()}</p>
  </header>

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
            onclick={() => setFilter('status', option.value)}
            type="button"
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  </section>

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
          onPageChange={handlePageChange}
          baseUrl={paginationBaseUrl}
          paramName="page"
        />
      </div>
    {/if}
  </section>
</div>

<!-- Edit Media Dialog -->
<EditMediaDialog
  bind:open={showEditDialog}
  media={editTarget}
  onSave={handleSave}
/>

<!-- Delete Confirmation Dialog -->
<Dialog.Root bind:open={showDeleteConfirm} onOpenChange={handleDeleteDialogChange}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.media_delete_title()}</Dialog.Title>
    </Dialog.Header>
    <p class="delete-description">{m.media_delete_confirm()}</p>
    <div class="dialog-actions">
      <button
        class="btn btn-secondary"
        onclick={() => handleDeleteDialogChange(false)}
        disabled={isDeleting}
      >
        {m.common_cancel()}
      </button>
      <button class="btn btn-danger" onclick={confirmDelete} disabled={isDeleting}>
        {isDeleting ? m.common_loading() : m.media_delete_button()}
      </button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .media-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .page-subtitle {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-normal);
  }

  /* Filters */
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

  @media (min-width: 640px) {
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
    border-radius: var(--radius-full, 9999px);
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

  /* Delete dialog content */
  .delete-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-relaxed);
  }


  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* Button styles for dialogs */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
    border: none;
    text-decoration: none;
    padding: var(--space-2) var(--space-4);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .btn-secondary:hover:not(:disabled) {
    background-color: var(--color-surface);
  }

  .btn-danger {
    background-color: var(--color-error-600, #dc2626);
    color: #ffffff;
    border-color: var(--color-error-600, #dc2626);
  }

  .btn-danger:hover:not(:disabled) {
    background-color: var(--color-error-700, #b91c1c);
    border-color: var(--color-error-700, #b91c1c);
  }

  /* Dark mode */
  :global([data-theme='dark']) .page-title {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .page-subtitle {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .delete-description {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .filter-btn {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .filter-btn:hover {
    border-color: var(--color-border-hover-dark);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .filter-btn--active {
    background-color: var(--color-interactive);
    border-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }

  :global([data-theme='dark']) .btn-secondary {
    background-color: var(--color-surface-dark);
    color: var(--color-text-dark);
    border-color: var(--color-border-dark);
  }
</style>
