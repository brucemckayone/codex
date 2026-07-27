<!--
  @component FaqSection

  The honest answers (SPEC §4.1 `faq`) — an objection-handling accordion.

  TWO renderings, progressively enhanced:
  • BASELINE (SSR, no-JS, reduced-motion): native <details>/<summary> — a
    fully-legible, keyboard-operable accordion that toggles instantly with zero
    JS. This is what the server emits, so the section is never blank and never
    depends on JS for its core behaviour (WAI-ARIA + keyboard come for free).
  • ENHANCED (browser + motion OK): the prototype's cinematic language — each
    row fades/rises into view on scroll (`use:reveal`, staggered), the +/− glyph
    morphs between states, the question text and glyph warm on hover/open, and
    the answer panel animates its height smoothly (`use:smoothDetails`) instead
    of snapping.

  Motion is layered on top of the accessible baseline: the reveal action
  self-arms from JS so no-JS never hides content, and `smoothDetails` bails to
  the browser's instant native toggle under `prefers-reduced-motion`.

  Prop contract is unchanged (eyebrow/heading/items) — same coercers, same
  self-hide-when-unconfigured guard.
-->
<script lang="ts">
  import { asString, asObjectArray, fieldString } from '../coerce';
  import { reveal } from '../reveal';
  import type { FaqSectionProps, FaqEntry, JourneySalesContext } from '../types';
  import type { SectionProps } from '$lib/page-builder';

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
  }

  const { config }: Props = $props();

  const p: FaqSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    items: asObjectArray<FaqEntry>(config, 'items', (entry) => {
      const question = fieldString(entry, 'question');
      const answer = fieldString(entry, 'answer');
      if (!question || !answer) return null;
      return { question, answer };
    }),
  });

  const heading = $derived(p.heading ?? 'The honest answers.');
  const items = $derived(p.items ?? []);

  // Stagger cap — mirrors the prototype's .faq-r1…r5 delay ladder.
  const delayClass = (i: number): string => `d${Math.min(i + 1, 5)}`;

  // ── ENHANCEMENT: smooth open/close height.
  //    A client-only Svelte action (never runs during SSR). Keeps native
  //    <details> as the source of truth; under reduced-motion it does nothing
  //    and lets the browser toggle instantly — the accessible baseline. Read at
  //    click time so a mid-session preference flip is always respected.
  function smoothDetails(node: HTMLDetailsElement) {
    const summary = node.querySelector<HTMLElement>('.faq__q');
    const panel = node.querySelector<HTMLElement>('.faq__panel');
    if (!summary || !panel) return;

    let animating = false;

    const prefersReduced = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onClick = (event: MouseEvent) => {
      // Reduced motion (or no measurable panel): let the browser toggle instantly.
      if (prefersReduced()) return;
      event.preventDefault();
      if (animating) return;

      if (node.open) {
        // ── closing ──
        animating = true;
        panel.style.height = `${panel.scrollHeight}px`;
        requestAnimationFrame(() => {
          panel.style.height = '0px';
        });
        const onEnd = (ev: TransitionEvent) => {
          if (ev.propertyName !== 'height') return;
          panel.removeEventListener('transitionend', onEnd);
          node.open = false;
          panel.style.height = '';
          animating = false;
        };
        panel.addEventListener('transitionend', onEnd);
      } else {
        // ── opening ──
        animating = true;
        node.open = true; // reveal content so it can be measured
        const target = panel.scrollHeight;
        panel.style.height = '0px';
        requestAnimationFrame(() => {
          panel.style.height = `${target}px`;
        });
        const onEnd = (ev: TransitionEvent) => {
          if (ev.propertyName !== 'height') return;
          panel.removeEventListener('transitionend', onEnd);
          panel.style.height = ''; // let it flow at natural height
          animating = false;
        };
        panel.addEventListener('transitionend', onEnd);
      }
    };

    summary.addEventListener('click', onClick);
    return {
      destroy() {
        summary.removeEventListener('click', onClick);
      },
    };
  }
</script>

