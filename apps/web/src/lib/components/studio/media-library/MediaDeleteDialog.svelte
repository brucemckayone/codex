<!--
  @component MediaDeleteDialog

  The Studio's Delete Media dialog (Codex-6sbn1). It reads where the item is
  used as it opens, and draws one of the approved states (scratchpad
  mockups-owner-numbers/media-delete/):

  - checking (F1) and check failed (F2): Delete stays off, Try again;
  - blocked (page 2): something published uses it. Every use is listed with
    Replace, drafts too (owner round 2, decision 5); Delete stays off, with
    the reason beside it;
  - drafts (page 3): allowed, with a warning naming the drafts;
  - unused (page 4);
  - after a click that didn't delete: refused because something became
    published (R1) or the uses moved (R2), or the delete failed (F3).

  The drafts and unused states carry the one 30-day line (owner round 2,
  decision 3); blocked doesn't, as in the mockup, since nothing can be deleted
  there yet. Once a read has answered, the uses are read again each time the
  creator comes back to this tab (Replace opens a new one), and on Check now:
  never on a timer.

  `flow` (media-delete-flow.svelte.ts) decides; this words and draws.

  @prop flow              The dialog's state; open it with `flow.open(target)`
  @prop onConfirm         The Delete button (the page runs `flow.confirm()`)
  @prop focusAfterDelete  Where focus goes once the item has left the library
