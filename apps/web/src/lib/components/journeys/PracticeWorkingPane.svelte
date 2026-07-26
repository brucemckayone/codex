<!--
  @component PracticeWorkingPane

  The in-course player's working column (SPEC §8.6): lesson chrome (breadcrumb,
  journey badge, title, type line), the practice itself, the stage "why", the
  single completion + Next affordance, the peak-end completion card on the last
  practice, and the prev / back-to-overview footer.

  Completion follows the D-E boundary (SPEC §14.3):
    - video / audio → completion AUTO-writes on genuine 100% finish. No button;
      a status states "completes when you finish". Genuine finish is read from
      the SINGLE progress store — the player saves position on the native
      `ended` event, so `playbackPercent` reaches 100 only on a true finish
      (the 95% "watched" flag never does). Idempotent.
    - written → an EXPLICIT "Mark complete" button (no playback signal).

  Players are click-initiated (no unmuted hover-autoplay). Written bodies render
  server-sanitised `bodyHtml` via `{@html}` (mirrors the standalone content page).

  @prop {JourneyPractice} practice - The open practice.
  @prop {string} courseTitle - Course title (breadcrumb + footer + overview link).
  @prop {string} stageName - The practice's stage name (breadcrumb + "why").
  @prop {string | null} stageGloss - The stage's reflective line, if any.
  @prop {string} dashboardHref - Root-relative course dashboard link.
  @prop {string | null} streamingUrl - Signed HLS URL (media); null → degraded.
  @prop {string | null} waveformUrl - Signed waveform URL (audio).
  @prop {string | null} bodyHtml - Rendered body (written); server-sanitised.
  @prop {number} initialProgressSeconds - Resume position (media).
  @prop {boolean} isComplete - Reactive completion (parent live query).
  @prop {number} playbackPercent - Reactive watch % (parent live query).
  @prop {string | null} prevHref - Previous practice, or null at the start.
  @prop {string | null} prevTitle - Previous practice title (footer label).
  @prop {string | null} nextHref - Next practice, or null at the end.
  @prop {string} nextLabel - Next affordance label (gate-crossing aware).
