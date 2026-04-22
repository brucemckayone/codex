<!--
  @component StudioMediaPage

  Shared media library page for both personal Creator Studio and Org
  Studio. Composes the editorial command bar, optional feature slab,
  media-tile grid with inline upload ghosts, and pagination. Upload
  surface is a viewport-wide drop overlay + floating queue dock (see
  MediaUpload.svelte).
-->
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import MediaUpload, { type UploadItem } from '$lib/components/studio/MediaUpload.svelte';
  import MediaLibraryCommandBar from '$lib/components/studio/media-library/MediaLibraryCommandBar.svelte';
  import MediaFeatureSlab from '$lib/components/studio/media-library/MediaFeatureSlab.svelte';
  import MediaTileGrid, { type UploadGhost } from '$lib/components/studio/media-library/MediaTileGrid.svelte';
  import EditMediaDialog from '$lib/components/studio/EditMediaDialog.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import * as Dialog from '$lib/components/ui/Dialog';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { FilmIcon, SearchXIcon } from '$lib/components/ui/Icon';
  import { deleteMedia, updateMedia } from '$lib/remote/media.remote';
  import { logger } from '$lib/observability';
  import type { MediaItemWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { Button } from '$lib/components/ui';

  type MediaType = 'all' | 'video' | 'audio';
  type StatusFilter = 'all' | 'ready' | 'transcoding' | 'failed';

  interface Props {
    /** Page data containing mediaItems, pagination, and filters */
    data: {
      mediaItems: MediaItemWithRelations[];
      pagination: { page: number; totalPages: number; total?: number };
      filters: { status: string; mediaType: string };
    };
    /** Studio name shown in the browser tab (e.g., "My Studio" or org name) */
    studioName: string;
    /** Optional class forwarded to the root for layout composition (R13) */
    class?: string;
  }

  const { data, studioName, class: className }: Props = $props();

  // ── Upload surface wiring ─────────────────────────────────────────────
  let uploadQueue: UploadItem[] = $state([]);
  let triggerPicker: (() => void) | null = $state(null);

  // Turn UploadItem[] into UploadGhost[] for the grid
  const ghostItems = $derived<UploadGhost[]>(
    uploadQueue
      .filter((u) => u.status === 'uploading' || u.status === 'completing' || u.status === 'error')
      .map((u, i) => ({
        key: `${u.file.name}-${i}-${u.id ?? 'pending'}`,
        name: u.file.name,
        mediaType: u.file.type.startsWith('video/') ? 'video' : 'audio',
        progress: u.progress,
        status: u.status,
      }))
  );

  function openPicker() {
    triggerPicker?.();
  }

  // ── Delete state ──────────────────────────────────────────────────────
  let showDeleteConfirm = $state(false);
  let deleteTargetId: string | null = $state(null);
  let isDeleting = $state(false);

  // ── Edit state ────────────────────────────────────────────────────────
  let showEditDialog = $state(false);
  let editTarget = $state<MediaItemWithRelations | null>(null);

  // ── Pagination derivations ────────────────────────────────────────────
  const currentPage = $derived(data.pagination.page);
  const totalPages = $derived(data.pagination.totalPages);
  const totalItems = $derived(
    data.pagination.total ?? data.mediaItems.length
  );

  // ── URL-driven filter/search state ────────────────────────────────────
  const activeMediaType = $derived(
    (data.filters.mediaType === 'all' ? 'all' : data.filters.mediaType) as MediaType
  );
  const activeStatus = $derived(
    (data.filters.status === 'all' ? 'all' : data.filters.status) as StatusFilter
  );
  const activeSearch = $derived(page.url.searchParams.get('q') ?? '');

  let searchValue = $state(activeSearch);
  // keep local input in sync if URL changes externally (filter click, nav)
  $effect(() => {
    searchValue = activeSearch;
  });

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchValue = value;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const params = new URLSearchParams(page.url.searchParams);
      if (value.trim()) {
        params.set('q', value);
      } else {
        params.delete('q');
      }
      params.delete('page');
      const qs = params.toString();
      void goto(`/studio/media${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true });
    }, 200);
  }

  function handleSearchClear() {
    searchValue = '';
    const params = new URLSearchParams(page.url.searchParams);
    params.delete('q');
    params.delete('page');
    const qs = params.toString();
    void goto(`/studio/media${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true });
  }

  // ── Filter application ────────────────────────────────────────────────
  function setUrlParam(key: string, value: string, allSentinel = 'all') {
    const params = new URLSearchParams(page.url.searchParams);
    if (value === allSentinel) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page');
    const qs = params.toString();
    void goto(`/studio/media${qs ? `?${qs}` : ''}`, { invalidateAll: true });
  }

  function handleMediaTypeChange(value: MediaType) {
    setUrlParam('mediaType', value);
  }

  function handleStatusChange(value: StatusFilter) {
    setUrlParam('status', value);
  }

  // ── Pagination base URL (carries filters + search) ────────────────────
  const paginationBaseUrl = $derived.by(() => {
    const params = new URLSearchParams();
    if (data.filters.status !== 'all') params.set('status', data.filters.status);
    if (data.filters.mediaType !== 'all') params.set('mediaType', data.filters.mediaType);
    if (activeSearch) params.set('q', activeSearch);
    const qs = params.toString();
    return `/studio/media${qs ? `?${qs}` : ''}`;
  });

  // ── Client-side search (filters current page items by title) ──────────
  const filteredItems = $derived.by(() => {
    if (!activeSearch.trim()) return data.mediaItems;
    const needle = activeSearch.toLowerCase();
    return data.mediaItems.filter((item) =>
      item.title.toLowerCase().includes(needle)
    );
  });

  // ── Feature slab visibility ───────────────────────────────────────────
  // Only on page 1, no filters, no search — and only when the newest item
  // is `ready` (so the hero tile shows a real "done" piece, not a spinner).
  const featureMedia = $derived.by(() => {
    if (currentPage !== 1) return null;
    if (activeMediaType !== 'all' || activeStatus !== 'all') return null;
    if (activeSearch.trim()) return null;
    if (filteredItems.length === 0) return null;
    const candidate = filteredItems[0];
    return candidate.status === 'ready' ? candidate : null;
  });

  const gridItems = $derived.by(() =>
    featureMedia
      ? filteredItems.filter((i) => i.id !== featureMedia.id)
      : filteredItems
  );

  // Ordinal base: if the slab took ordinal 01, the grid starts at 02.
  const gridStartOrdinal = $derived(featureMedia ? 2 : 1);

  // ── Event handlers ────────────────────────────────────────────────────
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
      logger.error('Failed to delete media', {
        error: error instanceof Error ? error.message : String(error),
      });
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

  // TODO i18n — studio_media_search_empty_title / _description
  const searchEmptyTitle = 'No matches';
  const searchEmptyDescription =
    'Try a different search term or clear the search to see everything.';
