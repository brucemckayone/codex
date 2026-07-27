<!--
  @component ReelSection

  A cinematic practice-preview clip that sits just before the descent map (SPEC
  §4.1 `reel`). Deliberately NOT the intro film: an ultrawide 2.4:1 letterbox
  with an editorial split header, a "framed footage" chrome (viewfinder corners,
  a rec tag, a waveform scrubber), and a candlelit poster that breathes.

  TWO renderings, progressively enhanced:
  • BASELINE (SSR, no-JS, reduced-motion): the fully-composed cinematic still —
    header, letterbox frame, layered atmosphere, corner marks, caption whisper
    and a static player-chrome bar. Every word legible; nothing depends on JS.
    The play affordance itself is STREAMED (public preview, no auth) via
    `{#await}` with a skeleton, matching the shell+stream contract.
  • ENHANCED (browser + motion OK): the prototype's signature motion layered on
    top — header + stage fade/rise into view (IntersectionObserver via the shared
    `reveal` action), the candlelight bloom breathes, the incense haze drifts, the
    rec dot pulses, the play button carries an invitation ring, and (when the org
    supplies more than one) the whispered caption cross-fades on a slow cycle.

  Real playback stays in `ui/IntroVideoModal` (HLS) — the frame is the poster and
  the click target; motion is gated on `mounted && !reduced` so the accessible
  still always ships first. Tokens are the real Codex design system (the
  prototype's ember/bone/ink palette were stand-ins); the frame stays theme-aware
  rather than baking in a candlelit dark.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import { reveal } from '../reveal';
  import { asString, asStringArray } from '../coerce';
  import type { ReelSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: ReelSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    sub: asString(config, 'sub'),
    posterUrl: asString(config, 'posterUrl'),
  });

  const heading = $derived(p.heading ?? 'This is what a descent looks like.');

  /**
   * Whispered subtitle(s) — `caption` / `captions` / `tag` are now declared on
   * `ReelSectionProps`. Still read through the coerce guards rather than `p.*`
   * because `props` is org-authored jsonb (the type states intent; the guard is
   * what survives a malformed value). `captions` (an array) takes precedence,
   * else a single `caption`. Absent ⇒ no caption line renders.
   */
  const captions = $derived(
    asStringArray(config, 'captions') ??
      (asString(config, 'caption') ? [asString(config, 'caption') as string] : [])
  );

  /** Optional decorative rec-tag label (defensive read); defaults to "Preview". */
  const tagLabel = $derived(asString(config, 'tag') ?? 'Preview');

  // Unique-per-instance id so multiple reels on a page never share the waveform
  // <symbol>. Increments in identical order on server + client ⇒ hydration-safe.
  const waveId = `reel-wave-${nextWaveId()}`;

  let open = $state(false);
  let mounted = $state(false);
  let reduced = $state(false);
  let captionIndex = $state(0);
  let captionFading = $state(false);

  const currentCaption = $derived(captions[captionIndex] ?? captions[0]);
  const cycleCaptions = $derived(mounted && !reduced && captions.length > 1);

  function formatDuration(seconds: number | null | undefined): string | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  onMount(() => {
    mounted = true;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduced = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Slow ambient cross-fade through the whispered captions — enhancement only.
  $effect(() => {
    if (!cycleCaptions) {
      captionFading = false;
      return;
    }
    const total = captions.length;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const cycle = setInterval(() => {
      captionFading = true;
      swap = setTimeout(() => {
        captionIndex = (captionIndex + 1) % total;
        captionFading = false;
      }, 420);
    }, 5600);
    return () => {
      clearInterval(cycle);
      if (swap) clearTimeout(swap);
    };
  });
</script>

<div class="reel">
  <div class="reel__inner">
    <header class="reel__head">
      <div class="reel__lead reveal" use:reveal>
        {#if p.eyebrow}
          <p class="reel__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="reel__title" id={waveId + '-heading'}>{heading}</h2>
      </div>
      {#if p.sub}
        <p class="reel__sub reveal reveal--d1" use:reveal>{p.sub}</p>
      {/if}
    </header>

    <figure
      class="reel__stage reveal reveal--d2"
      use:reveal
      style={p.posterUrl
        ? `--poster: url(${JSON.stringify(p.posterUrl)})`
        : undefined}
    >
      <div class="reel__frame">
        <!-- layered candlelit atmosphere (decorative) -->
        <div class="reel__poster" aria-hidden="true">
          <span class="reel__base"></span>
          <span class="reel__body"></span>
          <span class="reel__rim"></span>
          <span class="reel__glow" class:is-live={mounted && !reduced}></span>
          <span class="reel__haze" class:is-live={mounted && !reduced}></span>
          {#if p.posterUrl}
            <span class="reel__image"></span>
          {/if}
          <span class="reel__vignette"></span>
          <span class="reel__grain"></span>
        </div>

        <!-- viewfinder corner marks — "this is framed footage" -->
        <span class="reel__corner reel__corner--tl" aria-hidden="true"></span>
        <span class="reel__corner reel__corner--tr" aria-hidden="true"></span>
        <span class="reel__corner reel__corner--bl" aria-hidden="true"></span>
        <span class="reel__corner reel__corner--br" aria-hidden="true"></span>

        <!-- top meta: rec tag + total duration (duration streams with preview) -->
        <div class="reel__topmeta" aria-hidden="true">
          <span class="reel__tag">
            <span class="reel__dot" class:is-live={mounted && !reduced}></span>
            {tagLabel}
          </span>
          {#await context.sellPreview then preview}
            {@const dur = formatDuration(preview?.reel?.durationSeconds)}
            {#if dur}
              <span class="reel__dur">{dur}</span>
            {/if}
          {/await}
        </div>

        <span class="reel__scrim" aria-hidden="true"></span>

        <div class="reel__lower">
          {#if currentCaption}
            <p class="reel__caption" class:is-fading={captionFading}>
              {currentCaption}
            </p>
          {/if}

          <div class="reel__chrome">
            {#await context.sellPreview}
              <span class="reel__play reel__play--pending" aria-hidden="true">
                <span class="reel__play-icon"><PlayIcon /></span>
              </span>
              <div class="reel__track reel__track--pending" aria-hidden="true">
                <div class="reel__skeleton"></div>
              </div>
            {:then preview}
              {#if preview?.reel}
                {@const reel = preview.reel}
                <button
                  type="button"
                  class="reel__play"
                  class:is-armed={mounted && !reduced}
                  onclick={() => (open = true)}
                  aria-label="Play the practice preview"
                >
                  <span class="reel__play-icon" aria-hidden="true">
                    <PlayIcon />
                  </span>
                </button>
                <div class="reel__track" aria-hidden="true">
                  <svg
                    class="reel__wave reel__wave--base"
                    viewBox="0 0 480 40"
                    preserveAspectRatio="none"
                  >
                    <g id={waveId} fill="currentColor">
                      <rect x="4" y="15" width="7" height="10" rx="3" />
                      <rect x="19" y="13" width="7" height="14" rx="3" />
                      <rect x="34" y="10" width="7" height="20" rx="3" />
                      <rect x="49" y="7" width="7" height="26" rx="3" />
                      <rect x="64" y="9" width="7" height="22" rx="3" />
                      <rect x="79" y="12" width="7" height="16" rx="3" />
                      <rect x="94" y="14" width="7" height="12" rx="3" />
                      <rect x="109" y="11" width="7" height="18" rx="3" />
                      <rect x="124" y="6" width="7" height="28" rx="3" />
                      <rect x="139" y="3" width="7" height="34" rx="3" />
                      <rect x="154" y="5" width="7" height="30" rx="3" />
                      <rect x="169" y="9" width="7" height="22" rx="3" />
                      <rect x="184" y="13" width="7" height="14" rx="3" />
                      <rect x="199" y="15" width="7" height="10" rx="3" />
                      <rect x="214" y="12" width="7" height="16" rx="3" />
                      <rect x="229" y="8" width="7" height="24" rx="3" />
                      <rect x="244" y="4" width="7" height="32" rx="3" />
                      <rect x="259" y="6" width="7" height="28" rx="3" />
                      <rect x="274" y="10" width="7" height="20" rx="3" />
                      <rect x="289" y="14" width="7" height="12" rx="3" />
                      <rect x="304" y="12" width="7" height="16" rx="3" />
                      <rect x="319" y="9" width="7" height="22" rx="3" />
                      <rect x="334" y="5" width="7" height="30" rx="3" />
                      <rect x="349" y="7" width="7" height="26" rx="3" />
                      <rect x="364" y="11" width="7" height="18" rx="3" />
                      <rect x="379" y="14" width="7" height="12" rx="3" />
                      <rect x="394" y="15" width="7" height="10" rx="3" />
                      <rect x="409" y="12" width="7" height="16" rx="3" />
                      <rect x="424" y="9" width="7" height="22" rx="3" />
                      <rect x="439" y="11" width="7" height="18" rx="3" />
                      <rect x="454" y="14" width="7" height="12" rx="3" />
                      <rect x="469" y="16" width="7" height="8" rx="3" />
                    </g>
                  </svg>
                  <svg
                    class="reel__wave reel__wave--fill"
                    viewBox="0 0 480 40"
                    preserveAspectRatio="none"
                  >
                    <use href={'#' + waveId} />
                  </svg>
                  <span class="reel__playhead"></span>
                </div>
                <IntroVideoModal
                  {open}
                  src={reel.playlistUrl}
                  title={heading}
                  onclose={() => (open = false)}
                />
              {:else}
                <!-- No preview configured: keep the still legible, no play. -->
                <span class="reel__play reel__play--empty" aria-hidden="true">
                  <span class="reel__play-icon"><PlayIcon /></span>
                </span>
                <div class="reel__track" aria-hidden="true">
                  <div class="reel__rest-rail"></div>
                </div>
              {/if}
            {/await}
          </div>
        </div>
      </div>
    </figure>
  </div>
</div>

<style>
  .reel {
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
  }

  .reel__inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-width: 72rem;
    margin-inline: auto;
  }

  /* ── editorial split header: title left, whisper right ── */
  .reel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  @media (--breakpoint-md) {
    .reel__head {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-10);
    }
  }

  .reel__lead {
    max-width: 30ch;
  }

  .reel__eyebrow {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .reel__title {
    margin: 0;
    max-width: 24ch;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: clamp(var(--text-3xl), 5.4vw, var(--text-5xl));
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .reel__sub {
    margin: 0;
    max-width: 30ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  @media (--breakpoint-md) {
    .reel__sub {
      text-align: right;
      padding-bottom: var(--space-1);
    }
  }

  /* ── the cinematic stage ── */
  .reel__stage {
    margin: 0;
    transform-origin: center bottom;
  }

  .reel__frame {
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: 2.4 / 1;
    border-radius: var(--radius-card);
    overflow: hidden;
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 22%, transparent);
    background: var(--color-background);
    box-shadow:
      0 var(--space-8) var(--space-16) calc(-1 * var(--space-10))
        color-mix(in oklab, var(--color-brand-primary) 42%, #000),
      0 var(--space-2) var(--space-8) calc(-1 * var(--space-5)) rgba(0, 0, 0, 0.4);
    display: grid;
    place-items: center;
  }

  /* thin top sheen — reads like the surface of a screen */
  .reel__frame::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    border-radius: inherit;
    box-shadow: inset 0 1px 0 color-mix(in oklab, var(--color-heading) 10%, transparent);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 5%, transparent),
      transparent 12%
    );
  }

  /* ── poster: layered warm atmosphere over a theme-aware base ── */
  .reel__poster {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .reel__poster > * {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* warm base — a lift where the candle sits, resolved from the org brand */
  .reel__base {
    background: radial-gradient(
      150% 130% at 26% 34%,
      color-mix(in oklab, var(--color-surface) 88%, var(--color-brand-primary) 12%) 0%,
      var(--color-surface) 42%,
      var(--color-background) 72%
    );
  }

  /* the reclining body — a low warm mass catching flame light */
  .reel__body {
    background: radial-gradient(
      78% 130% at 58% 138%,
      color-mix(in oklab, var(--color-brand-primary) 26%, transparent) 0%,
      color-mix(in oklab, var(--color-brand-accent) 20%, transparent) 34%,
      transparent 62%
    );
    mix-blend-mode: screen;
    opacity: 0.9;
  }

  /* rim light — a skin edge grazed by candlelight */
  .reel__rim {
    background: radial-gradient(
      42% 60% at 38% 74%,
      color-mix(in oklab, var(--color-brand-accent) 34%, transparent) 0%,
      transparent 56%
    );
    mix-blend-mode: screen;
    opacity: 0.8;
  }

  /* candlelight — bloom + brighter core */
  .reel__glow {
    background: radial-gradient(
      closest-side at 25% 40%,
      color-mix(in oklab, var(--color-brand-primary) 92%, white 8%) 0%,
      color-mix(in oklab, var(--color-brand-primary) 55%, transparent) 20%,
      color-mix(in oklab, var(--color-brand-accent) 22%, transparent) 46%,
      transparent 66%
    );
    mix-blend-mode: screen;
    transform-origin: 25% 40%;
    opacity: 0.9;
  }

  /* incense/haze drifting slowly across the frame */
  .reel__haze {
    background: radial-gradient(
      60% 90% at 70% 20%,
      color-mix(in oklab, var(--color-brand-accent) 12%, transparent),
      transparent 60%
    );
    mix-blend-mode: screen;
    opacity: 0.6;
  }

  /* a real poster still layers over the atmosphere when configured */
  .reel__image {
    background: var(--poster, none) center / cover no-repeat;
    opacity: 0.92;
  }

  .reel__vignette {
    background: radial-gradient(
      125% 120% at 50% 40%,
      transparent 38%,
      color-mix(in oklab, var(--color-background) 45%, transparent) 74%,
      color-mix(in oklab, var(--color-background) 78%, #000) 100%
    );
  }

  .reel__grain {
    opacity: 0.07;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='rn'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23rn)'/%3E%3C/svg%3E");
  }

  /* motion is enhancement only — armed once JS confirms motion is welcome */
  .reel__glow.is-live {
    animation: reel-breath 8s var(--ease-in-out) infinite;
  }

  .reel__haze.is-live {
    animation: reel-drift 22s var(--ease-in-out) infinite alternate;
  }

  @keyframes reel-breath {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.82;
    }
    50% {
      transform: scale(1.07);
      opacity: 1;
    }
  }

  @keyframes reel-drift {
    from {
      transform: translate3d(-4%, 2%, 0);
    }
    to {
      transform: translate3d(5%, -3%, 0);
    }
  }

  /* ── viewfinder corner marks ── */
  .reel__corner {
    position: absolute;
    z-index: 4;
    width: clamp(1rem, 2.2vw, 1.6rem);
    height: clamp(1rem, 2.2vw, 1.6rem);
    border: 0 solid color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
    opacity: 0.55;
    pointer-events: none;
  }

  .reel__corner--tl {
    top: var(--space-5);
    left: var(--space-5);
    border-top-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }

  .reel__corner--tr {
    top: var(--space-5);
    right: var(--space-5);
    border-top-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
  }

  .reel__corner--bl {
    bottom: var(--space-5);
    left: var(--space-5);
    border-bottom-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }

  .reel__corner--br {
    bottom: var(--space-5);
    right: var(--space-5);
    border-bottom-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
  }

  /* ── top meta: rec tag + duration ── */
  .reel__topmeta {
    position: absolute;
    z-index: 4;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: clamp(1rem, 2.8vw, 1.75rem) clamp(1.2rem, 3vw, 2rem);
    pointer-events: none;
  }

  .reel__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.28em;
    color: color-mix(in oklab, var(--color-heading) 74%, transparent);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
  }

  .reel__dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
    box-shadow: 0 0 10px color-mix(in oklab, var(--color-brand-primary) 80%, transparent);
  }

  .reel__dot.is-live {
    animation: reel-pulse 4s var(--ease-in-out) infinite;
  }

  @keyframes reel-pulse {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 1;
    }
  }

  .reel__dur {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-background) 55%, transparent);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    backdrop-filter: blur(var(--blur-sm));
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
  }

  /* ── lower block: caption whisper + player chrome ── */
  .reel__scrim {
    position: absolute;
    z-index: 2;
    left: 0;
    right: 0;
    bottom: 0;
    height: 62%;
    pointer-events: none;
    background: linear-gradient(
      0deg,
      color-mix(in oklab, var(--color-background) 90%, transparent) 0%,
      color-mix(in oklab, var(--color-background) 55%, transparent) 42%,
      transparent 100%
    );
  }

  .reel__lower {
    position: absolute;
    z-index: 4;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    gap: clamp(0.7rem, 2vw, 1.15rem);
    padding: clamp(1rem, 3vw, 2rem);
  }

  .reel__caption {
    align-self: center;
    text-align: center;
    margin: 0;
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: clamp(var(--text-base), 2.5vw, var(--text-2xl));
    line-height: var(--leading-snug);
    color: color-mix(in oklab, var(--color-heading) 90%, transparent);
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
    max-width: 32ch;
    transition: opacity var(--duration-slow) var(--ease-out);
  }

  .reel__caption::before {
    content: '\201C';
    opacity: 0.4;
    margin-right: 0.06em;
  }

  .reel__caption::after {
    content: '\201D';
    opacity: 0.4;
    margin-left: 0.06em;
  }

  .reel__caption.is-fading {
    opacity: 0;
  }

  .reel__chrome {
    display: flex;
    align-items: center;
    gap: clamp(0.7rem, 2vw, 1.15rem);
  }

  /* play button — glassy invitation, opens the real HLS modal */
  .reel__play {
    position: relative;
    flex: none;
    width: clamp(2.7rem, 4.4vw, 3.3rem);
    height: clamp(2.7rem, 4.4vw, 3.3rem);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: var(--color-heading);
    background: color-mix(in oklab, var(--color-brand-primary) 16%, transparent);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 60%, transparent);
    backdrop-filter: blur(var(--blur-md));
    box-shadow: 0 var(--space-2) var(--space-8) calc(-1 * var(--space-3))
      rgba(0, 0, 0, 0.6);
    cursor: pointer;
    transition:
      transform var(--duration-fast) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out);
  }

  .reel__play:hover {
    transform: translateY(-2px);
    background: color-mix(in oklab, var(--color-brand-primary) 26%, transparent);
  }

  .reel__play:active {
    transform: translateY(0) scale(0.96);
  }

  .reel__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .reel__play--pending,
  .reel__play--empty {
    cursor: default;
    opacity: 0.65;
  }

  .reel__play--pending {
    animation: reel-skeleton 1.4s var(--ease-in-out) infinite;
  }

  /* gentle invitation ring — enhancement only (armed by JS) */
  .reel__play::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
    opacity: 0;
  }

  .reel__play.is-armed::after {
    animation: reel-ring 2.8s var(--ease-out) infinite;
  }

  @keyframes reel-ring {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    70% {
      transform: scale(1.55);
      opacity: 0;
    }
    100% {
      transform: scale(1.55);
      opacity: 0;
    }
  }

  .reel__play-icon {
    display: inline-flex;
    width: 44%;
    height: 44%;
    margin-left: 3px;
  }

  /* waveform scrubber */
  .reel__track {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: clamp(1.5rem, 3.4vw, 2.4rem);
  }

  .reel__wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .reel__wave--base {
    color: color-mix(in oklab, var(--color-heading) 30%, transparent);
  }

  .reel__wave--fill {
    color: var(--color-brand-primary);
    clip-path: inset(0 100% 0 0);
    filter: drop-shadow(
      0 0 5px color-mix(in oklab, var(--color-brand-primary) 55%, transparent)
    );
  }

  .reel__playhead {
    position: absolute;
    top: -12%;
    bottom: -12%;
    left: 0;
    width: 2px;
    background: var(--color-heading);
    box-shadow: 0 0 10px color-mix(in oklab, var(--color-brand-primary) 90%, transparent);
    opacity: 0;
  }

  .reel__rest-rail {
    position: absolute;
    inset: 45% 0 auto 0;
    height: 2px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-heading) 22%, transparent);
  }

  /* streamed-play skeleton */
  .reel__track--pending {
    display: flex;
    align-items: center;
  }

  .reel__skeleton {
    width: 100%;
    height: 40%;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-heading) 18%, transparent);
    animation: reel-skeleton 1.4s var(--ease-in-out) infinite;
  }

  @keyframes reel-skeleton {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 0.85;
    }
  }

  /* ── reveal-on-scroll (armed by the shared `reveal` action) ──
     Base `.reveal` (no armed class) is the fully-visible SSR / no-JS baseline.
     The `reveal` action adds `reveal--armed` (hidden) only once JS confirms
     motion is welcome, then `is-in` when the node scrolls in. The runtime
     classes live in `:global()` so Svelte's scoper doesn't prune them. */
  .reveal {
    transition:
      opacity var(--duration-slower) var(--ease-out),
      transform var(--duration-slower) var(--ease-out);
  }

  .reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(26px);
  }

  .reveal--d1:global(.reveal--armed) {
    transition-delay: 0.1s;
  }

  .reveal--d2:global(.reveal--armed) {
    transition-delay: 0.2s;
  }

  .reel__stage:global(.reveal--armed) {
    transform: translateY(34px) scale(0.985);
  }

  .reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .reel__stage:global(.reveal--armed.is-in) {
    transform: none;
  }

  /* ── responsive: keep the letterbox graceful ── */
  @media (max-width: 760px) {
    .reel__head {
      align-items: flex-start;
    }
    .reel__frame {
      aspect-ratio: 4 / 3;
      min-height: 280px;
    }
    .reel__caption::before,
    .reel__caption::after {
      content: none;
    }
  }

  @media (max-width: 420px) {
    .reel__frame {
      aspect-ratio: 3 / 3.4;
    }
    .reel__tag {
      letter-spacing: 0.2em;
    }
  }

  /* ── reduced motion: the composed still, no movement ── */
  @media (prefers-reduced-motion: reduce) {
    .reel__glow,
    .reel__haze,
    .reel__dot,
    .reel__play::after,
    .reel__skeleton,
    .reel__play--pending {
      animation: none !important;
    }
    .reel__glow {
      opacity: 1;
      transform: scale(1.04);
    }
    .reel__play::after {
      opacity: 0;
    }
    .reel__caption {
      transition: none;
    }
    /* The reveal action already skips arming under reduced motion (it only adds
       `is-in`); this guards any residual transition on the composed still. */
    .reveal {
      transition: none;
    }
  }
</style>

<script module lang="ts">
  // Per-instance sequence for the waveform <symbol> id. Module-scoped so it
  // increments in identical order during SSR and hydration (no id clashes,
  // no hydration mismatch even with multiple reels on one page).
  let waveSeq = 0;
  function nextWaveId(): number {
    return waveSeq++;
  }
</script>
