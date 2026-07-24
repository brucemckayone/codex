<!--
  @component PracticeWorkingPane

  The in-course player's working pane: the practice itself + its completion
  affordance + prev/next nav. Completion follows the D-E boundary (SPEC §14.3):

    - video / audio → completion AUTO-writes on genuine 100% finish. No button;
      a caption states "completes when you finish". Genuine finish is detected
      from the SINGLE progress store: the player's tracker saves position on the
      native `ended` event, so `playbackPercent` reaches 100 only on a true
      finish (the 95% "watched" flag never reaches 100). Idempotent.
    - written → an EXPLICIT "Mark complete" button (no playback signal).

  Playback (no unmuted hover-autoplay — the players are click-initiated).

  @prop {JourneyPractice} practice - The open practice.
  @prop {string | null} streamingUrl - Signed HLS URL (media); null → degraded.
  @prop {string | null} waveformUrl - Signed waveform URL (audio).
  @prop {string | null} bodyHtml - Rendered body (written); server-sanitised.
  @prop {number} initialProgressSeconds - Resume position (media).
  @prop {boolean} isComplete - Reactive completion (parent live query).
  @prop {number} playbackPercent - Reactive watch % (parent live query).
  @prop {string | null} prevHref - Previous practice, or null at the start.
  @prop {string | null} nextHref - Next practice, or null at the end.
-->
<script lang="ts">
  import AudioPlayer from '$lib/components/AudioPlayer/AudioPlayer.svelte';
  import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from '$lib/components/ui/Icon';
  import VideoPlayer from '$lib/components/VideoPlayer/VideoPlayer.svelte';
  import { markPracticeComplete } from '$lib/collections';
  import type { JourneyPractice } from '$lib/journeys/types';

  interface Props {
    practice: JourneyPractice;
    streamingUrl: string | null;
    waveformUrl: string | null;
    bodyHtml: string | null;
    initialProgressSeconds: number;
    isComplete: boolean;
    playbackPercent: number;
    prevHref: string | null;
    nextHref: string | null;
  }

  const {
    practice,
    streamingUrl,
    waveformUrl,
    bodyHtml,
    initialProgressSeconds,
    isComplete,
    playbackPercent,
    prevHref,
    nextHref,
  }: Props = $props();

  const isMedia = $derived(
    practice.contentType === 'video' || practice.contentType === 'audio'
  );

  // D-E auto-write: media completes on genuine 100% finish (not the 95% watch
  // flag). `markPracticeComplete` is idempotent so re-fires are safe.
  $effect(() => {
    if (!isMedia || isComplete) return;
    if (playbackPercent >= 100) {
      markPracticeComplete(practice.contentId, 'auto');
    }
  });

  function handleMarkComplete(): void {
    markPracticeComplete(practice.contentId, 'manual');
  }
</script>

<article class="pane">
  <header class="pane__header">
    <h1 class="pane__title">{practice.title}</h1>
    {#if isComplete}
      <span class="pane__badge" aria-label="Completed">
        <CheckIcon /> Completed
      </span>
    {/if}
  </header>

  <div class="pane__stage">
    {#if isMedia}
      {#if streamingUrl}
        {#if practice.contentType === 'video'}
          <VideoPlayer
            src={streamingUrl}
            contentId={practice.contentId}
            contentTitle={practice.title}
            initialProgress={initialProgressSeconds}
          />
        {:else}
          <AudioPlayer
            src={streamingUrl}
            contentId={practice.contentId}
            initialProgress={initialProgressSeconds}
            {waveformUrl}
            title={practice.title}
          />
        {/if}
      {:else}
        <!-- Round-D signs the R2 stream URL; until then, a degraded state. -->
        <div class="pane__placeholder">
          <p>This {practice.contentType} streams once the access plumbing lands.</p>
        </div>
      {/if}
    {:else if bodyHtml}
      <!-- Server-rendered, sanitised body (mirrors the standalone content page). -->
      <div class="pane__body">
        {@html bodyHtml}
      </div>
    {:else}
      <div class="pane__placeholder">
        <p>This practice has no content yet.</p>
      </div>
    {/if}
  </div>

  <footer class="pane__footer">
    <div class="pane__completion">
      {#if isMedia}
        {#if isComplete}
          <span class="pane__complete-note">
            <CheckIcon /> Completed on finish
          </span>
        {:else}
          <span class="pane__auto-note">Completes when you finish</span>
        {/if}
      {:else if isComplete}
        <span class="pane__complete-note">
          <CheckIcon /> Marked complete
        </span>
      {:else}
        <button type="button" class="pane__mark" onclick={handleMarkComplete}>
          <CheckIcon /> Mark complete
        </button>
      {/if}
    </div>

    <nav class="pane__nav" aria-label="Practice navigation">
      {#if prevHref}
        <a class="pane__nav-link" href={prevHref}>
          <ArrowLeftIcon /> Previous
        </a>
      {/if}
      {#if nextHref}
        <a class="pane__nav-link pane__nav-link--next" href={nextHref}>
          Next <ArrowRightIcon />
        </a>
      {/if}
    </nav>
  </footer>
</article>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }

  .pane__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .pane__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    color: var(--color-heading);
  }

  .pane__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-success-100);
    color: var(--color-success-700);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .pane__stage {
    border-radius: var(--radius-card);
    overflow: hidden;
    min-width: 0;
  }

  .pane__placeholder {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    padding: var(--space-8);
    text-align: center;
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
    border-radius: var(--radius-card);
  }

  .pane__body {
    padding: var(--space-2) 0;
    color: var(--color-text);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
  }

  .pane__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .pane__auto-note,
  .pane__complete-note {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .pane__complete-note {
    color: var(--color-success);
  }

  .pane__mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-primary-600);
    border-radius: var(--radius-button);
    background: var(--color-primary-600);
    color: var(--color-text-on-brand);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) ease;
  }

  .pane__mark:hover {
    background: var(--color-primary-700);
  }

  .pane__mark:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .pane__nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pane__nav-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-button);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: var(--text-sm);
    transition: background-color var(--duration-fast) ease;
  }

  .pane__nav-link:hover {
    background: var(--color-surface-secondary);
    color: var(--color-heading);
  }

  .pane__nav-link:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>