-->
<script lang="ts">
  import AudioPlayer from '$lib/components/AudioPlayer/AudioPlayer.svelte';
  import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CheckIcon,
    ClockIcon,
    CompassIcon,
    LibraryIcon,
  } from '$lib/components/ui/Icon';
  import VideoPlayer from '$lib/components/VideoPlayer/VideoPlayer.svelte';
  import { markPracticeComplete } from '$lib/collections';
  import type { JourneyPractice } from '$lib/journeys/types';

  interface Props {
    practice: JourneyPractice;
    courseTitle: string;
    stageName: string;
    stageGloss: string | null;
    dashboardHref: string;
    streamingUrl: string | null;
    waveformUrl: string | null;
    bodyHtml: string | null;
    initialProgressSeconds: number;
    isComplete: boolean;
    playbackPercent: number;
    prevHref: string | null;
    prevTitle: string | null;
    nextHref: string | null;
    nextLabel: string;
  }

  const {
    practice,
    courseTitle,
    stageName,
    stageGloss,
    dashboardHref,
    streamingUrl,
    waveformUrl,
    bodyHtml,
    initialProgressSeconds,
    isComplete,
    playbackPercent,
    prevHref,
    prevTitle,
    nextHref,
    nextLabel,
  }: Props = $props();

  const isMedia = $derived(
    practice.contentType === 'video' || practice.contentType === 'audio'
  );
  const isLast = $derived(nextHref === null);

  const typeLabel = $derived(
    practice.contentType === 'video'
      ? 'Video'
      : practice.contentType === 'audio'
        ? 'Audio'
        : 'Reflection'
  );
  const minutes = $derived(
    practice.durationSeconds
      ? Math.max(1, Math.round(practice.durationSeconds / 60))
      : null
  );
  const typeLine = $derived(
    minutes ? `${typeLabel} · ${minutes} min` : typeLabel
  );
  const verb = $derived(practice.contentType === 'audio' ? 'listen' : 'watch');

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
  <nav class="pane__crumb" aria-label="Breadcrumb">
    <a class="pane__crumb-link" href={dashboardHref}>{courseTitle}</a>
    <span class="pane__crumb-sep" aria-hidden="true">›</span>
    <span class="pane__crumb-stage">{stageName}</span>
    <span class="pane__crumb-sep" aria-hidden="true">›</span>
    <span class="pane__crumb-here" aria-current="page">{practice.title}</span>
  </nav>

  <span class="pane__badge">
    <span class="pane__badge-glyph" aria-hidden="true">◈</span>
    part of your journey
  </span>

  <h1 class="pane__title">{practice.title}</h1>
  <p class="pane__type">{typeLine}</p>

  {#if isMedia}
    <div class="pane__media">
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
        <!-- canView withheld the signed stream — degraded, still in-course. -->
        <div class="pane__placeholder">
          <p>This {practice.contentType} isn't available to stream right now.</p>
        </div>
      {/if}
    </div>
  {/if}

  {#if stageGloss}
    <p class="pane__why">{stageGloss}</p>
  {/if}

  {#if !isMedia}
    {#if bodyHtml}
      <!-- Server-rendered, sanitised body (mirrors the standalone content page). -->
      <div class="pane__body">
        {@html bodyHtml}
      </div>
    {:else}
      <div class="pane__placeholder pane__placeholder--body">
        <p>This reflection has no written guidance yet.</p>
      </div>
    {/if}
  {/if}

  <div class="pane__actions">
    {#if isMedia}
      <span class="pane__auto" class:pane__auto--done={isComplete}>
        {#if isComplete}
          <CheckIcon size={16} class="pane__auto-glyph" />
          Completed · your place is saved
        {:else}
          <ClockIcon size={16} class="pane__auto-glyph" />
          Saves as you {verb} · completes when you finish
        {/if}
      </span>
    {:else if isComplete}
      <span class="pane__done-pill">
        <CheckIcon size={16} /> Completed
      </span>
    {:else}
      <button type="button" class="pane__mark" onclick={handleMarkComplete}>
        <CheckIcon size={16} /> Mark complete
      </button>
    {/if}

    {#if !isLast && nextHref}
      <a class="pane__next" href={nextHref}>
        {nextLabel}
        <ArrowRightIcon size={18} class="pane__next-arrow" />
      </a>
    {/if}
  </div>

  {#if isLast}
    <!-- Peak-end: the journey closes on the last practice (SPEC §14.5). -->
    <section class="pane__complete">
      <span class="pane__seal" aria-hidden="true"><CheckIcon size={24} /></span>
      <h2 class="pane__complete-title">You've walked the whole of {courseTitle}.</h2>
      <p class="pane__complete-body">
        The ground is in you now. Return to any practice whenever you need it —
        or let the next journey find you.
      </p>
      <div class="pane__complete-row">
        <a class="pane__next" href="/explore">
          <CompassIcon size={18} /> Find your next journey
        </a>
        <a class="pane__ghost" href="/library">
          <LibraryIcon size={18} /> Back to your library
        </a>
      </div>
    </section>
  {/if}

  <footer class="pane__foot">
    {#if prevHref}
      <a class="pane__foot-link" href={prevHref}>
        <span class="pane__foot-label"><ArrowLeftIcon size={14} /> Previous</span>
        <span class="pane__foot-title">{prevTitle}</span>
      </a>
    {:else}
      <span></span>
    {/if}
    <a class="pane__foot-link pane__foot-link--map" href={dashboardHref}>
      <span class="pane__foot-label">Back to</span>
      <span class="pane__foot-title">{courseTitle} overview</span>
    </a>
  </footer>
</article>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 48rem;
    margin-inline: auto;
    padding: var(--space-8) var(--space-6) var(--space-16);
    min-width: 0;
  }

  /* ── breadcrumb ── */
  .pane__crumb {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .pane__crumb-link {
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .pane__crumb-link:hover {
    color: var(--color-brand-primary);
  }

  .pane__crumb-sep {
    opacity: 0.5;
  }

  .pane__crumb-here {
    color: var(--color-brand-primary);
  }

  /* ── journey badge ── */
  .pane__badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 30%, transparent);
    background: color-mix(in oklab, var(--color-brand-primary) 12%, transparent);
    color: var(--color-brand-primary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .pane__title {
    margin: var(--space-3) 0 var(--space-1);
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    font-weight: var(--font-normal);
    line-height: var(--leading-tight);
    color: var(--color-heading);
    text-wrap: balance;
  }

  .pane__type {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  /* ── media / body ── */
  .pane__media {
    width: 100%;
    margin-top: var(--space-6);
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 18%, transparent);
    background: var(--color-surface-secondary);
  }

  .pane__placeholder {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-tertiary);
  }

  .pane__placeholder--body {
    aspect-ratio: auto;
    width: 100%;
    margin-top: var(--space-6);
    border-radius: var(--radius-card);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .pane__placeholder p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .pane__why {
    width: 100%;
    margin: var(--space-6) 0 0;
    padding-left: var(--space-4);
    border-left: var(--border-width-thick) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent);
    font-family: var(--font-heading);
    font-style: italic;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .pane__body {
    width: 100%;
    margin-top: var(--space-6);
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .pane__body :global(p) {
    margin: 0 0 var(--space-4);
  }

  .pane__body :global(h2),
  .pane__body :global(h3) {
    margin: var(--space-6) 0 var(--space-2);
    font-family: var(--font-heading);
    color: var(--color-heading);
  }

  /* ── actions: the single completion + Next ── */
  .pane__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-8);
  }

  .pane__mark,
  .pane__next,
  .pane__ghost,
  .pane__done-pill,
  .pane__auto {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .pane__mark {
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 28%, transparent);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .pane__mark:hover {
    border-color: var(--color-brand-primary);
  }

  .pane__mark:focus-visible,
  .pane__next:focus-visible,
  .pane__ghost:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .pane__done-pill {
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent);
    background: color-mix(in oklab, var(--color-brand-primary) 16%, transparent);
    color: var(--color-brand-primary);
  }

  .pane__next {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
    border: var(--border-width) var(--border-style) transparent;
  }

  .pane__next:hover {
    transform: translateY(-1px);
  }

  :global(.pane__next-arrow) {
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .pane__next:hover :global(.pane__next-arrow) {
    transform: translateX(3px);
  }

  .pane__ghost {
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 28%, transparent);
    color: var(--color-text);
  }

  .pane__ghost:hover {
    border-color: var(--color-brand-primary);
  }

  .pane__auto {
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
  }

  .pane__auto--done {
    border-color: color-mix(in oklab, var(--color-brand-primary) 40%, transparent);
    color: var(--color-text-secondary);
  }

  :global(.pane__auto-glyph) {
    color: var(--color-brand-primary);
  }

  /* ── peak-end completion card ── */
  .pane__complete {
    width: 100%;
    margin-top: var(--space-10);
    padding: var(--space-10) var(--space-6);
    text-align: center;
    border-radius: var(--radius-card);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-brand-primary) 28%, transparent);
    background: radial-gradient(
      120% 130% at 50% 0%,
      color-mix(in oklab, var(--color-brand-primary) 13%, transparent),
      transparent
    );
  }

  .pane__seal {
    display: grid;
    place-items: center;
    width: var(--space-16);
    height: var(--space-16);
    margin: 0 auto var(--space-4);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .pane__complete-title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    color: var(--color-heading);
    text-wrap: balance;
  }

  .pane__complete-body {
    max-width: 42ch;
    margin: var(--space-3) auto var(--space-6);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .pane__complete-row {
    display: flex;
    gap: var(--space-3);
    justify-content: center;
    flex-wrap: wrap;
  }

  /* ── footer: prev + back to overview (no second Next) ── */
  .pane__foot {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    margin-top: var(--space-10);
    padding-top: var(--space-5);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .pane__foot-link {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 48%;
    text-decoration: none;
    color: var(--color-text-secondary);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .pane__foot-link:hover {
    color: var(--color-brand-primary);
  }

  .pane__foot-link:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
    border-radius: var(--radius-sm);
  }

  .pane__foot-link--map {
    text-align: right;
    align-items: flex-end;
  }

  .pane__foot-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .pane__foot-title {
    font-size: var(--text-sm);
  }

  @media (max-width: 40rem) {
    .pane {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pane__mark,
    .pane__next,
    .pane__ghost,
    :global(.pane__next-arrow) {
      transition: none;
    }

    .pane__next:hover {
      transform: none;
    }
  }
</style>
