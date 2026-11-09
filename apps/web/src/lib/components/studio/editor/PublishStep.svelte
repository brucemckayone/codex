<!--
  @component PublishStep

  Step 2, Publish (Codex-a6ofh.2.4, mockup W4), for a piece that has never
  been live: everything that isn't the piece itself, on one screen. Who can
  watch is open; how it looks in lists shows the card it becomes; where it
  appears folds to a one-line summary. Only what is missing is listed, right
  above the one button, which names what it does ("Publish for £12.00").

  Settings save as they go, through the same draft session as Write (owner
  3A). Publish is the session's (`session.publish`): it saves what is on
  screen, riding any save already out, then publishes, so it never puts an
  older save live. The checklist is the publish gate's own rules read from
  the screen (`publishGaps`); a refusal the server sends anyway is listed by
  its code (`PUBLISH_REFUSAL_CODES`), or said in its own words. A read it
  checks by (the media, payouts) that fails is logged and said, with Try
  again, never taken for "nothing missing"; Publish stays open, as the
  server still judges.

  Mounted by `ContentEditor`, once per visit, from the read the route made
  on arriving, so the session starts from the piece as Write left it.

  @prop {ContentWithRelations} content - The draft, read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for the piece's address; null in the personal studio
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by, on the card
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import { describeThrown } from '$lib/client-log';
  import { Button } from '$lib/components/ui';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { publishContent, publishContentWhenReady } from '$lib/remote/content.remote';
  import { logger } from '$lib/observability';
  import type { ContentWithRelations } from '$lib/types';
  import { accessGroupToFlags } from '$lib/utils/content-access';
  import { focusIfLost } from '$lib/utils/focus-if-lost';
  import { formatPrice } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import { savedDraftValues, TYPE_WORD } from './canvas-text';
  import { createDraftSession, type DraftValues } from './draft-session.svelte';
  import EditorSection from './EditorSection.svelte';
  import { CONTENT_LIST_HREF, type EditorContentType, editHref, pieceHref, previewHref } from './editor-url';
  import {
    asPublishGap,
    earnsByFlags,
    gapRow,
    type PublishGap,
    publishGaps,
    blockedRow,
    refusalPutRightBy,
  } from './publish-gaps';
  import { createPublishReads } from './publish-reads.svelte';
  import { createPublishSchedule } from './publish-schedule.svelte';
  import PublishScheduled from './PublishScheduled.svelte';
  import PublishSettings from './PublishSettings.svelte';
  import WentLiveNotice from './WentLiveNotice.svelte';
  import WriteBar from './WriteBar.svelte';

  interface Props {
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
  }

  const { content, contentType, organizationId, orgSlug, creatorUsername = null, authorName }: Props = $props();

  // Publish when ready (Codex-a6ofh.2.9): the piece's publish as last read,
  // which a publish, a cancel or a read after the media settles moves on.
  // Its media is read only from its effect, once `reads` exists.
  const schedule = untrack(() =>
    createPublishSchedule({
      contentId: content.id,
      initial: {
        status: content.status,
        publishedAt: content.publishedAt,
        publishRequestedAt: content.publishRequestedAt ?? null,
        publishBlockedReason: content.publishBlockedReason ?? null,
        slug: content.slug ?? null,
      },
      media: () => reads.media,
    })
  );

  // One session per mount (ContentEditor keys it per visit): the props it is
  // started from are this visit's read. Whether it has been live is the
  // schedule's latest read: a go-live seen here stops its draft saves.
  const session = untrack(() =>
    createDraftSession({
      saved: { id: content.id, values: savedDraftValues(content) },
      publication: () => schedule.publication,
      contentType,
      organizationId,
    })
  );
  /** The session's own values, the same object for its life. */
  const values = session.values;
  const access = $derived(session.values.access);
  const writeHref = $derived(editHref(content.id));

  /** A change made here: what the last Publish was refused for may be put right. */
  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    if (refusal && refusalPutRightBy(refusal.gap, key)) refusal = null;
    session.set(key, value);
  }

  // Payouts, the org's plans and the media: what the checklist and the
  // settings are judged by.
  const reads = createPublishReads({ values, content: () => content, organizationId: () => organizationId });

  /** What a save sends for the access group: what the button reads. */
  const flags = $derived(accessGroupToFlags(access, organizationId));
  const forSale = $derived(flags.isPurchasable && (flags.priceCents ?? 0) > 0);

  // ── How it looks in lists ──────────────────────────────────────────────
  /** A cover set or removed here (the cover line's); undefined until then, so the saved one shows. */
  let coverSet = $state<string | null | undefined>(undefined);
  /** A cover set or removed here: a refusal for a deleted frame no longer holds. */
  function setCover(next: string | null | undefined) {
    coverSet = next;
    if (refusal?.gap === 'THUMBNAIL_MEDIA_DELETED') refusal = null;
  }
  /** A cover is going up or coming off: Publish waits for it. */
  let coverBusy = $state(false);
  /** Its saved cover is a frame of a video since deleted (Codex-tqvmx), until another is set. */
  const coverDeleted = $derived(coverSet === undefined && content.thumbnailFrame?.deletedAt != null);

  /** What is typed in the slug field is not a slug: Publish would send the last one that was. */
  let slugInvalid = $state(false);
  /** A category created in the fold is on its way: Publish waits to save it. */
  let categoryBusy = $state(false);

  // ── Before this can go live ────────────────────────────────────────────
  const gaps = $derived(
    publishGaps({
      contentType,
      values,
      needsTitle: session.needsTitle,
      media: reads.media,
      coverDeleted,
      connectReady: reads.connectReady,
      organizationId,
    })
  );
  /**
   * What the last Publish was refused for: its row, or its own words. Cleared
   * by the next, or by a change here that may put it right
   * (`refusalPutRightBy`). `unsent`: it stopped at its save.
   */
  let refusal = $state<{ gap: PublishGap | null; message: string; unsent: boolean; slow: boolean } | null>(null);
  /**
   * A refusal's words, when it has no row. One that stopped at its save is
   * said as the save now stands: saved since (so Publish again), still out
   * (`slow`), or in the save's own words until its retry fails too, which
   * the bar then says.
   */
  const refusalWords = $derived.by(() => {
    if (!refusal || refusal.gap !== null) return null;
    if (!refusal.unsent) return refusal.message;
    if (session.status === 'error') return null;
    if (session.status === 'saved') return m.studio_publish_saved_press_again();
    return refusal.slow ? m.studio_editor_publish_save_slow() : refusal.message;
  });
  const rows = $derived.by(() => {
    const extra = refusal?.gap;
    const listed = extra && !gaps.includes(extra) ? [...gaps, extra] : gaps;
    return listed.map((gap) => gapRow(gap, { contentType, media: reads.media }));
  });

  let publishing = $state(false);
  /**
   * It went live, and where it goes now: held still until the next page
   * takes over. The toast alone says it is live, as it outlasts the step
   * (Codex-a6ofh.2.12): said here too, it was seen and heard twice.
   */
  let done = $state<'list' | 'move' | null>(null);
  /** Live, as Publish or as the schedule saw it land: held still, its way on offered. */
  const held = $derived(publishing || done !== null || schedule.live);
  /**
   * Live by another way (owner, 2026-11-09: freeze it): the step stays in
   * view, but nothing in it can touch the live piece. Its settings are
   * inert, its checklist, banner and foot go, and the notice is the one way
   * on, carrying the changes.
   */
  const frozen = $derived(session.wentLiveElsewhere);
  const waitHint = $derived(
    coverBusy ? m.studio_editor_next_needs_cover() : categoryBusy ? m.studio_publish_wait_category() : null
  );
  /**
   * The media stands in the way, and it is on its way: Publish when ready
   * schedules past it (Codex-a6ofh.2.9). Its row and the button both say so,
   * and it is offered once it is all that is left, every other rule checked now.
   */
  const mediaWaits = $derived(gaps.includes('MEDIA_NOT_READY') && reads.media?.onItsWay === true);
  const whenReady = $derived(mediaWaits && gaps.length === 1);
  const blocked = $derived((gaps.length > 0 && !whenReady) || coverBusy || categoryBusy || slugInvalid);
  /** Scheduled, the wait is the banner's to say: the checklist lists only what else is missing. */
  const listedRows = $derived(schedule.scheduled ? rows.filter((row) => row.gap !== 'MEDIA_NOT_READY') : rows);
  /**
   * Payouts, for a piece that earns: a free piece does not wait on them, as
   * the server's gate does not look (`assertCreatorCanBePaid`). Not read yet,
   * the kinds that earn are still offered, but it is never announced ready.
   */
  const earns = $derived(earnsByFlags(flags));
  const payoutsUnread = $derived(reads.connectUnread && earns);
  const payoutsPending = $derived(reads.connectLoading && earns);
  /** Payouts, where they count, are read and set. */
  const payoutsKnown = $derived(!payoutsUnread && !payoutsPending);
  /** Nothing is missing, and nothing it checks by went unread or is unread yet. */
  const ready = $derived(listedRows.length === 0 && !slugInvalid && !reads.mediaUnread && payoutsKnown);
  /**
   * A payouts Try again's outcome, said on its own line whatever else is
   * left: the checklist's status line leads with how much is left.
   */
  const payoutsRetryNote = $derived(
    reads.connectRetrying
      ? m.studio_publish_connect_retrying()
      : reads.connectFailedAgain && payoutsUnread
        ? m.studio_publish_connect_unread_again()
        : ''
  );

  /** A Try again that reads them: focus stays in the checklist, whose status says what is left. */
  async function retryPayouts() {
    await reads.rereadConnect();
    if (reads.connectUnread) return;
    await tick();
    focusIfLost(gapsEl);
  }
  /** The unread row's words: a Try again says it is trying, and that it failed again. */
  const payoutsUnreadWords = $derived(
    reads.connectRetrying
      ? m.studio_publish_connect_retrying()
      : reads.connectFailedAgain
        ? m.studio_publish_connect_unread_again()
        : m.studio_publish_connect_unread()
  );
  /**
   * The checklist's one live region: the wait, the all-clear, or (heard
   * only) how much is left, so a row going (the media ready) is told.
   */
  const left = $derived(listedRows.length + Number(slugInvalid));
  /**
   * Scheduled, the checklist shows only while something else is left or a
   * read failed. Payouts still loading are not: the schedule was checked
   * against them already.
   */
  const checklistShown = $derived(!schedule.scheduled || left > 0 || reads.mediaUnread || payoutsUnread);
  const statusWords = $derived.by(() => {
    if (waitHint) return waitHint;
    if (whenReady && payoutsKnown) return m.studio_publish_gaps_when_ready();
    if (ready) return m.studio_publish_gaps_none();
    if (left > 0) return m.studio_publish_gaps_left({ count: left });
    if (reads.mediaUnread) return m.studio_publish_media_unread({ type: TYPE_WORD[contentType]() });
    if (payoutsUnread) return m.studio_publish_connect_unread();
    return payoutsPending ? m.studio_publish_connect_checking() : '';
  });
  /** What Publish is doing, outside what it holds still, so it is heard and keeps focus. */
  const progressWords = $derived.by(() => {
    if (done === 'list') return m.studio_publish_opening_content();
    if (done === 'move') return m.studio_publish_going_on();
    if (!publishing) return '';
    if (session.holdingMove) return m.studio_publish_publishing_then_move();
    return whenReady ? m.studio_publish_scheduling() : m.studio_publish_publishing();
  });
  let progressEl = $state<HTMLElement | null>(null);
  const publishWords = $derived.by(() => {
    if (mediaWaits) {
      return forSale
        ? m.studio_publish_button_when_ready_price({ price: formatPrice(flags.priceCents) })
        : m.studio_publish_button_when_ready();
    }
    return forSale ? m.studio_publish_button_price({ price: formatPrice(flags.priceCents) }) : m.studio_publish_button();
  });
  /** Where it lives, once it is live: by its slug as saved, which a refused slug save never was. */
  const viewHref = $derived(
    schedule.live && schedule.slug !== null
      ? pieceHref(page.url, { orgSlug, creatorUsername }, { slug: schedule.slug, id: content.id })
      : null
  );
  /** Scheduled, whether the tab can close: one making an upload stops it, and says so. */
  const closeWords = $derived.by(() => {
    if (!schedule.scheduled) return null;
    return reads.media?.uploadingHere ? m.studio_publish_scheduled_keep_open() : m.studio_publish_scheduled_close();
  });
  let scheduleEl = $state<HTMLElement | null>(null);
  /**
   * The step's one live region for the schedule: each change of what the
   * banner shows is said here, as the banner's own Alerts are furniture (a
   * newly mounted live region is heard unreliably, and focus already on the
   * banner says nothing when it moves there again).
   */
  let scheduleNotice = $state('');
  /** An action in the banner settled: focus, if its control went, goes back to the banner. */
  function refocusBanner() {
    void tick().then(() => focusIfLost(scheduleEl, null, { preventScroll: true }));
  }
  /**
   * What a change to `view` says, in the banner's own lead words; empty when
   * the banner's own alert already says it (reads that ran out unanswered).
   */
  function viewWords(view: NonNullable<typeof schedule.view>): string {
    const type = TYPE_WORD[contentType]();
    switch (view) {
      case 'live':
        return m.studio_publish_live({ title: values.title.trim() });
      case 'blocked':
        // Why, and where it is put right, as the banner says it.
        return schedule.blockedReason === null
          ? m.studio_publish_blocked()
          : `${m.studio_publish_blocked()} ${blockedRow(schedule.blockedReason, contentType).words}`;
      case 'gone':
        return m.studio_publish_gap_media_deleted({ type });
      case 'failed':
        return reads.media?.canRetry
          ? m.studio_publish_scheduled_media_failed({ type })
          : m.studio_publish_blocked_media_failed({ type });
      case 'stale':
        return schedule.readFailed ? '' : m.studio_publish_scheduled_settling({ type });
      case 'waiting':
        return m.studio_publish_scheduled_heading();
    }
  }
  // What the banner shows changed (a read saw it go live, or not; the media
  // failed, or a retry set it going; a cancel landed, here or elsewhere, or
  // lost to the go-live): it is said, and focus, if the control the creator
  // was on went with the old view or was held still, goes to the banner
  // without scrolling. Ended, focus goes to the checklist, which lists the
  // wait again.
  let seenView = untrack(() => schedule.view);
  $effect(() => {
    const view = schedule.view;
    if (view === seenView) return;
    const was = seenView;
    seenView = view;
    if (view !== null) {
      // Empty words still replace the old view's: they no longer hold.
      scheduleNotice = viewWords(view);
      refocusBanner();
      return;
    }
    if (was === 'live' || was === 'blocked') return;
    scheduleNotice = schedule.cancelledHere
      ? m.studio_publish_scheduled_cancelled()
      : m.studio_publish_scheduled_ended();
    void tick().then(() => focusIfLost(gapsEl, null, { preventScroll: true }));
  });
  // Gone or failed, the reads running out adds Check again without a change
  // of view: said, unless the banner's alert already says the reads failed.
  let seenStale = untrack(() => schedule.stale);
  $effect(() => {
    const stale = schedule.stale;
    if (stale === seenStale) return;
    seenStale = stale;
    const view = untrack(() => schedule.view);
    if (stale && (view === 'gone' || view === 'failed') && !untrack(() => schedule.readFailed)) {
      scheduleNotice = m.studio_publish_scheduled_still_waiting();
    }
  });
  // A read that could not be made, while scheduled: what the region last
  // said from a read ("in a moment", "not live yet") is not known now, and
  // the banner's read alert is the one voice.
  $effect(() => {
    if (schedule.readFailed && untrack(() => schedule.scheduled)) scheduleNotice = '';
  });
  const gapsId = $props.id();
  let gapsEl = $state<HTMLElement | null>(null);

  /** Unmounted (its host closed it): nothing left here to show or move. */
  let gone = false;
  $effect(() => () => {
    gone = true;
  });

  /** Where Publish leads, or a move asked for meanwhile: a failed move still lands. */
  function leave(to: string | URL) {
    goto(to).catch((err) => {
      logger.warn('studio_publish.leave_failed', { contentId: content.id, ...describeThrown(err) });
      location.assign(to);
    });
  }

  /**
   * Save what is on screen, then publish. Live, it is listed with the
   * creator's other pieces, or goes where the creator moved to meanwhile;
   * refused, the checklist says why, and focus goes there, as the screen is
   * held still meanwhile (a move waits: the session holds it).
   */
  async function publish() {
    // A move already under way is the creator's last word: Publish waits.
    if (held || blocked || navigating.to !== null) return;
    publishing = true;
    refusal = null;
    // A cancel said earlier is old news once it is asked to publish again.
    scheduleNotice = '';
    // The button goes busy, so focus goes where the progress is said.
    void tick().then(() => progressEl?.focus());
    try {
      const result = await session.publish(whenReady ? publishContentWhenReady : publishContent);
      const heldMove = session.takeHeldMove();
      if (result.ok && result.live !== false) {
        done = heldMove ? 'move' : 'list';
        toast.success(m.studio_publish_live({ title: values.title.trim() }));
        if (!gone) leave(heldMove ?? CONTENT_LIST_HREF);
        return;
      }
      if (result.ok) {
        if (await showScheduled(result.row, heldMove)) return;
        // Accepted, yet neither live nor scheduled: no server of this
        // version answers so. Said as a failure, never as nothing.
        logger.error('studio_publish.unexpected_answer', { contentId: content.id });
        if (!refuse({ gap: null, message: m.studio_editor_publish_failed(), unsent: false, slow: false })) return;
      } else {
        const said = refuse({
          gap: asPublishGap(result.code),
          message: result.message ?? m.studio_editor_publish_failed(),
          unsent: result.unsent === true,
          slow: result.code === 'SAVE_SLOW',
        });
        if (!said) return;
      }
    } finally {
      publishing = false;
    }
    await tick();
    gapsEl?.focus();
  }

  /**
   * A publish answered scheduled: a draft still, its edits saving. A move
   * asked for meanwhile is the creator's last word, told on the way out, as
   * is a step that closed; else the banner says it, and focus goes there.
   * False for an answer that is not scheduled.
   */
  async function showScheduled(row: unknown, heldMove: URL | null): Promise<boolean> {
    schedule.adopt(row);
    if (!schedule.scheduled) return false;
    if (gone || heldMove) {
      toast.success(m.studio_publish_scheduled_toast({ title: values.title.trim(), type: TYPE_WORD[contentType]() }));
      if (!gone && heldMove) leave(heldMove);
      return true;
    }
    await tick();
    scheduleEl?.focus();
    return true;
  }

  /**
   * A refusal, said in the checklist, which focus goes to after; or, the
   * step closed meanwhile, as a toast. False then: nothing is left to focus.
   */
  function refuse(said: NonNullable<typeof refusal>): boolean {
    if (gone) {
      toast.error(said.message);
      return false;
    }
    refusal = said;
    return true;
  }
