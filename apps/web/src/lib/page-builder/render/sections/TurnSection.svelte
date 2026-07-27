<!--
  @component TurnSection

  The pivot from pain to promise, and the descent into the staged arc
  (SPEC §4.1 `turn`). A two-column composition on wide viewports — the framing
  statement + lede (left), and a numbered "descent arc" of supporting points
  (right) threaded by a rail that draws downward into a warm root. Stacks on
  narrow. Renders nothing when neither a statement nor a lede is configured.

  TWO renderings, progressively enhanced (mirrors AcheSection):
  • BASELINE (SSR, no-JS, reduced-motion): the fully-composed, fully-legible
    layout — statement, lede, thread, arc rail (drawn), root and every stage
    visible at once. This is what the server emits, so the section is never
    blank and never depends on JS.
  • ENHANCED (browser + motion OK): the prototype's cinematic reveal-on-scroll —
    headline/lede rise in, the thread stretches out, the arc rail draws down
    into the root, and the stages stagger up as their roman numerals warm to
    the brand accent.

  Motion is layered via the shared `reveal` action on the root: it arms the
  hidden state from JS (`reveal--armed`) and flips `is-in` when the section
  scrolls into view — so the accessible baseline always ships first, and
  reduced-motion / no-JS clients get the composed state with no armed hiding.
-->
<script lang="ts">
  import { asString, asStringArray } from '../coerce';
  import { reveal } from '../reveal';
  import type { TurnSectionProps, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: TurnSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    statement: asString(config, 'statement'),
    lede: asString(config, 'lede'),
    points: asStringArray(config, 'points'),
  });

  /** Lowercase roman numeral for a 1-based stage index (i, ii, iii, …). */
  function toRoman(n: number): string {
    const table: [number, string][] = [
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ];
    let value = n;
    let out = '';
    for (const [amount, symbol] of table) {
      while (value >= amount) {
        out += symbol;
        value -= amount;
      }
    }
    return out || `${n}`;
  }

  /**
   * A point may carry an optional gloss after a dash separator
   * ("Regulation — finding the ground"). The bold name is everything before the
   * first en/em dash; the gloss is the remainder. A plain point degrades to a
   * name-only stage. Reads within the frozen `points: string[]` contract.
   */
  const stages = $derived(
    (p.points ?? []).map((raw, i) => {
      const match = raw.match(/\s+[—–]\s+/);
      if (match && match.index !== undefined) {
        return {
          roman: toRoman(i + 1),
          name: raw.slice(0, match.index).trim(),
          gloss: raw.slice(match.index + match[0].length).trim() || undefined,
        };
      }
      return { roman: toRoman(i + 1), name: raw, gloss: undefined };
    })
  );
</script>

