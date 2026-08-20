<!--
  @component FaqSection

  Objection-handling questions and answers (SPEC §4.1 `faq`).

  ── THE NINE AXES ──────────────────────────────────────────────────────────
  Every layout / rhythm / type-scale / edge / surface / motion decision reads a
  `--jp-*` property that `render/SectionRenderer.svelte` resolves onto the
  `.jp-sec` wrapper as a `data-jp-*` attribute
  (`docs/design/journey-sections/02-axis-contract.md` A9). COLOUR STAYS
  `--color-*` (A11); the one exception is the `--jp-accent-*` family.

  ── FIVE COMPOSITIONS ──────────────────────────────────────────────────────
  `accordion` (default) · `open` · `boxed` · `paired` · `grouped`. `boxed` is
  ported from the canvas partial's `.jp-faq--boxed`
  (`render-edit/journey-sections/_faq.css:45-46`, contract A12); `paired` and
  `grouped` are new (research §3).

  Two of them are COLLAPSIBLE (`accordion`, `boxed`, `grouped`) and two are
  STATIC (`open`, `paired`). The collapsible ones use native
  `<details>`/`<summary>`, so keyboard operation and the AT announcement come for
  free; the static ones are a plain `<h3>` + `<p>` list, because rendering a
  `<details open>` that is never meant to close advertises an affordance that is
  not there.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): native `<details>` toggling instantly,
    every answer reachable with zero JS. This is what the server emits.
  • ENHANCED (browser + motion OK): rows rise into view on the `motion` axis's
    timing, the +/− glyph morphs, and the answer panel animates its height
    (`smoothDetails`) instead of snapping.

  `smoothDetails` bails under `prefers-reduced-motion`, read at CLICK time so a
  mid-session preference flip is respected.
