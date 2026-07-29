<!--
  @component JourneyCard

  A journey DISCOVERY / LIBRARY card (Codex-oi2w4). Renders a published
  course-journey as a typographic tile — a "Journey" badge, kicker → title →
  tagline hierarchy, and a curriculum-stats + price-or-progress foot.

  Journeys read DIFFERENTLY from content cards (SPEC §8.5: price · lessons ·
  "journey" affordance). The distinction is carried by LAYOUT + typography, not a
  per-type colour — no hardcoded tone gradient (which would vanish on dark org
  brands). Transparent-by-default; the accent badge + hover border are the only
  brand touch, via theme-/brand-aware semantic tokens.

  PROTOTYPE CONFORMANCE (Codex-ycsd8). The reference is `.jcard` in
  `docs/design/course-journeys/prototype/explore.html`, which is where that card's
  anatomy is DEFINED (1-threshold.html only consumes it). Closed against it: a
  large/light title (1.7rem @ 400, not a small bold UI label), .2em kicker
  tracking, stats as segments with the NUMERAL emphasised, no foot divider, the
  badge as an overlay pill on the cover, and a weight-600 CTA.

  Three prototype traits are DELIBERATELY not reproduced, and the reasons are
  load-bearing — do not "restore fidelity" without reading them:
   • Tone gradients (`.jcard__cover.ember/.blood/.clay`) — per-card accent colour
     contradicts the neutral-palette decision; aspect ratio + layout carry type.
   • An always-on card background — cards are transparent until hover. The
     prototype's chrome lives on the `--featured` variant instead, which is what
     `JourneyCardView.featured` is for.
   • An italic-SERIF tagline and price — the token set has no `--font-serif`
     (only sans/heading/mono, both brand-overridable), so a serif here would have
     to be hardcoded and would fight per-org brand fonts.

  COVER (Codex-eqh0z): `journey.coverImageUrl` renders a fixed-ratio cover band.
  The band reserves its space with `aspect-ratio` whether or not there is an
  image, so a cover-less journey shows the typographic fallback — a quiet
  surface-tinted plate carrying the kicker's initial — at EXACTLY the same height.
  A rail of mixed covered/uncovered cards therefore never jumps, and the fallback
  is neutral: no per-journey accent, no tone palette.

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

  // Curriculum stats as SEGMENTS rather than one joined string, so the numeral
  // can carry the emphasis and the noun stay quiet — the prototype's
  // `<b>24</b> practices` reading (explore.html `.jcard__stats b`). Singular-aware;
  // a stageless draft shows practices only (defensive — a published journey
  // normally has stages).
  //
  // Built imperatively rather than with `.filter(Boolean)`: apps/web has
  // strictNullChecks OFF, so a filtered array of `T | null` does not narrow.
  const statSegments = $derived.by(() => {
    const segments: { value: number; label: string }[] = [];
    if (journey.stageCount > 0) {
      segments.push({
        value: journey.stageCount,
        label: journey.stageCount === 1 ? 'stage' : 'stages',
      });
    }
    segments.push({
      value: journey.practiceCount,
      label: journey.practiceCount === 1 ? 'practice' : 'practices',
    });
    return segments;
  });

  const statusLabel = $derived.by(() => {
    if (!progress) return null;
    if (progress.status === 'completed') return 'Completed';
    if (progress.status === 'not-started') return 'Not started yet';
    return `${progress.completedPractices} of ${progress.totalPractices} practices`;
  });

  // The fallback plate's glyph — the title's first character. Purely decorative
  // (the title is read out right below it), so the plate is aria-hidden.
  const fallbackGlyph = $derived(
    (journey.kicker?.trim() || journey.title.trim()).charAt(0).toUpperCase()
  );
</script>

<a
  class="journey-card"
  {href}
  class:journey-card--enrolled={Boolean(progress)}
  class:journey-card--featured={journey.featured}
