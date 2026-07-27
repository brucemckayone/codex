<!--
  @component GuideSection

  The maker's bio (SPEC §4.1 `guide`) — "made by someone who had to find the
  ground first". Optional portrait + name + multi-paragraph bio + credentials,
  with an optional pull-quote climax.

  TWO renderings, progressively enhanced (mirrors the prototype `guide` fragment):
  • BASELINE (SSR, no-JS, reduced-motion): the copy and a fully-composed candlelit
    "meet your guide" poster paint immediately — every layer visible, nothing
    hidden behind JS. Renders nothing when neither a bio nor a name/heading is set.
  • ENHANCED (browser + motion OK): copy + poster rise into view on scroll
    (staggered `use:reveal`), a soft ember aura breathes inside the poster, and the
    frame warms on hover. All motion is CSS, gated by `prefers-reduced-motion` so
    the reduced-motion path holds the composed baseline (the `reveal` action itself
    skips arming under reduced motion / SSR, so content is never stuck hidden).
-->
<script lang="ts">
  import { asString, asStringArray } from '../coerce';
  import { reveal } from '../reveal';
  import { safeHref } from '../safe-href';
  import type { GuideSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: GuideSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    name: asString(config, 'name'),
    bio: asStringArray(config, 'bio'),
    portraitUrl: asString(config, 'portraitUrl'),
    credentials: asStringArray(config, 'credentials'),
  });

  // The prototype's emotional climax is a pull-quote. It is not yet part of the
  // shared GuideSectionProps contract, so read it defensively from config and
  // simply omit the quote when absent (see desiredSharedChanges for the lead).
  const quote = $derived(asString(config, 'quote'));

  // A single-glyph mark for the decorative candlelit poster when no portrait is
  // configured — the guide's initial, evoking a portrait placeholder.
  const mark = $derived(
    (p.name ?? p.heading ?? '').trim().charAt(0).toUpperCase() || '·'
  );
</script>