-->
<script lang="ts">
  import {
    asNumberedGroups,
    asObjectArray,
    asString,
    fieldString,
  } from '../coerce';
  import { reveal } from '../reveal';
  import type { FaqSectionProps, FaqEntry, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * `group` is the `OWED_READS.faq` entry (`g1`/`g2`/`g3`, contract A28) — the
   * builder has written it since F-C and nothing read it. It is declared here
   * rather than on `FaqSectionProps` in `render/types.ts` because that file is
   * shared across the seven component worktrees; consolidation should absorb it.
   *
   * No `coerce.ts` change was needed, contrary to the WP brief's expectation:
   * `asNumberedGroups` takes its field→prefix map as a CALL-SITE argument, so
   * `{ question: 'q', answer: 'a', group: 'g' }` reads `g1`/`g2`/`g3` with the
   * existing helper untouched.
   */
  interface FaqRow extends FaqEntry {
    group?: string;
  }

  interface FaqCopy extends FaqSectionProps {
    items?: FaqRow[];
  }

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
    variant?: string;
    /**
     * Present for the uniform contract and NOT destructured: every one of this
     * section's nine axes lands in CSS, because none of them changes what is
     * RENDERED. (`proof` does read `accent` in markup, because two of its five
     * values make `--jp-accent-fill` transparent and the avatar needs a different
     * treatment when there is no plate to sit on.)
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, variant, editable = false, onEdit }: Props = $props();

  const p: FaqCopy = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    // `items[]` is the authored array shape; the builder writes numbered
    // `q1/a1/g1, q2/a2/g2…` triples, which are the fallback (coerce.ts's
    // BUILDER-SHAPE BRIDGE note). NO `items[]` REPEATER may be added to
    // `section-fields.ts` before the stored flats are migrated — the array shape
    // WINS here, so an empty repeater would silently destroy the Q&As a page has
    // been serving (`Codex-wtfs1`, contract A30).
    items:
      asObjectArray<FaqRow>(config, 'items', (entry) => {
        const question = fieldString(entry, 'question');
        const answer = fieldString(entry, 'answer');
        if (!question || !answer) return null;
        return { question, answer, group: fieldString(entry, 'group') };
      }) ??
      asNumberedGroups<FaqRow>(
        config,
        { question: 'q', answer: 'a', group: 'g' },
        ({ question, answer, group }) =>
          question && answer ? { question, answer, group } : null
      ),
  });

  /**
   * NO HARDCODED FALLBACK HEADING (`Codex-i9pzs`). This section used to fall back
   * to `'The honest answers.'` — copy in one org's voice, compiled into a
   * component every other org's sell page renders. No course field is honestly an
   * FAQ heading, so the element self-hides. Deliberately NOT an i18n key: a key
   * holding that sentence has moved the problem rather than fixed it.
   */
  const heading = $derived(p.heading);
  const items: FaqRow[] = $derived(p.items ?? []);

  const COMPOSITIONS = ['accordion', 'open', 'boxed', 'paired', 'grouped'];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'accordion'
  );

  /**
   * `open` and `paired` show every answer, so there is nothing to collapse and no
   * `<details>` is rendered. String discriminant rather than a boolean: `apps/web`
   * has `strictNullChecks` OFF, so a boolean-literal discriminant does not narrow.
   */
  const collapsible = $derived(
    composition === 'open' || composition === 'paired' ? 'no' : 'yes'
  );

  /**
   * `grouped` clusters entries that share a `g<n>` label, in first-appearance
   * order. Entries with no label fall into one leading unlabelled cluster, so a
   * page that has never filled `g1-g3` in — every page today, since the
   * catalogue's `defaultProps` does not seed them — renders as a single ungrouped
   * list rather than as nothing.
   */
  interface FaqCluster {
    key: string;
    label?: string;
    rows: { row: FaqRow; index: number }[];
  }

  const clusters: FaqCluster[] = $derived.by(() => {
    // A plain array scan rather than a Map: this runs over at most a dozen
    // entries, and a Map held inside a derivation would have to be a `SvelteMap`
    // to satisfy the reactivity lint for no benefit — nothing outside this
    // computation ever reads it.
    const out: FaqCluster[] = [];
    items.forEach((row, index) => {
      const key = row.group ?? '';
      let cluster = out.find((c) => c.key === key);
      if (!cluster) {
        cluster = { key, label: row.group, rows: [] };
        out.push(cluster);
      }
      cluster.rows.push({ row, index });
    });
    return out;
  });

  /** Every composition except `grouped` is one flat cluster. */
  const rendered: FaqCluster[] = $derived(
    composition === 'grouped'
      ? clusters
      : [{ key: '', rows: items.map((row, index) => ({ row, index })) }]
  );

  /**
   * The shared `.jp-reveal[data-jp-step]` ladder in
   * `journey-sections-shared.css` stops at 5, and `--jp-reveal-stagger` is
   * calibrated for about that many block beats — so a twelve-entry FAQ clamps
   * rather than taking three seconds to assemble (pilot lesson 5). This replaces
   * the local `d1`…`d5` delay classes, which hardcoded their own ladder and so
   * ignored the `motion` axis entirely.
   */
  const step = (i: number): string => String(Math.min(i + 1, 5));

  /**
   * The inline-edit seam for the studio canvas, as a spreadable attribute bag.
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having
   * no seam at all.
   *
   * DELIBERATELY NOT `render-edit/EditableText.svelte`: it renders an EMPTY
   * element and fills `textContent` from a Svelte action, and actions do not run
   * during SSR — so the public page would serve `<h2></h2>` and paint the text in
   * only after hydration. The canvas never noticed because the studio is
   * `ssr = false`. Here the text is a real child node.
   */
  const editAttrs = (key: string): HTMLAttributes<HTMLElement> =>
    editable
      ? {
          contenteditable: 'true',
          spellcheck: 'false',
          'data-field': key,
          oninput: (e) =>
            onEdit?.(key, (e.currentTarget as HTMLElement).textContent ?? ''),
        }
      : {};

  /**
   * Editing happens against the builder's numbered keys, which only exist on the
   * flat-field path. An entry that came from an authored `items[]` array has no
   * `props` key to write back to, so it renders read-only even in the canvas.
   */
  const flatAuthored = $derived(!Array.isArray(config.items));
  const rowAttrs = (prefix: string, index: number) =>
    flatAuthored ? editAttrs(`${prefix}${index + 1}`) : {};

  /**
   * In the canvas every answer is open, because a collapsed panel cannot be
   * edited, and the summary swallows its own click so placing a caret in the
   * question does not toggle the row shut underneath the cursor.
   */
  const startOpen = $derived(editable || collapsible === 'no');

  function swallow(event: MouseEvent) {
    if (editable) event.preventDefault();
  }

  // ── ENHANCEMENT: smooth open/close height.
  //    A client-only Svelte action (never runs during SSR). Keeps native
  //    <details> as the source of truth; under reduced motion it does nothing and
  //    lets the browser toggle instantly — the accessible baseline. Read at click
  //    time so a mid-session preference flip is always respected.
  function smoothDetails(node: HTMLDetailsElement) {
    const summary = node.querySelector<HTMLElement>('.faq__q');
    const panel = node.querySelector<HTMLElement>('.faq__panel');
    if (!summary || !panel) return;

    let animating = false;

    const prefersReduced = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onClick = (event: MouseEvent) => {
      // Reduced motion, or an editable canvas row: let the browser decide.
      if (prefersReduced() || editable) return;
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
  <div class="faq" data-faq={composition}>
    <!-- ONE observer for the whole section, on the container. The shared atom is
         `.reveal--armed .jp-reveal` — a DESCENDANT selector — and the `reveal`
         action adds `.reveal--armed` to the node it is used on, so the action goes
         on the container and the staggered beats are its children. -->
    <div class="faq__inner" use:reveal>
      {#if p.eyebrow || heading}
        <header class="faq__head jp-reveal">
          {#if p.eyebrow}
            <p class="jp-sec__eyebrow faq__eyebrow" {...editAttrs('eyebrow')}>
              {p.eyebrow}
            </p>
          {/if}
          {#if heading}
            <h2
              class="jp-sec__heading jp-sec__heading--sub faq__heading"
              {...editAttrs('heading')}
            >
              {heading}
            </h2>
          {/if}
          <div class="faq__rule" aria-hidden="true"></div>
        </header>
      {/if}

      {#each rendered as cluster (cluster.key)}
        <div class="faq__cluster">
          {#if cluster.label}
            <h3 class="faq__group-label jp-reveal">{cluster.label}</h3>
          {/if}
          <div class="faq__list">
            {#each cluster.rows as { row, index } (index)}
              {#if collapsible === 'yes'}
                <details
                  class="faq__item jp-reveal"
                  data-jp-step={step(index)}
                  open={startOpen}
                  use:smoothDetails
                >
                  <summary class="faq__q" onclick={swallow}>
                    <span class="faq__q-text" {...rowAttrs('q', index)}>
                      {row.question}
                    </span>
                    <span class="faq__ic" aria-hidden="true"></span>
                  </summary>
                  <div class="faq__panel">
                    <div class="faq__panel-inner">
                      <p class="faq__a" {...rowAttrs('a', index)}>
                        {row.answer}
                      </p>
                    </div>
                  </div>
                </details>
              {:else}
                <div class="faq__item jp-reveal" data-jp-step={step(index)}>
                  <h3 class="faq__q-text" {...rowAttrs('q', index)}>
                    {row.question}
                  </h3>
                  <div class="faq__panel-inner">
                    <p class="faq__a" {...rowAttrs('a', index)}>{row.answer}</p>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX — every value an axis read.

     `--jp-sec-pad-block` / `--jp-sec-pad-inline` / `--jp-sec-gap` are the shared
     role aliases from `journey-design.css`. They contain `6cqw`, so they MUST be
     consumed on a DESCENDANT of `.jp-sec` — an element is not its own query
     container, and reading them on the wrapper resolves the `cqw` against the
     page rather than the section (pilot lesson 1). `.faq` is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .faq {
    position: relative;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);

    /* THE THIRD TYPE STEP, derived.

       The `type` axis has two steps — `--jp-display` for a section headline and
       `--jp-heading-size` for a subordinate heading — and a question row is
       neither. Rather than hardcode a size (which would put `type` out of reach
       of the thing this section is mostly made of), derive a third step from the
       second and bound it at both ends, so no axis value can push a question
       below body size or above the sub-heading step.

       0.5 is solved backwards from Candlelit exactly as the pilot solved its
       `80svh`: at `type: monumental` this lands on the `--text-xl` the question
       shipped before the axes existed (24px at a 1440 viewport). The four values
       then read 17 / 17 / 20 / 24px, so the axis genuinely reaches the row. */
    /* Promoted to `--jp-body-size` in `journey-design.css` (A44,
       `Codex-8oznv`). The expression that used to live here IS that rung, so this
       is the same value from one source instead of two. */
    --faq-q-size: var(--jp-body-size);

    /* The gap between the header and the list. It was a fixed `--space-10`, so
       `density` could not reach it. Expressed as a multiple of the shared
       `--jp-sec-gap`, which already carries the rhythm; 1.6 is the same factor
       `proof` uses, so the two sections' header rhythm stays in step. */
    --faq-block-gap: calc(var(--jp-sec-gap) * 1.6);
  }

  .faq__inner {
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* ── header ── */
  .faq__head {
    margin-block-end: var(--faq-block-gap);
  }

  .faq__eyebrow {
    /* The shared atom defaults to `--tracking-wider`; this section shipped a
       markedly wider `.32em`, which has no token. `--tracking-wider` is the
       widest that does, so the eyebrow narrows here by design (contract: design
       tokens only). Unobservable today — `section-fields.ts` declares no
       `faq.eyebrow` field, so nothing can author one. */
    --jp-eyebrow-tracking: var(--tracking-wider);
    margin-block-end: var(--space-3);
  }

  .faq__heading {
    margin: 0;
  }

  /* Ceremonial hairline under the heading. `--jp-accent-mark`, never
     `--jp-accent-fill`: the latter is `transparent` at `accent: text` and
     `accent: edge`, so the rule would vanish on two of five values (pilot
     lesson 4). */
  .faq__rule {
    width: var(--space-12);
    height: var(--border-width);
    margin: var(--jp-sec-gap) auto 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--jp-accent-mark) 60%, transparent),
      transparent
    );
  }

  /* ── clusters (only `grouped` renders more than one) ── */
  .faq__cluster + .faq__cluster {
    margin-block-start: var(--faq-block-gap);
  }

  .faq__group-label {
    margin: 0 0 calc(var(--space-3) * var(--jp-rhythm));
    font-family: var(--font-heading);
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    /* A cluster label is a real heading a reader relies on to navigate, so it
       takes the accent's TEXT role — which resolves to `--jp-ember-text`, the
       AA-calibrated rung — never `--jp-ember`, which measures 2.04:1 in dark on
       the golden org (research §0.1). */
    color: var(--jp-accent-text);
    text-align: var(--jp-text-align);
  }

  /* ── list ── */
  .faq__list {
    /* WIDTH is a token, COLOUR is the axis. Reading `--jp-edge-width` here would
       let `edge: none` delete the only boundary between rows, which is a
       legibility loss rather than a style choice; `--jp-edge-color` still lets
       `edge` tint them. Measured: this moves the rule from `--jp-line-subtle`
       (1.40:1 light / 1.21:1 dark) to `--jp-line` (1.79 / 1.49) — still under the
       3:1 graphic floor, which `journey-design.css` documents and accepts on the
       condition that a hairline is never the ONLY signal. Here it is not: each
       row also carries generous rhythm-scaled padding and its own +/- control. */
    border-top: var(--border-width) solid var(--jp-edge-color);
    text-align: left;
  }

  .faq__item {
    border-bottom: var(--border-width) solid var(--jp-edge-color);
  }

  /* summary = the question row */
  .faq__q {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    padding-block: calc(var(--space-5) * var(--jp-rhythm));
    /* The tap target is the ROW, and it must clear the WCAG floor at every
       density — `compact` multiplies the padding by 0.75, so the floor is stated
       rather than assumed (contract A2: density may only make a target larger). */
    min-height: var(--tap-target-min);
    box-sizing: border-box;
    list-style: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .faq__q::-webkit-details-marker {
    display: none;
  }

  .faq__q::marker {
    content: '';
  }

  /* The canonical focus ring (rule R14). It used to be a text-decoration on the
     question with `outline: none` on the row, which is the one thing a focus
     style may not do. NOTE this is deliberately independent of `--jp-edge-*`:
     `edge: none` and `edge: soft` remove borders and must NEVER remove a focus
     ring (research §5.1). */
  .faq__q:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .faq__q-text {
    flex: 1;
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-normal));
    font-size: var(--faq-q-size);
    line-height: var(--leading-snug);
    letter-spacing: var(--jp-display-tracking);
    color: var(--color-text);
    transition: color var(--duration-normal) var(--ease-out);
  }

  .faq__item:hover .faq__q-text,
  .faq__item[open] .faq__q-text {
    color: var(--color-heading);
  }

  /* ── the +/− indicator ──
     THE GLYPH IS A MEANINGFUL UI GRAPHIC, so it takes `--jp-accent-text` rather
     than a raw brand token. Measured before: `--color-brand-accent` gave
     2.06:1 on `studio-alpha` and 2.38:1 on `of-blood-and-bones` in LIGHT against
     the 3:1 graphic floor — the affordance for the whole accordion, failing on
     both orgs. `--jp-accent-text` resolves to `--jp-ember-text`, the rung
     calibrated to clear AA at both poles (13.93 light / 5.40 dark).

     The RING is chrome around it and takes the accent's border role. */
  .faq__ic {
    position: relative;
    flex: none;
    align-self: flex-start;
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-full);
    /* THE RING IS PART OF THE CONTROL, so it is derived from `--jp-accent-text`
       rather than from `--jp-accent-edge` or `--jp-accent-mark`. Two measured
       reasons, in order:

       1. Mixing an axis token down again double-counts. Carrying the original
          `26%` across to `--jp-accent-edge` measured 1.62:1 light / 1.14:1 dark
          (from 3.32 / 2.32), because at `accent: glow` that token is ALREADY a
          45% ember mix, so 26% of it is ~12% ember.
       2. `--jp-accent-edge` and `--jp-accent-mark` both resolve to `--jp-ember`,
          which is THEME-BLIND (`Codex-8jve9`, contract A35): measured `#552e8e`
          in both themes, giving 8.49:1 on the golden org in light and 2.04:1 in
          dark against a 3:1 floor. `--jp-accent-text` is `--jp-ember-text`, whose
          `--jp-heading` half DOES flip, so it holds at both poles.

       FULL STRENGTH AT REST, and the state change is carried by the fill and the
       border WEIGHT rather than by fading the colour. This section shipped a
       faint ring that brightened on hover, and any alpha low enough to read as
       "faint" fails in dark: a 55% mix measured 2.53:1. A resting control
       boundary is not decoration, so it takes the floor, and the hover state
       earns its distinction some other way — which also matches the glyph inside
       it, which is full strength too.

       Only the ring is upgraded. The genuinely decorative marks in these two
       sections — the trust dots, the candle-catch hairline, the ceremonial rule,
       the oversized quote glyph — stay on `--jp-accent-mark`, which is the role
       A34 added for exactly them; none of them carries information the adjacent
       text does not, so the 3:1 graphic floor does not apply. */
    border: var(--border-width) solid var(--jp-accent-text);
    transition:
      border-width var(--duration-slow) var(--ease-out),
      background var(--duration-slow) var(--ease-out);
  }

  .faq__item:hover .faq__ic,
  .faq__item[open] .faq__ic {
    border-width: var(--border-width-thick);
    background: color-mix(in oklab, var(--jp-accent-text) 12%, transparent);
  }

  .faq__ic::before,
  .faq__ic::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--space-3);
    height: var(--border-width-thick);
    border-radius: var(--radius-xs);
    background: var(--jp-accent-text);
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
    padding-block: 0 calc(var(--space-5) * var(--jp-rhythm));
    /* The answer is indented clear of the +/− control. Rhythm-scaled so a
       `compact` section tightens the indent along with everything else. */
    padding-inline: 0 calc(var(--space-12) * var(--jp-rhythm));
  }

  .faq__a {
    margin: 0;
    max-width: var(--jp-measure);
    font-family: var(--font-body);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* The answer fades in with its own panel, but ONLY inside a collapsible row —
     a static composition has no open state to key off, so the opacity would
     stick at zero. */
  .faq[data-faq='accordion'] .faq__a,
  .faq[data-faq='boxed'] .faq__a,
  .faq[data-faq='grouped'] .faq__a {
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

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITIONS

     Each sets ARRANGEMENT only — alignment, measure, surface, accent, type-scale
     and motion are axes and are already handled above, which is why these blocks
     are short.
     ═══════════════════════════════════════════════════════════════════════ */

  /* `boxed` — each entry in its own panel. Ported from the canvas partial's
     `.jp-faq--boxed` (`render-edit/journey-sections/_faq.css:45-46`).

     Research §3 marked this a COLLAPSE candidate ("largely `open` +
     `surface: panel`; keep only if the per-entry panel differs from the section
     panel"). It is kept, and the per-entry panel does differ: `surface: panel`
     paints ONE plate behind the whole section, while this paints a plate per
     entry with the section behind them. `LEGACY_SECTION_VARIANTS` carries no
     `faq` entry, so nothing was retired and no stored id needed forwarding. */
  .faq[data-faq='boxed'] .faq__list {
    border-top: 0;
    display: grid;
    gap: calc(var(--space-3) * var(--jp-rhythm));
  }

  .faq[data-faq='boxed'] .faq__item {
    border: var(--border-width) solid var(--jp-edge-color);
    border-radius: var(--radius-lg);
    padding-inline: calc(var(--space-4) * var(--jp-rhythm));
    background: color-mix(in oklab, var(--color-surface) 40%, transparent);
    box-shadow: var(--jp-edge-shadow);
  }

  /* `open` — every answer shown, hairline-ruled, no toggle. */
  .faq[data-faq='open'] .faq__item {
    padding-block: calc(var(--space-5) * var(--jp-rhythm));
  }

  .faq[data-faq='open'] .faq__q-text {
    display: block;
    margin-block-end: calc(var(--space-2) * var(--jp-rhythm));
  }

  .faq[data-faq='open'] .faq__panel-inner {
    padding-inline: 0;
  }

  /* `paired` — two-column Q/A rows, all open, hairline-ruled. A CONTAINER query
     drops it to one column, not a viewport media query (contract A14): the
     builder canvas renders this section inside a device frame narrower than the
     window, where a viewport query reads the wrong number. */
  .faq[data-faq='paired'] .faq__item {
    display: grid;
    grid-template-columns: 1fr;
    gap: calc(var(--space-2) * var(--jp-rhythm));
    padding-block: calc(var(--space-5) * var(--jp-rhythm));
  }

  .faq[data-faq='paired'] .faq__panel-inner {
    padding-inline: 0;
  }

  @container (min-width: 44rem) {
    .faq[data-faq='paired'] .faq__item {
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: var(--jp-sec-gap);
      align-items: start;
    }
  }

  /* `grouped` — a heading per cluster. The cluster's own rule replaces the
     list's top rule so the label is not boxed in above and below. */
  .faq[data-faq='grouped'] .faq__list {
    border-top: 0;
  }

  .faq[data-faq='grouped'] .faq__item:first-child {
    border-top: var(--border-width) solid var(--jp-edge-color);
  }

  /* ── narrow: drop the answer indent so the measure is not squeezed ──
     A CONTAINER query (contract A14), replacing a raw `35rem` viewport query. */
  @container (max-width: 35rem) {
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
      transition: none;
    }

    .faq__a {
      opacity: 1;
      transform: none;
    }
  }
</style>
