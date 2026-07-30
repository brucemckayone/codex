<!--
  @component JourneyEntryCard

  THE journey entry card (Codex-tnwnu, absorbing Codex-ycsd8 delta L). One
  treatment for every surface that offers a way INTO a journey: the org landing
  carousel, the /explore rail, the library "Your journeys" shelf, the library
  "Jump back in" resume strip, and the dashboard threshold. Those five each had
  their own card — five silhouettes, five cover treatments, three of them with a
  per-card tone gradient — which is what this replaces.

  ── COVER ANATOMY (conformance to Codex-p7wc8) ────────────────────────────────
  Copied from `ContentCard`'s shipped title-in-cover variant, deliberately
  byte-for-byte where it matters, so a journey cover and a content cover on the
  SAME page read as one system:

    1. `.jec__cover-brand`  a brand-tinted gradient, ALWAYS painted.
    2. `.jec__cover-img`    the photo, promoted ON TOP of it when there is one.
    3. `.jec__flair`        the ghosted dropcap — the journey's type signature.
    4. `.jec__scrim`        the shared scrim ramp (identical stops to
                            `ContentCard.cc--title-in-cover .cc__body`).
    5. text / progress / badge above all of it.

  Painting the gradient FIRST and unconditionally is load-bearing: a 404, or a
  no-JS / pre-hydration load failure, degrades to the gradient with no handler
  and no layout shift, and a cover-less journey gets the same treatment as a
  covered one rather than a different card.

  The ramp is likewise unconditional. `JourneyRailCard` used to gate it behind
  `--imaged`, which meant the cover-less card had no ramp and its overlaid text
  sat on a raw gradient — two treatments again.

  ── FLAIR, NOT A CENTRED LETTER ───────────────────────────────────────────────
  `JourneyCard` centred the kicker's initial as a fallback glyph, i.e. it was
  visible ONLY when there was no photo. Journeys are none of `ContentCard`'s
  audio/video/article types, so they have no waveform or play-ring of their own —
  the oversized ghosted dropcap (ContentCard's article idiom) becomes theirs, and
  it renders on EVERY card, photo or not. The character derivation is unchanged:
  the kicker's initial, falling back to the title's.

  `--font-semibold` deliberately, not `--font-bold`: under an org brand
  `--font-bold` is re-declared as `var(--heading-weight, 700)` and computes to
  400 for single-weight display faces (Archivo Black), which would silently
  un-weight the dropcap.

  ── PROGRESS IS DETERMINATE AND ALWAYS VISIBLE ────────────────────────────────
  Enrolled entries carry a real progress bar along the cover's bottom edge, over
  the scrim so it reads on photo and gradient alike. Never hover-gated (hover is
  not a gesture), never animated, and exposed as a `progressbar` naming the
  journey. Discover entries have no bar at all.

  ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────
   • No per-card tone gradient (`.ember`/`.blood`/`.clay`, and the library's
     title-hash tone). Per-type/per-card accent colour contradicts the neutral
     palette decision AND disappears on dark org brands; ratio + layout carry
     the type signal.
   • No always-on card background. Cards are transparent until hover; `featured`
     is where chrome belongs.
   • No serif. There is no `--font-serif` token, so a serif tagline would have to
     be hardcoded and would fight per-org brand fonts. `--font-heading` (which
     resolves through `--brand-font-heading`) is the editorial voice here.
   • No hover preview (text fade + shimmer sweep + animated scrub). The
     determinate bar above replaces it.
   • No duration stat. No course-level rollup exists yet — `durationSeconds`
     lives on practices only.

  Presentational. Callers build `href` (cross-org-aware) and project their DTO
  through the mappers in `./journey-entry-card`.
-->
<script lang="ts">
  import { formatPrice } from '$lib/utils/format';
  import type { JourneyEntryCardProps } from './journey-entry-card';

  const {
    href,
    title,
    kicker = null,
    tagline = null,
    meta = null,
    coverImageUrl = null,
    layout = 'tile',
    featured = false,
    badge = null,
    stats = [],
    progress = null,
    priceCents = null,
    membershipLabel = null,
    accessLabel = null,
    cta = 'View portal',
  }: JourneyEntryCardProps = $props();

  const priceLabel = $derived(
    priceCents != null ? formatPrice(priceCents) : null
  );

  /**
   * The flair dropcap's character — the kicker's initial, falling back to the
   * title's. Purely decorative (the title is read out right beside it), so the
   * whole flair layer is aria-hidden.
   */
  const flairGlyph = $derived(
    ((kicker ?? '').trim() || (title ?? '').trim()).charAt(0).toUpperCase()
  );

  /** Clamped so a bad rollup can never paint a bar wider than its track. */
  const percent = $derived(
    progress ? Math.max(0, Math.min(100, Math.round(progress.percent))) : 0
  );
</script>

{#snippet textBlock()}
  <div class="jec__text">
    {#if kicker}
      <span class="jec__kicker">{kicker}</span>
    {/if}
    <h3 class="jec__title">{title}</h3>
    {#if tagline}
      <p class="jec__tagline">{tagline}</p>
    {/if}
    {#if meta}
      <p class="jec__meta">{meta}</p>
    {/if}
  </div>
{/snippet}

{#snippet foot()}
  <div class="jec__foot">
    {#if stats.length > 0 || progress?.label || accessLabel}
      <div class="jec__facts">
        {#if stats.length > 0}
          <p class="jec__stats">
            {#each stats as segment (segment.label)}
              <span class="jec__stat">
                <b class="jec__stat-value">{segment.value}</b>
                {segment.label}
              </span>
            {/each}
          </p>
        {/if}
        {#if progress?.label}
          <p class="jec__status">{progress.label}</p>
        {/if}
        {#if accessLabel}
          <span class="jec__access">{accessLabel}</span>
        {/if}
      </div>
    {/if}

    <div class="jec__cta">
      {#if priceLabel}
        <span class="jec__price">{priceLabel}</span>
      {:else if membershipLabel}
        <span class="jec__membership">{membershipLabel}</span>
      {/if}
      <span class="jec__go">
        {cta}
        <span class="jec__arrow" aria-hidden="true">&rarr;</span>
      </span>
    </div>
  </div>
{/snippet}

<a class="jec" {href} data-layout={layout} class:jec--featured={featured}>
  <div class="jec__cover">
    <!-- ALWAYS painted, so a missing / broken / not-yet-loaded photo degrades
         to the gradient with no handler and no layout shift. -->
    <div class="jec__cover-brand"></div>
    {#if coverImageUrl}
      <img
        class="jec__cover-img"
        src={coverImageUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
    {/if}
    <div class="jec__flair" aria-hidden="true">
      <span class="jec__dropcap">{flairGlyph}</span>
    </div>
    <!-- Unconditional: the ramp is part of the cover, not a photo affordance. -->
    <div class="jec__scrim" aria-hidden="true"></div>

    {#if badge}
      <span class="jec__badge">{badge}</span>
    {/if}

    {#if layout === 'tile'}
      {@render textBlock()}
    {/if}

    {#if progress}
      <div
        class="jec__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="{title} progress"
      >
        <span class="jec__progress-fill" style="width: {percent}%"></span>
      </div>
    {/if}
  </div>

  {#if layout === 'row'}
    <div class="jec__body">
      {@render textBlock()}
      {@render foot()}
    </div>
  {:else}
    {@render foot()}
  {/if}
</a>

<style>
  /* ── Card shell ───────────────────────────────────────────────────────────
     Transparent by default; hover lifts and fills. The prototype's always-on
     background lives on `--featured` instead, which is the standing decision
     ("cards are transparent by default, hero/featured earn chrome"). */
  .jec {
    position: relative;
    display: grid;
    height: 100%;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    border-radius: var(--radius-xl);
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

  .jec:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .jec:focus-visible {
    outline: var(--border-width-thick) var(--border-style) var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .jec--featured {
    background: var(--color-surface);
    border-color: var(--color-border-strong);
  }

  /* ── Cover ────────────────────────────────────────────────────────────────
     `aspect-ratio` (never a fixed height) reserves the cover's space in every
     state, so covered and cover-less cards are exactly the same size and a
     mixed rail never jumps. */
  .jec__cover {
    position: relative;
    display: grid;
    align-content: end;
    overflow: hidden;
  }

  .jec[data-layout='tile'] .jec__cover {
    /* 3:4 portrait — the same ratio `ContentCard` uses for its browse tiles
       (`shape='3:4'`), so journeys and content share one grid rhythm. */
    aspect-ratio: 3 / 4;
  }

  /* Shared imageless cover — the brand-tinted gradient standing in for a
     photograph, lifted from `ContentCard.cc__cover--brand` so both card
     families fall back identically. Re-themes per org via the brand + scrim
     tokens. */
  .jec__cover-brand {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      158deg,
      color-mix(in oklab, var(--color-brand-primary) 26%, var(--color-surface-card))
        0%,
      color-mix(in oklab, var(--color-brand-primary) 12%, var(--color-surface-card))
        34%,
      color-mix(in oklab, var(--media-scrim) 40%, var(--color-surface-card)) 66%,
      var(--media-scrim) 100%
    );
  }

  /* Soft off-centre accent glow so the cover reads as lit, not a flat ramp. */
  .jec__cover-brand::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      90% 60% at 78% 8%,
      color-mix(in srgb, var(--color-brand-accent) 26%, transparent),
      transparent 60%
    );
  }

  .jec__cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* ── Flair ────────────────────────────────────────────────────────────────
     The journey's type signature: an oversized ghosted dropcap top-left,
     drawn over the cover but BEHIND the scrim ramp. Decorative, so
     aria-hidden and never a pointer target. */
  .jec__flair {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    overflow: hidden;
  }

  .jec__dropcap {
    position: absolute;
    left: -0.04em;
    top: -0.12em;
    font-family: var(--font-heading);
    /* NOT --font-bold: an org brand re-declares that as var(--heading-weight)
       and it computes to 400 on single-weight display faces. */
    font-weight: var(--font-semibold);
    font-size: calc(var(--text-display) * 1.7);
    line-height: var(--leading-none);
    color: color-mix(in srgb, var(--media-glyph) 26%, transparent);
    user-select: none;
  }

  /* A row's cover is a fraction of a tile's, so the same 1.7×display dropcap
     would spill far past it. Scaled to the smaller box, same treatment. */
  .jec[data-layout='row'] .jec__dropcap {
    font-size: var(--text-display);
  }

  /* ── Scrim ramp ───────────────────────────────────────────────────────────
     IDENTICAL stops to `ContentCard.cc--title-in-cover .cc__body` and to the
     ramp `JourneyRailCard` already used. Do not "improve" the stops — matching
     them is the entire point. */
  .jec__scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: linear-gradient(
      to top,
      var(--media-scrim),
      color-mix(in srgb, var(--media-scrim) 70%, transparent) 45%,
      color-mix(in srgb, var(--media-scrim) 35%, transparent) 75%,
      transparent 100%
    );
  }

  /* ── Overlay badge ────────────────────────────────────────────────────────
     Brings its own scrim (translucent surface wash + blur + border) so it
     reads over an arbitrary creator-uploaded photo. `--text-xs` is the token
     floor — there is no `--text-2xs`. */
  .jec__badge {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 4;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-interactive) 45%, transparent);
    background-color: color-mix(in oklab, var(--color-surface) 65%, transparent);
    backdrop-filter: blur(var(--blur-md));
    color: var(--color-interactive);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  /* ── Progress ─────────────────────────────────────────────────────────────
     Determinate, always visible, no animation. Above the scrim so it reads
     over both a photograph and the gradient. */
  .jec__progress {
    position: absolute;
    inset: auto 0 0;
    z-index: 3;
    height: var(--space-1);
    background: color-mix(in oklab, var(--media-glyph) 22%, transparent);
  }

  .jec__progress-fill {
    display: block;
    height: 100%;
    background: var(--color-interactive);
  }

  /* ── Text ─────────────────────────────────────────────────────────────────
     On a tile the text block is a CHILD of the cover, sitting on the ramp. On
     a row it lives beside the cover — a 4:3 thumbnail cannot legibly hold a
     title, and forcing one in would be fidelity at the cost of readability. */
  .jec__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .jec[data-layout='tile'] .jec__text {
    position: relative;
    z-index: 3;
    padding: var(--space-5);
  }

  .jec__kicker {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .jec__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-normal);
    line-height: var(--leading-tight);
    /*
      Titles are creator-authored, so one unbroken word must not widen the tile.
      `anywhere` rather than `break-word` deliberately: only `anywhere` also
      shrinks the intrinsic MIN-CONTENT size, which is what the grid/carousel
      track measures.
    */
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .jec__tagline {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    /* Clamp to two lines so a long lede never unbalances a rail of cards. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .jec__meta {
    margin: 0;
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Overlaid text uses --media-glyph (near-white, brand-tinted) rather than the
     theme's --color-text, so it never renders dark-on-dark over the scrim on a
     light org — the same reasoning as `ContentCard`'s title-in-cover. */
  .jec[data-layout='tile'] .jec__title {
    color: var(--media-glyph);
  }

  .jec[data-layout='tile'] .jec__kicker,
  .jec[data-layout='tile'] .jec__tagline,
  .jec[data-layout='tile'] .jec__meta {
    color: color-mix(in srgb, var(--media-glyph) 78%, transparent);
  }

  /* A row's text sits on the CARD, not on the cover, so it takes the page's
     own text tokens. */
  .jec[data-layout='row'] .jec__title {
    font-size: var(--text-lg);
    color: var(--color-text);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .jec[data-layout='row'] .jec__kicker {
    color: var(--color-text-muted);
  }

  .jec[data-layout='row'] .jec__tagline,
  .jec[data-layout='row'] .jec__meta {
    color: var(--color-text-secondary);
  }

  .jec[data-layout='row'].jec--featured .jec__title {
    font-size: var(--text-2xl);
  }

  /* ── Foot ─────────────────────────────────────────────────────────────────
     No divider — the cover-to-foot run is continuous, and `margin-top: auto`
     on the CTA does the separating. A border here cut the card into panels. */
  .jec__foot {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .jec[data-layout='tile'] .jec__foot {
    padding: var(--space-4) var(--space-5) var(--space-5);
  }

  .jec[data-layout='row'] .jec__foot {
    margin-top: var(--space-3);
    gap: var(--space-2);
  }

  .jec__facts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
  }

  /* A flex row of segments, not one sentence. */
  .jec__stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  /*
    The numeral carries the weight, the noun stays quiet.

    `--color-text`, NOT `--color-text-secondary`: muted/secondary are
    distance-from-mid-grey formulas whose relative ORDER flips between themes,
    so on a light org the "emphasised" numeral came out lighter than the noun it
    outranks. `--color-text` tracks the theme properly, so the numeral is the
    more prominent of the pair either way. jsdom cannot catch that — it does not
    resolve oklch — which is why it is verified in a browser, not in a test.
  */
  .jec__stat-value {
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .jec__status {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  /* Neutral chip. Deliberately ONE style for every access source — a
     per-source palette is the per-type accent colour the neutral-palette
     decision rejects; the label already carries the meaning. */
  .jec__access {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .jec__cta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: auto;
  }

  .jec__price {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
  }

  .jec__membership {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .jec__go {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
  }

  .jec__arrow {
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .jec:hover .jec__arrow {
    transform: translateX(var(--space-1));
  }

  /* A featured row is a page's THRESHOLD (the dashboard's one way back in), so
     its CTA earns a filled pill rather than a text link. */
  .jec--featured .jec__go {
    align-self: flex-start;
    padding: var(--space-2-5) var(--space-5);
    border-radius: var(--radius-full);
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  /* ── Row silhouette ───────────────────────────────────────────────────────
     Cover in column 1, everything else beside it. Same cover LAYERS as the
     tile, at a smaller ratio — the shared treatment is what makes a resume
     strip and a browse tile one system; an identical silhouette is not. */
  .jec[data-layout='row'] {
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-4);
    align-content: stretch;
    padding: var(--space-4);
  }

  .jec[data-layout='row'] .jec__cover {
    width: clamp(6.5rem, 24vw, 9rem);
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-lg);
  }

  .jec[data-layout='row'].jec--featured .jec__cover {
    width: clamp(7.5rem, 30vw, 12.5rem);
  }

  .jec[data-layout='row'] .jec__body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  @media (--below-sm) {
    .jec[data-layout='row'] {
      grid-template-columns: minmax(0, 1fr);
    }

    .jec[data-layout='row'] .jec__cover {
      width: 100%;
      aspect-ratio: 16 / 9;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .jec,
    .jec__arrow {
      transition: none;
    }

    .jec:hover {
      transform: none;
    }

    .jec:hover .jec__arrow {
      transform: none;
    }
  }
</style>