>
  <!--
    The band is ALWAYS rendered so its reserved height is identical with and
    without a cover — that is what keeps a mixed rail from shifting.

    The badge sits ON the band (prototype `.jcard__tag`, absolutely placed top-left)
    rather than above the kicker. It carries its own scrim — a translucent surface
    wash plus a backdrop blur and a border — so it stays legible over an arbitrary
    creator-uploaded photo, which a plain-coloured pill would not.
  -->
  <div class="journey-card__cover">
    <span class="journey-card__badge">Portal</span>
    {#if journey.coverImageUrl}
      <img
        class="journey-card__cover-img"
        src={journey.coverImageUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
    {:else}
      <span class="journey-card__cover-glyph" aria-hidden="true">
        {fallbackGlyph}
      </span>
    {/if}
  </div>

  <div class="journey-card__head">
    {#if journey.kicker}
      <span class="journey-card__kicker">{journey.kicker}</span>
    {/if}
    <h3 class="journey-card__title">{journey.title}</h3>
    {#if journey.tagline}
      <p class="journey-card__tagline">{journey.tagline}</p>
    {/if}
  </div>

  <div class="journey-card__foot">
    {#if statSegments.length > 0}
      <p class="journey-card__stats">
        {#each statSegments as segment (segment.label)}
          <span class="journey-card__stat">
            <b class="journey-card__stat-value">{segment.value}</b>
            {segment.label}
          </span>
        {/each}
      </p>
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

  /*
    The prototype's `.jcard` always carries a background (`ink-2 @ 55%`), which
    contradicts the standing decision that cards are transparent by default and
    only hero/featured tiles earn chrome. `JourneyCardView.featured` already
    exists in the DTO and the card was ignoring it — so the featured tile is
    where the prototype's chrome belongs, and a browsing tile stays transparent.
  */
  .journey-card--featured {
    background: var(--color-surface);
    border-color: var(--color-border-strong);
  }

  /* ── Cover band ───────────────────────────────────────────────────────────
     `aspect-ratio` (not a fixed height) reserves the band's space in BOTH
     states, so the covered and cover-less variants are exactly the same height
     and a mixed rail never shifts. Neutral surface tint only — no per-journey
     accent (a `color-mix(brand, transparent)` plate disappears on dark orgs). */
  .journey-card__cover {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background-color: var(--color-surface-secondary);
    border-bottom: var(--border-width) var(--border-style)
      var(--color-border-subtle);
  }

  .journey-card__cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .journey-card__cover-glyph {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-semibold);
    line-height: 1;
    color: var(--color-text-muted);
  }

  .journey-card__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-5);
    flex: 1;
  }

  /*
    Overlay badge (prototype `.jcard__tag`: absolute, top-left of the cover).
    It must read over a creator-uploaded photo, so it brings its own scrim —
    a translucent surface wash + backdrop blur + border — exactly the prototype's
    approach, rather than relying on the image being dark enough.
    `--text-2xs` does not exist in the token set; `--text-xs` is the floor.
  */
  .journey-card__badge {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 1;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-interactive) 45%, transparent);
    background-color: color-mix(
      in oklab,
      var(--color-surface) 65%,
      transparent
    );
    backdrop-filter: blur(var(--blur-md));
    color: var(--color-interactive);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  /* Prototype `.jcard__cover .kk` tracks at .2em — much wider than the 0.08em
     this had, and that openness is most of the card's editorial voice. */
  .journey-card__kicker {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  /*
    Prototype `.jcard__cover h3` is 1.7rem at weight 400 — LARGE and LIGHT. This
    was --text-xl semibold, i.e. smaller and heavier, which read as a UI label
    rather than a title. `--text-2xl` clamps 1.5→1.875rem, bracketing 1.7rem.
  */
  .journey-card__title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-normal);
    line-height: var(--leading-tight);
    color: var(--color-text-primary);
    /*
      Titles are creator-authored, so one unbroken word must not widen the tile.
      `anywhere` rather than `break-word` deliberately: only `anywhere` also
      shrinks the intrinsic MIN-CONTENT size, which is what the grid/carousel
      track measures. Verified: a 44-character unbroken title overflowed the card
      by 368px before this, and the larger --text-2xl title made that likelier.
    */
    overflow-wrap: anywhere;
  }

  .journey-card__tagline {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    /* Clamp to two lines so a long lede never unbalances a rail of cards. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /*
    No divider. The prototype's `.jcard__body` runs continuously from the cover to
    the foot — the `margin-top: auto` on `.jcard__foot` does the separating. A
    border-top here cut the card into three stacked panels.
  */
  .journey-card__foot {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-5) var(--space-5);
  }

  /* Prototype `.jcard__stats`: a flex row of segments, not one sentence. */
  .journey-card__stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /*
    `.jcard__stats b` — the numeral carries the weight, the noun stays quiet.

    `--color-text`, NOT `--color-text-secondary`. Measured in a real browser on a
    light-background org: the label's `--color-text-muted` resolves to oklch 0.55
    in BOTH themes, while `--color-text-secondary` lands at 0.611 dark / 0.65
    light — so on a light page the "emphasised" numeral came out LIGHTER than the
    noun it is supposed to outrank, i.e. the emphasis inverted. `--color-text`
    tracks the theme properly (0.9 dark / 0.05 light), so the numeral is the more
    prominent of the pair either way. jsdom cannot catch this — it does not
    resolve oklch — which is why it is asserted in the browser, not in the test.
  */
  .journey-card__stat-value {
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .journey-card__cta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .journey-card__price {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
  }

  .journey-card__membership {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  /* Prototype `.jcard__go` is weight 600 — the CTA is the card's loudest text
     after the title, and --font-medium under-sold it. */
  .journey-card__go {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
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