-->
<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import * as Dialog from '$lib/components/ui/Dialog';
  import {
    AlertTriangleIcon,
    ClockIcon,
    FilmIcon,
    InfoIcon,
    LockIcon,
    MusicIcon,
    RefreshCwIcon,
  } from '$lib/components/ui/Icon';
  import { formatDuration, formatFileSize } from '$lib/utils/format';
  import { getThumbnailUrl } from '$lib/utils/image';
  import * as m from '$paraglide/messages';
  import type { MediaDeleteFlow } from './media-delete-flow.svelte';
  import { liveUsesPhrase, splitUses } from './media-usage';
  import MediaUsesList from './MediaUsesList.svelte';
  import MediaUsesSkeleton from './MediaUsesSkeleton.svelte';

  interface Props {
    flow: MediaDeleteFlow;
    onConfirm: () => void;
    /**
     * Where focus goes when the item left the library: the button that opened
     * the dialog goes with its tile once the list refreshes.
     */
    focusAfterDelete?: () => HTMLElement | null;
  }

  const { flow, onConfirm, focusAfterDelete }: Props = $props();

  /** The disabled Delete is described by its reason (a screen reader's "dimmed, why"). */
  const uid = $props.id();
  const whyId = `${uid}-why`;

  const target = $derived(flow.target);
  const view = $derived(flow.view);
  const usage = $derived(flow.check.state === 'ready' ? flow.check.usage : null);
  const notice = $derived(flow.notice);

  // Wide for a list. Until the read lands, the library's count guesses, so
  // the dialog doesn't jump from narrow to wide as it fills.
  const wide = $derived(
    view === 'blocked' ||
      view === 'drafts' ||
      ((view === 'checking' || view === 'check-failed') && (target?.usage?.total ?? 0) > 0)
  );

  const isVideo = $derived(target?.mediaType === 'video');
  const cardMeta = $derived(
    target
      ? [
          isVideo ? m.media_type_video() : m.media_type_audio(),
          formatDuration(target.durationSeconds),
          formatFileSize(target.fileSizeBytes),
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
  );

  const blockedBody = $derived.by(() => {
    if (!usage) return '';
    const uses = liveUsesPhrase(usage);
    return splitUses(usage.uses).live.length === 1
      ? m.media_delete_blocked_body_one({ uses })
      : m.media_delete_blocked_body({ uses });
  });

  // Focus goes back to the button that opened the dialog, read as it opens.
  let returnFocus: HTMLElement | null = null;
  let focusFor: string | null = null;
  $effect.pre(() => {
    const id = flow.target?.id ?? null;
    if (id !== null && id !== focusFor) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    focusFor = id;
  });

  // Back from a Replace tab: check once, in any state a read has answered
  // (unused too), never while a read or the delete is under way.
  $effect(() => {
    if (!flow.target) return;
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        flow.check.state === 'ready' &&
        !flow.rechecking &&
        !flow.deleting
      ) {
        void flow.recheck();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  function handleOpenChange(open: boolean) {
    if (!open) flow.close();
  }

  /**
   * Back to the button that opened the dialog; after a delete, to the page's
   * choice, because that button leaves with its tile when the list refreshes.
   */
  function closeFocus(): HTMLElement | null {
    if (flow.removed) return focusAfterDelete?.() ?? null;
    return returnFocus?.isConnected ? returnFocus : null;
  }
</script>

<Dialog.Root
  open={target !== null}
  onOpenChange={handleOpenChange}
  dismissible={!flow.deleting}
  {closeFocus}
>
  <Dialog.Content size={wide ? 'md' : 'sm'}>
    <Dialog.Header>
      <Dialog.Title>{m.media_delete_title()}</Dialog.Title>
    </Dialog.Header>
    <Dialog.Body>
      {#if target}
        <div class="md-body">
          <div class="md-media">
            <span class="md-media__thumb">
              {#if target.thumbnailUrl}
                <img
                  src={getThumbnailUrl(target.thumbnailUrl, 'sm')}
                  alt=""
                  class="md-media__img"
                />
              {:else if isVideo}
                <FilmIcon size={18} />
              {:else}
                <MusicIcon size={18} />
              {/if}
            </span>
            <span class="md-media__text">
              <span class="md-media__title">{target.title}</span>
              <span class="md-media__meta">{cardMeta}</span>
            </span>
          </div>

          {#if notice && notice.kind !== 'failed'}
            <Alert variant={notice.kind === 'now-live' ? 'error' : 'info'}>
              <p class="md-alert">
                {#if notice.kind === 'now-live'}
                  <AlertTriangleIcon size={16} />
                {:else}
                  <InfoIcon size={16} />
                {/if}
                <span>
                  <b>{m.media_delete_refused_title()}</b>
                  {#if notice.kind === 'now-live'}
                    {notice.title
                      ? m.media_delete_refused_live_named({ title: notice.title })
                      : m.media_delete_refused_live()}
                  {:else if notice.kind === 'new-draft'}
                    {m.media_delete_refused_draft()}
                  {:else}
                    {m.media_delete_refused_changed()}
                  {/if}
                </span>
              </p>
            </Alert>
          {/if}

          {#if view === 'checking'}
            <MediaUsesSkeleton />
          {:else if view === 'check-failed'}
            <Alert variant="error">
              <div class="md-alert md-alert--action">
                <AlertTriangleIcon size={16} />
                <span>
                  {flow.check.state === 'failed' && flow.check.rateLimited
                    ? m.media_delete_check_rate_limited()
                    : m.media_delete_check_failed()}
                </span>
                <Button size="xs" variant="secondary" onclick={() => flow.recheck()}>
                  <RefreshCwIcon size={12} />
                  {m.media_tile_try_again()}
                </Button>
              </div>
            </Alert>
          {:else if view === 'blocked' && usage}
            <!-- After R1 the refusal above already says why (mockup R1). -->
            {#if notice?.kind !== 'now-live'}
              <Alert variant="warning">
                <p class="md-alert">
                  <LockIcon size={16} />
                  <span><b>{m.media_delete_blocked_title()}</b> {blockedBody}</span>
                </p>
              </Alert>
            {/if}
            <MediaUsesList {usage} draftAction="replace" />
            <p class="md-quiet">
              <RefreshCwIcon size={12} />
              <span>
                {m.media_delete_recheck()}
                <button
                  type="button"
                  class="md-link"
                  disabled={flow.rechecking}
                  onclick={() => flow.recheck()}
                >
                  {m.media_delete_check_now()}
                </button>
              </span>
            </p>
          {:else if view === 'drafts' && usage}
            <Alert variant="warning">
              <p class="md-alert">
                <AlertTriangleIcon size={16} />
                <span>
                  <b>
                    {usage.drafts === 1
                      ? m.media_delete_drafts_title_one()
                      : m.media_delete_drafts_title({ count: usage.drafts })}
                  </b>
                  {usage.drafts === 1
                    ? m.media_delete_drafts_body_one()
                    : m.media_delete_drafts_body()}
                </span>
              </p>
            </Alert>
            <MediaUsesList {usage} />
          {:else if view === 'unused'}
            <p class="md-lede">
              <b>{m.media_delete_unused_title()}</b>
              {m.media_delete_unused_body()}
            </p>
          {/if}

          {#if notice?.kind === 'failed'}
            <Alert variant="error">
              <p class="md-alert">
                <AlertTriangleIcon size={16} />
                <span>
                  {notice.rateLimited
                    ? m.media_delete_failed_rate_limited()
                    : m.media_delete_failed()}
                </span>
              </p>
            </Alert>
          {/if}

          {#if view === 'drafts' || view === 'unused'}
            <p class="md-quiet">
              <ClockIcon size={12} />
              <span>{m.media_delete_kept()}</span>
            </p>
          {/if}
        </div>
      {/if}
    </Dialog.Body>
    <Dialog.Footer>
      {#if view === 'blocked'}
        <span class="md-why" id={whyId}>{m.media_delete_why_disabled()}</span>
      {/if}
      <Button variant="ghost" onclick={() => flow.close()} disabled={flow.deleting}>
        {view === 'blocked' ? m.common_close() : m.common_cancel()}
      </Button>
      <Button
        variant="destructive"
        onclick={onConfirm}
        disabled={!flow.canDelete}
        aria-describedby={view === 'blocked' ? whyId : undefined}
        loading={flow.deleting}
      >
        {m.media_delete_button()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .md-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .md-media {
    display: grid;
    grid-template-columns: var(--space-16) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .md-media__thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .md-media__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .md-media__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .md-media__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .md-media__meta {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .md-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }

  .md-alert > :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .md-alert--action {
    align-items: center;
    flex-wrap: wrap;
  }

  .md-alert--action > span {
    flex: 1;
    /* No spacing token is this wide: below about 25 characters, Try again wraps under the sentence. */
    min-width: 12rem;
  }

  .md-alert b,
  .md-lede b {
    font-weight: var(--font-semibold);
  }

  .md-lede {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text);
    text-wrap: pretty;
  }

  .md-quiet {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1-5);
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  .md-quiet > :global(svg) {
    flex-shrink: 0;
    margin-top: var(--space-0-5);
  }

  .md-link {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .md-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  .md-link:disabled {
    opacity: var(--opacity-60);
    cursor: progress;
  }

  .md-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .md-why {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    align-self: center;
    text-align: center;
  }

  @media (--breakpoint-sm) {
    .md-why {
      margin-inline-end: auto;
      text-align: start;
    }
  }
</style>
