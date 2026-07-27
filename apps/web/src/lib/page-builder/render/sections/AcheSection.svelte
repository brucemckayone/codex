<!--
  @component AcheSection

  Names the held pain before hope is offered (SPEC §4.1 `ache`). A sequence of
  short "beats" read one after another.

  TWO renderings, progressively enhanced:
  • BASELINE (SSR, no-JS, reduced-motion): a clean, fully-legible stacked
    sequence — every beat visible at once. This is what the server emits, so the
    section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the prototype's cinematic pinned reveal — a
    tall scroll `track` pins a 100vh `stage`; scrolling advances one beat at a
    time (crossfade), a breathing aura warms the frame, a segmented rail tracks
    progress, and a vignette focuses the centre.

  Enhancement is gated on `mounted && !reduced` so the accessible baseline always
  ships first; the scroll math lives in an `$effect` that re-wires if the
  reduced-motion preference flips mid-session.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { asString, asStringArray } from '../coerce';
  import type { AcheSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: AcheSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    beats: asStringArray(config, 'beats'),
  });

  const beats = $derived(p.beats ?? []);

  let mounted = $state(false);
  let reduced = $state(false);
  let activeIndex = $state(0);
  let trackEl = $state<HTMLElement | undefined>(undefined);

  // The pinned reveal needs motion + at least two beats to sequence between.
  const enhanced = $derived(mounted && !reduced && beats.length > 1);

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

  // Scroll driver: map the track's progress through the viewport onto an active
  // beat index. Re-runs (and tears down) whenever `enhanced` or the track flips.
  $effect(() => {
    if (!enhanced || !trackEl) return;
    const track = trackEl;
    const count = beats.length;
    let ticking = false;

    const update = () => {
      ticking = false;
      const total = track.offsetHeight - window.innerHeight;
      if (total <= 0) {
        activeIndex = 0;
        return;
      }
      const scrolled = Math.min(
        Math.max(-track.getBoundingClientRect().top, 0),
        total
      );
      const idx = Math.floor((scrolled / total) * count);
      activeIndex = Math.min(Math.max(idx, 0), count - 1);
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });
</script>

{#if beats.length > 0}
  <div
    class="ache"
    class:ache--enhanced={enhanced}
    style="--beat-count: {beats.length}"
  >
    <div class="ache__track" bind:this={trackEl}>
      <div class="ache__stage">
        <div class="ache__aura" aria-hidden="true"></div>
        <div class="ache__frame">
          {#if p.eyebrow}
            <p class="ache__chapter">{p.eyebrow}</p>
          {/if}

          <div class="ache__beats">
            {#each beats as beat, i (i)}
              <p class="ache__beat" class:is-active={enhanced && i === activeIndex}>
                {beat}
              </p>
            {/each}
          </div>

          {#if enhanced}
            <div class="ache__progress" aria-hidden="true">
              {#each beats as _, i (i)}
                <span class="ache__seg" class:is-on={i <= activeIndex}></span>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .ache {
    position: relative;
    isolation: isolate;
  }

  .ache__track {
    position: relative;
  }

  .ache__stage {
    position: relative;
    display: grid;
    place-items: center;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
    overflow: clip;
  }

  /* Breathing warmth behind the words — fills the frame, never a void. */
  .ache__aura {
    position: absolute;
    z-index: 0;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(78vw, 38.75rem);
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    pointer-events: none;
    opacity: 0.6;
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 50%,
      color-mix(in oklab, var(--color-brand-accent) 30%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 12%, transparent) 42%,
      transparent 68%
    );
  }

  /* Cinematic vignette darkening the edges to focus the centre. */
  .ache__stage::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: radial-gradient(
      125% 95% at 50% 50%,
      transparent 52%,
      color-mix(in oklab, var(--color-background) 55%, transparent) 100%
    );
  }

  .ache__frame {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    max-width: 48rem;
    margin-inline: auto;
    text-align: center;
  }

  .ache__chapter {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  /* Ceremonial flanking hairlines. */
  .ache__chapter::before,
  .ache__chapter::after {
    content: '';
    width: clamp(1.5rem, 6vw, 3rem);
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--color-brand-accent) 55%, transparent)
    );
  }

  .ache__chapter::after {
    transform: scaleX(-1);
  }

  .ache__beats {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .ache__beat {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.01em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .ache__progress {
    display: none;
    align-items: center;
    gap: var(--space-2);
  }

  .ache__seg {
    width: clamp(1.6rem, 5vw, 2.9rem);
    height: 2px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text-tertiary) 55%, transparent);
    transition:
      background var(--duration-slow) var(--ease-out),
      box-shadow var(--duration-slow) var(--ease-out);
  }

  .ache__seg.is-on {
    background: var(--color-brand-accent);
    box-shadow: 0 0 14px color-mix(in oklab, var(--color-brand-accent) 55%, transparent);
  }

  /* ── ENHANCED: pinned one-beat-at-a-time reveal ──
     Only applied when JS has confirmed motion is welcome (`.ache--enhanced`);
     the baseline above stays the SSR / no-JS / reduced-motion fallback. */
  .ache--enhanced .ache__track {
    /* Scroll length: one viewport of travel per beat, plus a lead viewport. */
    height: calc((var(--beat-count) + 1) * 100vh);
  }

  .ache--enhanced .ache__stage {
    position: sticky;
    top: 0;
    height: 100vh;
    padding-block: 0;
  }

  .ache--enhanced .ache__aura {
    animation: ache-breathe 8s ease-in-out infinite;
  }

  .ache--enhanced .ache__beats {
    display: block;
    position: relative;
    align-self: stretch;
    min-height: clamp(220px, 40vh, 360px);
  }

  .ache--enhanced .ache__beat {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: 100%;
    max-width: 32rem;
    margin: 0;
    opacity: 0;
    /* Enter offset composes over the centring `translate`. */
    transform: translateY(0.9rem) scale(0.99);
    filter: blur(3px);
    transition:
      opacity 0.85s var(--ease-out),
      transform 0.85s var(--ease-out),
      filter 0.85s var(--ease-out);
    pointer-events: none;
  }

  .ache--enhanced .ache__beat.is-active {
    opacity: 1;
    transform: none;
    filter: none;
  }

  .ache--enhanced .ache__progress {
    display: flex;
  }

  @keyframes ache-breathe {
    0%,
    100% {
      transform: scale(0.92);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.05);
      opacity: 0.78;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ache__aura {
      animation: none;
    }
    .ache__seg {
      transition: none;
    }
  }
</style>
