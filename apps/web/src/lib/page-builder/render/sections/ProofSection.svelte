<!--
  @component ProofSection

  Testimonials (SPEC §4.1 `proof`) — "what the ground gives back". Renders from
  the awaited `context.testimonials` (public, no auth). Self-hides when the
  course has no testimonials.

  TWO renderings, progressively enhanced:
  • BASELINE (SSR, no-JS, reduced-motion): a clean, fully-legible grid of quote
    cards — every card visible at once. This is what the server emits, so the
    section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the prototype's staggered reveal-on-scroll —
    the header and each card fade + rise into place one after another as the
    section enters the viewport (via the shared `reveal` action), a faint warmth
    glows behind the header, cards carry an oversized decorative quotation mark
    and a warm gradient avatar, and hovering a card lifts it while a candle-catch
    hairline brightens along its top edge.

  Motion is layered by the `reveal` action, which arms the hidden state from JS
  only — so the accessible baseline always ships first and reduced-motion / no-JS
  fall back to the composed static state.
-->
<script lang="ts">
  import { asString } from '../coerce';
  import { reveal } from '../reveal';
  import type { ProofSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: ProofSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
  });

  // Optional aggregate trust cue — read defensively from config so the shared
  // ProofSectionProps type needn't change to render it, and absent → omitted.
  const trustLabel = $derived(asString(config, 'trustLabel'));

  const testimonials = $derived(
    [...context.testimonials].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const heading = $derived(p.heading ?? 'What the ground gives back.');

  /** First letter of a name for the gradient avatar (falls back to a bullet). */
  function initial(name: string): string {
    const match = name.trim().match(/\p{L}|\p{N}/u);
    return match ? match[0].toUpperCase() : '•';
  }
</script>

{#if testimonials.length > 0}
  <div class="proof">
    <div class="proof__inner">
      <header class="proof__head reveal" use:reveal>
        {#if p.eyebrow}
          <p class="proof__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="proof__heading">{heading}</h2>
      </header>

      <ul class="proof__grid">
        {#each testimonials as testimonial, i (testimonial.id)}
          <li
            class="proof__item reveal"
            style="--reveal-delay: {i * 90}ms"
            use:reveal
          >
            <figure class="proof__figure">
              <blockquote class="proof__quote">{testimonial.quote}</blockquote>
              <figcaption class="proof__cite">
                <span class="proof__avatar" aria-hidden="true"
                  >{initial(testimonial.authorName)}</span
                >
                <span class="proof__id">
                  <span class="proof__author">{testimonial.authorName}</span>
                  {#if testimonial.authorContext}
                    <span class="proof__context">{testimonial.authorContext}</span>
                  {/if}
                </span>
              </figcaption>
            </figure>
          </li>
        {/each}
      </ul>

      {#if trustLabel}
        <p class="proof__trust reveal" style="--reveal-delay: {testimonials.length * 90}ms" use:reveal>
          <span class="proof__stack" aria-hidden="true">
            {#each testimonials.slice(0, 5) as testimonial (testimonial.id)}
              <span class="proof__dot"></span>
            {/each}
          </span>
          <span class="proof__count">{trustLabel}</span>
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .proof {
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
    /* Faint local warmth behind the header — never a void, tinted by the brand. */
    background: radial-gradient(
      78% 55% at 50% 0%,
      color-mix(in oklab, var(--color-brand-primary) 9%, transparent),
      transparent 62%
    );
  }

  .proof__inner {
    max-width: 68rem;
    margin-inline: auto;
  }

  .proof__head {
    text-align: center;
    max-width: 44rem;
    margin: 0 auto var(--space-12);
  }

  .proof__eyebrow {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .proof__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .proof__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-5);
    margin: 0;
    padding: 0;
    list-style: none;
    align-items: stretch;
  }

  @media (--breakpoint-md) {
    .proof__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-6);
    }
  }

  @media (--breakpoint-lg) {
    .proof__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  .proof__item {
    display: flex;
  }

  .proof__figure {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-6);
    border-radius: var(--radius-card);
    border: var(--border-width) solid var(--color-border-subtle);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-surface-secondary) 90%, transparent),
      color-mix(in oklab, var(--color-surface) 70%, transparent)
    );
    box-shadow: 0 24px 55px -38px
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent);
    overflow: hidden;
    transition:
      transform var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
  }

  /* Candle-catch hairline along the top edge — brightens on hover. */
  .proof__figure::after {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--color-brand-accent) 55%, transparent) 22%,
      color-mix(in oklab, var(--color-brand-accent) 55%, transparent) 78%,
      transparent
    );
    opacity: 0.45;
    transition: opacity var(--duration-normal) var(--ease-out);
  }

  @media (hover: hover) {
    .proof__item:hover .proof__figure {
      transform: translateY(-4px);
      border-color: color-mix(
        in oklab,
        var(--color-brand-accent) 34%,
        var(--color-border-subtle)
      );
      box-shadow: 0 30px 60px -34px
        color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
    }
    .proof__item:hover .proof__figure::after {
      opacity: 1;
    }
  }

  .proof__quote {
    position: relative;
    z-index: 1;
    margin: 0;
    padding-top: var(--space-8);
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.005em;
    color: var(--color-heading);
    text-wrap: pretty;
  }

  /* Oversized decorative quotation mark, low-opacity, behind the text. */
  .proof__quote::before {
    content: '\201C';
    position: absolute;
    top: -0.4rem;
    left: -0.3rem;
    z-index: -1;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-5xl);
    line-height: 1;
    color: color-mix(in oklab, var(--color-brand-accent) 24%, transparent);
    pointer-events: none;
  }

  .proof__cite {
    margin-top: auto;
    padding-top: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .proof__avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.875rem;
    height: 2.875rem;
    border-radius: var(--radius-full);
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-lg);
    color: var(--color-text-inverse, var(--color-background));
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-heading) 18%, transparent),
      0 6px 16px -8px color-mix(in oklab, var(--color-brand-primary) 60%, transparent);
  }

  /* Per-person warm hue — pure CSS gradient circles from brand tokens. */
  .proof__item:nth-child(3n + 1) .proof__avatar {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-accent) 90%, white 4%),
      var(--color-brand-primary) 88%
    );
  }
  .proof__item:nth-child(3n + 2) .proof__avatar {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-primary) 85%, white 6%),
      color-mix(in oklab, var(--color-brand-accent) 60%, var(--color-brand-primary))
    );
  }
  .proof__item:nth-child(3n + 3) .proof__avatar {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-accent) 70%, var(--color-brand-primary)),
      var(--color-brand-primary) 90%
    );
  }

  .proof__id {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    line-height: var(--leading-snug);
  }

  .proof__author {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .proof__context {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
  }

  /* Aggregate trust cue — understated, closes the section. */
  .proof__trust {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin: var(--space-10) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .proof__stack {
    display: inline-flex;
  }

  .proof__dot {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-full);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-heading) 18%, transparent),
      0 0 0 2px var(--color-background);
  }

  .proof__dot + .proof__dot {
    margin-left: -0.625rem;
  }

  .proof__stack .proof__dot:nth-child(3n + 1) {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-accent) 90%, white 4%),
      var(--color-brand-primary) 88%
    );
  }
  .proof__stack .proof__dot:nth-child(3n + 2) {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-primary) 85%, white 6%),
      color-mix(in oklab, var(--color-brand-accent) 60%, var(--color-brand-primary))
    );
  }
  .proof__stack .proof__dot:nth-child(3n + 3) {
    background: radial-gradient(
      circle at 34% 28%,
      color-mix(in oklab, var(--color-brand-accent) 70%, var(--color-brand-primary)),
      var(--color-brand-primary) 90%
    );
  }

  /* ── reveal-on-scroll (armed by the `reveal` action from JS only) ──
     No-JS / reduced-motion / SSR never see `.reveal--armed`, so the composed
     static state is the accessible baseline. */
  .reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(22px);
    transition:
      opacity 0.85s var(--ease-out),
      transform 0.85s var(--ease-out);
    transition-delay: var(--reveal-delay, 0ms);
  }

  .reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  /* ── mobile: swipeable snap-row that bleeds to the screen edges ── */
  @media (--below-md) {
    .proof__grid {
      display: flex;
      grid-template-columns: none;
      gap: var(--space-4);
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      scroll-padding-inline: var(--space-5);
      /* Bleed past the section inline padding for an edge-to-edge carousel. */
      margin-inline: calc(-1 * var(--space-5));
      padding-inline: var(--space-5);
      padding-bottom: var(--space-2);
      scrollbar-width: none;
    }
    .proof__grid::-webkit-scrollbar {
      display: none;
    }
    .proof__item {
      flex: 0 0 84%;
      scroll-snap-align: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal:global(.reveal--armed) {
      opacity: 1;
      transform: none;
      transition: none;
    }
    .proof__figure {
      transition: none;
    }
    .proof__item:hover .proof__figure {
      transform: none;
    }
    .proof__figure::after {
      transition: none;
    }
  }
</style>
