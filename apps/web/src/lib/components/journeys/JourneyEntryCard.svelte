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
   * The flair dropcap's character — purely decorative (the title is read out
   * right beside it), so the whole flair layer is aria-hidden.
   *
   * The source flips by layout because the two layouts put different KINDS of
   * text in `kicker`. A tile's kicker is the creator's editorial line ("A
   * twelve-practice descent"), which is per-item, so its initial is a signature.
   * A row's kicker is a TYPE label ("Portal", "Video") shared by every card of
   * that kind — taking its initial would print the same "P" on every cover-less
   * portal in the shelf. The title is per-item in both, so it leads on rows.
   */
  const flairGlyph = $derived(
    (layout === 'row'
      ? (title ?? '').trim() || (kicker ?? '').trim()
      : (kicker ?? '').trim() || (title ?? '').trim()
    )
      .charAt(0)
      .toUpperCase()
  );

  /**
   * The flair is FALLBACK TEXTURE, not a watermark — so a row that already has a
   * photograph does not get one.
   *
   * On a tile the dropcap has a 3:4 cover to itself and reads as a type
   * signature. A row's cover is a fraction of that and the badge occupies the
   * same top-left corner, so over a photo the two marks overlapped: a
   * `--text-display` glyph and the "PORTAL" pill in the same ~7rem box, with the
   * glyph's stem showing past the pill's left edge. The empty-cover case still
   * needs it — the deep brand plate alone is a blank rectangle at that size — so
   * this suppresses the collision without giving up the state it was added for.
   *
   * A string comparison, not `layout !== 'tile'`: apps/web has strictNullChecks
   * off, so string discriminants are the narrowing that actually works here.
   */
  const showFlair = $derived(!(layout === 'row' && Boolean(coverImageUrl)));

  /**
   * The bar's value, sanitised to an integer in 0–100.
   *
   * Two separate hazards, and `Math.min`/`Math.max` only handle one of them:
   *  • Out of RANGE (a rollup reporting 140) is clamped, so the fill can never
   *    paint wider than its track.
   *  • Not a NUMBER is floored to 0. Both `Math.min` and `Math.max` PROPAGATE
   *    `NaN` rather than clamping it, so a `NaN` percent would otherwise reach
   *    the DOM as `aria-valuenow="NaN"` (invalid ARIA) and `width: NaN%` (which
   *    browsers drop, silently degrading to a zero-width fill that still
   *    announces itself as a determinate bar). `Number.isFinite` also catches
   *    `Infinity` from a divide-by-zero.
   *
   * No producer can currently emit either — every one of them guards its
   * division (`total > 0 ? … : 0`) — but this expression is the stated safety
   * net for exactly that, so it should actually be one.
   */
  const percent = $derived.by(() => {
    if (!progress || !Number.isFinite(progress.percent)) return 0;
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
  });
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
    {#if showFlair}
      <div class="jec__flair" aria-hidden="true">
        <span class="jec__dropcap">{flairGlyph}</span>
      </div>
    {/if}
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
    /*
      The card's QUIET ink, for foot text that sits on the page rather than on
      the scrimmed cover (status, access chip, stat nouns, and a row's
      kicker/meta/tagline).

      It is derived from `--color-text` because that is the only text token here
      that actually INVERTS with the theme: org-brand.css computes it as
      `clamp(0.05, (0.6 - l) * 1000, 0.9)` off the brand background, so it is
      near-black on a light org and near-white on a dark one. Every other quiet
      option is a FIXED grey — `--color-text-secondary` is oklch(0.65) and
      `--color-text-muted` is oklch(0.55) in BOTH themes — so each one passes on
      exactly one theme and fails on the other. Measured on this org:
        secondary  3.12 light  /  ~5.5 dark
        muted      4.68 light  /  3.82 dark
      There is no existing token that is both quiet and AA in both themes, so
      rather than adding one, this mixes the inverting token back toward the page
      at 65%: ~6.4:1 in both themes, and still clearly subordinate to the title.
    */
    --jec-ink-quiet: color-mix(in oklab, var(--color-text) 65%, transparent);

    /*
      Makes the card queryable by its OWN width. `--text-3xl` is viewport-fluid
      (`clamp(…, 4.5vw, …)`), so at a 1440 viewport it is 40px whether the card
      is the 421px `/explore` tile or the 208px library rail tile — and 40px in
      208px is about two words per line. The design system's stated answer to
      exactly this is container queries ("Card adapts to its grid cell size, not
      viewport" — ContentCard), so the narrow step below uses one.

      Safe to contain: every call site sizes this card EXTERNALLY (a grid cell, a
      `flex: 0 0` rail track, or a Carousel track), so nothing depends on the
      card's width being derived from its contents.
    */
    container-type: inline-size;

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

  /*
    Imageless cover — a deep BRANDED plate.

    This was `ContentCard.cc__cover--brand`'s formula, which anchors its stops on
    `--color-surface-card`. That token is near-WHITE on a light org, so the
    gradient's top resolved to cream (#ffe0d2) and the always-on scrim was left
    to supply every bit of tonal depth from a pale base. Four measured symptoms,
    all from that one fact:
      • the ghosted dropcap was a near-white glyph on a near-white backdrop —
        1.015:1, with no letterform discernible in the render. It is the only
        thing filling the empty upper 60% of a cover-less tile, so on light orgs
        that area was simply blank.
      • the composite ran #3d3c38 → #605e59 → #8f8881 → #feddcf: charcoal mud
        rather than a colour, because a full-strength scrim over a pale base has
        nowhere else to go.
      • that charcoal bottom met the cream page at a hard horizontal edge (cards
        are transparent by default), so the tile read as a grey rectangle
        dropped on cream rather than as media.
      • the ramp crossed 3.0:1 at 62.0% up the cover while the 208px library
        tile's title block starts at 61.7% — so title LENGTH silently governed
        legibility, and one more wrapped line went illegible.

    Anchoring on a lightness-pinned brand tone fixes all four together, and it is
    the right lever rather than four patches: the scrim exists to protect text
    over a photograph we do NOT control. Over a gradient we author ourselves,
    darkening it further is redundant work whose only product is mud. Give the
    plate its own depth and the ramp goes back to merely seating the text.

    The lightness is PINNED (`oklch(from … 0.30 …)`) instead of derived from a
    theme surface, so the plate is the same depth in both themes. That is
    deliberate, and it is what the token set already assumes about media:
    `--media-glyph` is a near-white ink in BOTH themes (themes/light.css:63,
    themes/dark.css:59), which only makes sense over a dark backdrop. A media
    plate is dark in light mode for the same reason a photograph is.

    Chroma is scaled DOWN as the plate deepens so the bottom lands as a deep
    brand shadow rather than a saturated block — the text sits there.

    This layer is only ever VISIBLE when there is no photo: the `<img>` is
    `inset: 0` directly over it. So none of this can regress the covered case,
    which measures 9.65:1 and is already approved.
  */
  .jec__cover-brand {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      158deg,
      oklch(from var(--color-brand-primary) 0.32 calc(c * 0.64) h) 0%,
      oklch(from var(--color-brand-primary) 0.26 calc(c * 0.55) h) 48%,
      oklch(from var(--color-brand-primary) 0.17 calc(c * 0.4) h) 100%
    );
  }

  /* Soft off-centre accent glow so the plate reads as LIT rather than as a flat
     ramp — this is most of what separates "media" from "grey rectangle". Also
     lightness-pinned, for the same reason the plate is. */
  .jec__cover-brand::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      92% 62% at 78% 6%,
      oklch(from var(--color-brand-accent) 0.58 calc(c * 0.95) h / 0.45),
      transparent 62%
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
    /* 42%, not ContentCard's 26%. At 26% over the OLD near-white plate this
       measured 1.015:1 and no letterform was discernible; over the deep plate it
       reaches 1.83, still under the 2.16 that dark mode already ships and
       accepts. 42% clears that in both themes, and because the plate is now
       lightness-pinned the figure no longer moves with the theme. It stays
       ghosted texture — the title is the thing you read. */
    color: color-mix(in srgb, var(--media-glyph) 42%, transparent);
    user-select: none;
  }

  /* A row's cover is a fraction of a tile's, so the same 1.7×display dropcap
     would spill far past it. Scaled to the smaller box, same treatment.

     Denser ink than the tile's 42%: the row cover is short, so the scrim reaches
     ~0.47 alpha where the glyph sits (against ~0.33 on a tile) and washes the
     same ink out — measured 1.80 on a row against the tile's 2.23. 58% restores
     parity rather than letting the silhouette decide how visible the flair is. */
  .jec[data-layout='row'] .jec__dropcap {
    font-size: var(--text-display);
    color: color-mix(in srgb, var(--media-glyph) 58%, transparent);
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
     Brings its own scrim (translucent wash + blur + border) so it reads over an
     arbitrary creator-uploaded photo. `--text-xs` is the token floor — there is
     no `--text-2xs`.

     Ink is `--media-glyph` on a DARK wash, not `--color-interactive` on a
     `--color-surface` wash. The old pairing measured 3.00:1 on a light org:
     brand orange on a near-white pill fails AA, and it fought the cover it sits
     on. Everything else painted over media in this card already uses the media
     tokens; the badge was the one holdout. */
  .jec__badge {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    z-index: 4;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--media-glyph) 38%, transparent);
    /* 82%, not 72%. The badge is the one element whose backdrop is NOT the plate
       — it carries its own wash, so a photograph shows through it. Bounded
       against the two extremes a photo can be: at 72% the worst case (a
       pure-white region under the badge) measured 4.38:1 for 13px/600 text,
       marginally under the 4.5 that size needs. At 82% the worst case clears it,
       and the best case (black photo) is unaffected at ~13:1. */
    background-color: color-mix(in srgb, var(--media-scrim) 82%, transparent);
    backdrop-filter: blur(var(--blur-md));
    color: var(--media-glyph);
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

  /*
    Matches `ContentCard`'s title-in-cover title — `--text-3xl` (fluid, ≈31px
    phone → ≈40px desktop) at `--font-semibold`. This was `--text-2xl` at
    `--font-normal`: measured side by side in the SAME grid metric, 30px/w400
    against ContentCard's 40px/w600, i.e. 25% smaller and a weight step lighter
    in the same family and colour. That divergence is exactly what a shared card
    is supposed to remove.

    `--font-semibold` (600), NOT `--font-bold`: an org brand re-declares
    `--font-bold` as `var(--heading-weight, 700)` (org-brand.css:171), which
    computes to 400 on a single-weight display face. `--font-semibold` is not
    re-declared.

    The TWO-LINE CLAMP is not decoration, it is what makes 40px safe, and it is
    also copied from ContentCard (`.cc--title-in-cover[data-content-type]
    .cc__title`). Without it the first attempt at this overflowed: a 23-character
    title at 40px in a 208px tile grew a four-line block taller than the cover,
    and because the cover is `align-content: end` with `overflow: hidden` the
    block ran off the TOP and the opening words were clipped away behind the
    badge. Measured proof at the time: the title's first line reported
    `yFracUpFromCoverBottom: 1.069` — above 1.0, i.e. outside the cover entirely.
  */
  .jec__title {
    margin: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-semibold);
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

  /*
    A THREE-RUNG type ladder, queried against the CARD rather than the viewport,
    because `--text-3xl` is viewport-fluid and would otherwise hand 40px to a
    208px rail. `--text-3xl` is kept where ContentCard and this card genuinely
    share a grid (`/explore`, 26.3rem); the narrower rails step down.

    The rungs are set by MEASUREMENT, not taste. With the title clamped to two
    lines, the largest size that fits the fixture's 23-character title is:

      track   13rem → 18px      15rem → 20px      17rem → 24px
              14rem → 18px      16rem → 22px      20rem → 30px

    …so a 16rem rail can carry `--text-lg` with real margin (its ceiling is 22px)
    and still fit titles up to ~30 characters, which is the length band real
    journey names occupy. Above ~30 characters any of these truncate; that is a
    two-line clamp working, not a sizing error.

    The middle rung is defensive: without it the ladder jumps 20px → 40px at a
    single breakpoint, so any future rail at 21rem would inherit a 40px title it
    cannot fit — the exact failure this ladder exists to prevent.
  */
  @container (max-width: 26rem) {
    .jec[data-layout='tile'] .jec__title {
      font-size: var(--text-2xl);
    }
  }
  @container (max-width: 20rem) {
    .jec[data-layout='tile'] .jec__title {
      font-size: var(--text-lg);
    }
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
  /*
    THREE lines, where a tile gets two. A tile's clamp has to defend a four-child
    text stack sitting on a scrim inside a fixed-ratio cover; a row's text block
    holds two children (title, next practice) beside a cover that takes its height
    from them, so a third line costs nothing structural — the cover simply grows
    with it.

    Measured in the 248px column this row now has: 20px at two lines holds ~44
    characters, at three ~66. Real journey names sit inside 66; a 60-character
    title was clipping at two. The clamp still exists so a pathological name
    cannot make every card in the flex rail tall (siblings stretch to the
    tallest), it just stops truncating the names people actually write.
  */
  .jec[data-layout='row'] .jec__title {
    font-size: var(--text-lg);
    color: var(--color-text);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  /*
    A row's text block holds two things (title, then the next practice), so it
    gets a real gap between them rather than the tile's `--space-1`, which was
    tuned for a four-child stack sitting on a scrim.
  */
  .jec[data-layout='row'] .jec__text {
    gap: var(--space-1-5);
  }

  /*
    Two lines, not one ellipsis. The base rule is `nowrap` + `text-overflow`,
    which suits a tile's meta (a short credit line, "Guided by …") but on the
    resume row the meta is the card's most USEFUL line — the name of the practice
    you are about to open — and it was arriving as "Next · Soul Path Ment…" after
    16 characters.

    Two lines of `--text-sm` in this column measures ~68 characters INCLUDING the
    "Next · " prefix, so it is a bound, not unlimited: a practice title past ~60
    characters still clips. That is a deliberate stopping point rather than a
    solved problem — the card lives in a flex rail whose siblings stretch to the
    tallest, so an unbounded meta would let one wordy practice name inflate every
    card on the shelf.
  */
  .jec[data-layout='row'] .jec__meta {
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: clip;
    line-height: var(--leading-normal);
  }

  /*
    ONE LINE, always. A row's kicker is a type label, so it fits — but this is a
    shared component and the prop is a free string, so the clamp is what stops a
    future call site passing an editorial sentence and silently reintroducing the
    three-line block that broke this layout. Ellipsis rather than clip so a long
    one reads as shortened rather than as a rendering fault.
  */
  .jec[data-layout='row'] .jec__kicker {
    color: var(--jec-ink-quiet);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* On a ROW these sit on the card, not on the scrimmed cover, so they take
     the theme-inverting quiet ink rather than a fixed grey. `-secondary`
     measured 3.12:1 on cream; `-muted` fixed that but measured 3.82:1 on dark.
     See `--jec-ink-quiet`. */
  .jec[data-layout='row'] .jec__tagline,
  .jec[data-layout='row'] .jec__meta {
    color: var(--jec-ink-quiet);
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
    gap: var(--space-2);
  }

  /*
    Tighter than it was (`--space-4/5/5` padding, `--space-3` gap). The foot was
    7.72rem against a 17.21rem cover on the 208px library tile, which is what
    drove that rail to ~25rem tall. Nothing was removed — the status line, the
    access chip and the price/CTA row are all still there — the vertical rhythm
    just stopped being generous enough for a full-width panel on a 208px card.
  */
  .jec[data-layout='tile'] .jec__foot {
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .jec[data-layout='row'] .jec__foot {
    margin-top: var(--space-3);
    gap: var(--space-2);
  }

  /* `align-items: baseline` so the status text and the chip's label sit on one
     optical line when they DO fit; `center` floated the chip against the text. */
  .jec__facts {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  /* A flex row of segments, not one sentence. */
  .jec__stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
    color: var(--jec-ink-quiet);
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

  /* The theme-inverting quiet ink — see `--jec-ink-quiet`. `-secondary` measured
     3.12:1 on cream and `-muted` 3.82:1 on dark, so neither fixed grey works in
     both themes. (The secondary token's own light-theme value is tracked
     separately as Codex-k7yum; this only declines to add a NEW failing surface.) */
  .jec__status {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--jec-ink-quiet);
  }

  /*
    Neutral chip. Deliberately ONE style for every access source — a per-source
    palette is the per-type accent colour the neutral-palette decision rejects;
    the label already carries the meaning.

    It now has a chip's own SHAPE. `--color-border-subtle` measured 1.2:1 against
    the cream page — an invisible outline, so on the 208px tile (where the chip
    necessarily wraps below the status line) the label read as an orphaned word
    mysteriously indented by its own padding rather than as a chip. Geometry
    confirmed the wrap is a genuine wrap, not a misalignment: the chip's box is
    flush with the status text above it (`indentDeltaPx: 0`); only its inner
    padding shifted the glyphs. `--color-border` plus a faint surface fill makes
    the boundary visible, so the padding reads as intentional.
  */
  .jec__access {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    /*
      Derived from the card's quiet ink, not from a `--color-border-*` token.
      Measured on cream: `--color-border-subtle` gives 1.20:1 and `--color-border`
      only 1.44:1 — both invisible, which is what made the label read as a stray
      word. The border tokens are tuned for panel edges on a surface, not for a
      hairline that has to survive on the page itself. Mixed off the inverting ink
      the outline clears 3:1 in BOTH themes: clearly a chip, still quiet.

      No background fill: a 5% wash was tried and it pushed the chip's own 13px
      label from 4.68:1 to 4.19:1, i.e. it fixed the outline by breaking the text.
      The outline alone is what the shape needed.
    */
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 45%, transparent);
    font-size: var(--text-xs);
    line-height: var(--leading-tight);
    color: var(--jec-ink-quiet);
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
    color: var(--jec-ink-quiet);
  }

  /* `--color-interactive-active`, not `--color-interactive`. The raw brand
     (#EA580C) on the cream page measured 3.43:1 — a sub-AA pair for a 15px CTA.
     `-active` is the same hue at `calc(l - 0.15)` on light and `calc(l + 0.15)`
     on dark, so it moves AWAY from the page in BOTH themes: 6.39:1 on cream, and
     it stays unmistakably brand rather than going neutral. That two-directional
     behaviour is why it is the right token here and `--color-text` is not —
     `--color-text` would pass at 20:1 and stop reading as a CTA. */
  .jec__go {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-interactive-active);
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
    /*
      A floor, not a height. Two lines of `--text-lg` title + two of `--text-sm`
      meta + the CTA is the tallest a resume row goes, and the rail's flex
      `stretch` already equalises siblings — so this only stops a one-line title
      from collapsing the stretched cover into a letterbox sliver.
    */
    min-height: 9rem;
  }

  /*
    THE COVER SPANS THE ROW'S FULL HEIGHT.

    Grid items already default to `align-self: stretch`, so the fix is the
    ABSENCE of `aspect-ratio` rather than any new property: `aspect-ratio: 4 / 3`
    was resolving the cover's height FROM its width, which pinned a 9rem cover to
    6.75rem tall inside a grid row that the text beside it had grown to ~19rem.
    The cover then sat at the top of a box three times its height — the "image out
    of alignment with the text" this fixes. Unpinned, the cover's top and bottom
    edges track the text block's at every content length, which is the only way
    this holds for creator-authored copy of unknown size.

    `object-fit: cover` on the photo (`.jec__cover-img`) means the resulting
    shape — portrait when the text is tall, squarer when short — always crops
    rather than distorts.

    Narrower than the old 9rem, too. On the library's resume track the cover was
    taking 144px of a 352px card: 41% of the inner width for a thumbnail, which
    left the text column 160px. At 7.5rem the same card gives the text ~248px.
  */
  .jec[data-layout='row'] .jec__cover {
    width: clamp(6rem, 22vw, 7.5rem);
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