{#if items.length > 0}
  <div class="faq">
    <div class="faq__inner">
      <header class="faq__head faq-reveal" use:reveal>
        {#if p.eyebrow}
          <p class="faq__eyebrow">{p.eyebrow}</p>
        {/if}
        <h2 class="faq__heading">{heading}</h2>
        <div class="faq__rule" aria-hidden="true"></div>
      </header>

      <div class="faq__list">
        {#each items as item, i (i)}
          <details
            class="faq__item faq-reveal {delayClass(i)}"
            use:reveal
            use:smoothDetails
          >
            <summary class="faq__q">
              <span class="faq__q-text">{item.question}</span>
              <span class="faq__ic" aria-hidden="true"></span>
            </summary>
            <div class="faq__panel">
              <div class="faq__panel-inner">
                <p class="faq__a">{item.answer}</p>
              </div>
            </div>
          </details>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .faq {
    padding-block: var(--space-20);
    padding-inline: var(--space-5);
  }

  .faq__inner {
    max-width: 48rem;
    margin-inline: auto;
  }

  /* ── header ── */
  .faq__head {
    text-align: center;
    margin-bottom: var(--space-10);
  }

  .faq__eyebrow {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--color-brand-accent);
  }

  .faq__heading {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-4xl);
    line-height: var(--leading-tight);
    letter-spacing: -0.015em;
    color: var(--color-heading);
    text-wrap: balance;
  }

  /* ceremonial ember hairline under the heading */
  .faq__rule {
    width: 3rem;
    height: 1px;
    margin: var(--space-6) auto 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--color-brand-accent) 60%, transparent),
      transparent
    );
  }

  /* ── list ── */
  .faq__list {
    border-top: var(--border-width) solid var(--color-border-subtle);
  }

  .faq__item {
    border-bottom: var(--border-width) solid var(--color-border-subtle);
  }

  /* summary = the question row */
  .faq__q {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    padding-block: var(--space-5);
    list-style: none;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .faq__q::-webkit-details-marker {
    display: none;
  }

  .faq__q::marker {
    content: '';
  }

  .faq__q-text {
    flex: 1;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--text-xl);
    line-height: var(--leading-snug);
    letter-spacing: -0.005em;
    color: var(--color-text);
    transition: color var(--duration-normal) var(--ease-out);
  }

  .faq__item:hover .faq__q-text,
  .faq__item[open] .faq__q-text {
    color: var(--color-heading);
  }

  /* keyboard focus ring lives on the text, not the whole row */
  .faq__q:focus-visible .faq__q-text {
    color: var(--color-heading);
    text-decoration: underline;
    text-decoration-color: color-mix(
      in oklab,
      var(--color-brand-accent) 70%,
      transparent
    );
    text-underline-offset: var(--space-1);
  }

  /* ── the +/− indicator ── */
  .faq__ic {
    position: relative;
    flex: none;
    width: var(--space-9);
    height: var(--space-9);
    margin-top: 2px;
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-brand-primary) 26%, transparent);
    transition:
      border-color var(--duration-slow) var(--ease-out),
      background var(--duration-slow) var(--ease-out);
  }

  .faq__item:hover .faq__ic,
  .faq__item[open] .faq__ic {
    border-color: color-mix(
      in oklab,
      var(--color-brand-primary) 62%,
      transparent
    );
    background: color-mix(in oklab, var(--color-brand-primary) 8%, transparent);
  }

  .faq__ic::before,
  .faq__ic::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0.75rem;
    height: 1.5px;
    border-radius: var(--radius-xs);
    background: var(--color-brand-accent);
    transform: translate(-50%, -50%);
    transition:
      transform var(--duration-slow) var(--ease-out),
      opacity var(--duration-slow) var(--ease-out);
  }

  /* vertical bar of the plus — collapses to leave a minus on open */
  .faq__ic::after {
    transform: translate(-50%, -50%) rotate(90deg);
  }

  .faq__item[open] .faq__ic::after {
    transform: translate(-50%, -50%) rotate(0deg);
    opacity: 0;
  }

  /* ── answer panel ── */
  .faq__panel {
    overflow: hidden;
    transition: height var(--duration-slow) var(--ease-out);
  }

  .faq__panel-inner {
    padding-block: 0 var(--space-5);
    padding-inline: 0 var(--space-12);
  }

  .faq__a {
    margin: 0;
    max-width: 60ch;
    font-family: var(--font-body);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
    opacity: 0;
    transform: translateY(var(--space-1));
    transition:
      opacity var(--duration-slower) var(--ease-out),
      transform var(--duration-slower) var(--ease-out);
  }

  .faq__item[open] .faq__a {
    opacity: 1;
    transform: none;
  }

  /* ── reveal-on-scroll: armed from JS (see reveal.ts) so SSR / no-JS / reduced
       motion paint the fully-revealed baseline and never get stuck hidden. ── */
  .faq-reveal:global(.reveal--armed) {
    opacity: 0;
    transform: translateY(var(--space-6));
    transition:
      opacity var(--duration-slower) var(--ease-out),
      transform var(--duration-slower) var(--ease-out);
  }

  .faq-reveal:global(.reveal--armed.is-in) {
    opacity: 1;
    transform: none;
  }

  .faq-reveal.d1 {
    transition-delay: 50ms;
  }
  .faq-reveal.d2 {
    transition-delay: 120ms;
  }
  .faq-reveal.d3 {
    transition-delay: 190ms;
  }
  .faq-reveal.d4 {
    transition-delay: 260ms;
  }
  .faq-reveal.d5 {
    transition-delay: 330ms;
  }

  @media (width <= 35rem) {
    .faq__panel-inner {
      padding-inline: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .faq__q-text,
    .faq__ic,
    .faq__ic::before,
    .faq__ic::after,
    .faq__panel,
    .faq__a {
      transition: none !important;
    }
    .faq__a {
      opacity: 1;
      transform: none;
    }
    .faq-reveal.reveal--armed {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
