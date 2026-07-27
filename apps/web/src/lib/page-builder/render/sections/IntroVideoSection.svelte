<!--
  @component IntroVideoSection

  The 90-second sell film (SPEC §4.1 `introVideo`, §10). The heading/sub render
  immediately (SEO-critical); the play affordance is STREAMED — it fills in when
  the public 30s `preview.m3u8` resolves (HARDENING §E: NO `canView` on the shell,
  public preview, no auth). While the preview promise is pending we show a
  poster skeleton; a resolution failure `.catch()`-es to null and the section
  degrades to just its copy. Playback reuses `ui/IntroVideoModal` (HLS.js).

  TWO renderings, progressively enhanced (mirrors the prototype `intro` fragment):
  • BASELINE (SSR, no-JS, reduced-motion): the copy and a fully-composed candlelit
    play-frame paint immediately — every layer visible, nothing hidden behind JS.
  • ENHANCED (browser + motion OK): copy + frame rise into view on scroll (staggered
    `use:reveal`), a key-light aura breathes behind the ember play button, and two
    pulse rings ripple outward. All motion is CSS, gated by `prefers-reduced-motion`
    so the reduced-motion path holds the composed baseline.
-->
<script lang="ts">
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import SectionSkeleton from '../SectionSkeleton.svelte';
  import { asString } from '../coerce';
  import { reveal } from '../reveal';
  import type { IntroVideoSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: IntroVideoSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    sub: asString(config, 'sub'),
    posterUrl: asString(config, 'posterUrl'),
  });

  const heading = $derived(p.heading ?? 'Ninety seconds inside the work.');

  let open = $state(false);

  /** Advisory duration → a compact `M:SS` badge. Never fabricates a value. */
  function formatDuration(seconds: number | null | undefined): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
</script>

