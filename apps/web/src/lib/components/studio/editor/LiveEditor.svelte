<!--
  @component LiveEditor

  Editing a piece that has been live (Codex-a6ofh.2.5, mockup W5): the two
  steps become two tabs, Page (the Write canvas) and Settings (the Publish
  step's sections, and what only a live piece has), since there is no "next"
  any more. One draft session sits above both, so a tab switch keeps every
  change. That includes an unpublished piece: its buyers keep it (owner,
  2026-11-05).

  Its changes wait for Update (owner 3A): nothing half-finished goes out.
  Discard puts them all back. Leaving with changes not live yet asks Update,
  Discard or Stay, in the editor's own dialog (`LeaveDialog`). A cover is
  staged and goes with Update; only media ready to play is offered; the link
  is locked, and changes only from Settings, with a warning.

  The tab is in the address (`?tab=settings`), swapped in place, so a reload
  opens where the creator was. Mounted by `ContentEditor`, once per visit.

  @prop {ContentWithRelations} content - The piece, read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for its address
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by
  @prop {LiveTab} [tab] - The tab the address asks for
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import * as Tabs from '$lib/components/ui/Tabs';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getMediaItem } from '$lib/remote/media.remote';
  import type { ContentWithRelations } from '$lib/types';
  import * as m from '$paraglide/messages';
  import { savedDraftValues } from './canvas-text';
  import { createDraftSession, type LeaveAnswer, type LeaveReason } from './draft-session.svelte';
  import { type EditorContentType, LIVE_TAB_PARAM, type LiveTab } from './editor-url';
  import LeaveDialog from './LeaveDialog.svelte';
  import LiveBar from './LiveBar.svelte';
  import LiveSettings from './LiveSettings.svelte';
  import { takeLiveHandoff } from './live-handoff';
  import WriteCanvas from './WriteCanvas.svelte';

  interface Props {
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
    tab?: LiveTab;
  }

  const {
    content,
    contentType,
    organizationId,
    orgSlug,
    creatorUsername = null,
    authorName,
    tab: initialTab = 'page',
  }: Props = $props();

  /** On sale now, until Unpublish here (and back with Publish again). */
  let published = $state(untrack(() => content.status === 'published'));

  // ── Leaving ────────────────────────────────────────────────────────────
  /** The question the session is asking; null when none is. */
  let asked = $state<LeaveReason | null>(null);
  /** Answers the question once: a close after an answer (the dialog's own) changes nothing. */
  let answer: ((given: LeaveAnswer) => void) | null = null;
  function askToLeave(reason: LeaveReason): Promise<LeaveAnswer> {
    // A second move while one is asked about (Back, behind the dialog):
    // the first stays put, and the newer one is asked.
    answer?.('stay');
    asked = reason;
    return new Promise((resolve) => {
      answer = (given) => {
        answer = null;
        asked = null;
        resolve(given);
      };
    });
  }

  /**
   * Changes carried from writing: the piece went live under its draft's
   * editor, and "Open it to update" brought them here (Codex-a6ofh.2). They
   * start as changes waiting for Update. Taken once, as this visit mounts.
   */
  const carried = untrack(() => takeLiveHandoff(content.id));

  // One session per mount (ContentEditor keys it per visit): the props it is
  // started from are this visit's read. Mounted only for a piece that has
  // been live, so it reads as one throughout: an older row with no publish
  // stamp would read as a never-live draft once unpublished, and autosave.
  const session = untrack(() =>
    createDraftSession({
      saved: { id: content.id, values: savedDraftValues(content) },
      carried,
      publication: () => ({
        status: published ? 'published' : 'draft',
        publishedAt: content.publishedAt ?? content.createdAt,
      }),
      contentType,
      organizationId,
      askToLeave,
      holdWhile: () => waiting,
    })
  );

  // ── The tabs ───────────────────────────────────────────────────────────
  let tab = $state<string>(untrack(() => initialTab));
  /** Settings mounts the first time it opens, and stays, so its reads wait for that. */
  let settingsOpened = $state(untrack(() => initialTab === 'settings'));
  function switchTab(next: string | undefined) {
    if (next === undefined) return;
    tab = next;
    if (next === 'settings') settingsOpened = true;
    // In place: a navigation would remount the editor and drop the session.
    const url = new URL(page.url);
    const wanted = next === 'settings' ? 'settings' : null;
    if (url.searchParams.get(LIVE_TAB_PARAM) === wanted) return;
    if (wanted) url.searchParams.set(LIVE_TAB_PARAM, wanted);
    else url.searchParams.delete(LIVE_TAB_PARAM);
    replaceState(url, page.state);
  }

  /** Bumped by Discard: both tabs start again from the session's values, the body's editor too. */
  let discards = $state(0);
  function discard() {
    if (waiting) return;
    session.discard();
    discards += 1;
  }

  // ── Update ─────────────────────────────────────────────────────────────
  /** A cover is being readied on the page, or on Settings: each says its own. */
  let pageCoverBusy = $state(false);
  let settingsCoverBusy = $state(false);
  let mediaPending = $state(false);
  let categoryBusy = $state(false);
  let slugInvalid = $state(false);
  /**
   * What is on its way (a cover, an upload or a category), said as why
   * Update waits; null when nothing is. Discard waits for it too, or it
   * would land after and put back a change just discarded.
   */
  const waitingFor = $derived(
    pageCoverBusy || settingsCoverBusy
      ? m.studio_editor_next_needs_cover()
      : mediaPending
        ? m.studio_editor_next_needs_upload()
        : categoryBusy
          ? m.studio_publish_wait_category()
          : null
  );
  const waiting = $derived(waitingFor !== null);
  /** Why Update can't go yet: it would send without what is on its way, or a link that isn't one. */
  const updateHint = $derived(waitingFor ?? (slugInvalid ? m.studio_publish_gap_slug() : null));

  let updating = $state(false);
  async function update() {
    if (updating || updateHint !== null) return;
    updating = true;
    try {
      const result = await session.flush();
      // A refusal is the bar's to say: its words stay until fixed or discarded.
      if (result.ok) toast.success(published ? m.studio_live_updated() : m.studio_live_updated_unpublished());
    } finally {
      updating = false;
    }
  }

  /** The chosen media as read: its length fills the canvas's meta line. */
  const chosenMedia = $derived.by(() => {
    const id = session.values.mediaItemId;
    return id ? (getMediaItem(id).current ?? null) : null;
  });
