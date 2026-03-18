<!--
  @component StudioMediaPage

  Media management page in Studio. Displays an upload zone and a grid of
  existing media items with pagination. Supports edit metadata and delete actions.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import MediaUpload from '$lib/components/studio/MediaUpload.svelte';
  import MediaGrid from '$lib/components/studio/MediaGrid.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { deleteMedia } from '$lib/remote/media.remote';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  let showDeleteConfirm = $state(false);
  let deleteTargetId: string | null = $state(null);
  let isDeleting = $state(false);

  const currentPage = $derived(data.pagination.page);
  const totalPages = $derived(data.pagination.totalPages);
  const orgSlug = $derived($page.params.slug);
  const baseUrl = $derived(`/${orgSlug}/studio/media`);

  /**
   * Handle successful upload: refresh the media list
   */
  function handleUploadComplete() {
    void invalidateAll();
  }

  /**
   * Handle edit media (placeholder - could open a dialog)
   */
  function handleEdit(id: string) {
    // Future: open edit dialog
    console.log('Edit media:', id);
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
      console.error('Failed to delete media:', error);
    } finally {
      isDeleting = false;
    }
  }

  /**
   * Cancel delete operation
   */
  function cancelDelete() {
    showDeleteConfirm = false;
    deleteTargetId = null;
  }

  /**
   * Handle page change via URL navigation
   */
  function handlePageChange(newPage: number) {
    // Pagination links handle navigation via baseUrl + paramName
    // This callback is for client-side state sync
    void newPage;
  }
</script>

<svelte:head>
  <title>{m.media_title()} | {data.org.name} Studio</title>
</svelte:head>

<div class="media-page">
  <header class="page-header">
    <h1 class="page-title">{m.media_title()}</h1>
    <p class="page-subtitle">{m.media_subtitle()}</p>
  </header>

  <section class="upload-section">
    <MediaUpload onUploadComplete={handleUploadComplete} />
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
          {baseUrl}
          paramName="page"
        />
      </div>
    {/if}
  </section>
</div>

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm}
  <div class="dialog-overlay" onclick={cancelDelete} role="presentation">
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-desc"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') cancelDelete(); }}
    >
      <h2 id="delete-dialog-title" class="dialog-title">{m.media_delete_title()}</h2>
      <p id="delete-dialog-desc" class="dialog-description">{m.media_delete_confirm()}</p>
      <div class="dialog-actions">
        <button class="btn btn--secondary" onclick={cancelDelete} disabled={isDeleting}>
          {m.common_cancel()}
        </button>
        <button class="btn btn--danger" onclick={confirmDelete} disabled={isDeleting}>
          {isDeleting ? m.common_loading() : m.media_delete_button()}
        </button>
      </div>
    </div>
  </div>
{/if}

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

  .upload-section {
    /* Spacing is handled by the parent gap */
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

  /* Delete Confirmation Dialog */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background-color: var(--color-overlay, rgba(0, 0, 0, 0.5));
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 50);
    padding: var(--space-4);
  }

  .dialog {
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    max-width: 400px;
    width: 100%;
    box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
  }

  .dialog-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-2) 0;
  }

  .dialog-description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-6) 0;
    line-height: var(--leading-relaxed);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn--secondary {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  .btn--secondary:hover:not(:disabled) {
    background-color: var(--color-surface-secondary);
  }

  .btn--danger {
    background-color: var(--color-error-600, #dc2626);
    color: #ffffff;
    border-color: var(--color-error-600, #dc2626);
  }

  .btn--danger:hover:not(:disabled) {
    background-color: var(--color-error-700, #b91c1c);
    border-color: var(--color-error-700, #b91c1c);
  }

  /* Dark mode */
  [data-theme='dark'] .page-title {
    color: var(--color-text-dark);
  }

  [data-theme='dark'] .page-subtitle {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .dialog {
    background-color: var(--color-surface-dark);
  }

  [data-theme='dark'] .dialog-title {
    color: var(--color-text-dark);
  }

  [data-theme='dark'] .dialog-description {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .btn--secondary {
    background-color: var(--color-surface-dark);
    color: var(--color-text-dark);
    border-color: var(--color-border-dark);
  }

  [data-theme='dark'] .btn--secondary:hover:not(:disabled) {
    background-color: var(--color-surface-variant);
  }
</style>
