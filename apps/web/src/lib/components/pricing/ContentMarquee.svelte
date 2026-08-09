<!--
  @component ContentMarquee

  A single row of items that drifts continuously sideways and never ends —
  the "proof band" on the pricing page's catalogue section.

  ── Why this is not the shared `Carousel` ───────────────────────────────
  `lib/components/carousel/Carousel.svelte` is purely user-driven: an
  `overflow-x: auto` track with `scroll-snap-type: x mandatory`, arrows and
  `onfocusin` scroll-into-view. It has no timer, no rAF loop and no item
  duplication, so a seamless loop is not expressible in it — and its
  mandatory scroll-snap would fight a transform animation. Rather than teach
  a scroll container to animate itself, the two behaviours stay separate:
  `Carousel` for rails the visitor drives (the portals rail right below this
  band uses it verbatim), this component for a band that drives itself.

  ── Why a CSS animation and not requestAnimationFrame ───────────────────
  A CSS `animation` on `transform` is time-based, so it runs at the same
  perceived speed on a 60Hz laptop and a 120Hz phone. A per-frame JS
  decrement would drift at double speed on the latter (04-motion.md §4).
  There is also nothing to schedule, so there is no loop to tear down.

  ── Seamlessness ────────────────────────────────────────────────────────
  The track holds TWO identical groups and translates by exactly -50%, so the
  frame at 100% is pixel-identical to the frame at 0%. Each group repeats the
  item list `reps` times (`reps > 1` only for very short lists) so one group
  is always at least as wide as the widest viewport — otherwise the second
  group would run out and leave a visible gap at the loop point.

  ── Why nothing inside is focusable ─────────────────────────────────────
  A moving target is hostile to click, and a duplicated track would double
  every tab stop and everything a screen reader reads out. Both problems
  disappear if the band carries no links. The duplicate group therefore needs
  only `aria-hidden`, with no `inert`/`tabindex="-1"` sweep to keep in sync.

  @prop {T[]} items - Items to render. Order is preserved.
  @prop {Snippet<[T, number]>} renderItem - Renders one item. MUST NOT contain
        focusable elements — see above.
  @prop {string} ariaLabel - Accessible name for the band.
  @prop {string} itemWidth - Track cell width (CSS length; a token or rem value).
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  interface Props {
    items: T[];
    renderItem: Snippet<[T, number]>;
    ariaLabel: string;
    itemWidth?: string;
  }

  const {
    items,
    renderItem,
    ariaLabel,
    itemWidth = '13rem',
  }: Props = $props();

  /**
   * Cells one group must contain before it is wide enough to cover the widest
   * viewport on its own. At the default 13rem cell plus its gap that is
   * ~1500px — comfortably past the page's 72rem content column, and past a
   * full-width 1440 viewport if this is ever used outside it.
   */
  const MIN_CELLS_PER_GROUP = 7;

  /**
   * Below this many DISTINCT items an endless-scroll illusion is a lie the
   * content cannot support: the band would show the same two photographs six
   * times over. Those orgs get a static, centred row instead — honest, and it
   * still reads as one row of the same tiles.
   */
  const MIN_ITEMS_FOR_DRIFT = 4;

  const drifting = $derived(items.length >= MIN_ITEMS_FOR_DRIFT);

  /** How many times the item list repeats inside ONE group. */
  const reps = $derived(
    items.length > 0
      ? Math.max(1, Math.ceil(MIN_CELLS_PER_GROUP / items.length))
      : 1
  );

  /** Cells per group — drives the duration so px/second stays constant. */
  const cellsPerGroup = $derived(items.length * reps);

  /** `reps` as an iterable for the template. */
  const repIndices = $derived(Array.from({ length: reps }, (_, i) => i));
</script>

