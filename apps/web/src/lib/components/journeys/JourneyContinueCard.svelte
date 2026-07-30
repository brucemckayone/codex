<!--
  @component JourneyContinueCard

  The single "threshold" back into the course (SPEC §8.3 continue-where-left-off,
  prototype `course-dashboard.html` `.cont`). One tap to resume: a media plate
  (play/read glyph + overall %) beside the state-aware framing (Begin / Resume /
  Revisit) and the practice's stage + medium + duration.

  Presentational — the parent resolves WHICH practice to resume to and the
  journey state; this component only renders the threshold. Colours read the
  portal palette re-pointed by the dashboard root, so it stays legible and
  brand-reactive on the warm/dark surface.
-->
<script lang="ts">
  import { ArrowRightIcon, EditIcon, PlayIcon } from '$lib/components/ui/Icon';
  import {
    practiceKindLabel,
    practiceMinutes,
    stageNumeral,
  } from '$lib/journeys/practice-display';
  import type { PracticeContentType } from '$lib/journeys/types';

  interface Props {
    href: string;
    title: string;
    contentType: PracticeContentType;
    stageName: string;
    /** Zero-based stage position, for the roman numeral in the meta row. */
    stageIndex: number;
    durationSeconds: number | null;
    /** Overall course completion 0–100 (the plate badge). */
    percent: number;
    /** Journey state → framing + CTA verb. */
    state: 'begin' | 'resume' | 'revisit';
  }

  const {
    href,
    title,
    contentType,
    stageName,
    stageIndex,
    durationSeconds,
    percent,
    state,
  }: Props = $props();

  const minutes = $derived(practiceMinutes(durationSeconds));
  const isWritten = $derived(contentType === 'written');

  const eyebrow = $derived(
    state === 'begin'
      ? 'Begin your journey'
      : state === 'revisit'
        ? "You've walked this whole journey"
        : 'Continue where you left off'
  );
  const cta = $derived(
    state === 'begin' ? 'Begin' : state === 'revisit' ? 'Revisit' : 'Resume'
  );

  const meta = $derived(
    [
      `Stage ${stageNumeral(stageIndex)}`,
      stageName,
      practiceKindLabel(contentType),
      minutes ? `${minutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  );
</script>

<a class="cont" {href}>
  <div class="cont__media" aria-hidden="true">
    <span class="cont__play">
      {#if isWritten}
        <EditIcon size={22} />
      {:else}
        <PlayIcon size={22} fill="currentColor" />
      {/if}
    </span>
    <span class="cont__pct">{percent}%</span>
  </div>

  <div class="cont__body">
    <p class="cont__eyebrow">{eyebrow}</p>
    <h2 class="cont__title">{title}</h2>
    <p class="cont__meta">{meta}</p>
    <span class="cont__cta">
      {cta}
      <span class="cont__arrow"><ArrowRightIcon size={16} /></span>
    </span>
  </div>
</a>

<style>
  .cont {
    display: flex;
    gap: var(--space-5);
    align-items: stretch;
    padding: var(--space-4);
    border-radius: var(--radius-xl, var(--radius-lg));
    text-decoration: none;
    background: color-mix(in oklab, var(--portal-ember) 9%, var(--portal-surface));
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--portal-ember) 30%, transparent);
    box-shadow: 0 var(--space-5) var(--space-16) calc(-1 * var(--space-8))
      color-mix(in oklab, var(--portal-ember) 55%, var(--portal-bg-deep));
    transition:
      transform var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out);
  }

  .cont:hover {
    transform: translateY(calc(-1 * var(--space-0-5)));
    border-color: color-mix(in oklab, var(--portal-ember) 55%, transparent);
  }

  .cont:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .cont__media {
    flex: none;
    width: clamp(7.5rem, 30vw, 12.5rem);
    border-radius: var(--radius-lg);
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: radial-gradient(
      130% 120% at 50% 0%,
      color-mix(in oklab, var(--portal-ember-soft) 45%, var(--portal-surface-2)),
      var(--portal-bg-deep)
    );
  }

  .cont__play {
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: var(--portal-ember-ink);
    background: color-mix(in oklab, var(--portal-ember) 92%, var(--portal-text));
    box-shadow: 0 var(--space-2) var(--space-6) calc(-1 * var(--space-1))
      color-mix(in oklab, var(--portal-ember) 70%, var(--portal-bg-deep));
  }

  .cont__pct {
    position: absolute;
    bottom: var(--space-2);
    left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--portal-text-dim);
    background: color-mix(in oklab, var(--portal-bg-deep) 70%, transparent);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-variant-numeric: tabular-nums;
  }

  .cont__body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-2) var(--space-2) var(--space-2) 0;
    min-width: 0;
  }

  .cont__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--portal-ember-text);
  }

  .cont__title {
    margin: var(--space-1) 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
    color: var(--portal-text);
  }

  .cont__meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--portal-text-faint);
  }

  .cont__cta {
    margin-top: var(--space-4);
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-full);
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--portal-ember-ink);
    background: linear-gradient(
      180deg,
      var(--portal-ember),
      var(--portal-ember-soft)
    );
  }

  .cont__arrow {
    display: inline-flex;
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .cont:hover .cont__arrow {
    transform: translateX(var(--space-1));
  }

  @media (--below-sm) {
    .cont {
      flex-direction: column;
    }

    .cont__media {
      width: 100%;
      aspect-ratio: 16 / 8;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cont,
    .cont__arrow {
      transition: none;
    }

    .cont:hover {
      transform: none;
    }
  }
</style>
