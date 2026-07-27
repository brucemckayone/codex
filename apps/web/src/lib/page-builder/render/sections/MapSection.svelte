<!--
  @component MapSection

  The descent map (SPEC §4.1 `map`): the course's ordered stages, each a gate on
  a vertical spine with its concurrent pool of practices. This is the PUBLIC
  sales view — it renders from the awaited `context.stages` and shows NO progress
  and NO completion state (those belong to the member dashboard, WP-4). The
  practice's `completed` field is omitted server-side on the public page.

  TWO renderings, progressively enhanced (mirrors AcheSection):
  • BASELINE (SSR, no-JS, reduced-motion): every gate and practice card is fully
    lit and legible at once, the spine is drawn to full height. This is what the
    server emits, so the section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the prototype's cinematic descent — a single
    monotonic scroll value grows the ember spine downward, and as the drawn edge
    passes each gate node that gate ignites in turn (node warms, its meta rises,
    its concurrent practice cards fade up with a stagger). The header + closing
    note fade/rise in on scroll via the shared `reveal` action.

  Enhancement is gated on `mounted && !reduced` (the `descent--enhanced` class),
  so the accessible baseline always ships first; the scroll math lives in an
  `$effect` that re-wires if the reduced-motion preference flips mid-session.

  CONTRACT GAP (flagged for the conductor): the prototype's free-taste door — a
  single "free" practice badge on the map — has no field on the frozen
  `JourneyPracticeView`. It is intentionally NOT rendered here to keep typecheck
  clean; when WP-6/WP-2 add a public `isFree`/`preview` flag to the practice
  read-model, add the badge here (additive). Likewise per-practice minutes and a
  total-minutes stat need new read-model fields before they can surface.
