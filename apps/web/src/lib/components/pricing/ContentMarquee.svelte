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

  ── Why no TILE is focusable, and why there is exactly ONE button ────────
  A moving target is hostile to click, and a duplicated track would double
  every tab stop and everything a screen reader reads out. Both problems
  disappear if the tiles carry no links. The duplicate group therefore needs
  only `aria-hidden`, with no `inert`/`tabindex="-1"` sweep to keep in sync.

  That is a rule about the TILES, not about the band. Motion that starts by
  itself and runs longer than five seconds needs a pause mechanism (WCAG 2.2.2
  Pause, Stop, Hide, Level A), and `:hover` is not one: a touchscreen never
  hovers, so on a phone an unpausable band would loop forever with no way out.
  `prefers-reduced-motion` does not discharge 2.2.2 either — it only serves
  people who already opted out globally, not the person who wants THIS row to
  stop. So the band carries one stationary `<button>`, outside the moving
  track: one predictable tab stop instead of 18 moving ones, which is also
  what finally gives `:focus-within` below something to catch.

  The button swaps its icon and its accessible NAME rather than carrying
  `aria-pressed`. That is the APG media-control convention (a "Pause" control
  that becomes a "Resume" control), and it avoids the doubled announcement
  "Pause, pressed" that a toggle role produces. Deliberate — please don't
  re-litigate it into `aria-pressed`.

  ── The mask lives on an inner window, not on the root ───────────────────
  The edge-fade mask must not fade the pause button, and `mask-image` applies
  to the whole element including its controls. So `.marquee` is a bare
  positioning context and `.marquee__window` does the clipping and fading.

  @prop {T[]} items - Items to render. Order is preserved.
  @prop {Snippet<[T, number]>} renderItem - Renders one item. MUST NOT contain
        focusable elements — see above.
  @prop {string} ariaLabel - Accessible name for the band.
  @prop {string} itemWidth - Track cell width (CSS length; a token or rem value).
  @prop {string} class - Forwarded to the root, so a caller can own the band's
        width, margin or grid placement without reaching in with `:global()`.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import * as m from '$paraglide/messages';
  import { PauseIcon, PlayIcon } from '$lib/components/ui/Icon';

  interface Props {
    items: T[];
    renderItem: Snippet<[T, number]>;
    ariaLabel: string;
    itemWidth?: string;
    class?: string;
  }

  const {
    items,
    renderItem,
    ariaLabel,
    itemWidth = '13rem',
    class: className,
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

  /** User-driven stop. Only meaningful on the drifting branch. */
  let paused = $state(false);

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
  <div
    class="marquee {className ?? ''}"
    role="group"
    aria-label={ariaLabel}
    data-drifting={drifting}
    data-paused={paused}
  >
    <div class="marquee__window">
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

    {#if drifting}
      <button
        type="button"
        class="marquee__pause"
        onclick={() => (paused = !paused)}
        aria-label={paused ? m.marquee_resume() : m.marquee_pause()}
      >
        {#if paused}
          <PlayIcon size={16} />
        {:else}
          <PauseIcon size={16} />
        {/if}
      </button>
    {/if}
  </div>
{/if}

<style>
  .marquee {
    /* Bare positioning context for the pause button. The clipping and the
       edge fade live on `.marquee__window` so the mask cannot fade the
       control — see the header comment. */
    position: relative;
  }

  .marquee__window {
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

  /* Nothing continues past either edge on the static branch — the row IS the
     whole set — so a fade there would promise items that do not exist, and
     would clip the outer tiles of a centred row that exactly fits. */
  .marquee[data-drifting='false'] .marquee__window {
    mask-image: none;
    -webkit-mask-image: none;
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
    width: 100%;
  }

  /* The static branch exists FOR sparse orgs (1–3 published items), which
     means it is the branch most likely to be read on a phone. A single
     non-wrapping row of definite 13rem cells is 432px at two items and 656px
     at three — both wider than a 390px viewport's ~343px column — and the
     window's `overflow: hidden` offers no wheel, no touch pan and no
     focusable child, so anything past the edge would be unreachable by
     everyone rather than merely awkward (WCAG 1.4.10 Reflow). Wrapping keeps
     every tile whole: one per row on a phone, one centred row on a desktop.
     The seam padding is dropped too — there is no second group to separate,
     and it would push the centred row half a gap off-centre. */
  .marquee__track--static .marquee__group {
    flex-wrap: wrap;
    justify-content: center;
    row-gap: var(--space-4);
    width: 100%;
    padding-inline-end: 0;
  }

  .marquee__track--static .marquee__cell {
    /* Still a definite basis (see `.marquee__cell`), but allowed to shrink and
       never wider than the column, so a column narrower than one cell gets a
       narrower tile instead of a cropped one. */
    flex: 0 1 var(--_marquee-cell-width, 13rem);
    max-width: 100%;
  }

  /* Hovering or tabbing anywhere near the band stops it, so a pointer never
     has to chase anything and the pause button's own focus ring is not dragged
     out from under the user. `:focus-within` is NOT dead: the pause button is
     the focusable descendant it catches.

     `[data-paused]` is the WCAG 2.2.2 mechanism — the only one that works on a
     touchscreen, which cannot hover. */
  .marquee:hover .marquee__track,
  .marquee:focus-within .marquee__track,
  .marquee[data-paused='true'] .marquee__track {
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

  /* Sits over the top-right tile rather than in a row of its own: the band is
     one of several sections stacked at `--space-16` and an extra control row
     would read as a new section. Same size, shape and surface treatment as
     `Carousel`'s arrows so the two rails one below the other match — but
     NEVER hidden below `--breakpoint-md` the way those arrows are, because
     touch is exactly the input that has no hover fallback. */
  .marquee__pause {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-shadow);
    backdrop-filter: blur(var(--blur-sm));
    -webkit-backdrop-filter: blur(var(--blur-sm));
  }

  .marquee__pause:hover {
    background: var(--color-surface);
    box-shadow: var(--shadow-md);
  }

  .marquee__pause:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* IconBase paints `fill: none; stroke: currentColor`, which renders the
     pause bars as two hairline outlines at 16px. Solid reads as a glyph. */
  .marquee__pause :global(svg) {
    fill: currentColor;
    stroke: none;
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
     both stops the ticking and restores the designed 0% frame.

     With the band genuinely still, a pause control has nothing to act on and
     would only be one more thing to tab past, so it goes away with the
     motion. WCAG 2.2.2 is satisfied here by the absence of motion. */
  @media (prefers-reduced-motion: reduce) {
    .marquee__track {
      animation: none;
    }

    .marquee__pause {
      display: none;
    }
  }

  /* The button's surface is translucent + blurred; honour an OS request to
     drop that, the way the pricing page does for its own glass surfaces. */
  @media (prefers-reduced-transparency: reduce) {
    .marquee__pause {
      background: var(--color-surface);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }
</style>
