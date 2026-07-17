<!--
  @component FeatureCarousel

  A full-bleed "Editor's picks" carousel: one large editorial feature slide per
  view (image underlay → scrim → eyebrow/kind → title → description → CTA), a row
  of dots underneath, and an IntersectionObserver that keeps the active dot in
  sync with whichever slide is in view.

  Distinct from `Carousel.svelte` (grid rail + arrows): slides are bespoke,
  full-width editorial panels and navigation is dot-driven, so this lives beside
  the grid carousel rather than extending it.

  SSR-safe: the server renders every slide plus the dot row with dot 0 active.
  The IntersectionObserver and scroll handlers only attach after mount (guarded
  by `$app/environment`'s `browser`), so with JS disabled the component degrades
  to a plain horizontally scroll-snapping strip — no layout shift, no dead JS.

  Full-bleed is a layout concern of the parent (WP-11 assembly gives it the
  edge-to-edge width); the track fills 100% of whatever width it is handed.

  @prop {FeatureItem[]} items - Features to render. `< 2` shows a single static
    slide (or nothing when empty) with no dot row.
  @prop {string} ariaLabel - Accessible label for the carousel region.
  @prop {string} ctaLabel - Decorative call-to-action shown on each slide. The
    real click target is the whole-slide title anchor; the CTA is aria-hidden.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import type { FeatureItem } from './feature-carousel.types';

  interface Props {
    items: FeatureItem[];
    ariaLabel?: string;
    ctaLabel?: string;
  }

  const { items, ariaLabel = "Editor's picks", ctaLabel = 'Explore' }: Props =
    $props();

  let trackEl = $state<HTMLDivElement | null>(null);
  let activeIndex = $state(0);

  const hasCarousel = $derived(items.length > 1);

  /**
   * Scroll a slide into view and optimistically claim the active dot. The dot
   * is set synchronously (not left to the IntersectionObserver) so keyboard /
   * click activation reflects immediately — the observer then keeps it honest
   * as the user free-scrolls.
   */
  function goTo(index: number) {
    activeIndex = index;
    if (!browser || !trackEl) return;
    const slide =
      trackEl.querySelectorAll<HTMLElement>('.feature-carousel__slide')[index];
    if (!slide) return;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slide.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }

  // Active-dot sync. Observe each slide against the track; the slide crossing
  // the 0.6 threshold becomes active (0.6 not 0.5 so two half-visible slides at
  // mid-snap don't both claim active — mirrors Spotlight's threshold choice).
  // Browser-guarded and torn down on cleanup so re-renders / unmount don't leak
  // observers. Re-runs when `items` or `trackEl` change.
  $effect(() => {
    if (!browser || !trackEl || !hasCarousel) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const slides = Array.from(
      trackEl.querySelectorAll<HTMLElement>('.feature-carousel__slide')
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          const idx = slides.indexOf(entry.target as HTMLElement);
          if (idx !== -1) activeIndex = idx;
        }
      },
      { root: trackEl, threshold: 0.6 }
    );
    for (const slide of slides) observer.observe(slide);

    return () => observer.disconnect();
  });
</script>

