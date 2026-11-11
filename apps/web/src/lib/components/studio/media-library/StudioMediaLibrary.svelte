<!--
  @component StudioMediaLibrary

  The studio media library, one component for the org and personal studios
  (Codex-a6ofh.1.6; mockups media.html M1, M2, M6, M7a; data-design §1.1).

  It owns its reads: `listMedia` for the view the URL describes, 24 a page,
  with "Show more" appending the next page, and `getMediaSummary` for the
  whole-library numbers the header and the needs-attention line show. Every
  read renders three states (data-design §0): a skeleton while nothing has
  arrived, an error with Try again when the read failed, and the data. A
  failed read never falls through to "your library is empty".

  Live (Codex-l2c48.7): the page subscribes to the studio's status socket
  (`$lib/client/media-status`), which feeds every tile and asks for a refetch
  when the list falls behind. A finished item is announced once in a polite
  live region; the grid itself is not a live region, because live progress
  would make a screen reader read every tick.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { boundSearchParam, gateSearchQuery } from '@codex/validation';
  import { page } from '$app/state';
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { uploadQueue } from '$lib/client/upload-queue.svelte';
  import MediaUpload from '$lib/components/studio/MediaUpload.svelte';
  import { Button } from '$lib/components/ui';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { MOBILE_QUERY } from '$lib/components/ui/FilterDrawer/breakpoint';
  import { AlertTriangleIcon, FilmIcon, SearchXIcon, UploadIcon } from '$lib/components/ui/Icon';
  import ConfirmDialog from '$lib/components/ui/Feedback/ConfirmDialog.svelte';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { logger } from '$lib/observability';
  import { deleteMedia, getMediaSummary, getMediaUsage, listMedia } from '$lib/remote/media.remote';
  import { readFreshQuery } from '$lib/remote/query-result';
  import { formatFileSize } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import { attentionLine, soleFacetLabel } from './library-options';
  import { MEDIA_BULK_DELETE_MAX, runBulkDelete } from './bulk-delete';
  import {
    isNarrowed,
    LIBRARY_DEFAULTS,
    libraryListArgs,
    readLibraryState,
    readOpenItem,
  } from './library-url';
  import MediaDrawer from './MediaDrawer.svelte';
  import { retryMediaTranscoding } from './media-retry';
  import { describeTile } from './tile-state';
  import MediaDeleteDialog from './MediaDeleteDialog.svelte';
  import { logReadFailure } from './log-read-failure';
  import { createListSearch, createListUrlWriter } from '../list-url-writer';
  import { PagedList } from '../paged-list.svelte';
  import PagedListMore from '../PagedListMore.svelte';
  import { MediaDeleteFlow } from './media-delete-flow.svelte';
  import { draftsLeftToast } from './media-usage';
  import MediaLibraryCommandBar from './MediaLibraryCommandBar.svelte';
  import MediaLibraryToolbar from './MediaLibraryToolbar.svelte';
  import MediaTable from './MediaTable.svelte';
  import MediaTileGrid, { type UploadGhost } from './MediaTileGrid.svelte';

  interface Props {
    /** Studio name shown in the browser tab (e.g., "My Studio" or org name) */
    studioName: string;
    /** Optional class forwarded to the root for layout composition (R13) */
    class?: string;
  }

  const { studioName, class: className }: Props = $props();

  type MediaPage = Awaited<ReturnType<typeof listMedia>>;
  type MediaItem = MediaPage['items'][number];

  // ── The view, from the URL ────────────────────────────────────────────
  const view = $derived(readLibraryState(page.url));
  /** The drawer's item (`?item=`, Codex-a6ofh.1.7). Not a facet: no refetch. */
  const openItem = $derived(readOpenItem(page.url));
  // The search floor (Codex-k618q) sits on the query argument: below
  // SEARCH_MIN_QUERY_LENGTH this is null and the list asks for no pattern.
  // Bounded first (Codex-osuqt): an over-long `?q=` is cut to the API's 255,
  // never refused as a 400 that no Try again could fix.
  const search = $derived(gateSearchQuery(boundSearchParam(view.q)));
  const narrowed = $derived(isNarrowed(view, search));

  // Below `sm` both views are the row list (M7a), so the toggle is moot.
  const phone = new MediaQuery(MOBILE_QUERY);
  const layout = $derived(phone.current ? 'grid' : view.view);

  // ── Reads ─────────────────────────────────────────────────────────────
  // The list a page at a time (`PagedList`, shared with the content list,
  // Codex-a6ofh.3.1): it holds the last list while a changed filter loads (the
  // page dims instead of flashing a skeleton), appends "Show more" only to the
  // view it was read for, and treats a failed read as a state, never empty.
  const list = new PagedList({
    args: (pageNumber) => libraryListArgs(view, search, pageNumber),
    read: listMedia,
    onMoreFailed: (error) => logReadFailure('studio_media.show_more_failed', error),
  });
  const summary = getMediaSummary();

  // The summary decorates the header. A failed read (first or refetch) drops
  // the sums, so stale numbers never read as current, and the attention slot
  // says it couldn't check, with its own Try again. Logged on each failure.
  const sums = $derived(summary.error == null ? summary.current : undefined);
  const summaryFailed = $derived(summary.error != null);
  $effect(() => {
    if (summary.error != null) logReadFailure('studio_media.summary_failed', summary.error);
  });

  let summaryRetrying = $state(false);
  async function retrySummary() {
    if (summaryRetrying) return;
    summaryRetrying = true;
    // A second failure sets `summary.error` again: the effect logs it, and
    // the line stays.
    await summary.refresh().catch(() => undefined);
    summaryRetrying = false;
  }

  // ── Upload surface ────────────────────────────────────────────────────
  // The queue is the studio's own store (Codex-a6ofh.1.2), so an upload
  // started here keeps going, and shows in the tray, after the page unmounts.
  let triggerPicker: (() => void) | null = $state(null);

  const ghostItems = $derived<UploadGhost[]>(
    uploadQueue.items
      .filter((u) => u.status === 'uploading' || u.status === 'completing' || u.status === 'error')
      .map((u) => ({
        key: u.key,
        name: u.title,
        mediaType: u.mediaType,
        progress: u.progress,
        status: u.status,
      }))
  );

  function openPicker() {
    triggerPicker?.();
  }

  // An item this tab is uploading shows as its ghost tile, never twice: the
  // live channel can refetch the list while the upload is still running.
  const uploadingHere = $derived(
    new Set(
      uploadQueue.items
        .filter((u) => u.id !== null && u.status !== 'done' && u.status !== 'queued')
        .map((u) => u.id as string)
    )
  );

  // ── The rows ──────────────────────────────────────────────────────────
  // Every loaded row once (`list.items`), less the uploads running here.
  const items = $derived(list.items.filter((item) => !uploadingHere.has(item.id)));

  // ── Header ────────────────────────────────────────────────────────────
  const countText = $derived.by(() => {
    if (narrowed) {
      if (!sums) return null;
      const label = soleFacetLabel(view);
      const shown = m.media_library_count_narrowed({ shown: list.total, total: sums.total });
      return label ? `${shown} · ${label}` : shown;
    }
    if (sums) {
      const size = formatFileSize(sums.totalBytes);
      if (sums.total === 1) return m.media_library_count_one({ size });
      return size ? m.media_library_count({ count: sums.total, size }) : m.media_library_items({ count: sums.total });
    }
    return list.shown ? m.media_library_items({ count: list.total }) : null;
  });

  const attention = $derived(attentionLine(sums, view.status));

  // ── Writing the view back to the URL ──────────────────────────────────
  // One navigation per tick, built on a navigation in flight, and none for a
  // write that changes nothing (`createListUrlWriter`, Codex-a6ofh.1.7).
  const setParams = createListUrlWriter(LIBRARY_DEFAULTS);

  // The box as typed: a writable derived, so typing overrides it. It
  // re-derives only when the URL's search text itself changes (Clear, back):
  // `urlSearch` is a string, so another param's write while typing (a status
  // click) leaves it, and what was typed, alone.
  const urlSearch = $derived(view.q);
  let searchValue = $derived(urlSearch);
  const searchInput = createListSearch((value) => setParams({ q: value }));
  onDestroy(searchInput.cancel);

  function clearFilters() {
    searchInput.cancel();
    setParams({ q: null, mediaType: null, status: null, usage: null });
  }

  // ── Refetch ───────────────────────────────────────────────────────────
  /**
   * Every loaded page again, and the summary: after an upload, edit or
   * delete, and whenever the live channel says the list is stale. REJECTS
   * when a read fails, so the caller logs it and the page keeps its rows.
   * Never `invalidate()`: a load that throws there swaps in +error.svelte,
   * unmounting a running upload.
   */
  async function refresh(): Promise<void> {
    await Promise.all([
      list.refresh(),
      // Decoration: a summary failure shows in the header and is logged by
      // the effect above. It never fails the list refetch the live channel
      // waits on to drop the states it holds.
      summary.refresh().catch(() => undefined),
    ]);
  }

  /** After this page's own change; a refetch that fails keeps the rows and says so. */
  function refreshAfterChange() {
    refresh().catch((error) => logReadFailure('studio_media.refresh_failed', error));
  }

  // The error card's and the stale notice's Try again: it shows it is
  // running, and says so when it fails again.
  let retrying = $state(false);
  let retryFailed = $state(false);
  async function retryList() {
    if (retrying) return;
    retrying = true;
    retryFailed = false;
    try {
      await refresh();
    } catch (error) {
      retryFailed = true;
      logReadFailure('studio_media.retry_failed', error);
    } finally {
      retrying = false;
    }
  }

  // ── Live status ───────────────────────────────────────────────────────
  const listedLifecycles = $derived(new Map(list.items.map((item) => [item.id, item.status])));

  let announcement = $state('');

  // onMount, not $effect: register() reads the store's own state, which an
  // effect would track, re-subscribing on every connection change.
  onMount(() =>
    mediaStatus.register({
      listed: () => listedLifecycles,
      refresh,
      settled: (mediaId, lifecycle) => {
        const title = list.items.find((item) => item.id === mediaId)?.title;
        if (!title) return;
        announcement =
          lifecycle === 'ready' ? m.media_announce_ready({ title }) : m.media_announce_failed({ title });
      },
    })
  );

  // A finished upload, whichever page started it, belongs in this list.
  // Paused, it is the creator's own work to watch: resume() refetches too.
  onMount(() =>
    uploadQueue.onComplete(() => {
      if (mediaStatus.connection === 'paused') mediaStatus.resume('action');
      else refreshAfterChange();
    })
  );

  // ── The drawer (Codex-a6ofh.1.7) ──────────────────────────────────────
  // Edit lives in the drawer now (mockup M3): title and description in place.
  function openDrawer(id: string) {
    setParams({ item: id });
  }

  function closeDrawer() {
    setParams({ item: null });
  }

  const openPoster = $derived(list.items.find((item) => item.id === openItem)?.thumbnailUrl ?? null);

  // ── Delete (Codex-6sbn1) ──────────────────────────────────────────────
  // Never a cached read: the chip's popover may hold the same query, minutes old.
  const deleteFlow = new MediaDeleteFlow({
    readUsage: (id) => readFreshQuery(getMediaUsage(id)),
    remove: (input) => deleteMedia(input),
  });

  /** Focus after a delete: the library, not `<body>` once the tile has gone. */
  let libraryBody: HTMLElement | null = $state(null);

  function handleDelete(id: string) {
    const media = list.items.find((item) => item.id === id);
    if (media) startDelete(media);
  }

  /** From a row, a tile or the drawer (which may show an item not loaded here). */
  function startDelete(media: Pick<MediaItem, 'id' | 'title' | 'mediaType' | 'durationSeconds' | 'fileSizeBytes'> & {
    thumbnailUrl?: string | null;
    usage?: MediaItem['usage'];
  }) {
    // The drawer gives way to the delete dialog: one dialog at a time.
    if (openItem === media.id) closeDrawer();
    deleteFlow.open({
      id: media.id,
      title: media.title,
      mediaType: media.mediaType,
      durationSeconds: media.durationSeconds,
      fileSizeBytes: media.fileSizeBytes,
      thumbnailUrl: media.thumbnailUrl ?? null,
      usage: media.usage,
    });
  }

  // ── Bulk (list view, mockup M2; data-design §1.3) ─────────────────────
  let selected = $state<Set<string>>(new Set());
  // A changed view starts a fresh selection, and its old result line goes.
  $effect(() => {
    void list.key;
    untrack(() => {
      selected = new Set();
      bulkResult = '';
    });
  });
  // Only rows the creator can see: an upload running here is a ghost, not a
  // row, and must never be swept into a delete it was not shown in.
  const selection = $derived(items.filter((item) => selected.has(item.id)));
  const selectionBytes = $derived(selection.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0));
  const retryable = $derived(
    selection.filter((item) => {
      const tile = describeTile(item, mediaStatus.items.get(item.id), 0);
      return tile.kind === 'failed' && tile.canRetry;
    })
  );

  function toggle(id: string) {
    if (selected.size === 0) bulkResult = '';
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function toggleAll(on: boolean) {
    if (on && selected.size === 0) bulkResult = '';
    selected = on ? new Set(items.map((item) => item.id)) : new Set();
  }

  let bulkBusy = $state(false);
  let bulkConfirmOpen = $state(false);
  let bulkResult = $state('');

  async function bulkRetry() {
    if (bulkBusy) return;
    bulkBusy = true;
    try {
      // Each one tells its own refusal (media-retry.ts); the socket the rest.
      for (const item of retryable) await retryMediaTranscoding(item.id);
    } finally {
      bulkBusy = false;
    }
  }

  async function bulkDelete() {
    const ids = selection.map((item) => item.id);
    if (bulkBusy) return;
    if (ids.length === 0 || ids.length > MEDIA_BULK_DELETE_MAX) {
      // The rows moved under the open confirm (a refetch, another tab).
      bulkResult = m.media_bulk_nothing();
      bulkConfirmOpen = false;
      return;
    }
    bulkBusy = true;
    try {
      const result = await runBulkDelete(ids, {
        readUsage: (id) => readFreshQuery(getMediaUsage(id)),
        remove: (input) => deleteMedia(input),
        onFailure: (id, error) => logReadFailure('studio_media.bulk_delete_failed', error, { mediaId: id }),
      });
      bulkResult = [
        result.deleted.length > 0 ? m.media_bulk_deleted({ count: result.deleted.length }) : '',
        result.draftsAffected > 0 ? m.media_bulk_drafts({ count: result.draftsAffected }) : '',
        result.blocked.length > 0 ? m.media_bulk_blocked({ count: result.blocked.length }) : '',
        result.changed.length > 0 ? m.media_bulk_changed({ count: result.changed.length }) : '',
        result.rateLimited.length > 0 ? m.media_bulk_rate_limited({ count: result.rateLimited.length }) : '',
        result.failed.length > 0 ? m.media_bulk_failed({ count: result.failed.length }) : '',
      ]
        .filter(Boolean)
        .join(' ');
      // What stayed stays selected, so the creator can see what it was.
      selected = new Set([...result.blocked, ...result.changed, ...result.rateLimited, ...result.failed]);
      refreshAfterChange();
    } finally {
      bulkBusy = false;
      bulkConfirmOpen = false;
    }
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
          toast.add(draftsLeftToast(outcome.drafts, outcome.firstDraft, page.url, outcome.thumbnails));
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

  const rowsEmpty = $derived(items.length === 0 && ghostItems.length === 0);

  /** "Nothing needs attention" (M6) when that is the whole question asked. */
  const onlyAttention = $derived(
    view.status === 'attention' && view.mediaType === 'all' && view.usage === 'any' && search === null
  );
</script>

<svelte:head>
  <title>{m.media_title()} | {studioName}</title>
</svelte:head>

{#snippet loadFailed()}
  <EmptyState
    title={m.media_library_error_title()}
    description={list.refused ? m.media_library_error_refused() : m.media_library_error_body()}
    icon={AlertTriangleIcon}
  >
    {#snippet action()}
      {#if list.refused && narrowed}
        <Button variant="secondary" onclick={clearFilters}>{m.media_clear_filters()}</Button>
      {:else}
        <Button loading={retrying} disabled={retrying} onclick={retryList}>{m.media_library_retry()}</Button>
      {/if}
      {#if retryFailed}
        <p class="retry-failed" role="alert">{m.media_library_retry_failed()}</p>
      {/if}
    {/snippet}
  </EmptyState>
{/snippet}

{#snippet empty()}
  {#if narrowed}
    <EmptyState
      title={onlyAttention ? m.media_library_none_attention_title() : m.media_library_none_title()}
      description={`${onlyAttention ? m.media_library_none_attention_body() : m.media_library_none_body()} ${
        sums ? m.media_library_in_library({ count: sums.total }) : ''
      }`.trim()}
      icon={SearchXIcon}
    >
      {#snippet action()}
        <Button variant="secondary" onclick={clearFilters}>{m.media_clear_filters()}</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.media_library_new_title()} description={m.media_library_new_body()} icon={FilmIcon}>
      {#snippet action()}
        <Button onclick={openPicker}>
          <UploadIcon size={16} />
          {m.media_empty_cta()}
        </Button>
        <p class="empty-hint">{m.media_library_new_hint()}</p>
      {/snippet}
    </EmptyState>
  {/if}
{/snippet}

{#snippet attentionSlot()}
  {#if attention}
    <div class="attention" role="note">
      <AlertTriangleIcon size={16} />
      <p class="attention-text"><strong>{attention.title}</strong> {attention.detail}</p>
      <Button size="sm" variant="secondary" onclick={() => setParams({ status: 'attention' })}>
        {m.media_attention_show()}
      </Button>
    </div>
  {:else if summaryFailed && view.status !== 'attention'}
    <!-- Never read as "nothing needs attention": the check did not run. -->
    <div class="attention attention--unknown" role="note">
      <p class="attention-text">{m.media_summary_failed()}</p>
      <Button size="sm" variant="ghost" loading={summaryRetrying} disabled={summaryRetrying} onclick={retrySummary}>
        {m.media_library_retry()}
      </Button>
    </div>
  {/if}
{/snippet}

{#snippet rows()}
  {#if list.failed}
    <!-- A refetch failed: these rows are the last that arrived. -->
    <div class="stale" role="alert">
      <p class="stale-text">
        {retryFailed ? m.media_library_retry_failed() : m.media_library_stale()}
      </p>
      <Button size="sm" variant="secondary" loading={retrying} disabled={retrying} onclick={retryList}>
        {m.media_library_retry()}
      </Button>
    </div>
  {/if}
  {#if layout === 'list'}
    {#if selection.length > 0}
      <div class="selbar" role="region" aria-label={m.media_bulk_label()}>
        <span class="selbar-count">
          {m.media_bulk_selected({ count: selection.length, size: formatFileSize(selectionBytes) || '0 KB' })}
        </span>
        {#if retryable.length > 0}
          <Button size="sm" variant="secondary" disabled={bulkBusy} onclick={bulkRetry}>
            {m.media_bulk_retry({ count: retryable.length })}
          </Button>
        {/if}
        <Button
          size="sm"
          variant="destructive"
          disabled={bulkBusy || selection.length > MEDIA_BULK_DELETE_MAX}
          onclick={() => (bulkConfirmOpen = true)}
        >
          {m.media_bulk_delete({ count: selection.length })}
        </Button>
        {#if selection.length > MEDIA_BULK_DELETE_MAX}
          <span class="selbar-note">{m.media_bulk_cap({ max: MEDIA_BULK_DELETE_MAX })}</span>
        {/if}
        <Button size="sm" variant="ghost" onclick={() => toggleAll(false)}>{m.media_bulk_clear()}</Button>
      </div>
    {/if}
    {#if bulkResult}
      <p class="bulk-result" role="status">{bulkResult}</p>
    {/if}
    <MediaTable
      {items}
      ghosts={ghostItems}
      {selected}
      onToggle={toggle}
      onToggleAll={toggleAll}
      onCancelUpload={(key) => uploadQueue.cancel(key)}
      onOpen={openDrawer}
      onEdit={openDrawer}
      onDelete={handleDelete}
    />
  {:else}
    <MediaTileGrid
      {items}
      ghosts={ghostItems}
      onCancelUpload={(key) => uploadQueue.cancel(key)}
      onOpen={openDrawer}
      onEdit={openDrawer}
      onDelete={handleDelete}
    />
  {/if}

  <PagedListMore {list} />
{/snippet}

<div class="media-library {className ?? ''}">
  <MediaLibraryCommandBar
    live={mediaStatus.connection}
    onLiveResume={() => mediaStatus.resume()}
    onUploadClick={openPicker}
  />

  <header class="library-header">
    <h1 class="library-title">
      {m.media_title()}
      {#if countText}
        <span class="library-count">{countText}</span>
      {/if}
    </h1>
    <!-- Decision 1A: media belongs to one creator, so say whose library this is. -->
    <p class="library-scope">{m.media_library_scope()}</p>
  </header>

  <MediaLibraryToolbar
    library={view}
    {searchValue}
    onSearchInput={(value) => {
      searchValue = value;
      searchInput.input(value);
    }}
    onSearchClear={() => {
      searchValue = '';
      searchInput.clear();
    }}
    onChange={setParams}
  />

  {@render attentionSlot()}

  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  <div
    class="library-body"
    role="region"
    aria-label={m.media_title()}
    aria-busy={list.refreshing || undefined}
    data-refreshing={list.refreshing || undefined}
    tabindex="-1"
    bind:this={libraryBody}
  >
    {#if list.unread || (list.failed && rowsEmpty)}
      {@render loadFailed()}
    {:else if list.loading}
      <div class="library-skeleton" aria-hidden="true">
        {#each Array(8) as _, index (index)}
          <div class="skeleton-tile">
            <div class="skeleton-thumb"><Skeleton width="100%" height="100%" /></div>
            <Skeleton width="75%" height="var(--text-sm)" />
            <Skeleton width="45%" height="var(--text-xs)" />
          </div>
        {/each}
      </div>
    {:else if rowsEmpty}
      {@render empty()}
    {:else}
      {@render rows()}
    {/if}
  </div>
</div>

<!-- Drop overlay + file input. The queue is the studio's store, and the tray
     that shows it lives in the studio layout. -->
<MediaUpload bind:triggerPicker />

<MediaDrawer
  mediaId={openItem}
  poster={openPoster}
  onClose={closeDrawer}
  onDelete={startDelete}
  onChanged={refreshAfterChange}
/>

<ConfirmDialog
  bind:open={bulkConfirmOpen}
  title={m.media_bulk_confirm_title({ count: selection.length })}
  description={m.media_bulk_confirm_body()}
  confirmText={m.media_bulk_delete({ count: selection.length })}
  variant="destructive"
  awaitConfirm
  onConfirm={bulkDelete}
/>

<!-- Delete: reads where the item is used first (Codex-6sbn1) -->
<MediaDeleteDialog flow={deleteFlow} onConfirm={confirmDelete} focusAfterDelete={() => libraryBody} />

<style>
  .media-library {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .library-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-1);
  }

  .library-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .library-count {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    letter-spacing: normal;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .library-scope {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .attention {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
    color: var(--color-status-warning-text);
  }

  .attention-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .attention--unknown {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .stale {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
  }

  .stale-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .retry-failed {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
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

  /* A changed filter is loading: the old rows stay, dimmed, until it lands. */
  .library-body[data-refreshing] {
    opacity: var(--opacity-60, 0.6);
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .library-skeleton {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-4) var(--space-3);
  }

  .skeleton-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }

  .skeleton-thumb {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .empty-hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .selbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    background: var(--color-interactive-subtle);
  }

  .selbar-count {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .selbar-note,
  .bulk-result {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  @media (--below-sm) {
    .library-skeleton {
      grid-template-columns: 1fr;
    }

    .attention {
      flex-wrap: wrap;
    }
  }
</style>
