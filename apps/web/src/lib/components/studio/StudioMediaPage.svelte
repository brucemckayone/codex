<!--
  @component StudioMediaPage

  Shared media library page for both personal Creator Studio and Org
  Studio. Composes the editorial command bar, optional feature slab,
  media-tile grid with inline upload ghosts, and pagination. Upload
  surface is a viewport-wide drop overlay + floating queue dock (see
  MediaUpload.svelte).

  Live (Codex-l2c48.7): the page subscribes to the studio's status socket
  (`$lib/client/media-status`), which feeds every tile and asks for a list
  refetch when the list falls behind. A finished item is announced once in
  a polite live region; the grid itself is not a live region, because live
  progress would make a screen reader read every tick.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import MediaUpload, { type UploadItem } from '$lib/components/studio/MediaUpload.svelte';
  import MediaLibraryCommandBar from '$lib/components/studio/media-library/MediaLibraryCommandBar.svelte';
  import MediaFeatureSlab from '$lib/components/studio/media-library/MediaFeatureSlab.svelte';
  import MediaTileGrid, { type UploadGhost } from '$lib/components/studio/media-library/MediaTileGrid.svelte';
  import EditMediaDialog from '$lib/components/studio/EditMediaDialog.svelte';
  import MediaDeleteDialog from '$lib/components/studio/media-library/MediaDeleteDialog.svelte';
  import { MediaDeleteFlow } from '$lib/components/studio/media-library/media-delete-flow.svelte';
  import { draftsLeftToast } from '$lib/components/studio/media-library/media-usage';
  import { Pagination } from '$lib/components/ui/Pagination';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { FilmIcon, SearchXIcon, UploadIcon } from '$lib/components/ui/Icon';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { deleteMedia, getMediaUsage, updateMedia } from '$lib/remote/media.remote';
  import { readFreshQuery } from '$lib/remote/query-result';
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { logger } from '$lib/observability';
  import type { MediaItemWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { Button } from '$lib/components/ui';

  type MediaType = 'all' | 'video' | 'audio';
  type StatusFilter = 'all' | 'ready' | 'transcoding' | 'failed';

  interface Props {
    /** Page data containing mediaItems, pagination, and filters */
    data: {
      mediaItems: (MediaItemWithRelations & { thumbnailUrl?: string | null })[];
      pagination: { page: number; totalPages: number; total?: number };
      filters: { status: string; mediaType: string };
    };
    /** Studio name shown in the browser tab (e.g., "My Studio" or org name) */
    studioName: string;
    /** Optional class forwarded to the root for layout composition (R13) */
    class?: string;
    /**
     * Refetch the media list: after an upload, edit or delete, and whenever
     * the live status channel says the list is stale. Resolves once the new
     * list has landed and REJECTS when it fails, so the page keeps its grid
     * and the failure is logged. Never `invalidate()`: a load that throws
     * there swaps in +error.svelte, unmounting a running upload.
     */
    onRefresh?: () => void | Promise<void>;
  }

  const { data, studioName, class: className, onRefresh }: Props = $props();

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
        mediaType: u.mediaType,
        progress: u.progress,
        status: u.status,
      }))
  );

  function openPicker() {
    triggerPicker?.();
  }

  // ── Live status ───────────────────────────────────────────────────────
  // An item this tab is uploading shows as its ghost tile, never twice: the
  // live channel can refetch the list while the upload is still running.
  const uploadingHere = $derived(
    new Set(
      uploadQueue
        .filter((u) => u.id !== null && u.status !== 'done' && u.status !== 'queued')
        .map((u) => u.id as string)
    )
  );

  const listedLifecycles = $derived(
    new Map(data.mediaItems.map((item) => [item.id, item.status]))
  );

  let announcement = $state('');

  // onMount, not $effect: register() reads the store's own state, which an
  // effect would track, re-subscribing on every connection change.
  onMount(() =>
    mediaStatus.register({
      listed: () => listedLifecycles,
      refresh: () => onRefresh?.(),
      settled: (mediaId, lifecycle) => {
        const title = data.mediaItems.find((item) => item.id === mediaId)?.title;
        if (!title) return;
        announcement =
          lifecycle === 'ready'
            ? m.media_announce_ready({ title })
            : m.media_announce_failed({ title });
      },
    })
  );


  // ── Delete (Codex-6sbn1) ──────────────────────────────────────────────
  // Never a cached read: the chip's popover may hold the same query, minutes old.
  const deleteFlow = new MediaDeleteFlow({
    readUsage: (id) => readFreshQuery(getMediaUsage(id)),
    remove: (input) => deleteMedia(input),
  });

  /** Focus after a delete: the library, not `<body>` once the tile has gone. */
  let libraryBody: HTMLElement | null = $state(null);

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
    const listed = data.mediaItems.filter((item) => !uploadingHere.has(item.id));
    if (!activeSearch.trim()) return listed;
    const needle = activeSearch.toLowerCase();
    return listed.filter((item) =>
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
  /** After this page's own change; a refetch that fails keeps the grid. */
  function refreshAfterChange() {
    Promise.resolve(onRefresh?.()).catch((error) => {
      logger.warn('studio_media.refresh_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function handleUploadComplete() {
    refreshAfterChange();
  }

  function handleEdit(id: string) {
    const media = data.mediaItems.find((item) => item.id === id);
    if (!media) return;
    editTarget = media;
    showEditDialog = true;
  }

  async function handleSave(id: string, updateData: { title?: string; description?: string | null }) {
    await updateMedia({ id, data: updateData });
    refreshAfterChange();
  }

  function handleDelete(id: string) {
    const media = data.mediaItems.find((item) => item.id === id);
    if (!media) return;
    deleteFlow.open({
      id: media.id,
      title: media.title,
      mediaType: media.mediaType,
      durationSeconds: media.durationSeconds,
      fileSizeBytes: media.fileSizeBytes,
      thumbnailUrl: media.thumbnailUrl,
      usage: media.usage,
    });
  }

  async function confirmDelete() {
    const mediaId = deleteFlow.target?.id;
    const outcome = await deleteFlow.confirm();
    if (!outcome) return;
    switch (outcome.kind) {
      case 'deleted':
        deleteFlow.close();
        refreshAfterChange();
        // Owner round 2, decision 6: say which drafts lost their media.
        if (outcome.drafts > 0) {
          toast.add(draftsLeftToast(outcome.drafts, outcome.firstDraft, page.url));
        }
        return;
      case 'gone':
        // Another tab deleted it first: the list catches up.
        deleteFlow.close();
        refreshAfterChange();
        toast.info(m.media_delete_already_gone());
        return;
      case 'failed':
        // The dialog says so (F3); this is for us.
        if (outcome.status === undefined || outcome.status >= 500) {
          logger.error('studio_media.delete_failed', { mediaId, status: outcome.status });
        } else if (outcome.status !== 429) {
          logger.warn('studio_media.delete_refused', { mediaId, status: outcome.status });
        }
        return;
      case 'refused':
        // The dialog re-read the uses and says why (R1, R2).
        return;
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
    live={mediaStatus.connection}
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
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  <div
    class="library-body"
    role="region"
    aria-label={m.media_title()}
    tabindex="-1"
    bind:this={libraryBody}
  >
    {#if data.mediaItems.length === 0 && ghostItems.length === 0}
      <EmptyState
        title={m.media_empty()}
        description={m.media_empty_description()}
        icon={FilmIcon}
      >
        {#snippet action()}
          <Button onclick={openPicker}>
            <UploadIcon size={16} />
            {m.media_empty_cta()}
          </Button>
        {/snippet}
      </EmptyState>
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

<!-- Delete: reads where the item is used first (Codex-6sbn1) -->
<MediaDeleteDialog
  flow={deleteFlow}
  onConfirm={confirmDelete}
  focusAfterDelete={() => libraryBody}
/>

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

  /* Focused from code only (after a delete): a ring round the whole library
     would mark nothing the creator can act on; the next Tab lands on a tile. */
  .library-body:focus {
    outline: none;
  }

  .pagination-container {
    display: flex;
    justify-content: center;
    margin-top: var(--space-2);
  }
</style>