{#if items.length > 0}
  <section
    class="feature-carousel"
    aria-roledescription="carousel"
    aria-label={ariaLabel}
  >
    <div class="feature-carousel__track" bind:this={trackEl}>
      {#each items as item, index (item.id)}
        <article
          class="feature-carousel__slide"
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${items.length}`}
        >
          <div
            class="feature-carousel__media"
            class:feature-carousel__media--fallback={!item.image}
          >
            {#if item.image}
              <img src={item.image} alt="" loading="lazy" />
            {/if}
          </div>
          <div class="feature-carousel__scrim" aria-hidden="true"></div>
          <div class="feature-carousel__body">
            {#if item.kind}
              <p class="feature-carousel__eyebrow">{item.kind}</p>
            {/if}
            <h3 class="feature-carousel__title">
              <a href={item.href}>{item.title}</a>
            </h3>
            {#if item.description}
              <p class="feature-carousel__desc">{item.description}</p>
            {/if}
            {#if ctaLabel}
              <span class="feature-carousel__cta" aria-hidden="true">
                {ctaLabel} &rarr;
              </span>
            {/if}
          </div>
        </article>
      {/each}
    </div>

    {#if hasCarousel}
      <div class="feature-carousel__dots">
        {#each items as item, index (item.id)}
          <button
            type="button"
            class="feature-carousel__dot"
            aria-label={`Go to feature ${index + 1}`}
            aria-current={activeIndex === index ? 'true' : undefined}
            onclick={() => goTo(index)}
          ></button>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .feature-carousel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* Horizontal scroll-snap strip. Scrollbar hidden — dots are the affordance. */
  .feature-carousel__track {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    border-radius: var(--radius-card);
    -webkit-overflow-scrolling: touch;
  }

  .feature-carousel__track::-webkit-scrollbar {
    display: none;
  }

  .feature-carousel__slide {
    position: relative;
    flex: 0 0 100%;
    scroll-snap-align: center;
    display: flex;
    align-items: flex-end;
    min-height: clamp(20rem, 44vh, 28.75rem);
    border-radius: var(--radius-card);
    border: var(--border-width) var(--border-style) var(--color-border);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  .feature-carousel__media {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .feature-carousel__media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Imageless slides get a branded gradient rather than collapsing to a flat
     panel — keeps the editorial weight on any org theme. */
  .feature-carousel__media--fallback {
    background:
      radial-gradient(
        90% 120% at 22% 40%,
        var(--color-brand-primary-subtle),
        transparent 70%
      ),
      linear-gradient(
        150deg,
        var(--color-surface-elevated),
        var(--color-surface)
      );
  }

  /* Legibility scrim built from --media-scrim so overlaid text keeps AA
     contrast on any brand (WP-7). Vertical fade anchors the bottom-left text;
     the diagonal pass reinforces the left column where the body sits. */
  .feature-carousel__scrim {
    position: absolute;
    inset: 0;
    z-index: 1;
    background:
      linear-gradient(
        to top,
        var(--media-scrim),
        color-mix(in srgb, var(--media-scrim) 70%, transparent) 45%,
        color-mix(in srgb, var(--media-scrim) 30%, transparent) 75%,
        transparent
      ),
      linear-gradient(
        105deg,
        color-mix(in srgb, var(--media-scrim) 65%, transparent) 0%,
        transparent 55%
      );
  }

  .feature-carousel__body {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: min(92%, 38rem);
    padding: var(--space-8);
    /* Overlaid text uses --media-glyph (near-white, brand-tinted) so it never
       renders dark-on-dark over the scrim on a light org. */
    color: var(--media-glyph);
  }

  .feature-carousel__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    /* Accent-tinted glyph — carries the brand while staying readable. */
    color: color-mix(in srgb, var(--color-brand-accent) 55%, var(--media-glyph));
  }

  .feature-carousel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: clamp(var(--text-3xl), 4.5vw, var(--text-display));
    line-height: var(--leading-tight);
    color: var(--media-glyph);
  }

  .feature-carousel__title a {
    color: inherit;
    text-decoration: none;
  }

  /* Whole-slide click target — one anchor, one focus stop. Mirrors ContentCard:
     the title link stretches over the entire slide via ::after. */
  .feature-carousel__title a::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
  }

  .feature-carousel__title a:hover {
    color: color-mix(in srgb, var(--media-glyph) 80%, var(--color-brand-accent));
  }

  .feature-carousel__title a:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
    border-radius: var(--radius-sm);
  }

  .feature-carousel__desc {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: color-mix(in srgb, var(--media-glyph) 82%, transparent);
    /* Cap at two lines so a long summary never crowds the slide. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Decorative affordance (aria-hidden). The accessible action is the title
     anchor covering the slide. */
  .feature-carousel__cta {
    align-self: flex-start;
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    color: var(--media-glyph);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .feature-carousel__dots {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .feature-carousel__dot {
    width: var(--space-2);
    height: var(--space-2);
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--color-border-strong);
    cursor: pointer;
    transition: width var(--duration-normal) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out);
  }

  .feature-carousel__dot[aria-current='true'] {
    width: var(--space-6);
    background: var(--color-brand-primary);
  }

  .feature-carousel__dot:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (prefers-reduced-motion: reduce) {
    .feature-carousel__track {
      scroll-behavior: auto;
    }

    .feature-carousel__dot {
      transition: none;
    }
  }
</style>
