<!--
  @component JourneyRailCard

  A single course as it appears in the /explore "Journeys" rail (SPEC §8.5).
  A brand-toned cover carries the kicker + serif title + tagline; the body
  carries an optional guide credit, a price/access badge, and the CTA that
  links to the course's PUBLIC sales page.

  Purely presentational — the parent supplies the resolved sales-page `href`
  (built with `buildJourneyUrl(..., { surface: 'sales' })`) so this component
  stays free of routing concerns. The per-card `index` rotates the cover hue
  off the org brand so a rail of journeys reads as a set of distinct tones
  without any hardcoded colour.

  COVER (Codex-eqh0z): when `journey.coverImageUrl` is set it renders as the
  cover band's backdrop, and the existing brand gradient becomes a SCRIM over it
  so the near-white kicker/title/tagline stay legible on any photograph. With no
  cover the gradient is the band, exactly as before — the band's reserved height
  is unchanged either way, so a rail of mixed cards never shifts.
-->
<script lang="ts">
  import type { CourseCardSummary } from '$lib/journeys/types';
  import { formatPrice } from '$lib/utils/format';

  interface Props {
    journey: CourseCardSummary;
    /** Resolved public sales-page URL (root-relative on the org subdomain). */
    href: string;
    /** Position in the rail — rotates the cover hue off the brand. */
    index?: number;
  }

  const { journey, href, index = 0 }: Props = $props();

  const isPurchasable = $derived(journey.priceCents != null);
  const priceLabel = $derived(
    journey.priceCents != null ? formatPrice(journey.priceCents) : 'Free'
  );
</script>

<a class="jcard" {href} style="--jcard-hue-shift: {index * 34}deg">
  <div class="jcard__cover" class:jcard__cover--imaged={!!journey.coverImageUrl}>
    {#if journey.coverImageUrl}
      <img
        class="jcard__cover-img"
        src={journey.coverImageUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
    {/if}
    <div class="jcard__text">
      {#if journey.kicker}
        <span class="jcard__kicker">{journey.kicker}</span>
      {/if}
      <h3 class="jcard__title">{journey.title}</h3>
      {#if journey.lede}
        <p class="jcard__tagline">{journey.lede}</p>
      {/if}
    </div>
  </div>

  <div class="jcard__body">
    {#if journey.guideName}
      <p class="jcard__guide">Guided by {journey.guideName}</p>
    {/if}
    <div class="jcard__foot">
      <span class="jcard__price" class:jcard__price--free={!isPurchasable}>
        {priceLabel}
      </span>
      <span class="jcard__go">
        See the journey
        <span class="jcard__arrow" aria-hidden="true">→</span>
      </span>
    </div>
  </div>
</a>

<style>
  .jcard {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-xl, var(--radius-lg));
    background: var(--color-surface);
    text-decoration: none;
    color: inherit;
    transition:
      transform var(--duration-normal) var(--ease-default),
      border-color var(--duration-normal) var(--ease-default),
      box-shadow var(--duration-normal) var(--ease-default);
  }

  .jcard:hover {
    transform: translateY(calc(-1 * var(--space-1)));
    border-color: var(--color-brand-primary);
    box-shadow: var(--shadow-lg);
  }

  .jcard:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 2px);
  }

  /* Cover — a brand-toned band; hue rotates per card off the org brand. */
  .jcard__cover {
    position: relative;
    display: grid;
    align-content: end;
    min-height: 10.5rem;
    padding: var(--space-5);
    background:
      radial-gradient(
        120% 120% at 100% 0%,
        oklch(
          from var(--color-brand-primary) 0.5 calc(c * 0.95)
            calc(h + var(--jcard-hue-shift, 0deg))
        ),
        transparent 70%
      ),
      linear-gradient(
        155deg,
        oklch(
          from var(--color-brand-primary) 0.36 calc(c * 0.85)
            calc(h + var(--jcard-hue-shift, 0deg))
        ),
        oklch(
          from var(--color-brand-primary) 0.2 calc(c * 0.55)
            calc(h + var(--jcard-hue-shift, 0deg) - 18deg)
        )
      );
  }

  /* The real cover paints over the band's brand gradient (which is then only the
     no-cover fallback), and `--media-scrim` — the brand-aware token the other
     media cover treatments use — goes over the image so the near-white
     kicker/title/tagline stay legible on an arbitrary photograph. */
  .jcard__cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Same scrim ramp `ContentCard`'s title-in-cover variant uses, so a journey
     cover and a content cover read as one system on the same page. */
  .jcard__cover--imaged::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      var(--media-scrim),
      color-mix(in srgb, var(--media-scrim) 70%, transparent) 45%,
      color-mix(in srgb, var(--media-scrim) 35%, transparent) 75%,
      transparent 100%
    );
  }

  .jcard__text {
    /* Above both the image and the scrim (both are earlier in paint order). */
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .jcard__kicker {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    /* Warm near-white on the toned cover — brand-tinted for cohesion. */
    color: oklch(from var(--color-brand-primary) 0.92 calc(c * 0.08) h);
  }

  .jcard__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-medium);
    line-height: var(--leading-tight);
    color: oklch(from var(--color-brand-primary) 0.98 calc(c * 0.04) h);
    text-wrap: balance;
  }

  .jcard__tagline {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: oklch(from var(--color-brand-primary) 0.9 calc(c * 0.05) h);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  .jcard__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) var(--space-5);
  }

  .jcard__guide {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .jcard__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .jcard__price {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
  }

  .jcard__price--free {
    color: var(--color-brand-primary);
  }

  .jcard__go {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-brand-primary);
  }

  .jcard__arrow {
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .jcard:hover .jcard__arrow {
    transform: translateX(var(--space-1));
  }

  @media (prefers-reduced-motion: reduce) {
    .jcard,
    .jcard__arrow {
      transition: none;
    }

    .jcard:hover {
      transform: none;
    }

    .jcard:hover .jcard__arrow {
      transform: none;
    }
  }
</style>
