<!--
  @component FeelSection

  What a practice FEELS like (left) + what's inside (right) — SPEC §4.1 `feel`.
  The emotional left column carries the copy and the "free-taste" preview player
  (the prototype's visual centrepiece); the right column is the "what's inside"
  timeline whose ember spine stitches the inclusions together.

  TWO renderings, progressively enhanced:
  • BASELINE (SSR, no-JS, reduced-motion): a fully-legible two-column layout —
    all copy, the waveform drawn at rest, the inclusion timeline complete. This
    is what the server emits, so the section is never blank and never JS-gated.
  • ENHANCED (browser + motion OK): the prototype's cinematic language — blocks
    fade/rise into view on scroll (`use:reveal`, staggered), the free-taste
    player animates as a breathing equaliser with a live playhead + click-to-seek
    and a pulsing play ring, and the timeline markers rotate + glow on hover.

  Motion is layered on top of the accessible baseline and gated on
  `mounted && !reduced`; the reveal action self-arms from JS so no-JS never hides
  content, and the waveform bars are computed deterministically (pure, SSR-safe)
  so they paint identically on the server and the client.

  Prop contract is unchanged (eyebrow/heading/body/inclusions). The optional
  free-taste player reads `previewTitle`/`previewSub`/`previewDuration` DEFENSIVELY
  from the config bag (no shared-type change) and self-hides when unconfigured.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { asString, asObjectArray, fieldString } from '../coerce';
  import { reveal } from '../reveal';
  import type { FeelSectionProps, FeelInclusion, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: FeelSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    body: asString(config, 'body'),
    inclusions: asObjectArray<FeelInclusion>(config, 'inclusions', (entry) => {
      const label = fieldString(entry, 'label');
      if (!label) return null;
      return { label, detail: fieldString(entry, 'detail') };
    }),
  });

  // ── Optional free-taste player, read defensively from the config bag.
  //    Not in the frozen FeelSectionProps type (see desiredSharedChanges); read
  //    straight off `config` with the existing coercers so an absent/malformed
  //    field self-hides the player rather than throwing during SSR.
  const previewTitle = $derived(asString(config, 'previewTitle'));
  const previewSub = $derived(asString(config, 'previewSub'));
  const previewDuration = $derived.by(() => {
    const raw = config['previewDuration'];
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 480;
  });
  const hasPlayer = $derived(!!previewTitle);

  const inclusions = $derived(p.inclusions ?? []);
  const hasContent = $derived(
    !!(p.eyebrow || p.heading || p.body || inclusions.length > 0 || hasPlayer)
  );

  // ── Deterministic waveform — pure, so SSR and the client paint the same bars.
  //    Quiet at the ends, full through the middle, textured per-bar (matches the
  //    prototype's organic arch). Rendered at rest in the baseline; the equaliser
  //    animation + playhead are layered only once motion is confirmed welcome.
  const BAR_COUNT = 56;
  interface Bar {
    h: number;
    dur: number;
    delay: number;
  }
  const bars: Bar[] = (() => {
    const out: Bar[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i / (BAR_COUNT - 1);
      const env = 0.3 + 0.7 * Math.sin(Math.PI * x);
      const tex = 0.5 + 0.5 * Math.sin(i * 0.9) * Math.cos(i * 0.37);
      const h = Math.max(0.14, Math.min(1, env * (0.42 + 0.58 * Math.abs(tex))));
      out.push({
        h: Number((h * 100).toFixed(1)),
        dur: Number((0.85 + (i % 7) * 0.11).toFixed(2)),
        delay: Number(((i % 11) * 0.05).toFixed(2)),
      });
    }
    return out;
  })();

  let mounted = $state(false);
  let reduced = $state(false);

  // ── Mock free-taste transport (a visual "taste", no real audio — mirrors the
  //    prototype). `elapsed` advances via rAF only when motion is welcome.
  let playing = $state(false);
  let elapsed = $state(0);

  const enhanced = $derived(mounted && !reduced);
  const progress = $derived(previewDuration > 0 ? elapsed / previewDuration : 0);
  const playedBars = $derived(Math.round(progress * BAR_COUNT));
  const headPct = $derived(Math.min(Math.max(progress * 100, 0), 100));

  const fmt = (secs: number): string => {
    const s = Math.max(0, Math.min(previewDuration, Math.round(secs)));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const curLabel = $derived(fmt(elapsed));
  const totLabel = $derived(fmt(previewDuration));

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

  // Advance the playhead while playing (motion path only). Tears down on pause /
  // reduced-motion / unmount so no rAF leaks across the section's lifetime.
  $effect(() => {
    if (!playing || !enhanced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed += (now - last) / 1000;
      last = now;
      if (elapsed >= previewDuration) {
        elapsed = 0;
        playing = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function togglePlay() {
    playing = !playing;
  }

  function seek(event: MouseEvent) {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    elapsed = frac * previewDuration;
  }
</script>

{#if hasContent}
  <div class="feel">
    <div class="feel__inner">
      <div class="feel__grid">
        <!-- LEFT · what it feels like -->
        <div class="feel__col">
          {#if p.eyebrow || p.heading || p.body}
            <div class="feel-reveal" use:reveal>
              {#if p.eyebrow}
                <p class="feel__eyebrow">{p.eyebrow}</p>
              {/if}
              {#if p.heading}
                <h2 class="feel__heading">{p.heading}</h2>
              {/if}
              {#if p.body}
                <p class="feel__body">{p.body}</p>
              {/if}
            </div>
          {/if}

          {#if hasPlayer}
            <div class="feel__player feel-reveal d1" use:reveal>
              <div
                class="feel-taste"
                role="group"
                aria-label="Free taste — {previewTitle} preview"
              >
                <div class="feel-taste__aura" aria-hidden="true"></div>
                <div class="feel-taste__head">
                  <button
                    class="feel-play"
                    class:is-playing={playing}
                    type="button"
                    aria-pressed={playing}
                    aria-label={playing ? 'Pause preview' : 'Play preview'}
                    onclick={togglePlay}
                  >
                    {#if playing}
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1.2" />
                        <rect x="14" y="5" width="4" height="14" rx="1.2" />
                      </svg>
                    {:else}
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path
                          d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z"
                        />
                      </svg>
                    {/if}
                  </button>
                  <div class="feel-taste__meta">
                    <div class="feel-taste__title">{previewTitle}</div>
                    {#if previewSub}
                      <div class="feel-taste__sub">{previewSub}</div>
                    {/if}
                  </div>
                  <div class="feel-taste__time" aria-hidden="true">
                    <span class="feel-cur">{curLabel}</span>
                    <span class="feel-sep">/</span>
                    <span>{totLabel}</span>
                  </div>
                </div>

                <div
                  class="feel-wave"
                  class:is-playing={playing && enhanced}
                  role="presentation"
                  aria-hidden="true"
                  onclick={seek}
                >
                  {#each bars as bar, i (i)}
                    <i
                      class:is-on={i < playedBars}
                      style="--h: {bar.h}%; --d: {bar.dur}s; --delay: {bar.delay}s"
                    ></i>
                  {/each}
                  <span class="feel-wave__head" style="left: {headPct}%"></span>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <!-- RIGHT · what's inside -->
        {#if inclusions.length > 0}
          <div class="feel__col">
            <div class="feel__inside feel-reveal d2" use:reveal>
              <ul class="feel-list">
                {#each inclusions as inclusion, i (i)}
                  <li>
                    <span class="feel-list__m" aria-hidden="true">&#10022;</span>
                    <span class="feel-list__lead">{inclusion.label}</span>
                    {#if inclusion.detail}
                      <span class="feel-list__sub">{inclusion.detail}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .feel {
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .feel__inner {
    max-width: 68rem;
    margin-inline: auto;
  }

  .feel__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-12);
    align-items: stretch;
  }

  @media (width >= 54rem) {
    .feel__grid {
      grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
      gap: var(--space-16);
    }
  }

  .feel__col {
    display: flex;
    flex-direction: column;
  }

  .feel__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--color-brand-accent);
  }

  .feel__heading {
    margin: var(--space-3) 0 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .feel__body {
    margin: var(--space-4) 0 0;
    max-width: 46ch;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ═══ LEFT · the free-taste player ═══ */
  .feel__player {
    /* Pin to the base of the column so the tall left column fills, no void. */
    margin-top: auto;
    padding-top: var(--space-8);
  }

  .feel-taste {
    position: relative;
    border-radius: var(--radius-xl);
    padding: var(--space-6);
    background: linear-gradient(
      180deg,
      var(--color-surface-elevated),
      var(--color-surface-secondary)
    );
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 24%, var(--color-border-subtle));
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  /* Warm hearth glow inside the card — the breathing aura signature. */
  .feel-taste__aura {
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      120% 90% at 12% 0%,
      color-mix(in oklab, var(--color-brand-primary) 16%, transparent),
      transparent 58%
    );
  }

  .feel-taste__head,
  .feel-wave {
    position: relative;
    z-index: 1;
  }

  .feel-taste__head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  /* play / pause button */
  .feel-play {
    flex: none;
    position: relative;
    width: clamp(3.5rem, 8vw, 4.125rem);
    height: clamp(3.5rem, 8vw, 4.125rem);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--color-text-on-brand);
    background: linear-gradient(
      180deg,
      var(--color-brand-primary),
      var(--color-brand-accent)
    );
    box-shadow: var(--shadow-md);
    transition:
      transform var(--duration-fast) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
  }

  .feel-play:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }

  .feel-play:active {
    transform: translateY(0);
  }

  .feel-play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-heading);
    outline-offset: var(--space-1);
  }

  .feel-play svg {
    width: 42%;
    height: 42%;
    display: block;
  }

  /* pulse ring while playing */
  .feel-play::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 60%, transparent);
    opacity: 0;
    pointer-events: none;
  }

  .feel-play.is-playing::after {
    animation: feel-pulse 2s var(--ease-out) infinite;
  }

  @keyframes feel-pulse {
    0% {
      opacity: 0.55;
      transform: scale(1);
    }
    70%,
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }

  .feel-taste__meta {
    flex: 1 1 auto;
    min-width: 0;
  }

  .feel-taste__title {
    font-family: var(--font-heading);
    color: var(--color-heading);
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
  }

  .feel-taste__sub {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
    letter-spacing: 0.01em;
  }

  .feel-taste__time {
    flex: none;
    align-self: flex-start;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .feel-taste__time .feel-cur {
    color: var(--color-brand-accent);
  }

  .feel-taste__time .feel-sep {
    color: var(--color-text-tertiary);
    margin: 0 var(--space-1);
  }

  /* waveform = equaliser + scrubber in one */
  .feel-wave {
    margin-top: var(--space-6);
    height: clamp(3.625rem, 9vw, 4.625rem);
    display: flex;
    align-items: center;
    gap: 2px;
    cursor: pointer;
  }

  .feel-wave i {
    flex: 1 1 0;
    min-width: 0;
    height: var(--h, 40%);
    border-radius: var(--radius-xs);
    transform-origin: center;
    background: color-mix(in oklab, var(--color-text) 22%, transparent);
    transition: background var(--duration-slow) var(--ease-out);
  }

  .feel-wave i.is-on {
    background: linear-gradient(
      180deg,
      var(--color-brand-primary),
      var(--color-brand-accent)
    );
  }

  /* Equaliser dance — enhancement only (class gated on motion in the markup). */
  .feel-wave.is-playing i {
    animation: feel-eq var(--d, 1.1s) var(--ease-out) infinite;
    animation-delay: var(--delay, 0s);
  }

  @keyframes feel-eq {
    0%,
    100% {
      transform: scaleY(0.56);
    }
    50% {
      transform: scaleY(1);
    }
  }

  /* playhead */
  .feel-wave__head {
    position: absolute;
    top: 6%;
    bottom: 6%;
    width: 1.5px;
    background: color-mix(in oklab, var(--color-brand-accent) 85%, var(--color-heading));
    transform: translateX(-50%);
    box-shadow: 0 0 10px color-mix(in oklab, var(--color-brand-accent) 70%, transparent);
    transition: left var(--duration-fast) linear;
    pointer-events: none;
  }

  .feel-wave__head::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 9px;
    height: 9px;
    border-radius: var(--radius-full);
    transform: translate(-50%, -50%);
    background: var(--color-brand-accent);
    box-shadow:
      0 0 0 3px color-mix(in oklab, var(--color-background) 70%, transparent),
      0 0 12px color-mix(in oklab, var(--color-brand-accent) 80%, transparent);
  }

  /* ═══ RIGHT · what's inside ═══ */
  .feel__inside {
    margin-top: auto;
  }

  .feel-list {
    list-style: none;
    position: relative;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  /* the spine — a faint ember thread stitching the markers together */
  .feel-list::before {
    content: '';
    position: absolute;
    z-index: 0;
    left: calc(clamp(1.9rem, 3.5vw, 2.3rem) / 2);
    top: var(--space-4);
    bottom: var(--space-4);
    width: 1px;
    transform: translateX(-50%);
    background: linear-gradient(
      180deg,
      transparent,
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent) 12%,
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent) 88%,
      transparent
    );
  }

  .feel-list li {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: clamp(1.9rem, 3.5vw, 2.3rem) 1fr;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-4) 0;
  }

  .feel-list__m {
    grid-row: span 2;
    align-self: center;
    width: clamp(1.9rem, 3.5vw, 2.3rem);
    height: clamp(1.9rem, 3.5vw, 2.3rem);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    background: var(--color-surface-secondary);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 34%, transparent);
    color: var(--color-brand-accent);
    font-size: var(--text-sm);
    line-height: var(--leading-none);
    transition:
      transform var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out),
      color var(--duration-normal) var(--ease-out);
  }

  .feel-list li:hover .feel-list__m {
    transform: scale(1.12) rotate(90deg);
    border-color: var(--color-brand-primary);
    color: var(--color-heading);
    box-shadow: 0 0 22px -4px color-mix(in oklab, var(--color-brand-primary) 55%, transparent);
  }

  .feel-list__lead,
  .feel-list__sub {
    grid-column: 2;
  }

  .feel-list__lead {
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    color: var(--color-text);
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    transition: color var(--duration-slow) var(--ease-out);
  }

  .feel-list li:hover .feel-list__lead {
    color: var(--color-heading);
  }

  .feel-list__sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin-top: var(--space-1);
  }

  /* ── reveal-on-scroll: armed from JS (see reveal.ts) so SSR / no-JS / reduced
       motion paint the fully-revealed baseline and never get stuck hidden. ── */
  .feel-reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(var(--space-6));
    transition:
      opacity var(--duration-slower) var(--ease-out),
      transform var(--duration-slower) var(--ease-out);
  }

  .feel-reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .feel-reveal.d1 {
    transition-delay: 80ms;
  }

  .feel-reveal.d2 {
    transition-delay: 160ms;
  }

  @media (max-width: 54rem) {
    .feel__player,
    .feel__inside {
      margin-top: var(--space-6);
    }

    .feel__body {
      max-width: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .feel-reveal:global(.reveal--armed) {
      opacity: 1;
      transform: none;
      transition: none;
    }
    .feel-wave.is-playing i {
      animation: none;
    }
    .feel-play.is-playing::after {
      animation: none;
    }
    .feel-wave__head {
      transition: none;
    }
    .feel-list__m,
    .feel-list__lead {
      transition: none;
    }
  }
</style>