{#if p.statement || p.lede}
  <div class="turn" use:reveal>
    <div class="turn__well" aria-hidden="true"></div>
    <div class="turn__inner">
      <div class="turn__grid">
        <div class="turn__head">
          {#if p.eyebrow}
            <p class="turn__eyebrow">{p.eyebrow}</p>
          {/if}
          {#if p.statement}
            <h2 class="turn__statement">{p.statement}</h2>
          {/if}
          {#if p.lede}
            <p class="turn__lede">{p.lede}</p>
          {/if}
          <div class="turn__thread" aria-hidden="true"></div>
        </div>

        {#if stages.length > 0}
          <div class="turn__arc">
            <span class="turn__rail turn__rail--base" aria-hidden="true"></span>
            <span class="turn__rail turn__rail--progress" aria-hidden="true"></span>
            <span class="turn__root" aria-hidden="true"></span>
            <ol class="turn__stages" aria-label="The stages of the descent">
              {#each stages as stage, i (i)}
                <li class="turn__stage" style="--d: {i}">
                  <span class="turn__num" aria-hidden="true">{stage.roman}</span>
                  <div class="turn__stage-body">
                    <h3 class="turn__name">{stage.name}</h3>
                    {#if stage.gloss}
                      <p class="turn__gloss">{stage.gloss}</p>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ═══ THE TURN — the pivot, and the descent into the staged arc ═══ */

  .turn {
    position: relative;
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
    overflow: clip;
    isolation: isolate;
    text-align: left;
  }

  /* A warm well the eye descends toward — atmosphere behind the arc. */
  .turn__well {
    position: absolute;
    z-index: -1;
    left: 62%;
    bottom: -16%;
    width: min(115%, 60rem);
    aspect-ratio: 1;
    translate: -50% 0;
    pointer-events: none;
    filter: blur(var(--blur-xl));
    background: radial-gradient(
      circle at 50% 50%,
      color-mix(in oklab, var(--color-brand-accent) 15%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 11%, transparent) 40%,
      transparent 66%
    );
  }

  .turn__inner {
    max-width: 68rem;
    margin-inline: auto;
  }

  .turn__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-12);
  }

  @media (--breakpoint-md) {
    .turn__grid {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: var(--space-16);
      align-items: center;
    }

    .turn__well {
      left: 50%;
      bottom: 4%;
      width: min(140%, 44rem);
    }
  }

  /* ── left: the statement (pain → promise) ── */
  .turn__head {
    max-width: 34ch;
  }

  .turn__eyebrow {
    display: block;
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .turn__statement {
    margin: 0;
    max-width: 32ch;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.02em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  .turn__lede {
    margin: var(--space-5) 0 0;
    max-width: 40ch;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* Decorative thread — the descent begins here. */
  .turn__thread {
    margin-top: var(--space-8);
    width: clamp(3rem, 6vw, 5rem);
    height: 2px;
    border-radius: var(--radius-full);
    transform-origin: left center;
    opacity: 0.85;
    background: linear-gradient(
      90deg,
      var(--color-brand-accent),
      transparent
    );
  }

  /* ── right: the descent arc ── */
  .turn__arc {
    position: relative;
    padding-left: var(--space-2);
  }

  /* The rail: faint base + accent progress that draws downward. */
  .turn__rail {
    position: absolute;
    left: var(--space-1);
    top: var(--space-6);
    bottom: var(--space-6);
    width: 2px;
    translate: -50% 0;
    border-radius: var(--radius-full);
  }

  .turn__rail--base {
    opacity: 0.32;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 24%, transparent),
      color-mix(in oklab, var(--color-brand-accent) 55%, transparent)
    );
  }

  .turn__rail--progress {
    transform-origin: top center;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-brand-accent) 28%, transparent),
      var(--color-brand-accent)
    );
    box-shadow: 0 0 12px color-mix(in oklab, var(--color-brand-accent) 45%, transparent);
  }

  /* The root — where the descent lands. */
  .turn__root {
    position: absolute;
    left: var(--space-1);
    bottom: var(--space-6);
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full);
    translate: -50% 50%;
    background: radial-gradient(
      circle,
      var(--color-brand-accent),
      color-mix(in oklab, var(--color-brand-accent) 22%, transparent) 66%,
      transparent
    );
    box-shadow: 0 0 18px 3px color-mix(in oklab, var(--color-brand-accent) 42%, transparent);
  }

  .turn__stages {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .turn__stage {
    position: relative;
    display: grid;
    grid-template-columns: clamp(3rem, 6vw, 4.4rem) 1fr;
    column-gap: clamp(0.7rem, 1.8vw, 1.3rem);
    align-items: baseline;
    padding-block: var(--space-5);
  }

  .turn__stage + .turn__stage {
    border-top: 1px solid color-mix(in oklab, var(--color-heading) 8%, transparent);
  }

  .turn__num {
    grid-column: 1;
    justify-self: start;
    padding-left: clamp(0.7rem, 1.6vw, 1.2rem);
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: var(--text-3xl);
    line-height: var(--leading-none);
    letter-spacing: 0.02em;
    color: color-mix(
      in oklab,
      var(--color-brand-accent) calc(58% + var(--d, 0) * 10%),
      var(--color-text-secondary)
    );
    transition: color var(--duration-slowest) var(--ease-out);
  }

  .turn__stage-body {
    grid-column: 2;
    padding-left: calc(var(--d, 0) * clamp(0px, 1vw, 15px));
  }

  .turn__name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.005em;
    color: var(--color-heading);
  }

  .turn__gloss {
    margin: var(--space-2) 0 0;
    max-width: 46ch;
    font-size: var(--text-base);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  /* ── ENHANCED: reveal-on-scroll (armed from JS by `use:reveal`) ──
     Hidden states apply ONLY while armed and not yet in-view. Reduced-motion /
     no-JS clients get `is-in` without `reveal--armed`, so these never bite and
     the composed baseline above renders as-is. */
  .turn:global(.reveal--armed) .turn__eyebrow,
  .turn:global(.reveal--armed) .turn__statement,
  .turn:global(.reveal--armed) .turn__lede {
    opacity: 0;
    transform: translateY(1rem);
    transition:
      opacity var(--duration-slowest) var(--ease-out),
      transform var(--duration-slowest) var(--ease-out);
  }

  .turn:global(.reveal--armed) .turn__statement {
    transition-delay: 60ms;
  }

  .turn:global(.reveal--armed) .turn__lede {
    transition-delay: 120ms;
  }

  .turn:global(.reveal--armed.is-in) .turn__eyebrow,
  .turn:global(.reveal--armed.is-in) .turn__statement,
  .turn:global(.reveal--armed.is-in) .turn__lede {
    opacity: 1;
    transform: none;
  }

  .turn:global(.reveal--armed) .turn__thread {
    opacity: 0;
    transform: scaleX(0);
    transition:
      transform var(--duration-slowest) var(--ease-out) 200ms,
      opacity var(--duration-slower) var(--ease-out) 200ms;
  }

  .turn:global(.reveal--armed.is-in) .turn__thread {
    opacity: 0.85;
    transform: none;
  }

  .turn:global(.reveal--armed) .turn__stage {
    opacity: 0;
    transform: translateY(1.125rem);
    transition:
      opacity var(--duration-slowest) var(--ease-out),
      transform var(--duration-slowest) var(--ease-out);
    transition-delay: calc(var(--d) * 110ms);
  }

  .turn:global(.reveal--armed.is-in) .turn__stage {
    opacity: 1;
    transform: none;
  }

  .turn:global(.reveal--armed) .turn__num {
    color: var(--color-text-tertiary);
  }

  .turn:global(.reveal--armed.is-in) .turn__num {
    color: color-mix(
      in oklab,
      var(--color-brand-accent) calc(58% + var(--d, 0) * 10%),
      var(--color-text-secondary)
    );
  }

  .turn:global(.reveal--armed) .turn__rail--progress {
    transform: scaleY(0);
    transition: transform calc(var(--duration-slowest) * 2) var(--ease-smooth) 150ms;
  }

  .turn:global(.reveal--armed.is-in) .turn__rail--progress {
    transform: scaleY(1);
  }

  .turn:global(.reveal--armed) .turn__root {
    opacity: 0;
    transform: scale(0.4);
    transition:
      opacity var(--duration-slowest) var(--ease-out) 1000ms,
      transform var(--duration-slowest) var(--ease-out) 1000ms;
  }

  .turn:global(.reveal--armed.is-in) .turn__root {
    opacity: 1;
    transform: none;
  }

  /* Belt-and-suspenders: if motion preference flips after arming, force the
     composed state (the `reveal` action already withholds arming under
     reduced-motion, but this guarantees no lingering hidden state). */
  @media (prefers-reduced-motion: reduce) {
    .turn:global(.reveal--armed) .turn__eyebrow,
    .turn:global(.reveal--armed) .turn__statement,
    .turn:global(.reveal--armed) .turn__lede,
    .turn:global(.reveal--armed) .turn__thread,
    .turn:global(.reveal--armed) .turn__stage,
    .turn:global(.reveal--armed) .turn__root {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }

    .turn:global(.reveal--armed) .turn__rail--progress {
      transform: scaleY(1) !important;
      transition: none !important;
    }

    .turn:global(.reveal--armed) .turn__num {
      color: color-mix(
        in oklab,
        var(--color-brand-accent) calc(58% + var(--d, 0) * 10%),
        var(--color-text-secondary)
      ) !important;
      transition: none !important;
    }
  }
</style>