{#if items.length > 0}
  <div class="marquee" role="group" aria-label={ariaLabel}>
    {#if drifting}
      <div class="marquee__track" style:--_marquee-cells={cellsPerGroup}>
        <!-- Group 1: the real, announced content. -->
        <div class="marquee__group">
          {#each repIndices as rep (rep)}
            {#each items as item, i (`${rep}-${i}`)}
              <div class="marquee__cell" style:--_marquee-cell-width={itemWidth}>
                {@render renderItem(item, i)}
              </div>
            {/each}
          {/each}
        </div>
        <!-- Group 2: the seam. Identical pixels, hidden from AT. -->
        <div class="marquee__group" aria-hidden="true">
          {#each repIndices as rep (rep)}
            {#each items as item, i (`${rep}-${i}`)}
              <div class="marquee__cell" style:--_marquee-cell-width={itemWidth}>
                {@render renderItem(item, i)}
              </div>
            {/each}
          {/each}
        </div>
      </div>
    {:else}
      <!-- Too few items to loop honestly — one static, centred row. -->
      <div class="marquee__track marquee__track--static">
        <div class="marquee__group">
          {#each items as item, i (i)}
            <div class="marquee__cell" style:--_marquee-cell-width={itemWidth}>
              {@render renderItem(item, i)}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .marquee {
    /* Clips the overflowing track. Deliberately NOT a full-bleed `vw`
       breakout: every `vw` unit counts the scrollbar gutter, so a `vw` band
       inside the padded page column overflows the document by the gutter width
       (base.css §horizontal overflow, and the 40px scroll commit a2b74fc4
       fixed). The mask below implies continuation instead. */
    overflow: hidden;
    /* Edge fade so the band reads as a window onto something longer rather
       than a row that stops. Same ramp as the /explore rail. */
    --_marquee-fade: var(--space-8);
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--_marquee-fade),
      black calc(100% - var(--_marquee-fade)),
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--_marquee-fade),
      black calc(100% - var(--_marquee-fade)),
      transparent 100%
    );
  }

  .marquee__track {
    display: flex;
    /* Sized by content, not by the clipping parent, so the two groups sit
       side by side instead of squeezing into one viewport width. */
    width: max-content;

    /* ── Duration ──────────────────────────────────────────────────────
       Per-CELL, not per-track, so pixels-per-second is constant: 5 items do
       not whizz past while 29 crawl.

       The motion scale tops out at --duration-slowest (800ms) — three orders
       of magnitude short of a minute-long drift — and `styles/tokens/*` is
       owned by an earlier round, so rather than add a global token this
       derives the per-cell time from an existing one (01-tokens.md §9
       sanctions `var()` arithmetic against existing tokens; §7 sanctions the
       `--_*` private prefix). --duration-slower is 500ms, so × 8 = 4s per
       cell ≈ 56px/second at the default cell width: calm enough to sit under
       a Subscribe CTA without competing with it. */
    --_marquee-cell-duration: calc(var(--duration-slower) * 8);
    animation: marquee-drift
      calc(var(--_marquee-cell-duration) * var(--_marquee-cells)) linear
      infinite;
  }

  .marquee__track--static {
    /* No loop to run, and no second group to translate against — a -50%
       slide here would push the only group half out of frame. */
    animation: none;
    justify-content: center;
    width: 100%;
  }

  /* Hovering or tabbing anywhere near the band stops it, so a pointer never
     has to chase anything and a focus ring inside a future tile would not be
     dragged out from under the user. */
  .marquee:hover .marquee__track,
  .marquee:focus-within .marquee__track {
    animation-play-state: paused;
  }

  .marquee__group {
    display: flex;
    gap: var(--space-4);
    /* Separates the two groups by exactly one gap, so the seam spacing
       matches the spacing inside a group. */
    padding-inline-end: var(--space-4);
  }

  .marquee__cell {
    /* DEFINITE width. `flex: 0 0 auto` would size each cell to its content's
       max-content width, which leaks the thumbnail's intrinsic resolution and
       gives one row cards of different widths (the bug the shared Carousel
       documents at .carousel__item). */
    flex: 0 0 var(--_marquee-cell-width, 13rem);
    display: flex;
    flex-direction: column;
  }

  .marquee__cell > :global(*) {
    flex: 1 1 auto;
    min-height: 0;
  }

  @keyframes marquee-drift {
    from {
      transform: translateX(0);
    }
    to {
      /* Exactly one group. The frame here is identical to `from`. */
      transform: translateX(-50%);
    }
  }

  /* The global collapse in motion.css sets `animation-duration: 0.01ms
     !important` on every element, which stops the band LOOKING like it moves
     — but measured, the animation stays `running` with an advancing
     currentTime, so a compositor animation ticks forever on the machine of
     the person who asked for stillness, and the band freezes at an arbitrary
     mid-slide offset (a half-cut card at the left edge). `animation: none`
     both stops the ticking and restores the designed 0% frame. */
  @media (prefers-reduced-motion: reduce) {
    .marquee__track {
      animation: none;
    }
  }
</style>
