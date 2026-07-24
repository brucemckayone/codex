<!--
  @component JourneyCard

  A journey DISCOVERY / LIBRARY card (Codex-oi2w4). Renders a published
  course-journey as a typographic tile — a "Journey" badge, kicker → title →
  tagline hierarchy, and a curriculum-stats + price-or-progress foot.

  Journeys read DIFFERENTLY from content cards (SPEC §8.5: price · lessons ·
  "journey" affordance). The distinction is carried by LAYOUT + typography, not a
  per-type colour: no cover image, no hardcoded tone gradient (which would vanish
  on dark org brands). Transparent-by-default; the accent badge + hover border are
  the only brand touch, via theme-/brand-aware semantic tokens.

  Presentational: the caller builds `href` (cross-org-aware via `buildJourneyUrl`)
  and supplies the resolved card. `progress` (present → the enrolled variant)
  swaps the price affordance for a progress ring + status line.
-->
<script lang="ts">
  import ProgressRing from '$lib/components/journeys/ProgressRing.svelte';
  import type { EnrolledJourneyCard, JourneyCardView } from '$lib/page-builder';
  import { formatPrice } from '$lib/utils/format';

  interface Props {
    journey: JourneyCardView;
    /** Destination URL — the caller builds it (cross-org-aware). */
    href: string;
    /**
     * Enrolled progress rollup. When set, the foot renders a progress ring +
     * status line ("N of M practices" / "Completed" / "Not started yet")
     * instead of the price + "View portal" affordance.
     */
    progress?: {
      percent: number;
      status: EnrolledJourneyCard['status'];
      completedPractices: number;
      totalPractices: number;
    };
  }

  const { journey, href, progress }: Props = $props();

  const priceLabel = $derived(
    journey.priceCents != null ? formatPrice(journey.priceCents) : null
  );

  // "N stages · M practices" — singular-aware; a stageless draft shows practices
  // only (defensive, though a published journey normally has stages).
  const statsLabel = $derived(
    [
      journey.stageCount > 0
        ? `${journey.stageCount} ${journey.stageCount === 1 ? 'stage' : 'stages'}`
        : null,
      `${journey.practiceCount} ${
        journey.practiceCount === 1 ? 'practice' : 'practices'
      }`,
    ]
      .filter(Boolean)
      .join(' · ')
  );

  const statusLabel = $derived.by(() => {
    if (!progress) return null;
    if (progress.status === 'completed') return 'Completed';
    if (progress.status === 'not-started') return 'Not started yet';
    return `${progress.completedPractices} of ${progress.totalPractices} practices`;
  });
</script>

<a class="journey-card" {href} class:journey-card--enrolled={Boolean(progress)}>
  <div class="journey-card__head">
    <span class="journey-card__badge">Portal</span>
    {#if journey.kicker}
      <span class="journey-card__kicker">{journey.kicker}</span>
    {/if}
    <h3 class="journey-card__title">{journey.title}</h3>
    {#if journey.tagline}
      <p class="journey-card__tagline">{journey.tagline}</p>
    {/if}
  </div>

  <div class="journey-card__foot">
    {#if statsLabel}
      <p class="journey-card__stats">{statsLabel}</p>
    {/if}

    {#if progress}
      <div class="journey-card__progress">
        <ProgressRing
          percent={progress.percent}
          size="var(--space-10)"
          ariaLabel="{progress.percent}% complete"
        />
        <span class="journey-card__status">{statusLabel}</span>
      </div>
    {:else}
      <div class="journey-card__cta">
        <span class="journey-card__price">
          {#if priceLabel}
            {priceLabel}
          {:else}
            <span class="journey-card__membership">Membership</span>
          {/if}
        </span>
        <span class="journey-card__go">
          View portal
          <span class="journey-card__arrow" aria-hidden="true">&rarr;</span>
        </span>
      </div>
    {/if}
  </div>
</a>

<style>
  .journey-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: transparent;
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    transition:
      transform var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default),
      background-color var(--duration-fast) var(--ease-default);
  }

  .journey-card:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .journey-card:focus-visible {
    outline: var(--border-width-thick) var(--border-style) var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .journey-card__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-5);
    flex: 1;
  }

  .journey-card__badge {
    align-self: flex-start;
    margin-bottom: var(--space-2);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-interactive) 45%, transparent);
    color: var(--color-interactive);
    font-size: var(--text-2xs, var(--text-xs));
    font-weight: var(--font-semibold, var(--font-medium));
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .journey-card__kicker {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .journey-card__title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--font-semibold, var(--font-bold));
    line-height: var(--leading-tight, 1.2);
    color: var(--color-text-primary);
  }

  .journey-card__tagline {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal, 1.5);
    color: var(--color-text-secondary);
    /* Clamp to two lines so a long lede never unbalances a rail of cards. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .journey-card__foot {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) var(--space-5);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .journey-card__stats {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .journey-card__cta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .journey-card__price {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold, var(--font-medium));
    color: var(--color-text-primary);
  }

  .journey-card__membership {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .journey-card__go {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
  }

  .journey-card__arrow {
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .journey-card:hover .journey-card__arrow {
    transform: translateX(var(--space-1));
  }

  .journey-card__progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .journey-card__status {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  @media (prefers-reduced-motion: reduce) {
    .journey-card,
    .journey-card__arrow {
      transition: none;
    }

    .journey-card:hover {
      transform: none;
    }
  }
</style>
