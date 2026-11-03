<!--
  @component MediaTable

  The media library's list view (Codex-a6ofh.1.6, mockup M2): one row per
  item with its status, uses, duration, size and date. Each row reads its
  item's live state from the studio's status socket, as a tile does, so the
  two views always name the same state. Bulk selection is E1.7's.
-->
<script lang="ts">
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { FilmIcon, MusicIcon } from '$lib/components/ui/Icon';
  import * as Table from '$lib/components/ui/Table';
  import type { MediaItemWithRelations } from '$lib/types';
  import { formatDate, formatDuration, formatFileSize } from '$lib/utils/format';
  import { getThumbnailSrcset } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import MediaActionsMenu from './MediaActionsMenu.svelte';
  import type { UploadGhost } from './MediaTileGrid.svelte';
  import MediaStatusPill from './MediaStatusPill.svelte';
  import MediaUseChip from './MediaUseChip.svelte';
  import { retryMediaTranscoding } from './media-retry';
  import { tileReason } from './tile-copy';
  import { describeTile, tilePill } from './tile-state';

  type MediaRow = MediaItemWithRelations;

  interface Props {
    items: MediaRow[];
    ghosts?: UploadGhost[];
    /** Bulk selection (M2): with these, each row and the header get a checkbox. */
    selected?: ReadonlySet<string>;
    onToggle?: (id: string) => void;
    onToggleAll?: (on: boolean) => void;
    onCancelUpload?: (key: string) => void;
    onOpen?: (id: string) => void;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  const {
    items,
    ghosts = [],
    selected,
    onToggle,
    onToggleAll,
    onCancelUpload,
    onOpen,
    onEdit,
    onDelete,
  }: Props = $props();

  const selectable = $derived(selected !== undefined && onToggle !== undefined);
  const allOn = $derived(selectable && items.length > 0 && items.every((i) => selected?.has(i.id)));
  const someOn = $derived(selectable && !allOn && items.some((i) => selected?.has(i.id)));

  const activeGhosts = $derived(ghosts.filter((g) => g.status !== 'done'));

  /** Only a row counting down reads the clock, so only it re-renders each second. */
  function viewFor(media: MediaRow) {
    const live = mediaStatus.items.get(media.id);
    return describeTile(media, live, live?.retryAt != null ? mediaStatus.now : 0);
  }

  /** One Try again at a time per row, as on the tile. */
  let retrying = $state(new Set<string>());

  async function tryAgain(id: string) {
    if (retrying.has(id)) return;
    retrying = new Set(retrying).add(id);
    try {
      await retryMediaTranscoding(id);
    } finally {
      const next = new Set(retrying);
      next.delete(id);
      retrying = next;
    }
  }
</script>

{#snippet ghostRow(ghost: UploadGhost)}
  <Table.Row class="ghost-row">
    {#if selectable}<Table.Cell class="col-select"></Table.Cell>{/if}
    <Table.Cell class="col-media">
      <div class="row-media">
        <span class="row-thumb row-thumb--ghost" aria-hidden="true">
          {#if ghost.mediaType === 'video'}<FilmIcon size={18} />{:else}<MusicIcon size={18} />{/if}
        </span>
        <span class="row-title" title={ghost.name}>{ghost.name}</span>
      </div>
    </Table.Cell>
    <Table.Cell>
      <span class="ghost-progress">
        {ghost.status === 'error' ? m.media_status_failed() : m.media_status_uploading()}
        · {ghost.progress}%
      </span>
    </Table.Cell>
    <Table.Cell class="col-muted">—</Table.Cell>
    <Table.Cell class="col-num col-muted">—</Table.Cell>
    <Table.Cell class="col-num col-muted">—</Table.Cell>
    <Table.Cell class="col-muted">—</Table.Cell>
    <Table.Cell class="col-actions">
      {#if onCancelUpload && ghost.status === 'uploading'}
        <button
          type="button"
          class="row-cancel"
          aria-label={m.media_tray_cancel_named({ name: ghost.name })}
          onclick={() => onCancelUpload(ghost.key)}
        >
          {m.media_tray_cancel()}
        </button>
      {/if}
    </Table.Cell>
  </Table.Row>
{/snippet}

{#snippet mediaRow(media: MediaRow)}
  {@const view = viewFor(media)}
  {@const pill = tilePill(view)}
  {@const reason = tileReason(view)}
  {@const kind = media.mediaType === 'video' ? m.media_type_video() : m.media_type_audio()}
  <Table.Row data-status={pill} data-selected={selected?.has(media.id) || undefined}>
    {#if selectable}
      <Table.Cell class="col-select">
        <input
          type="checkbox"
          checked={selected?.has(media.id) ?? false}
          aria-label={m.media_select_row({ title: media.title })}
          onchange={() => onToggle?.(media.id)}
        />
      </Table.Cell>
    {/if}
    <Table.Cell class="col-media">
      <div class="row-media">
        <span class="row-thumb" aria-hidden="true">
          {#if media.thumbnailUrl}
            <!-- The thumb is var(--space-20): 5rem at every width. -->
            <img
              src={media.thumbnailUrl}
              srcset={getThumbnailSrcset(media.thumbnailUrl) || undefined}
              sizes="5rem"
              alt=""
              loading="lazy"
            />
          {:else if media.mediaType === 'video'}
            <FilmIcon size={18} />
          {:else}
            <MusicIcon size={18} />
          {/if}
        </span>
        <span class="row-text">
          {#if onOpen}
            <button type="button" class="row-title row-open" title={media.title} onclick={() => onOpen(media.id)}>
              {media.title}
            </button>
          {:else}
            <span class="row-title" title={media.title}>{media.title}</span>
          {/if}
          <!-- One expression: a block's leading space is trimmed ("Video· …"). -->
          <span class="row-kind" data-status={pill}>{reason ? `${kind} · ${reason}` : kind}</span>
        </span>
      </div>
    </Table.Cell>
    <Table.Cell><MediaStatusPill {pill} /></Table.Cell>
    <Table.Cell><MediaUseChip mediaId={media.id} usage={media.usage} /></Table.Cell>
    <Table.Cell class="col-num">{formatDuration(media.durationSeconds) || '—'}</Table.Cell>
    <Table.Cell class="col-num">{formatFileSize(media.fileSizeBytes) || '—'}</Table.Cell>
    <Table.Cell class="col-date">{media.createdAt ? formatDate(media.createdAt) : '—'}</Table.Cell>
    <Table.Cell class="col-actions">
      <MediaActionsMenu
        title={media.title}
        onRetry={view.kind === 'failed' && view.canRetry && !retrying.has(media.id)
          ? () => tryAgain(media.id)
          : undefined}
        onEdit={onEdit && (() => onEdit(media.id))}
        onDelete={onDelete && (() => onDelete(media.id))}
      />
    </Table.Cell>
  </Table.Row>
{/snippet}

<Table.Root class="media-table">
  <Table.Header>
    <Table.Row>
      {#if selectable}
        <Table.Head class="col-select">
          <input
            type="checkbox"
            checked={allOn}
            indeterminate={someOn}
            aria-label={m.media_select_all()}
            onchange={(event) => onToggleAll?.(event.currentTarget.checked)}
          />
        </Table.Head>
      {/if}
      <Table.Head class="col-media">{m.media_col_media()}</Table.Head>
      <Table.Head>{m.media_col_status()}</Table.Head>
      <Table.Head>{m.media_col_used()}</Table.Head>
      <Table.Head class="col-num">{m.media_col_duration()}</Table.Head>
      <Table.Head class="col-num">{m.media_col_size()}</Table.Head>
      <Table.Head>{m.media_col_added()}</Table.Head>
      <Table.Head class="col-actions"><span class="sr-only">{m.media_col_actions()}</span></Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each activeGhosts as ghost (ghost.key)}
      {@render ghostRow(ghost)}
    {/each}

    {#each items as media (media.id)}
      {@render mediaRow(media)}
    {/each}
  </Table.Body>
</Table.Root>

<style>
  /* The primitives render the elements: their classes are reached through
     this component's own wrapper class. */
  :global(.media-table) {
    width: 100%;
  }

  :global(.media-table .col-media) {
    width: 40%;
    min-width: 16rem;
  }

  :global(.media-table .col-num) {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :global(.media-table .col-date) {
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  :global(.media-table .col-muted) {
    color: var(--color-text-muted);
  }

  :global(.media-table .col-select) {
    width: var(--space-10);
  }

  :global(.media-table tr[data-selected]) {
    background: var(--color-interactive-subtle);
  }

  .row-open {
    max-width: 100%;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row-open:hover {
    color: var(--color-interactive);
  }

  .row-open:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  :global(.media-table .col-actions) {
    width: var(--space-10);
    text-align: right;
  }

  .row-media {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .row-thumb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--space-20);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
  }

  .row-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .row-thumb--ghost {
    background: color-mix(in srgb, var(--color-interactive-subtle) 60%, transparent);
    color: var(--color-interactive);
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .row-title {
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-kind {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* The reason takes the state's colour, as it does on the tile. */
  .row-kind[data-status='failed'] { color: var(--color-status-error-text); }
  .row-kind[data-status='waiting'] { color: var(--color-status-info-text); }
  .row-kind[data-status='stopped'] { color: var(--color-status-warning-text); }

  .ghost-progress {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .row-cancel {
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .row-cancel:hover {
    background: var(--color-surface-secondary);
  }

  .row-cancel:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