-->
<script lang="ts">
  import { asString } from '../coerce';
  import { reveal } from '../reveal';
  import type { MapSectionProps, JourneySalesContext } from '../types';
  import type { JourneyContentType, SectionProps } from '$lib/page-builder';
  import { onMount } from 'svelte';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
  }

  const { config, context }: Props = $props();

  const p: MapSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    title: asString(config, 'title'),
    sub: asString(config, 'sub'),
    foot: asString(config, 'foot'),
  });

  const stages = $derived(
    [...context.stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const title = $derived(p.title ?? "Everything you'll walk.");

  const CONTENT_TYPE_LABEL: Record<JourneyContentType, string> = {
    video: 'Practice',
    audio: 'Audio',
    written: 'Reflection',
  };

  const CONTENT_TYPE_GLYPH: Record<JourneyContentType, string> = {
    video: '▶',
    audio: '♪',
    written: '✎',
  };

  const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

  function typeLabel(type: string): string {
    return CONTENT_TYPE_LABEL[type as JourneyContentType] ?? 'Practice';
  }

  function typeGlyph(type: string): string {
    return CONTENT_TYPE_GLYPH[type as JourneyContentType] ?? '•';
  }

  function roman(index: number): string {
    return ROMAN[index] ?? String(index + 1);
  }

  // ── Progressive enhancement state ──
  let mounted = $state(false);
  let reduced = $state(false);
  let bodyEl = $state<HTMLElement | undefined>(undefined);
  let drawEl = $state<HTMLElement | undefined>(undefined);
  // How many leading gates have been reached by the descending ember (monotonic).
  let litCount = $state(0);

  // The descent needs motion + at least one gate to ignite.
  const enhanced = $derived(mounted && !reduced && stages.length > 0);

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

  // Scroll driver: a single monotonic "reach" value grows the spine draw and,
  // as its drawn edge passes each gate node's centre, lights that gate + pool.
  // Re-runs (and tears down) whenever `enhanced` or the body element flips.
  $effect(() => {
    if (!enhanced || !bodyEl) return;
    const body = bodyEl;
    const draw = drawEl;
    let maxDrawn = 0;
    // Non-reactive high-water mark so we never read `litCount` inside the effect
    // (a read+write of the same state would loop the effect).
    let litLocal = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const br = body.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const ref = vh * 0.62; // the descending "reach" line
      const drawn = Math.max(0, Math.min(br.height, ref - br.top));
      if (drawn > maxDrawn) maxDrawn = drawn; // monotonic — the path stays walked
      if (draw) draw.style.height = `${maxDrawn}px`;

      const nodes = body.querySelectorAll<HTMLElement>('.descent__node');
      let lit = 0;
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        const cy = r.top - br.top + r.height / 2; // node centre, relative to body top
        if (maxDrawn >= cy - 6) lit = i + 1;
      }
      if (lit > litLocal) {
        litLocal = lit;
        litCount = lit;
      }
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    const onResize = () => {
      maxDrawn = 0;
      onScroll();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(onScroll).catch(() => {});
    }
    const raf = requestAnimationFrame(update);
    const settle = setTimeout(update, 400);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  });
</script>

{#if stages.length > 0}
  <div class="descent" class:descent--enhanced={enhanced}>
    <div class="descent__inner">
      <header class="descent__head reveal" use:reveal>
        {#if p.eyebrow}
          <p class="descent__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="descent__title">{title}</h2>
        {#if p.sub}
          <p class="descent__sub">{p.sub}</p>
        {/if}
        <p class="descent__stats">
          <span class="descent__stat">
            <b>{context.course.stageCount}</b> stages
          </span>
          <span class="descent__stat">
            <b>{context.course.practiceCount}</b> practices
          </span>
        </p>
      </header>

      <div class="descent__body" bind:this={bodyEl}>
        <div class="descent__spine" aria-hidden="true">
          <span class="descent__spine-track"></span>
          <span class="descent__spine-draw" bind:this={drawEl}></span>
        </div>

        <ol class="descent__stages">
          {#each stages as stage, i (stage.id)}
            {@const lit = !enhanced || i < litCount}
            <li class="descent__band" class:is-lit={lit}>
              <div class="descent__gate">
                <span class="descent__node" aria-hidden="true">
                  <span class="descent__rn">{roman(i)}</span>
                </span>
                <div class="descent__gate-meta">
                  <h3 class="descent__gate-name">{stage.name}</h3>
                  {#if stage.gloss}
                    <p class="descent__gloss">{stage.gloss}</p>
                  {/if}
                </div>
              </div>

              {#if stage.practices.length > 0}
                <div class="descent__practices">
                  {#each [...stage.practices].sort((a, b) => a.sortOrder - b.sortOrder) as practice (practice.contentId)}
                    <article class="descent__card">
                      <div class="descent__card-top">
                        <span class="descent__card-type">
                          <span class="descent__card-glyph" aria-hidden="true"
                            >{typeGlyph(practice.contentType)}</span
                          >
                          {typeLabel(practice.contentType)}
                        </span>
                        <span class="descent__card-lock" aria-hidden="true">🔒</span>
                      </div>
                      <h4 class="descent__card-title">{practice.title}</h4>
                      <span class="descent__sr">included with membership</span>
                    </article>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      </div>

      {#if p.foot}
        <p class="descent__foot reveal" use:reveal>{p.foot}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .descent {
    --descent-node: clamp(2.75rem, 5vw, 3.75rem);
    --descent-spine-x: calc(var(--descent-node) / 2);
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .descent__inner {
    max-width: 60rem;
    margin-inline: auto;
  }

  /* ── header ── */
  .descent__head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 48rem;
    margin: 0 auto var(--space-12);
    text-align: center;
  }

  .descent__eyebrow {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .descent__title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .descent__sub {
    margin: 0;
    max-width: 44rem;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
  }

  .descent__stat {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    background: var(--color-surface-secondary);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .descent__stat b {
    font-family: var(--font-heading);
    font-weight: var(--font-semibold);
    color: var(--color-brand-primary);
  }

  /* ── the spine + stack ── */
  .descent__body {
    position: relative;
  }

  .descent__spine {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--descent-spine-x);
    width: var(--border-width-thick);
    transform: translateX(-50%);
    z-index: 0;
    pointer-events: none;
  }

  .descent__spine-track {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-full);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 2%, transparent),
      color-mix(in oklab, var(--color-border) 90%, transparent) 12%,
      color-mix(in oklab, var(--color-border) 90%, transparent) 88%,
      color-mix(in oklab, var(--color-heading) 2%, transparent)
    );
  }

  /* Baseline: the spine reads as fully drawn (no JS to animate it). */
  .descent__spine-draw {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-full);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-brand-accent) 45%, transparent),
      var(--color-brand-accent)
    );
    box-shadow: 0 0 10px color-mix(in oklab, var(--color-brand-accent) 60%, transparent);
  }

  /* The glowing edge dot only rides the draw while it is animating. */
  .descent__spine-draw::after {
    content: '';
    display: none;
    position: absolute;
    bottom: -3px;
    left: 50%;
    width: 9px;
    height: 9px;
    transform: translateX(-50%);
    border-radius: var(--radius-full);
    background: var(--color-brand-accent);
    box-shadow: 0 0 12px 2px color-mix(in oklab, var(--color-brand-accent) 75%, transparent);
  }

  .descent__stages {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* ── a band: [gate] [concurrent practices] ── */
  .descent__band {
    position: relative;
    display: grid;
    grid-template-columns: minmax(13rem, 16.5rem) minmax(0, 1fr);
    column-gap: var(--space-8);
    align-items: start;
  }

  /* gate = spine node + name/gloss */
  .descent__gate {
    display: grid;
    grid-template-columns: var(--descent-node) minmax(0, 1fr);
    column-gap: var(--space-4);
    align-items: start;
  }

  .descent__node {
    grid-row: 1 / span 2;
    width: var(--descent-node);
    height: var(--descent-node);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    /* Baseline / lit look — the final warm state. */
    background: radial-gradient(
      circle at 50% 34%,
      color-mix(in oklab, var(--color-brand-accent) 26%, var(--color-surface-secondary)),
      var(--color-surface)
    );
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-accent) 60%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in oklab, var(--color-brand-accent) 22%, transparent),
      0 10px 34px -14px color-mix(in oklab, var(--color-brand-accent) 80%, transparent),
      inset 0 1px 0 color-mix(in oklab, var(--color-heading) 12%, transparent);
  }

  .descent__rn {
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: var(--text-lg);
    color: var(--color-brand-accent);
  }

  .descent__gate-meta {
    padding-top: var(--space-0-5);
  }

  .descent__gate-name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.01em;
    color: var(--color-heading);
  }

  .descent__gloss {
    margin: var(--space-2) 0 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* the concurrent pool — peers side by side, wrap as needed */
  .descent__practices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .descent__card {
    position: relative;
    flex: 1 1 11rem;
    min-width: 0;
    padding: var(--space-4);
    border-radius: var(--radius-card);
    background: var(--color-surface-secondary);
    border: var(--border-width) solid var(--color-border-subtle);
  }

  .descent__card:hover {
    border-color: color-mix(in oklab, var(--color-brand-accent) 45%, transparent);
    background: var(--color-surface);
    box-shadow: 0 12px 34px -20px color-mix(in oklab, var(--color-brand-accent) 60%, transparent);
  }

  .descent__card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .descent__card-type {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .descent__card-glyph {
    color: var(--color-brand-accent);
    font-size: var(--text-xs);
  }

  .descent__card-lock {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    flex: none;
  }

  .descent__card-title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-base);
    line-height: var(--leading-snug);
    color: var(--color-heading);
  }

  /* closing note */
  .descent__foot {
    margin: var(--space-12) 0 0;
    padding-top: var(--space-8);
    border-top: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-accent) 14%, transparent);
    text-align: center;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── shared reveal action (header + foot): armed only from JS, so SSR / no-JS
     paints the revealed state. ── */
  .reveal {
    opacity: 1;
  }
  .reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(var(--space-4));
    transition:
      opacity 0.7s var(--ease-out),
      transform 0.7s var(--ease-out);
  }
  .reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  /* ── ENHANCED: the ember descent ──
     Only applied when JS has confirmed motion is welcome (`.descent--enhanced`);
     the baseline above stays the SSR / no-JS / reduced-motion fallback. */

  /* Start the draw empty; the scroll driver sets its height in px. */
  .descent--enhanced .descent__spine-draw {
    height: 0;
    transition: height 0.22s var(--ease-out);
  }
  .descent--enhanced .descent__spine-draw::after {
    display: block;
  }

  /* Transitions live on the always-matching enhanced selector so the un-lit →
     lit change animates in both directions. */
  .descent--enhanced .descent__node {
    transition:
      opacity 0.6s var(--ease-out),
      transform 0.6s var(--ease-out),
      border-color 0.6s var(--ease-out),
      box-shadow 0.6s var(--ease-out),
      background 0.6s var(--ease-out);
  }
  .descent--enhanced .descent__rn {
    transition: color 0.6s var(--ease-out);
  }
  .descent--enhanced .descent__gate-meta {
    transition:
      opacity 0.7s var(--ease-out),
      transform 0.7s var(--ease-out);
  }
  .descent--enhanced .descent__card {
    transition:
      opacity 0.7s var(--ease-out),
      transform 0.7s var(--ease-out),
      border-color 0.3s var(--ease-out),
      background 0.3s var(--ease-out),
      box-shadow 0.3s var(--ease-out);
  }

  /* Armed (pre-lit) hidden/dim state — enhanced only. */
  .descent--enhanced .descent__band:not(.is-lit) .descent__node {
    opacity: 0.48;
    transform: scale(0.94);
    border-color: var(--color-border-subtle);
    background: var(--color-surface-secondary);
    box-shadow: inset 0 1px 0 color-mix(in oklab, var(--color-heading) 8%, transparent);
  }
  .descent--enhanced .descent__band:not(.is-lit) .descent__rn {
    color: var(--color-text-tertiary);
  }
  .descent--enhanced .descent__band:not(.is-lit) .descent__gate-meta {
    opacity: 0;
    transform: translateY(var(--space-4));
  }
  .descent--enhanced .descent__band:not(.is-lit) .descent__card {
    opacity: 0;
    transform: translateY(var(--space-5));
  }

  /* concurrent-pool stagger as a band ignites */
  .descent--enhanced .descent__band.is-lit .descent__card:nth-child(2) {
    transition-delay: 0.06s;
  }
  .descent--enhanced .descent__band.is-lit .descent__card:nth-child(3) {
    transition-delay: 0.12s;
  }
  .descent--enhanced .descent__band.is-lit .descent__card:nth-child(4) {
    transition-delay: 0.18s;
  }

  /* ── mobile: stack cleanly — gate (node + name + gloss), then its practices ── */
  @media (max-width: 45rem) {
    .descent__band {
      display: block;
      position: relative;
      padding-left: calc(var(--descent-node) + var(--space-4));
    }
    .descent__gate {
      display: block;
    }
    .descent__node {
      position: absolute;
      top: 0;
      left: 0;
    }
    .descent__gate-meta {
      padding-top: var(--space-1);
    }
    .descent__gloss {
      max-width: 46ch;
    }
    .descent__practices {
      margin-top: var(--space-4);
    }
    .descent__card {
      flex: 1 1 8.25rem;
    }
  }

  @media (max-width: 24rem) {
    .descent__card {
      flex-basis: 100%;
    }
  }

  /* ── reduced motion: everything shown, nothing draws ── */
  @media (prefers-reduced-motion: reduce) {
    .descent__spine-draw {
      transition: none;
    }
    .descent__spine-draw::after {
      display: none;
    }
    .descent__node,
    .descent__rn,
    .descent__gate-meta,
    .descent__card {
      transition: none;
    }
    .reveal:global(.reveal--armed) {
      transition: none;
    }
  }
</style>