</script>

<div class="editor">
  <Tabs.Root bind:value={() => tab, switchTab} defaultValue={initialTab}>
    <LiveBar {session} {published} onupdate={update} ondiscard={discard} {updating} {updateHint} {waiting} />
    <!-- Said while the carried changes still wait: Update or Discard ends it. -->
    <p class="live-carried" role="status">{carried && session.isDirty ? m.studio_live_carried() : ''}</p>
    <div class="editor-body" inert={updating}>
      <Tabs.Content value="page">
        {#key discards}
          <WriteCanvas
            {session}
            {contentType}
            {authorName}
            durationSeconds={chosenMedia?.durationSeconds ?? null}
            live
            oncoverbusy={(busy, failed) => {
              pageCoverBusy = busy;
              if (failed) session.stay();
            }}
            onmediapending={(pending) => (mediaPending = pending)}
          />
        {/key}
      </Tabs.Content>
      <Tabs.Content value="settings">
        {#if settingsOpened}
          {#key discards}
            <LiveSettings
              {session}
              {content}
              {contentType}
              {organizationId}
              {orgSlug}
              {creatorUsername}
              {authorName}
              {published}
              onpublishedchange={(next) => (published = next)}
              oncoverbusy={(busy, failed) => {
                settingsCoverBusy = busy;
                if (failed) session.stay();
              }}
              oncategorybusy={(busy) => (categoryBusy = busy)}
              onslugcheck={(invalid) => (slugInvalid = invalid)}
            />
          {/key}
        {/if}
      </Tabs.Content>
    </div>
  </Tabs.Root>
</div>

<LeaveDialog reason={asked} changes={session.changeCount} onanswer={(given) => answer?.(given)} />

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
  }

  /* No box of its own: the tabs' panels lay out as the editor's children. */
  .editor-body {
    display: contents;
  }

  .live-carried {
    max-inline-size: var(--container-content);
    margin: var(--space-3) auto 0;
    padding-inline: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Empty, out of the flow but still in the tree, so its words are heard when they come. */
  .live-carried:empty {
    position: absolute;
    margin: 0;
    padding: 0;
  }
</style>