<div class="intro">
  <div class="intro__lead">
    {#if p.eyebrow}
      <p class="intro__eyebrow reveal" use:reveal>{p.eyebrow}</p>
    {/if}
    <h2
      class="intro__heading reveal"
      style="--reveal-delay: var(--duration-fast)"
      use:reveal
    >
      {heading}
    </h2>
    {#if p.sub}
      <p
        class="intro__sub reveal"
        style="--reveal-delay: var(--duration-normal)"
        use:reveal
      >
        {p.sub}
      </p>
    {/if}
  </div>

  <div
    class="intro__stage reveal reveal--stage"
    style={p.posterUrl
      ? `--reveal-delay: var(--duration-slow); --poster: url(${JSON.stringify(p.posterUrl)})`
      : '--reveal-delay: var(--duration-slow)'}
    use:reveal
  >
    <!-- Breathing key-light behind the words — warmth, never a void. -->
    <div class="intro__aura" aria-hidden="true"></div>
    <!-- Cinematic vignette + top catch-light sheen seat the frame. -->
    <div class="intro__vignette" aria-hidden="true"></div>
    <div class="intro__sheen" aria-hidden="true"></div>

    {#await context.sellPreview}
      <SectionSkeleton shape="media" label="Loading the intro film" />
    {:then preview}
      {#if preview?.intro}
        {@const intro = preview.intro}
        {@const durationLabel = formatDuration(intro.durationSeconds)}
        <div class="intro__controls">
          <span class="intro__pulse" aria-hidden="true"></span>
          <span class="intro__pulse intro__pulse--2" aria-hidden="true"></span>
          <button
            type="button"
            class="intro__play"
            onclick={() => (open = true)}
            aria-label="Play the {Math.round(
              intro.durationSeconds ?? 90
            )}-second intro film"
          >
            <span class="intro__play-icon" aria-hidden="true">
              <PlayIcon />
            </span>
          </button>
        </div>

        {#if durationLabel}
          <span class="intro__duration" aria-hidden="true">
            <span class="intro__duration-dot"></span>
            {durationLabel}
          </span>
        {/if}

        <IntroVideoModal
          {open}
          src={intro.playlistUrl}
          title={heading}
          onclose={() => (open = false)}
        />
      {:else}
        <div class="intro__empty" aria-hidden="true"></div>
      {/if}
    {/await}
  </div>
</div>

<style>
  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    max-width: 60rem;
    margin-inline: auto;
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
    text-align: center;
  }

  .intro__lead {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }

  .intro__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .intro__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .intro__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* A candlelit poster frame: warm firelight rising from lower-centre + a clay
     presence upper-left over a deep body — atmosphere derived from the org
     brand, never a flat box. A real poster (`--poster`) layers over the top. */
  .intro__stage {
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 24%, transparent);
    background:
      var(--poster, none) center / cover no-repeat,
      radial-gradient(
        58% 66% at 50% 64%,
        color-mix(in oklab, var(--color-brand-primary) 42%, transparent),
        transparent 68%
      ),
      radial-gradient(
        92% 76% at 30% 24%,
        color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 22%, transparent),
        transparent 66%
      ),
      var(--color-surface);
    box-shadow:
      0 var(--space-8) var(--space-16) calc(-1 * var(--space-10))
        color-mix(in oklab, var(--color-brand-primary) 55%, #000),
      inset 0 var(--border-width) 0
        color-mix(in oklab, var(--color-heading) 10%, transparent);
    display: grid;
    place-items: center;
  }

  /* Soft central key-light — the warmth falling on the seated figure. */
  .intro__aura {
    position: absolute;
    z-index: 0;
    left: 50%;
    top: 46%;
    translate: -50% -50%;
    width: min(64%, 35rem);
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    pointer-events: none;
    opacity: 0.82;
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--color-brand-accent, var(--color-brand-primary)) 42%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 16%, transparent) 46%,
      transparent 70%
    );
    animation: intro-breathe 9s var(--ease-in-out) infinite;
  }

  @keyframes intro-breathe {
    0%,
    100% {
      opacity: 0.66;
      scale: 1;
    }
    50% {
      opacity: 0.9;
      scale: 1.07;
    }
  }

  /* Deep vignette — seats the warm centre in shadow, cinematic edge fall-off. */
  .intro__vignette {
    position: absolute;
    z-index: 1;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      86% 82% at 50% 45%,
      transparent 44%,
      color-mix(in oklab, var(--color-background) 58%, transparent) 100%
    );
  }

  /* Top catch-light sheen. */
  .intro__sheen {
    position: absolute;
    z-index: 2;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 9%, transparent),
      transparent 22%
    );
  }

  .intro__controls {
    position: relative;
    z-index: 3;
    display: grid;
    place-items: center;
  }

  .intro__controls > * {
    grid-area: 1 / 1;
  }

  .intro__play {
    position: relative;
    z-index: 1;
    display: inline-grid;
    place-items: center;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full);
    border: none;
    cursor: pointer;
    color: var(--color-text-on-brand);
    background: var(--color-brand-primary);
    box-shadow: 0 0 var(--space-8)
      color-mix(in oklab, var(--color-brand-primary) 60%, transparent);
    transition:
      transform var(--duration-slow) var(--ease-smooth),
      background-color var(--duration-fast) var(--ease-default),
      box-shadow var(--duration-slow) var(--ease-smooth);
  }

  /* Two breathing pulse rings — the ember, waiting to be watched. */
  .intro__pulse {
    z-index: 0;
    width: var(--space-16);
    height: var(--space-16);
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
    pointer-events: none;
    animation: intro-pulse 3.2s var(--ease-out) infinite;
  }

  .intro__pulse--2 {
    animation-delay: 1.6s;
  }

  @keyframes intro-pulse {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    100% {
      transform: scale(1.9);
      opacity: 0;
    }
  }

  .intro__play:hover {
    background: var(--color-brand-primary-hover);
    transform: translateY(-0.15rem) scale(1.05);
    box-shadow: 0 var(--space-4) var(--space-10) calc(-1 * var(--space-4))
      color-mix(in oklab, var(--color-brand-primary) 70%, #000);
  }

  .intro__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .intro__play-icon {
    display: inline-flex;
    width: var(--space-6);
    height: var(--space-6);
    margin-left: 3px; /* optical centring of the play triangle */
  }

  /* Corner chrome — a quiet duration badge, only when advisory data resolves. */
  .intro__duration {
    position: absolute;
    z-index: 4;
    right: var(--space-4);
    bottom: var(--space-4);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-1);
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    background: color-mix(in oklab, var(--color-background) 55%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.06em;
    color: color-mix(in oklab, var(--color-heading) 82%, transparent);
    pointer-events: none;
  }

  .intro__duration-dot {
    width: var(--space-1-5, 0.375rem);
    height: var(--space-1-5, 0.375rem);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    box-shadow: 0 0 8px
      color-mix(in oklab, var(--color-brand-primary) 70%, transparent);
  }

  .intro__empty {
    width: 100%;
    height: 100%;
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
    transform: translateY(1.5rem);
  }

  .reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .reveal--stage:global(.reveal--armed) {
    transform: translateY(1.6rem) scale(0.986);
  }

  .reveal--stage:global(.reveal--armed.is-in) {
    transform: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .intro__aura {
      animation: none;
    }
    .intro__pulse {
      animation: none;
      opacity: 0;
    }
    .intro__play {
      transition: none;
    }
    .intro__play:hover {
      transform: none;
    }
    /* Hold the composed state — the reveal action already skips arming under
       reduced motion, this guards any residual transition. */
    .reveal {
      transition: none;
    }
  }
</style>