{#if p.bio || p.name || p.heading}
  <div class="guide">
    <div class="guide__inner">
      <!-- Left: a candlelit "meet your guide" poster. A real portrait layers in
           when configured; otherwise a decorative brand-lit panel holds the
           column's visual weight (matching the prototype's play-frame) without
           implying playback we don't have. -->
      <div
        class="guide__poster reveal reveal--stage"
        class:guide__poster--photo={p.portraitUrl}
        style="--reveal-delay: var(--duration-slow)"
        use:reveal
      >
        {#if p.portraitUrl}
          <img
            src={safeHref(p.portraitUrl)}
            alt={p.name ? `Portrait of ${p.name}` : ''}
            loading="lazy"
          />
          <!-- Seat the photo in the same candlelit frame: quiet edge fall-off. -->
          <span class="guide__vignette" aria-hidden="true"></span>
          <span class="guide__sheen" aria-hidden="true"></span>
        {:else}
          <!-- Breathing ember rising from lower-centre — a lit presence, never a
               void — plus a vignette, top sheen, and fine grain for depth. -->
          <span class="guide__ember" aria-hidden="true"></span>
          <span class="guide__grain" aria-hidden="true"></span>
          <span class="guide__vignette" aria-hidden="true"></span>
          <span class="guide__sheen" aria-hidden="true"></span>
          <span class="guide__mark" aria-hidden="true">{mark}</span>
        {/if}
      </div>

      <div class="guide__body">
        {#if p.eyebrow}
          <p class="guide__eyebrow reveal" use:reveal>{p.eyebrow}</p>
        {/if}
        {#if p.heading}
          <h2
            class="guide__heading reveal"
            style="--reveal-delay: var(--duration-fast)"
            use:reveal
          >
            {p.heading}
          </h2>
        {/if}
        {#if p.name}
          <p
            class="guide__name reveal"
            style="--reveal-delay: var(--duration-normal)"
            use:reveal
          >
            {p.name}
          </p>
        {/if}
        {#if p.bio}
          <div
            class="guide__bio reveal"
            style="--reveal-delay: var(--duration-normal)"
            use:reveal
          >
            {#each p.bio as paragraph, i (i)}
              <p>{paragraph}</p>
            {/each}
          </div>
        {/if}
        {#if quote}
          <blockquote
            class="guide__quote reveal"
            style="--reveal-delay: var(--duration-slow)"
            use:reveal
          >
            <p>{quote}</p>
          </blockquote>
        {/if}
        {#if p.credentials}
          <ul
            class="guide__credentials reveal"
            style="--reveal-delay: var(--duration-slow)"
            use:reveal
          >
            {#each p.credentials as credential, i (i)}
              <li>{credential}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .guide {
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .guide__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-8);
    max-width: 60rem;
    margin-inline: auto;
  }

  @media (--breakpoint-md) {
    .guide__inner {
      grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr);
      gap: var(--space-12);
      align-items: center;
    }
  }

  /* Candlelit poster: firelight rising from lower-centre + a clay presence
     upper-left over a deep body — the same brand-derived warmth as the sell
     video frames, so the guide reads as part of one candlelit world. */
  .guide__poster {
    position: relative;
    isolation: isolate;
    aspect-ratio: 4 / 5;
    border-radius: var(--radius-card);
    overflow: hidden;
    display: grid;
    place-items: center;
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 20%, transparent);
    background:
      radial-gradient(
        46% 58% at 50% 66%,
        color-mix(in oklab, var(--color-brand-primary) 46%, transparent),
        transparent 68%
      ),
      radial-gradient(
        90% 72% at 30% 24%,
        color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 22%, transparent),
        transparent 66%
      ),
      var(--color-surface);
    box-shadow:
      0 var(--space-8) var(--space-16) calc(-1 * var(--space-10))
        color-mix(in oklab, var(--color-brand-primary) 55%, #000),
      inset 0 var(--border-width) 0
        color-mix(in oklab, var(--color-heading) 10%, transparent);
    transition:
      box-shadow var(--duration-slow) var(--ease-smooth),
      transform var(--duration-slow) var(--ease-smooth);
  }

  /* Hover warmth — the frame lifts a touch and the glow deepens. Aesthetic only;
     the poster is decorative, not an actionable control. */
  .guide__poster:hover {
    transform: translateY(-0.2rem);
    box-shadow:
      0 var(--space-10) var(--space-16) calc(-1 * var(--space-10))
        color-mix(in oklab, var(--color-brand-primary) 65%, #000),
      inset 0 var(--border-width) 0
        color-mix(in oklab, var(--color-heading) 14%, transparent);
  }

  .guide__poster--photo {
    background: var(--color-surface-secondary);
  }

  .guide__poster img {
    position: absolute;
    inset: 0;
    z-index: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Soft, tall ember glow that breathes like a lit form (prototype `guide__ember`). */
  .guide__ember {
    position: absolute;
    z-index: 1;
    left: 50%;
    bottom: 14%;
    width: 58%;
    aspect-ratio: 3 / 4;
    translate: -50% 0;
    pointer-events: none;
    filter: blur(var(--blur-xl));
    background: radial-gradient(
      50% 50% at 50% 55%,
      color-mix(in oklab, var(--color-brand-primary) 72%, transparent),
      color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 30%, transparent) 55%,
      transparent 72%
    );
    animation: guide-breathe 7.5s var(--ease-in-out) infinite;
  }

  @keyframes guide-breathe {
    0%,
    100% {
      opacity: 0.55;
      transform: scale(1);
    }
    50% {
      opacity: 0.9;
      transform: translateY(-2%) scale(1.06);
    }
  }

  /* Fine grain for texture. Inline SVG data URI is CSP-safe (no external asset). */
  .guide__grain {
    position: absolute;
    z-index: 2;
    inset: 0;
    pointer-events: none;
    opacity: 0.14;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='gn'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23gn)'/%3E%3C/svg%3E");
  }

  /* Inner vignette — darkens the edges so the warm centre reads as depth. */
  .guide__vignette {
    position: absolute;
    z-index: 3;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      78% 78% at 50% 52%,
      transparent 42%,
      color-mix(in oklab, var(--color-background) 62%, transparent) 100%
    );
  }

  /* Top catch-light sheen. */
  .guide__sheen {
    position: absolute;
    z-index: 4;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 10%, transparent),
      transparent 22%
    );
  }

  .guide__mark {
    position: relative;
    z-index: 5;
    font-family: var(--font-heading);
    font-size: var(--text-6xl, var(--text-display));
    font-weight: var(--font-normal);
    line-height: 1;
    color: color-mix(in oklab, var(--color-heading) 78%, transparent);
    text-shadow: 0 0 var(--space-6)
      color-mix(in oklab, var(--color-brand-primary) 45%, transparent);
  }

  .guide__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guide__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .guide__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .guide__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .guide__bio {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guide__bio p {
    margin: 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  /* Pull quote — the emotional climax: large serif, brand-lit accent rule. */
  .guide__quote {
    position: relative;
    margin: var(--space-4) 0 0;
    padding-left: var(--space-5);
    border-left: var(--border-width-thick) solid
      color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 55%, transparent);
    max-width: 32ch;
  }

  .guide__quote::before {
    content: '\201C';
    position: absolute;
    left: var(--space-3);
    top: -0.35em;
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    line-height: 1;
    color: color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 34%, transparent);
    pointer-events: none;
  }

  .guide__quote p {
    margin: 0;
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: var(--text-2xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.01em;
    color: color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 40%, var(--color-heading));
  }

  .guide__credentials {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .guide__credentials li {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* ── reveal-on-scroll ──
     Base `.reveal` (no armed class) is the fully-visible SSR / no-JS baseline.
     The `reveal` action adds `reveal--armed` (hidden) only once JS confirms
     motion is welcome, then `is-in` when the node scrolls into view. */
  .reveal {
    transition:
      opacity var(--duration-slowest) var(--ease-smooth),
      transform var(--duration-slowest) var(--ease-smooth);
    transition-delay: var(--reveal-delay, 0ms);
  }

  .reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(1.4rem);
  }

  .reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .reveal--stage:global(.reveal--armed) {
    transform: translateY(1.5rem) scale(0.985);
  }

  .reveal--stage:global(.reveal--armed.is-in) {
    transform: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .guide__ember {
      animation: none;
    }
    .guide__poster {
      transition: none;
    }
    .guide__poster:hover {
      transform: none;
    }
    /* Hold the composed state — the reveal action already skips arming under
       reduced motion; this guards any residual transition. */
    .reveal {
      transition: none;
    }
  }
</style>
