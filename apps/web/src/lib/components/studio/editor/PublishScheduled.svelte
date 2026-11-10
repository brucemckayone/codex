<!--
  @component PublishScheduled

  Publish when ready on the Publish step (Codex-a6ofh.2.9, mockup W4r): what
  a scheduled piece is waiting for, and how the wait ended. Shown by what the
  piece's own fields say (`createPublishSchedule`):
  - scheduled: it goes live by itself when the media is ready. The media
    failing while scheduled offers Try again (the schedule carries on) while
    one can help, and another file; gone, only another file. Ready but not
    yet seen live: Check again. Cancel is offered throughout, so a wait that
    is stuck can always be ended here;
  - live: it went live while the step was open, with View once its saved
    address is known (a cancel lost to the go-live reads it; a read that
    fails says so and offers Check again);
  - didn't go live: why, and where it is put right. It stays until a new
    publish clears it (owner: no Dismiss).
  Which of these it shows is the schedule's `view`. Its host renders it only
  while one holds. Every Alert here is furniture (`role="presentation"`): a
  newly mounted live region is announced unreliably, and the waiting one's %
  moves with every report, so the host's one live region says each change of
  view, and focus, if the control pressed went with it, comes back here.

  @prop {PublishSchedule} schedule - The piece's publish, as last read
  @prop {EditorContentType} contentType - Its type, for "the video"
  @prop {string} title - Its title, for "is live"
  @prop {{ status: string; deleted: boolean; progress: number | null; canRetry: boolean } | null} media - The media as the step judges it
  @prop {string | null} mediaId - The media, for Try again
  @prop {string | null} viewHref - Where it lives, once live
  @prop {string} writeHref - The Write step, where the media is chosen
  @prop {string} payoutsHref - Where payouts are set up
  @prop {() => void} [onretried] - A Try again was sent: read the media again, so it is watched again
  @prop {() => void} [refocus] - An action settled: focus, if the control pressed has gone, goes back to the banner