</script>

<svelte:head>
  <title>{m.media_title()} | {studioName}</title>
</svelte:head>

<div class="media-page {className ?? ''}">
  <MediaLibraryCommandBar
    total={totalItems}
    mediaType={activeMediaType}
    status={activeStatus}
    searchValue={searchValue}
    onUploadClick={openPicker}
    onSearchInput={handleSearchInput}
    onSearchClear={handleSearchClear}
    onMediaTypeChange={handleMediaTypeChange}
    onStatusChange={handleStatusChange}
  />

  <!-- Library body — feature slab (page 1 only), grid, pagination -->
  <div
    class="library-body"
    role="status"
    aria-live="polite"
    aria-busy={!data}
  >
    {#if data.mediaItems.length === 0 && ghostItems.length === 0}
      <EmptyState
        title={m.media_empty()}
        description={m.media_empty_description()}
        icon={FilmIcon}
      />
    {:else if filteredItems.length === 0 && ghostItems.length === 0}
      <EmptyState
        title={searchEmptyTitle}
        description={searchEmptyDescription}
        icon={SearchXIcon}
      />
    {:else}
      {#if featureMedia}
        <MediaFeatureSlab
          media={featureMedia}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      {/if}

      <MediaTileGrid
        items={gridItems}
        ghosts={ghostItems}
        startOrdinal={gridStartOrdinal}
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
    {/if}
  </div>
</div>

<!-- Upload surface (drop overlay + floating dock). Logic is self-contained;
     parent reads queue as ghosts and owns the picker trigger. -->
<MediaUpload
  onUploadComplete={handleUploadComplete}
  bind:uploadingItems={uploadQueue}
  bind:triggerPicker
/>

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
    gap: var(--space-5);
  }

  .library-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: 0 var(--space-1);
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
