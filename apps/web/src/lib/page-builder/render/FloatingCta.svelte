<!--
  @component FloatingCta

  Persistent bottom-centre conversion pill for the public journey sales page —
  the real-token equivalent of the prototype's `.floatcta`. It is parked
  off-screen and slides up once the reader passes the first viewport, giving an
  always-available "begin" affordance that follows them down the long page.

  PROGRESSIVE ENHANCEMENT. The markup renders on the server (so hydration
  matches), starts hidden + `inert`, and the slide is a pure CSS transform gated
  on `.is-shown`. Only a real, top-level visitor arms the scroll listener — the
  studio builder renders this component inside a preview iframe, where it stays
  parked off-screen and inert so it never covers the builder chrome or fights
  its own scroll. Under reduced motion it snaps in without the slide.

  IT YIELDS TO THE REAL OFFER. Two conditions, not one: past the fold AND the
  page's own conversion section is not on screen. The pill's whole justification
  is being a stand-in for a CTA the reader cannot currently see, so it has no
  business covering the offer itself — see `shown` below for what it was doing
  before.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CtaLink from './CtaLink.svelte';

  interface Props {
    /** Navigation target — checkout (pre-purchase) or dashboard (enrolled). */
    href: string;
    /** Short lead-in copy, e.g. the course title. */
    label: string;
    /** CTA button text. */
    ctaText: string;
    /**
     * The element the pill must not cover, as a selector. Default: the `invite`
     * section — the page's actual conversion moment.
     *
     * A SELECTOR rather than a bound element because the pill is a LATER SIBLING
     * of `SectionRenderer`'s whole output: it has no reference to any section, and
     * threading one up through the section loop would put presentation state into
     * the render context for one consumer. Pass `''` to opt out entirely.
     */
    hideWhenVisible?: string;
  }

  const {
    href,
    label,
    ctaText,
    hideWhenVisible = '[data-section-type="invite"]',
  }: Props = $props();

  /** Past the first viewport — the reader has left the hero's own CTA behind. */
  let pastFold = $state(false);
  /** The real offer is on screen, so the stand-in stands down. */
  let yielding = $state(false);

  /*
    `shown` was `window.scrollY > window.innerHeight * 0.5` and NOTHING ever
    unset it, so the pill stayed up for the entire remainder of the page —
    including the very bottom, where the `invite` section lives. It is
    `position: fixed; bottom: var(--space-5); z-index: var(--z-fixed)` and paints
    above every section, which produced two real collisions:

      1. on a phone it sat over the bottom of the invite offers grid and its
         `CtaLink`s — the page's actual conversion controls;
      2. the `invite: sticky` composition pins its own action bar at
         `position: sticky; bottom: var(--space-4); z-index: 2`, inside `.jp-sec`'s
         ISOLATED stacking context — so it loses to the pill regardless of the
         `2`, and the reader gets two overlapping bottom-anchored "join"
         affordances about 4px apart.
  */
  const shown = $derived(pastFold && !yielding);

  onMount(() => {
    // Real top-level visitors only. In the studio builder's preview iframe
    // (`window.self !== window.top`) the pill stays parked + inert.
    if (window.self !== window.top) return;

    let ticking = false;
    const update = () => {
      ticking = false;
      pastFold = window.scrollY > window.innerHeight * 0.5;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update();

    // Guarded exactly as `reveal.ts` guards its own observer: no
    // IntersectionObserver (or no such element on the page — a journey with no
    // `invite` section) falls back to the fold test alone, which is today's
    // behaviour rather than a permanently hidden pill.
    let observer: IntersectionObserver | undefined;
    const target = hideWhenVisible
      ? document.querySelector(hideWhenVisible)
      : null;
    if (target && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) yielding = entry.isIntersecting;
        },
        // Threshold 0 with a POSITIVE bottom margin, which grows the root
        // DOWNWARD: the pill retreats just before the offer scrolls into view
        // rather than after it, so the two are never on screen together even for
        // one frame. A negative bottom margin would do the opposite — delay the
        // yield until the offer was already partly under the pill.
        { threshold: 0, rootMargin: '0px 0px 12% 0px' }
      );
      observer.observe(target);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  });
</script>

<div class="floatcta" class:is-shown={shown} inert={!shown}>
  <span class="floatcta__copy">{label}</span>
  <CtaLink {href} size="md">{ctaText}</CtaLink>
</div>

<style>
  /* ── HOLDING CANDLELIT'S TWO ACCENT ROLES OFF, DELIBERATELY ────────────────
     `JourneyRenderer` now publishes the page look's `data-jp-accent` on
     `.journey-palette--page`, so this pill finally obeys the accent axis — it
     previously sat outside every `.jp-sec` and fell back to the raw
     `--color-brand-primary`.

     Wiring it in moves NEITHER the fill nor the ink on Candlelit: at
     `accent: glow` `--jp-accent-fill` is `#A62B0C` and the old raw fallback
     painted `rgb(166,43,12)` — the same pixel, measured through a canvas. But
     two roles WOULD newly land, because the fallback chain was hiding them: a
     45%-ember `--jp-accent-edge` border and the `--jp-accent-glow-mark` bloom.

     They are pinned back to what the pill renders today so that Candlelit — and
     the published pages, which carry no page design at all and so match no
     `[data-jp-accent]` block — are byte-identical across this change. That is a
     deliberate choice to keep one variable at a time, NOT a judgement that the
     pill should never glow: giving the page's most persistent affordance
     Candlelit's own bloom is arguably the axis finally arriving where it
     matters. Deleting this rule is how you turn it on, and it is an owner call
     rather than a side effect.

     KEYED ON `glow`, NOT ON THE PILL. The pin was first written on `.floatcta`
     itself, which took the edge away at all FIVE accent values — and
     `--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`
     (journey-design.css). So on the three looks carrying those at PAGE level —
     long-read and open-air (`text`), syllabus (`edge`) — the pill's CTA had a
     transparent fill AND a transparent border: no shape at all, a label
     indistinguishable from the secondary copy beside it. That is the one thing
     `CtaLink` is pinned never to do ("an outline needs an edge, or the
     transparent variants have no shape", journey-design.test.ts). Candlelit is
     the only preset whose PAGE accent is `glow`, so keying the pin on that
     value holds the benchmark byte-for-byte and lets the other four values
     paint the edge their own axis row declares — `--jp-line` at `text`/`none`,
     ember at `fill`/`edge`, i.e. the same border the in-section CTAs of that
     look already carry. The glow half never bit anywhere else either: the
     `text`/`fill`/`edge`/`none` blocks each declare
     `--jp-accent-glow-mark: none` themselves. */
  :global([data-jp-accent='glow']) .floatcta {
    --jp-accent-edge: transparent;
    --jp-accent-glow-mark: none;
  }

  .floatcta {
    position: fixed;
    left: 50%;
    bottom: var(--space-5);
    z-index: var(--z-fixed);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: calc(100vw - var(--space-8));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-lg));
    -webkit-backdrop-filter: blur(var(--blur-lg));
    box-shadow: var(--shadow-xl);
    /* Parked below the fold; slides up when `.is-shown`. */
    transform: translate(-50%, 200%);
    transition: transform var(--duration-slow) var(--ease-out);
  }

  .floatcta.is-shown {
    transform: translate(-50%, 0);
  }

  .floatcta__copy {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (--below-sm) {
    .floatcta {
      padding: var(--space-2);
    }
    .floatcta__copy {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .floatcta {
      transition: none;
    }
  }
</style>