-->
<script lang="ts">
  import { Alert, Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import { retryMediaTranscoding } from '../media-library/media-retry';
  import { TYPE_WORD } from './canvas-text';
  import type { EditorContentType } from './editor-url';
  import { blockedRow } from './publish-gaps';
  import type { PublishSchedule } from './publish-schedule.svelte';

  interface Props {
    schedule: PublishSchedule;
    contentType: EditorContentType;
    title: string;
    media: { status: string; deleted: boolean; progress: number | null; canRetry: boolean } | null;
    mediaId: string | null;
    viewHref: string | null;
    writeHref: string;
    payoutsHref: string;
    onretried?: () => void;
    refocus?: () => void;
  }

  const {
    schedule,
    contentType,
    title,
    media,
    mediaId,
    viewHref,
    writeHref,
    payoutsHref,
    onretried,
    refocus,
  }: Props = $props();

  const type = $derived(TYPE_WORD[contentType]());
  const waitWords = $derived(
    media?.progress == null
      ? m.studio_publish_scheduled_body({ type })
      : m.studio_publish_scheduled_body_pct({ type, pct: media.progress })
  );
  const blocked = $derived(
    schedule.blockedReason === null ? null : blockedRow(schedule.blockedReason, contentType)
  );
  /** Failed: Try again while one can help, else only another file. */
  const failedWords = $derived(
    media?.canRetry
      ? m.studio_publish_scheduled_media_failed({ type })
      : m.studio_publish_blocked_media_failed({ type })
  );
  /** Ready, not yet seen live: "in a moment" only while the last read answered. */
  const staleWords = $derived(
    schedule.readFailed
      ? m.studio_publish_scheduled_ready({ type })
      : m.studio_publish_scheduled_settling({ type })
  );

  async function cancel() {
    await schedule.cancel();
    refocus?.();
  }

  async function checkAgain() {
    await schedule.checkAgain();
    refocus?.();
  }

  let retrying = $state(false);
  /** The schedule carries on through a retry: nothing about it changes. */
  async function retry() {
    if (mediaId === null || retrying) return;
    retrying = true;
    try {
      await retryMediaTranscoding(mediaId);
      // The media's read still says failed, so nothing watches it: read it
      // again, and the watcher follows it to ready (or failed) once more.
      onretried?.();
    } finally {
      retrying = false;
      refocus?.();
    }
  }
</script>

{#snippet checkAgainButton()}
  <Button type="button" size="sm" variant="secondary" loading={schedule.checking} onclick={checkAgain}>
    {m.studio_publish_scheduled_check_again()}
  </Button>
{/snippet}

{#snippet cancelButton()}
  <Button
    type="button"
    size="sm"
    variant="secondary"
    loading={schedule.cancelling}
    aria-label={m.studio_publish_scheduled_cancel_label()}
    onclick={cancel}
  >
    {m.studio_publish_scheduled_cancel()}
  </Button>
{/snippet}

{#snippet anotherFile()}
  <!-- The media cannot get there itself: another file, or end the wait. -->
  <a class="schedule-link" href={writeHref}>{m.studio_publish_scheduled_choose_media({ type })}</a>
  {#if schedule.stale}{@render checkAgainButton()}{/if}
  {@render cancelButton()}
{/snippet}

{#if schedule.view === 'live'}
  <Alert variant="success" role="presentation">
    <p class="schedule-lead">{m.studio_publish_live({ title: title.trim() })}</p>
    {#if viewHref}
      <div class="schedule-actions">
        <a class="schedule-link" href={viewHref}>{m.studio_publish_view()}</a>
      </div>
    {:else if schedule.readFailed}
      <!-- Its link comes from a read (a cancel lost to the go-live), which
           failed: one more, which stays while it reads. -->
      <div class="schedule-actions">{@render checkAgainButton()}</div>
    {/if}
  </Alert>
{:else if schedule.view === 'gone'}
  <!-- Gone, it can never be ready: only another file can help. -->
  <Alert variant="warning" role="presentation">
    <p class="schedule-lead">{m.studio_publish_gap_media_deleted({ type })}</p>
    <div class="schedule-actions">{@render anotherFile()}</div>
  </Alert>
{:else if schedule.view === 'failed'}
  <!-- Past any Try again, the server is about to clear the schedule: only
       another file can help. -->
  <Alert variant="warning" role="presentation">
    <p class="schedule-lead">{failedWords}</p>
    <div class="schedule-actions">
      {#if media?.canRetry}
        <Button type="button" size="sm" variant="secondary" loading={retrying} onclick={retry}>
          {m.common_try_again()}
        </Button>
      {/if}
      {@render anotherFile()}
    </div>
  </Alert>
{:else if schedule.view === 'stale'}
  <Alert variant="info" role="presentation">
    <p class="schedule-lead">{staleWords}</p>
    <div class="schedule-actions">
      {@render checkAgainButton()}
      {@render cancelButton()}
    </div>
  </Alert>
{:else if schedule.view === 'waiting'}
  <Alert variant="info" role="presentation">
    <p class="schedule-heading">{m.studio_publish_scheduled_heading()}</p>
    <p class="schedule-lead">{waitWords}</p>
    <div class="schedule-actions">
      {@render cancelButton()}
    </div>
  </Alert>
{:else if blocked}
  <Alert variant="warning" role="presentation">
    <p class="schedule-heading">{m.studio_publish_blocked()}</p>
    <p class="schedule-lead">{blocked.words}</p>
    {#if blocked.fix === 'write'}
      <div class="schedule-actions">
        <a class="schedule-link" href={writeHref}>{m.studio_publish_gap_fix_on_write()}</a>
      </div>
    {:else if blocked.fix === 'payouts'}
      <div class="schedule-actions">
        <a class="schedule-link" href={payoutsHref}>{m.studio_content_form_access_payouts_link()}</a>
      </div>
    {/if}
  </Alert>
{/if}
<!-- There, empty, for as long as the banner is: a live region mounted with
     its words is announced unreliably, so each is heard when it is set. A
     check that finds it still waiting; a cancel that did not land; a read
     that could not be made. -->
<p class={['schedule-note', { 'sr-only': !schedule.stillWaiting }]} role="status">
  {schedule.stillWaiting ? m.studio_publish_scheduled_still_waiting() : ''}
</p>
<p class={['schedule-problem', { 'sr-only': !schedule.cancelProblem }]} role="alert">
  {schedule.cancelProblem ?? ''}
</p>
<p class={['schedule-problem', { 'sr-only': !schedule.readProblem }]} role="alert">
  {schedule.readProblem ?? ''}
</p>

<style>
  .schedule-heading {
    margin: 0;
    font-weight: var(--font-semibold);
  }

  .schedule-lead {
    margin: 0;
  }

  .schedule-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin-block-start: var(--space-3);
  }

  .schedule-link {
    font-weight: var(--font-medium);
    color: var(--color-link);
    text-decoration: underline;
  }

  .schedule-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .schedule-note {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
  }

  .schedule-problem {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--color-status-error-text);
  }
</style>
