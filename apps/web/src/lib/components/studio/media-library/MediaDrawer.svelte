<!--
  @component MediaDrawer

  One media item, in a side drawer over the library (Codex-a6ofh.1.7, mockup
  M3; a bottom sheet on a phone, M7b): watch it, see where it is used, and act
  on it. Opened from `?item=<id>`, so a link or Back reproduces it.

  Reads (data-design §1.2): on every open, the item (GET /api/media/:id) and
  where it is used (GET /:id/usage), in parallel and never cached; no
  prefetch, no timers. Title and description are edited in place and saved
  on blur (PATCH, the two fields it takes). The preview is minted on Play.
-->
<script lang="ts">
  import type { MediaUsage } from '@codex/shared-types';
  import { untrack } from 'svelte';
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { RefreshCwIcon, TrashIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getMediaItem, getMediaUsage, updateMedia } from '$lib/remote/media.remote';
  import { readFreshQuery, remoteErrorStatus } from '$lib/remote/query-result';
  import type { MediaItemWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import {
    type FieldSave,
    planSave,
    refusalFor,
    type SaveField,
    type SaveRefusal,
    saveStatusText,
  } from './drawer-save';
  import { newContentHref } from './library-url';
  import { mediaFacts } from './media-facts';
  import MediaPreviewPlayer from './MediaPreviewPlayer.svelte';
  import { logReadFailure } from './log-read-failure';
  import { retryMediaTranscoding } from './media-retry';
  import MediaStatusPill from './MediaStatusPill.svelte';
  import MediaUsesList from './MediaUsesList.svelte';
  import { tileReason } from './tile-copy';
  import { describeTile, tilePill } from './tile-state';

  interface Props {
    /** The open item, from `?item=`; null when the drawer is closed. */
    mediaId: string | null;
    /** The list row's poster: the single read does not resolve it. */
    poster?: string | null;
    onClose: () => void;
    onDelete: (media: MediaItemWithRelations) => void;
    /** A save landed: the library refetches its rows. */
    onChanged: () => void;
  }

  const { mediaId, poster = null, onClose, onDelete, onChanged }: Props = $props();

  type Loaded = { id: string; media: MediaItemWithRelations };
  let loaded = $state<Loaded | null>(null);
  let failed = $state<{ id: string; status: number | undefined } | null>(null);
  let usage = $state<{ id: string; value: MediaUsage | null; failed: boolean } | null>(null);

  async function load(id: string) {
    loaded = null;
    failed = null;
    usage = null;
    // A status belongs to the item it was about, never the next one opened.
    saves = { title: 'idle', description: 'idle' };
    saveRefusal = null;
    const [item, uses] = await Promise.allSettled([
      readFreshQuery(getMediaItem(id)),
      readFreshQuery(getMediaUsage(id)),
    ]);
    // The creator opened another item, or closed it, meanwhile.
    if (mediaId !== id) return;
    if (item.status === 'rejected') {
      failed = { id, status: remoteErrorStatus(item.reason) };
      logReadFailure('media_drawer.read_failed', item.reason, { mediaId: id });
      return;
    }
    loaded = { id, media: item.value };
    titleDraft = item.value.title;
    descriptionDraft = item.value.description ?? '';
    usage = { id, value: uses.status === 'fulfilled' ? uses.value : null, failed: uses.status === 'rejected' };
    if (uses.status === 'rejected') logReadFailure('media_drawer.usage_failed', uses.reason, { mediaId: id });
  }

  async function reloadUsage(id: string) {
    usage = null;
    try {
      const value = await readFreshQuery(getMediaUsage(id));
      if (mediaId === id) usage = { id, value, failed: false };
    } catch (error) {
      logReadFailure('media_drawer.usage_failed', error, { mediaId: id });
      if (mediaId === id) usage = { id, value: null, failed: true };
    }
  }

  // Every open reads again: the drawer never trusts what it read last time.
  // Leaving an item (Close, Back, another item) first saves what the
  // creator typed and has not blurred yet, against the item it was about.
  $effect(() => {
    const id = mediaId;
    untrack(() => {
      const leaving = loaded;
      if (leaving && leaving.id !== id) {
        void save('title', leaving, titleDraft);
        void save('description', leaving, descriptionDraft);
      }
      if (id) void load(id);
    });
  });

  // ── Live state, as the tile reads it ──────────────────────────────────
  const media = $derived(loaded && loaded.id === mediaId ? loaded.media : null);
  const live = $derived(media ? mediaStatus.items.get(media.id) : undefined);
  const view = $derived(
    media ? describeTile(media, live, live?.retryAt != null ? mediaStatus.now : 0) : null
  );
  const playable = $derived(view?.kind === 'ready');

  // ── Edit in place ─────────────────────────────────────────────────────
  let titleDraft = $state('');
  let descriptionDraft = $state('');
  /** Each field's own: one field's success never hides the other's failure. */
  let saves = $state<Record<SaveField, FieldSave>>({ title: 'idle', description: 'idle' });
  let saveRefusal = $state<SaveRefusal>(null);
  /** The value each field is saving now, so leaving never sends it twice. */
  const inFlight: Record<SaveField, string | null> = { title: null, description: null };

  /**
   * Save one field of `snapshot` (the item it was typed into), when `draft`
   * changed it. A save that lands after the drawer moved on still reports a
   * failure, as a toast naming the item.
   */
  async function save(
    field: SaveField,
    snapshot: Loaded | null = loaded,
    draft: string = field === 'title' ? titleDraft : descriptionDraft
  ) {
    if (!snapshot) return;
    const plan = planSave(field, snapshot.media, draft, inFlight[field]);
    const shown = () => mediaId === snapshot.id;
    if (plan.kind === 'skip') return;
    if (plan.kind === 'title-required') {
      // Blurring an emptied title puts the saved one back, and says why.
      if (shown()) {
        titleDraft = snapshot.media.title;
        saveRefusal = 'title-required';
      }
      return;
    }
    inFlight[field] = plan.value;
    if (shown()) {
      saves[field] = 'saving';
      saveRefusal = null;
    }
    try {
      await updateMedia({ id: snapshot.id, data: plan.patch });
      // Into what is shown NOW: the other field's save may have landed meanwhile.
      if (loaded?.id === snapshot.id) loaded = { id: snapshot.id, media: { ...loaded.media, ...plan.patch } };
      if (shown()) saves[field] = 'saved';
      onChanged();
    } catch (error) {
      logReadFailure('media_drawer.save_failed', error, { mediaId: snapshot.id });
      if (!shown()) {
        toast.error(m.media_drawer_save_failed_named({ title: snapshot.media.title }));
        return;
      }
      // The draft stays in the box, so a second blur tries again.
      saves[field] = 'failed';
      saveRefusal = refusalFor(remoteErrorStatus(error));
    } finally {
      inFlight[field] = null;
    }
  }

  const saveStatus = $derived(saveStatusText(saves, saveRefusal));

  const facts = $derived(media ? mediaFacts(media) : []);

  /** Why the item read failed, in words the creator can act on. */
  const failedCopy = $derived.by(() => {
    const status = failed?.status;
    if (status === 404) return { text: m.media_drawer_gone(), retry: false };
    if (status === 401) return { text: m.media_drawer_signed_out(), retry: false };
    if (status === 429) return { text: m.media_drawer_busy(), retry: true };
    return { text: m.media_library_error_body(), retry: true };
  });

  const usedIn = $derived.by(() => {
    const value = usage && usage.id === mediaId ? usage.value : null;
    if (!value) return null;
    if (value.total === 0) return m.media_drawer_unused();
    return value.total === 1 ? m.media_drawer_used_one() : m.media_drawer_used({ count: value.total });
  });

  let retrying = $state(false);
  async function tryAgain() {
    if (!media || retrying) return;
    retrying = true;
    try {
      await retryMediaTranscoding(media.id);
    } finally {
      retrying = false;
    }
  }
</script>

{#snippet editor()}
  <div class="drawer-edit">
    <label class="drawer-label" for="media-drawer-title">{m.media_edit_title_label()}</label>
    <input
      id="media-drawer-title"
      class="drawer-title"
      maxlength="255"
      bind:value={titleDraft}
      onblur={() => save('title')}
    />
    <label class="drawer-label" for="media-drawer-description">{m.media_edit_description_label()}</label>
    <textarea
      id="media-drawer-description"
      class="drawer-description"
      rows="3"
      maxlength="5000"
      placeholder={m.media_edit_description_placeholder()}
      bind:value={descriptionDraft}
      onblur={() => save('description')}
    ></textarea>
    <p class="drawer-save" role="status" data-failed={saveStatus?.failed || undefined}>{saveStatus?.text ?? ''}</p>
  </div>
{/snippet}

{#snippet usedInSection(id: string)}
  <section class="drawer-uses" aria-labelledby="media-drawer-uses">
    <h3 id="media-drawer-uses" class="drawer-heading">{usedIn ?? m.media_drawer_uses_heading()}</h3>
    {#if usage === null}
      <Skeleton width="100%" height="3rem" />
    {:else if usage.failed}
      <div class="drawer-note">
        <p>{m.media_drawer_usage_failed()}</p>
        <Button size="sm" variant="ghost" onclick={() => reloadUsage(id)}>{m.media_library_retry()}</Button>
      </div>
    {:else if usage.value && usage.value.total > 0}
      <MediaUsesList usage={usage.value} />
    {/if}
  </section>
{/snippet}

<!--
  Close only a drawer that is open. Melt reports every `set` of its open store
  as a change, even false to false, so the Dialog's mount-time sync fires
  onOpenChange(false) on a closed drawer. Passed on, that wrote the URL, the
  navigation re-ran the sync, and the page spun (9.8 GB in Chrome).
-->
<Dialog.Root open={mediaId !== null} onOpenChange={(open) => !open && mediaId !== null && onClose()}>
  <Dialog.Content class="media-drawer">
    {#if failed && failed.id === mediaId}
      <Dialog.Header>
        <Dialog.Title>{m.media_drawer_failed_title()}</Dialog.Title>
      </Dialog.Header>
      <p class="drawer-note">{failedCopy.text}</p>
      {#if failedCopy.retry}
        <Button variant="secondary" onclick={() => mediaId && load(mediaId)}>{m.media_library_retry()}</Button>
      {/if}
    {:else if !media || !view}
      <div class="drawer-loading" aria-busy="true">
        <Dialog.Title class="sr-only">{m.media_drawer_loading()}</Dialog.Title>
        <Skeleton width="100%" height="12rem" />
        <Skeleton width="70%" height="var(--text-xl)" />
        <Skeleton width="100%" height="4rem" />
      </div>
    {:else}
      <Dialog.Header>
        <!-- The title is the editable box; the dialog's name is the item's. -->
        <Dialog.Title class="sr-only">{media.title}</Dialog.Title>
        <div class="drawer-status">
          <MediaStatusPill pill={tilePill(view)} />
          {#if tileReason(view)}<span class="drawer-reason">{tileReason(view)}</span>{/if}
        </div>
      </Dialog.Header>

      {#if playable}
        {#key media.id}
          <MediaPreviewPlayer
            mediaId={media.id}
            mediaType={media.mediaType === 'audio' ? 'audio' : 'video'}
            title={media.title}
            {poster}
          />
        {/key}
      {:else if view.kind === 'failed' && view.canRetry}
        <Button variant="secondary" loading={retrying} disabled={retrying} onclick={tryAgain}>
          <RefreshCwIcon size={14} />
          {m.media_tile_try_again()}
        </Button>
      {/if}

      {@render editor()}

      {#if facts.length > 0}
        <dl class="drawer-facts">
          {#each facts as fact (fact.label)}
            <div class="fact"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
          {/each}
        </dl>
      {/if}

      {@render usedInSection(media.id)}

      <div class="drawer-actions">
        <a
          class="drawer-create"
          href={newContentHref({ id: media.id, mediaType: media.mediaType === 'audio' ? 'audio' : 'video' })}
        >
          {m.media_tray_create_content()}
        </a>
        <Button variant="destructive" onclick={() => onDelete(media)}>
          <TrashIcon size={14} />
          {m.media_action_delete()}
        </Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /* The Dialog primitive renders the panel: reached through its class. */
  :global(.dialog-content.media-drawer) {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    width: 100%;
    max-width: 32rem;
    height: 100%;
    max-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
    overflow-y: auto;
    border-radius: 0;
    border: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
  }

  /* Phone (M7b): a bottom sheet. */
  @media (--below-sm) {
    :global(.dialog-content.media-drawer) {
      top: auto;
      max-width: none;
      height: auto;
      max-height: 90vh;
      padding: var(--space-5) var(--space-4);
      border-left: none;
      border-top: var(--border-width) var(--border-style) var(--color-border);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
  }

  .drawer-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .drawer-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .drawer-reason {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .drawer-edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .drawer-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .drawer-title,
  .drawer-description {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }

  .drawer-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .drawer-description {
    resize: vertical;
    font-size: var(--text-sm);
  }

  .drawer-title:focus-visible,
  .drawer-description:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .drawer-save {
    min-height: var(--text-xs);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .drawer-save[data-failed] {
    color: var(--color-status-error-text);
  }

  .drawer-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .fact dt {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .fact dd {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }

  .drawer-uses {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .drawer-heading {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .drawer-note {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .drawer-note p {
    flex: 1;
    margin: 0;
  }

  .drawer-create {
    display: inline-flex;
    align-items: center;
    height: var(--space-10);
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .drawer-create:hover {
    background: var(--color-interactive-hover);
  }

  .drawer-create:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: auto;
  }

  @media (--below-sm) {
    .drawer-facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