</script>

<!-- Held still while Publish runs and once it has gone live, the bar's way
     back included; only the foot, which says what is happening, is not.
     Frozen, the foot is gone, so the bar's way back stays (owner, 2026-11-09). -->
<div class="editor">
  <div class="publish-held" inert={held && !frozen}>
    <WriteBar
      {session}
      {contentType}
      step="publish"
      backHref={writeHref}
      previewHref={session.contentId === null ? null : previewHref(session.contentId, 'publish')}
    />
  </div>
  <!-- Never held: once it went live elsewhere, its button is the way on. -->
  <WentLiveNotice {session} waitFor={waitHint} />

  <div class="publish">
    <div class="publish-held" inert={held}>
      <header class="publish-head">
        <h1 class="publish-title">{values.title}</h1>
        {#if !frozen}
          <p class="publish-intro">{m.studio_publish_intro()}</p>
        {/if}
      </header>
    </div>

    <!-- Never held: once it is live, its View and the foot's Done are the way on. -->
    {#if schedule.phase !== null && !frozen}
      <div class="publish-schedule" tabindex="-1" bind:this={scheduleEl}>
        <PublishScheduled
          {schedule}
          {contentType}
          title={values.title}
          media={reads.media}
          mediaId={values.mediaItemId}
          {viewHref}
          {writeHref}
          payoutsHref={reads.payoutsHref}
          refocus={refocusBanner}
          onretried={reads.rereadMedia}
        />
      </div>
    {/if}
    <!-- Frozen, the notice is the one voice: the banner this speaks for is gone. -->
    {#if !frozen}
      <p class="sr-only" role="status">{scheduleNotice}</p>
    {/if}

    <div class="publish-held" inert={held || frozen}>

      <PublishSettings
        {session}
        {reads}
        {content}
        {contentType}
        {organizationId}
        {orgSlug}
        {creatorUsername}
        {authorName}
        onchange={change}
        savedCover={content.thumbnailUrl}
        coverChanged={coverSet}
        oncoverchange={setCover}
        oncoverbusy={(busy) => (coverBusy = busy)}
        oncategorybusy={(busy) => (categoryBusy = busy)}
        onslugcheck={(invalid) => (slugInvalid = invalid)}
      />

      {#if checklistShown && !frozen}
      <EditorSection headingId="{gapsId}-gaps" ordinal={4} title={m.studio_publish_gaps()}>
        <div class="publish-gaps" id={gapsId} tabindex="-1" bind:this={gapsEl}>
          {#if !ready}
            <ul class="publish-gap-list">
              {#each listedRows as row (row.gap)}
                <li class="publish-gap">
                  <span>{row.words}</span>
                  {#if row.fix === 'write'}
                    <a class="publish-gap-fix" href={writeHref}>{m.studio_publish_gap_fix_on_write()}</a>
                  {:else if row.fix === 'payouts'}
                    <a class="publish-gap-fix" href={reads.payoutsHref}>{m.studio_content_form_access_payouts_link()}</a>
                  {/if}
                </li>
              {/each}
              {#if slugInvalid}
                <li class="publish-gap">
                  <span>{m.studio_publish_gap_slug()}</span>
                  <button type="button" class="publish-gap-fix" onclick={() => document.getElementById('slug')?.focus()}>
                    {m.studio_publish_gap_fix_here()}
                  </button>
                </li>
              {/if}
              {#if reads.mediaUnread}
                <li class="publish-gap publish-gap--unread">
                  <span>{m.studio_publish_media_unread({ type: TYPE_WORD[contentType]() })}</span>
                  <button type="button" class="publish-gap-fix" onclick={reads.rereadMedia}>{m.common_try_again()}</button>
                </li>
              {/if}
              {#if payoutsPending}
                <li class="publish-gap publish-gap--unread">
                  <span>{m.studio_publish_connect_checking()}</span>
                </li>
              {/if}
              {#if payoutsUnread}
                <li class="publish-gap publish-gap--unread">
                  <span>{payoutsUnreadWords}</span>
                  <button
                    type="button"
                    class="publish-gap-fix"
                    aria-busy={reads.connectRetrying}
                    onclick={retryPayouts}
                  >
                    {m.common_try_again()}
                  </button>
                </li>
              {/if}
            </ul>
          {/if}
          <p class="sr-only" role="status">{payoutsRetryNote}</p>
          <p
            class={[
              'publish-status',
              { 'publish-ready': ready && !waitHint, 'publish-hint': waitHint !== null, 'sr-only': !ready && !waitHint },
            ]}
            role="status"
          >
            {statusWords}
          </p>
          {#if refusalWords}
            <p class="publish-refusal" role="alert">{refusalWords}</p>
          {/if}
        </div>
      </EditorSection>
      {/if}
    </div>

    {#if !frozen}
    <div class="publish-foot">
      <p class={['publish-progress', { 'sr-only': !held }]} role="status" tabindex="-1" bind:this={progressEl}>
        {progressWords}
      </p>
      {#if schedule.scheduled || schedule.live}
        {#if closeWords}
          <p class="publish-close">{closeWords}</p>
        {/if}
        <Button type="button" variant={schedule.live ? 'primary' : 'secondary'} onclick={() => leave(CONTENT_LIST_HREF)}>
          {m.studio_publish_done()}
        </Button>
      {:else}
        <Button
          type="button"
          disabled={blocked || navigating.to !== null}
          loading={held}
          aria-describedby={blocked ? gapsId : undefined}
          onclick={publish}
        >
          {publishWords}
        </Button>
      {/if}
    </div>
    {/if}
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
  }

  .publish {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    inline-size: 100%;
    max-inline-size: var(--container-settings);
    margin: 0 auto;
    padding: var(--space-8) var(--space-4) var(--space-12);
  }

  .publish-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .publish-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .publish-intro,
  .publish-hint,
  .publish-close {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .publish-gaps {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-radius: var(--radius-md);
  }

  .publish-gaps:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .publish-gap-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .publish-gap {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  /* A read it checks by failed: said plainly, not as something to fix. */
  .publish-gap--unread {
    background: var(--color-surface-secondary);
  }

  .publish-gap-fix {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: var(--font-medium);
    color: var(--color-link);
    text-decoration: underline;
    cursor: pointer;
  }

  .publish-gap-fix:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .publish-status {
    margin: 0;
    font-size: var(--text-sm);
  }

  .publish-ready {
    color: var(--color-status-success-text);
  }

  .publish-refusal {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }

  /* No box of its own: what it holds lays out as the step's own children. */
  .publish-held {
    display: contents;
  }

  .publish-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2) var(--space-4);
  }

  .publish-schedule:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
    border-radius: var(--radius-md);
  }

  .publish-progress {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
  }

  .publish-progress:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-md) {
    .publish-foot {
      position: sticky;
      inset-block-end: 0;
      z-index: var(--z-sticky);
      margin-inline: calc(-1 * var(--space-4));
      padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
      border-block-start: var(--border-width) var(--border-style) var(--color-border);
      background: var(--color-surface);
    }

    .publish-foot > :global(*) {
      flex: 1;
    }

    .publish-progress {
      flex-basis: 100%;
    }
  }
</style>
