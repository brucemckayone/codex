<!--
  @component MediaPickerDialog

  The one media field every surface attaches media with (Codex-a6ofh.1.8,
  mockup M5): the content editor, the page builder's media panel and section
  inspector, and the brand studio's intro film.

  The field shows what is chosen by reading it BY ID (`getMediaItem`), never
  by finding it in a loaded list: the old combobox showed a saved item past
  its 50 (or 100) newest as an empty "Select media…". The dialog searches and
  pages the creator's whole library on the server, 24 at a time.

  `onchange` fires only on the creator's own act: Attach, Remove, or an
  upload started here getting its id. A value set from outside is shown and
  never echoed back, so a caller's saved value is never cleared by a read.
-->
<script lang="ts">
  import { boundSearchParam, gateSearchQuery, SEARCH_MAX_QUERY_LENGTH } from '@codex/validation';
  import { untrack } from 'svelte';
  import { type MediaStatusConnection, mediaStatus } from '$lib/client/media-status.svelte';
  import { type UploadItem, uploadQueue } from '$lib/client/upload-queue.svelte';
  import { Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { FilmIcon, MusicIcon, SearchIcon, UnlinkIcon, UploadIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { getMediaItem, listMedia } from '$lib/remote/media.remote';
  import { remoteErrorStatus } from '$lib/remote/query-result';
  import { formatDate, formatDuration } from '$lib/utils/format';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import { mediaFileAccept } from '../media-upload-file';
  import MediaStatusPill from './MediaStatusPill.svelte';
  import { SORT_OPTIONS } from './library-options';
  import type { LibrarySort } from './library-url';
  import { logReadFailure } from './log-read-failure';
  import { type PickerSegment, pickerListArgs } from './picker-args';
  import { chosenView, type Following, followUpload } from './picker-state';
  import { rejectionReason, tileReason } from './tile-copy';
  import { stallsAt, tilePill } from './tile-state';

  type MediaKind = 'video' | 'audio';

  interface Props {
    /** The chosen media id, or null. Shown as it is; never echoed back. */
    value: string | null;
    onchange: (mediaId: string | null) => void;
    /** What this field holds: the content's one type, or a slot's accept list. */
    mediaTypes: readonly MediaKind[];
    /**
     * Offer items still processing, and an upload: only a DRAFT may hold one
     * (`ContentService` refuses a non-ready item for content that is live or
     * was ever released). The page builder and the intro film keep ready only:
     * an un-transcoded item has no rendition to play on a live page.
     */
    allowProcessing?: boolean;
    /** The field's accessible name. */
    ariaLabel: string;
    /** A hidden input carrying the id, for a form that submits it. */
    name?: string;
    disabled?: boolean;
    /** The media library, opened in a new tab so the draft isn't left. Both studios serve it. */
    libraryHref?: string | null;
  }

  const {
    value,
    onchange,
    mediaTypes,
    allowProcessing = false,
    ariaLabel,
    name,
    disabled = false,
    libraryHref = '/studio/media',
  }: Props = $props();

  const kind = $derived<MediaKind | 'any'>(mediaTypes.length === 1 ? (mediaTypes[0] ?? 'any') : 'any');

  // ── The field: what is chosen, read by id ─────────────────────────────
  const chosen = $derived(value ? getMediaItem(value) : null);
  const chosenGone = $derived(remoteErrorStatus(chosen?.error) === 404);
  $effect(() => {
    if (chosen?.error == null) return;
    // Gone (deleted, or not this creator's) is a warning with the id; an
    // outage an error. Either way the field says which.
    if (chosenGone) logReadFailure('media_picker.chosen_gone', chosen.error, { mediaId: value });
    else logReadFailure('media_picker.chosen_failed', chosen.error, { mediaId: value });
  });

  /** Re-read the chosen item. A failure shows through its `.error` and is logged above. */
  function rereadChosen() {
    chosen?.refresh().catch(() => undefined);
  }

  // A chosen item still on its way to ready or failed is watched on the
  // studio's status socket (data-design §1.5: the editor's media card
  // subscribes to its one id), so a transcode that fails later says so
  // here. The store bounds its own fallback (no open-ended polling).
  /** The chosen item's id while it is still on its way: a primitive, so a re-read that changes nothing re-subscribes nothing. */
  const watchedId = $derived.by(() => {
    const item = chosen?.current;
    return item && item.status !== 'ready' && item.status !== 'failed' ? item.id : null;
  });
  $effect(() => {
    const id = watchedId;
    if (!id) return;
    // UNTRACKED, as the library registers in onMount: register() reads the
    // store's own `connection`, and an effect tracking it would re-subscribe
    // on every pause or stop, and each re-subscribe restarts the bounded
    // fallback, which is open-ended polling (owner rule).
    return untrack(() =>
      mediaStatus.register({
        listed: () => new Map([[id, chosen?.current?.status ?? 'uploading']]),
        refresh: () => chosen?.refresh(),
        settled: (mediaId) => {
          if (mediaId === id) rereadChosen();
        },
      })
    );
  });
  /**
   * What the card says about its watch, in the library's words: nothing
   * while it is live or starting; how it falls back; that it paused (with
   * Refresh, which re-reads this item too) or ended. Never a reading that
   * has quietly stopped moving.
   */
  const WATCH_LABELS: Partial<Record<MediaStatusConnection, () => string>> = {
    reconnecting: () => m.media_live_reconnecting(),
    polling: () => m.media_live_polling(),
    paused: () => m.media_live_paused(),
    stopped: () => m.media_live_stopped(),
  };
  /** The last item watched here: one that reaches ready says so, in words. */
  let watchedHere = $state<string | null>(null);
  $effect(() => {
    if (watchedId) watchedHere = watchedId;
  });
  const watchWords = $derived(watchedId ? (WATCH_LABELS[mediaStatus.connection]?.() ?? '') : '');
  /**
   * An item watched here reached ready: said, by name, in the same region a
   * Refresh focused. Heard, not shown: the pill already shows it. A failure
   * says so in its own alert.
   */
  const readyWords = $derived.by(() => {
    const item = chosen?.current;
    return !watchedId && item?.status === 'ready' && item.id === watchedHere
      ? m.media_picker_ready_named({ name: item.title })
      : '';
  });
  const watchPaused = $derived(watchedId !== null && mediaStatus.connection === 'paused');
  let watchNote = $state<HTMLElement | null>(null);

  function resumeWatch() {
    // Refresh goes once the store leaves 'paused': focus moves first to the
    // status it changes (mounted for the card's life), never <body>
    // (WCAG 2.4.3), as the library's bar does.
    watchNote?.focus();
    mediaStatus.resume();
  }

  function focusTrigger() {
    document.getElementById(triggerId)?.focus();
  }

  /**
   * On each field control that can leave while focused: on a press (Remove,
   * Discard, Cancel, a Try again, Refresh), a re-read swapping card and
   * alert, a value set from outside, or an upload row moving on by itself.
   * Focus it held would fall to <body>; it goes to the field's own button.
   *
   * hadFocus clears only when focus went somewhere else, judged a microtask after
   * the blur: Chrome blurs a node just BEFORE removing it, still connected,
   * and a window or tab blur leaves activeElement where it was.
   */
  function handsFocusOn(node: HTMLElement) {
    let hadFocus = false;
    const focused = () => {
      hadFocus = true;
    };
    const blurred = () =>
      queueMicrotask(() => {
        if (node.isConnected && document.activeElement !== node) hadFocus = false;
      });
    node.addEventListener('focus', focused);
    node.addEventListener('blur', blurred);
    return () => {
      node.removeEventListener('focus', focused);
      node.removeEventListener('blur', blurred);
      // A microtask on, after Chrome's removal blur has been judged.
      queueMicrotask(() => {
        if (hadFocus && document.activeElement === document.body) focusTrigger();
      });
    };
  }

  // The stall rule reads the clock: one timer, for the moment the chosen
  // upload would stall, rather than a clock ticking all the while. The
  // clock lands on the line at least: a timer is not the wall clock.
  /** The longest delay setTimeout keeps (2^31 - 1 ms). */
  const MAX_TIMEOUT_MS = 2_147_483_647;
  let clock = $state(Date.now());
  $effect(() => {
    const item = chosen?.current;
    if (item?.status !== 'uploading' || !item.createdAt) return;
    const at = stallsAt(item.createdAt);
    const wait = at - Date.now();
    // Past setTimeout's limit a browser fires at once, which the clamp would
    // turn into a false "stopped": arm nothing; the next re-read checks again.
    if (!Number.isFinite(at) || wait >= MAX_TIMEOUT_MS) return;
    const timer = setTimeout(() => (clock = Math.max(Date.now(), at + 1)), Math.max(0, wait) + 1);
    return () => clearTimeout(timer);
  });

  // ── An upload started here ────────────────────────────────────────────
  // While this field is open, an upload it started is attached the moment
  // createMedia gives it an id, and undone if it is cancelled or fails. Once
  // the field unmounts, the content's own by-id read says if it went.
  let following = $state<Following | null>(null);
  const followedRow = $derived(
    following ? (uploadQueue.items.find((item) => item.key === following?.key) ?? null) : null
  );
  /** The row this field is showing: until it is done, the field shows it. */
  const uploading = $derived(followedRow && followedRow.status !== 'done' ? followedRow : null);

  $effect(() => {
    // Read the two fields HERE: the queue changes a row in place, so its
    // identity never changes as it uploads, and an effect keyed on the row
    // alone would never run again.
    const row = followedRow ? { id: followedRow.id, status: followedRow.status } : null;
    untrack(() => {
      if (!following) return;
      const wasDone = following.done;
      const step = followUpload(following, row, value);
      following = step.following;
      if ('report' in step) onchange(step.report ?? null);
      // Finished: the chosen item's status moved on from uploading.
      if (step.following?.done && !wasDone) rereadChosen();
    });
  });

  // ── The dialog ────────────────────────────────────────────────────────
  let open = $state(false);
  /** Focus goes back to the field's button on close (ui Dialog's `closeFocus`). */
  const triggerId = $props.id();
  let fileInput = $state<HTMLInputElement | null>(null);
  /** The row the creator has marked; Attach makes it the field's value. */
  let marked = $state<string | null>(null);
  let searchInput = $state('');
  let segment = $state<PickerSegment>('ready');
  let sort = $state<LibrarySort>('newest');
  /** Bumped on each open: a Show more from the last opening never lands in this one. */
  let opening = 0;
  /** Why the last file wasn't attached, said here: the modal covers the tray. */
  let uploadNote = $state<string | null>(null);

  function openDialog() {
    if (disabled) return;
    marked = value;
    uploadNote = null;
    // A list from the last opening may be another type's (the content type
    // changed), and its pages' boundaries may have moved since: start clean.
    held = null;
    extra = { key: '', pages: [] };
    moreFailedFor = null;
    opening += 1;
    open = true;
  }

  /** The typed search, once typing pauses: one list read per pause, not per key. */
  let searchTerm = $state('');
  $effect(() => {
    const next = searchInput;
    if (next === '') {
      searchTerm = '';
      return;
    }
    const timer = setTimeout(() => (searchTerm = next), 250);
    return () => clearTimeout(timer);
  });
  // The search floor (Codex-k618q) on the query argument, bounded first
  // (Codex-osuqt), as the library does it.
  const search = $derived(gateSearchQuery(boundSearchParam(searchTerm)));
  const facets = $derived({ mediaTypes, segment: allowProcessing ? segment : 'ready', sort } as const);
  const listKey = $derived(JSON.stringify(pickerListArgs(facets, search, 1)));
  /**
   * What a failed list read asked for: never the search text itself. The
   * facet is `listStatus`: `status` is the HTTP status logReadFailure adds.
   */
  function listContext(pageNumber: number) {
    const { status, mediaType, sortBy } = pickerListArgs(facets, search, pageNumber);
    return { listStatus: status, mediaType, sortBy, page: pageNumber, searched: search !== null };
  }
  const firstPage = $derived(open ? listMedia(pickerListArgs(facets, search, 1)) : null);

  type MediaPage = Awaited<ReturnType<typeof listMedia>>;
  /** The last list that arrived, kept (dimmed) while a changed search loads. */
  let held = $state.raw<MediaPage | null>(null);
  $effect(() => {
    const current = firstPage?.current;
    if (current) held = current;
  });

  /**
   * A list read failed: this view's first read, or a refetch (kit keeps
   * `current` and sets `error`). As the library guards it: a failed read
   * never falls back to an empty list, or to another query's rows.
   */
  const listFailed = $derived(firstPage?.error != null);
  /** This query's own answer has arrived: only it may say the list is empty. */
  const answered = $derived(firstPage?.current !== undefined);
  $effect(() => {
    if (firstPage?.error != null) logReadFailure('media_picker.list_failed', firstPage.error, listContext(1));
  });

  let extra = $state.raw<{ key: string; pages: MediaPage[] }>({ key: '', pages: [] });
  const extraPages = $derived(extra.key === listKey ? extra.pages : []);
  let moreLoading = $state(false);
  /** The list a Show more failed for: a new search starts clean. */
  let moreFailedFor = $state<string | null>(null);

  const shownFirst = $derived(firstPage?.current ?? held);
  const items = $derived.by(() => {
    const seen = new Set<string>();
    // Pages of this query only: while it loads, the held list shows alone.
    return [shownFirst, ...(answered ? extraPages : [])]
      .flatMap((pageOfItems) => pageOfItems?.items ?? [])
      .filter((item) => !seen.has(item.id) && seen.add(item.id));
  });
  const total = $derived(shownFirst?.pagination.total ?? 0);

  async function showMore() {
    const key = listKey;
    const mine = opening;
    const pages = extraPages;
    const current = () => mine === opening && key === listKey;
    // What this read asks for, as asked: the facets may change while it waits.
    const args = pickerListArgs(facets, search, pages.length + 2);
    const context = listContext(pages.length + 2);
    moreLoading = true;
    moreFailedFor = null;
    try {
      const next = await listMedia(args);
      if (current()) extra = { key, pages: [...pages, next] };
    } catch (error) {
      logReadFailure('media_picker.show_more_failed', error, context);
      if (current()) moreFailedFor = key;
    } finally {
      moreLoading = false;
    }
  }

  let retrying = $state(false);
  /** Ask again. A second failure shows through `.error`, and the effect above logs it. */
  async function retryList() {
    if (retrying || !firstPage) return;
    retrying = true;
    await firstPage.refresh().catch(() => undefined);
    retrying = false;
  }

  /** The marked row, from the list, or the chosen item when it is the one marked. */
  const markedItem = $derived(
    items.find((item) => item.id === marked) ??
      (marked !== null && marked === value ? (chosen?.current ?? null) : null)
  );

  function attach(event?: SubmitEvent) {
    event?.preventDefault();
    if (marked !== null && marked !== value) {
      following = null;
      onchange(marked);
    }
    open = false;
  }

  function remove() {
    following = null;
    onchange(null);
  }

  function startUpload(event: Event & { currentTarget: HTMLInputElement }) {
    const files = event.currentTarget.files;
    const file = files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const [key] = uploadQueue.add([file]);
    const row = key ? uploadQueue.items.find((item) => item.key === key) : undefined;
    if (!row) {
      // Refused (too big, empty, a type the platform can't take): say why here.
      const refusal = uploadQueue.rejections.at(-1);
      uploadNote = refusal ? rejectionReason(refusal.name, refusal.reason) : null;
      return;
    }
    if (!mediaTypes.includes(row.mediaType)) {
      // It still goes up to the library; it can't go here.
      uploadNote = m.media_picker_upload_wrong_type();
      return;
    }
    following = { key: row.key, id: null, before: value, done: false };
    open = false;
  }

  const TITLE = { video: m.media_picker_title_video, audio: m.media_picker_title_audio, any: m.media_picker_title_any };
  const LEAD = { video: m.media_picker_lead_video, audio: m.media_picker_lead_audio, any: m.media_picker_lead_any };
  const UPLOAD = { video: m.media_picker_upload_video, audio: m.media_picker_upload_audio, any: m.media_picker_upload_any };
  const SEGMENTS: readonly { value: PickerSegment; label: () => string }[] = [
    { value: 'ready', label: () => m.media_status_ready() },
    { value: 'processing', label: () => m.media_status_processing() },
    { value: 'all', label: () => m.media_picker_segment_all() },
  ];

  function useLine(usage: { total: number } | undefined): string | null {
    if (!usage) return null;
    return usage.total > 0 ? m.media_chip_in_use({ count: usage.total }) : m.media_chip_not_in_use();
  }

  /** One line of facts. One expression in the markup: a block trims its leading space. */
  function factLine(...parts: (string | null | undefined | false)[]): string {
    return parts.filter(Boolean).join(' · ');
  }
</script>

{#snippet thumb(item: { mediaType: string; thumbnailUrl?: string | null; durationSeconds?: number | null }, size: string)}
  <span class="thumb" aria-hidden="true">
    {#if item.thumbnailUrl}
      <img
        src={item.thumbnailUrl}
        srcset={getThumbnailSrcset(item.thumbnailUrl) || undefined}
        sizes={size}
        alt=""
        loading="lazy"
      />
    {:else if item.mediaType === 'video'}
      <FilmIcon size={18} />
    {:else}
      <MusicIcon size={18} />
    {/if}
    {#if item.durationSeconds}
      <span class="thumb-duration">{formatDuration(item.durationSeconds)}</span>
    {/if}
  </span>
{/snippet}

{#snippet uploadField(row: UploadItem)}
  {#if row.status === 'error'}
    <!-- Failed: the field went back to what it held (shown below); this says
         why, and offers the way on, named for the upload as the tray does. -->
    <div class="field-card field-card--failed" role="alert">
      <span class="thumb thumb--empty" aria-hidden="true"><UnlinkIcon size={18} /></span>
      <span class="field-text">
        <span class="field-title">{row.title}</span>
        <span class="field-meta">
          {row.failure === 'direct' ? m.media_upload_error_direct() : m.media_upload_error()}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={m.media_upload_try_again_named({ name: row.title })}
        onclick={() => uploadQueue.retry(row.key)}
        {@attach handsFocusOn}
      >
        {m.common_try_again()}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={m.media_picker_upload_discard_named({ name: row.title })}
        onclick={() => uploadQueue.remove(row.key)}
        {@attach handsFocusOn}
      >
        {m.media_picker_upload_discard()}
      </Button>
    </div>
  {:else}
    <div class="field-card">
      <span class="thumb thumb--empty" aria-hidden="true"><UploadIcon size={18} /></span>
      <span class="field-text">
        <span class="field-title">{row.title}</span>
        <span class="field-meta" role="status">
          {row.status === 'queued' ? m.media_picker_upload_waiting() : m.media_picker_uploading({ pct: row.progress })}
        </span>
      </span>
      {#if row.status === 'queued' || row.status === 'uploading'}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={m.media_tray_cancel_named({ name: row.title })}
          onclick={() => uploadQueue.cancel(row.key)}
          {@attach handsFocusOn}
        >
          {m.media_tray_cancel()}
        </Button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet chosenField()}
  {#if chosen?.error != null}
    <div class="field-card field-card--failed" role="alert">
      <span class="thumb thumb--empty" aria-hidden="true"><UnlinkIcon size={18} /></span>
      <span class="field-text">
        <span class="field-title">
          {chosenGone ? m.media_picker_chosen_gone() : m.media_picker_chosen_failed()}
        </span>
      </span>
      {#if !chosenGone}
        <Button type="button" size="sm" variant="ghost" onclick={rereadChosen} {@attach handsFocusOn}
          >{m.common_try_again()}</Button
        >
      {/if}
    </div>
  {:else if chosen?.current}
    {@const item = chosen.current}
    <!-- The library's own rules: a failed or stopped item never reads as processing. -->
    {@const view = chosenView(item, mediaStatus.items.get(item.id), clock)}
    {@const reason = tileReason(view)}
    <div class="field-card" data-status={tilePill(view)}>
      {@render thumb(item, '6rem')}
      <span class="field-text">
        <span class="field-title">{item.title}</span>
        <span class="field-meta">
          <MediaStatusPill pill={tilePill(view)} />
          {factLine(item.durationSeconds && formatDuration(item.durationSeconds), useLine(item.usage))}
        </span>
        {#if reason && (view.kind === 'failed' || view.kind === 'stopped')}
          <span class="field-reason" role="alert">{reason}</span>
        {/if}
        <!-- Mounted for the card's life, so a change of words is announced
             and a focused status outlives its item settling; the Refresh
             is beside it, never inside it. -->
        <span class="field-watch">
          <span class="field-live" role="status" tabindex="-1" bind:this={watchNote} {@attach handsFocusOn}
            >{watchWords}<span class="sr-only">{readyWords}</span></span
          >
          {#if watchPaused}
            <Button type="button" size="xs" variant="ghost" onclick={resumeWatch} {@attach handsFocusOn}>
              {m.media_live_resume()}
            </Button>
          {/if}
        </span>
      </span>
    </div>
  {:else if chosen}
    <Skeleton height="var(--space-16)" aria-hidden="true" />
  {/if}
{/snippet}

{#snippet tools()}
  <div class="picker-tools">
    <label class="picker-search">
      <SearchIcon size={16} />
      <span class="sr-only">{m.media_picker_search()}</span>
      <input
        type="search"
        bind:value={searchInput}
        maxlength={SEARCH_MAX_QUERY_LENGTH}
        placeholder={m.media_picker_search()}
      />
    </label>
    {#if allowProcessing}
      <div class="picker-segment" role="radiogroup" aria-label={m.media_col_status()}>
        {#each SEGMENTS as option (option.value)}
          <button type="button" role="radio" aria-checked={segment === option.value} onclick={() => (segment = option.value)}>
            {option.label()}
          </button>
        {/each}
      </div>
    {/if}
    <label class="picker-sort">
      <span class="sr-only">{m.media_sort_label()}</span>
      <select bind:value={sort}>
        {#each SORT_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label()}</option>
        {/each}
      </select>
    </label>
  </div>
{/snippet}

{#snippet uploadRow()}
  <button type="button" class="picker-upload" onclick={() => fileInput?.click()}>
    <span class="thumb thumb--empty" aria-hidden="true"><UploadIcon size={18} /></span>
    <span class="field-text">
      <span class="field-title">{UPLOAD[kind]()}</span>
      <span class="field-meta">{m.media_picker_upload_hint()}</span>
    </span>
  </button>
  <input
    bind:this={fileInput}
    type="file"
    class="sr-only"
    tabindex="-1"
    accept={mediaFileAccept(mediaTypes)}
    onchange={startUpload}
  />
  {#if uploadNote}
    <p class="picker-note" role="alert">{uploadNote}</p>
  {/if}
{/snippet}

{#snippet rows()}
  {#if listFailed}
    <div class="picker-note picker-note--stale" role="alert">
      <span>{m.media_picker_list_stale()}</span>
      <Button type="button" size="sm" variant="ghost" disabled={retrying} onclick={retryList}>{m.common_try_again()}</Button>
    </div>
  {/if}
  <div class="picker-rows" role="radiogroup" aria-label={TITLE[kind]()} data-refreshing={!answered || undefined}>
    {#each items as item (item.id)}
      <label class="picker-row" data-marked={marked === item.id || undefined}>
        <input type="radio" class="sr-only" name="media-picker-choice" value={item.id} bind:group={marked} />
        {@render thumb(item, '6rem')}
        <span class="field-text">
          <span class="field-title">{item.title}</span>
          <span class="field-meta">
            {factLine(item.status !== 'ready' && m.media_status_processing(), useLine(item.usage))}
          </span>
        </span>
        <span class="picker-date">{item.createdAt ? formatDate(item.createdAt) : ''}</span>
      </label>
    {/each}
  </div>
  <!-- Only this query's own pages: never page 2 of a new search under page 1 of the last. -->
  {#if answered && items.length < total}
    <Button type="button" size="sm" variant="ghost" disabled={moreLoading} onclick={showMore}>
      {m.media_library_show_more({ left: total - items.length, total })}
    </Button>
  {/if}
  {#if moreFailedFor === listKey}
    <p class="picker-note" role="alert">{m.media_picker_more_failed()}</p>
  {/if}
{/snippet}

{#snippet listBody()}
  {#if listFailed && (!answered || items.length === 0)}
    <div class="picker-state" role="alert">
      <p>{m.media_picker_list_failed()}</p>
      <Button type="button" size="sm" variant="secondary" disabled={retrying} onclick={retryList}>
        {m.common_try_again()}
      </Button>
    </div>
  {:else if items.length > 0}
    {@render rows()}
  {:else if !answered}
    {#each { length: 4 }, index (index)}
      <Skeleton height="var(--space-14)" aria-hidden="true" />
    {/each}
  {:else}
    <div class="picker-state" role="status">
      <p>{search ? m.media_picker_no_results() : m.media_picker_empty_title()}</p>
      {#if search}
        <Button type="button" size="sm" variant="ghost" onclick={() => (searchInput = '')}>
          {m.media_picker_clear_search()}
        </Button>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="picker">
  {#if name}<input type="hidden" {name} value={value ?? ''} />{/if}
  {#if uploading}{@render uploadField(uploading)}{/if}
  <!-- In flight, the upload is the field; once it failed, what the field
       kept shows under it, so Remove below acts on something visible. -->
  {#if value !== null && (!uploading || uploading.status === 'error')}
    {@render chosenField()}
  {/if}
  <div class="picker-actions">
    <Button
      id={triggerId}
      type="button"
      size="sm"
      variant="secondary"
      aria-label={value === null ? ariaLabel : m.media_picker_change_named({ name: ariaLabel })}
      {disabled}
      onclick={openDialog}
    >
      {value === null ? TITLE[kind]() : m.media_picker_change()}
    </Button>
    <!-- Not while an upload is in flight: its own Cancel is what stops it. -->
    {#if value !== null && (!uploading || uploading.status === 'error')}
      <Button type="button" size="sm" variant="ghost" {disabled} onclick={remove} {@attach handsFocusOn}
        >{m.media_picker_clear()}</Button
      >
    {/if}
  </div>
</div>

<Dialog.Root bind:open closeFocus={() => document.getElementById(triggerId)}>
  <Dialog.Content size="md" class="media-picker">
    <form class="picker-form" onsubmit={attach}>
      <Dialog.Header>
        <Dialog.Title>{TITLE[kind]()}</Dialog.Title>
        <Dialog.Description>
          {allowProcessing ? LEAD[kind]() : `${LEAD[kind]()} ${m.media_picker_lead_ready()}`}
        </Dialog.Description>
      </Dialog.Header>
      {@render tools()}
      <Dialog.Body class="picker-list" aria-busy={!answered && !listFailed}>
        {#if allowProcessing}{@render uploadRow()}{/if}
        {@render listBody()}
      </Dialog.Body>
      <Dialog.Footer>
        <p class="picker-selected" aria-live="polite">
          {#if markedItem}
            {factLine(
              m.media_picker_selected({ title: markedItem.title }),
              markedItem.durationSeconds && formatDuration(markedItem.durationSeconds),
              markedItem.usage && markedItem.usage.total > 0 && m.media_chip_in_use({ count: markedItem.usage.total })
            )}
          {/if}
        </p>
        {#if libraryHref}
          <a class="picker-library" href={libraryHref} target="_blank" rel="noopener">
            {m.media_picker_open_library()}<span class="sr-only"> {m.media_use_new_tab()}</span>
          </a>
        {/if}
        <Button type="button" variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
        <Button type="submit" disabled={marked === null}>{m.media_picker_attach()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .picker-actions {
    display: flex;
    gap: var(--space-2);
  }

  .field-card,
  .picker-upload,
  .picker-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .field-card--failed {
    border-color: var(--color-status-error-border);
  }

  .field-reason {
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .field-watch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* Never display:none while empty: a hidden region is dropped from the
     accessibility tree, and its next words would go unannounced. */
  .field-live {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .field-live:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .picker-note--stale {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* The last list, while this one loads: dimmed, never claimed as current. */
  .picker-rows[data-refreshing] {
    opacity: 0.6;
  }

  .thumb {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--space-24);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-duration {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    color: var(--color-text);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .field-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    text-align: left;
  }

  .field-title {
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field-meta,
  .picker-date,
  .picker-note,
  .picker-selected {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* The panel is a capped flex column: the form carries it on, so the
     list (Dialog.Body) is what scrolls, with the tools and footer pinned. */
  .picker-form {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  .picker-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-6) var(--space-2);
  }

  .picker-search {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-2);
    min-width: 12rem;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
  }

  .picker-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--color-text);
    font: inherit;
  }

  .picker-search:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .picker-search input:focus {
    outline: none;
  }

  .picker-segment {
    display: inline-flex;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .picker-segment button {
    padding: var(--space-1) var(--space-3);
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .picker-segment button[aria-checked='true'] {
    background: var(--color-interactive-subtle);
    color: var(--color-link);
    font-weight: var(--font-semibold);
  }

  .picker-segment button:focus-visible,
  .picker-upload:focus-visible,
  .picker-library:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .picker-sort select {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  /* A flick past the list's end stays in the list (ui Dialog.Body scrolls). */
  :global(.media-picker .picker-list) {
    gap: var(--space-2);
    overscroll-behavior: contain;
  }

  .picker-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .picker-upload {
    border-style: dashed;
    font: inherit;
    cursor: pointer;
  }

  .picker-row {
    cursor: pointer;
  }

  .picker-row:hover,
  .picker-upload:hover {
    background: var(--color-surface-secondary);
  }

  .picker-row[data-marked] {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .picker-row:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .picker-date {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .picker-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-secondary);
  }

  .picker-state p {
    margin: 0;
  }

  .picker-selected {
    flex: 1;
    min-width: 0;
  }

  .picker-library {
    font-size: var(--text-sm);
    color: var(--color-link);
  }

  @media (max-width: 39.9375rem) {
    .picker-date {
      display: none;
    }
  }
</style>
