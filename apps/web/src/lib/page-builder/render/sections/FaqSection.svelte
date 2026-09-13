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
  ported from the since-deleted canvas partial's `.jp-faq--boxed`
  (`render-edit/journey-sections/_faq.css:45-46`, contract A12); `paired` and
  `grouped` are new (research §3).

  Two of them are COLLAPSIBLE (`accordion`, `boxed`, `grouped`) and two are
  STATIC (`open`, `paired`). The collapsible ones use native
  `<details>`/`<summary>`, so keyboard operation and the AT announcement come for
  free; the static ones are a plain `<h3>` + `<p>` list, because rendering a
  `<details open>` that is never meant to close advertises an affordance that is
  not there.

  ── EIGHT DESIGN LANGUAGES ─────────────────────────────────────────────────
  The nine axes reach this section, but reaching it is not the same as speaking
  it. Measured across the whole page-builder CSS, Candlelit's tell (ember bloom,
  corner brackets, motes) is implemented 4-28x more densely than any sibling
  look's, and that density is the whole reason Candlelit is the only preset the
  product owner rates. The `DESIGN LANGUAGES` block at the foot of this file
  closes that gap FOR THIS SECTION: each of the other seven presets gets the
  falsifiable signature research §1 names for its family, at Candlelit's level of
  conviction.

  Two rules govern that block, and both are load-bearing:

  1. EVERY LOOK IS ADDRESSED BY A SELECTOR THAT MATCHES IT AND NOTHING ELSE.
     The 8 presets are permutations of only 38 axis values and 20 of those are
     shared, so a bare rule on a shared value silently restyles siblings. The
     per-look selectors are proved unique in the comment above each block.
  2. CANDLELIT COMES OUT UNCHANGED. It is uniquely identified by
     `surface:media` · `edge:none` · `media:bleed` · `accent:glow`, and NOT ONE
     look selector below keys on any of those four — so no look block can match
     it. Its other five axes (`type:monumental`, `align:center`, `density:airy`,
     `width:text`, `motion:drift`) are shared and are never keyed on bare.

  ── THE LOOK VOCABULARY, AND WHY IT IS CUSTOM PROPERTIES ───────────────────
  A look block re-points local `--faq-*` properties; it almost never paints. That
  is the same constraint `journey-design.css` holds itself to, one level down, and
  it exists to stop a specificity war: a look selector is (0,3,0) while a
  composition rule like `.faq[data-faq='boxed'] .faq__item` is (0,5,0), so a look
  that PAINTED would lose to a composition and would need a per-composition
  duplicate for each of five compositions. Re-pointing an inherited property
  sidesteps the cascade entirely — treatment and composition stop competing.

  EVERY BASE DEFAULT IN THAT VOCABULARY IS THE LITERAL THIS FILE PAINTED BEFORE
  IT EXISTED, so the base look is byte-identical.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): native `<details>` toggling instantly,
    every answer reachable with zero JS. This is what the server emits.
  • ENHANCED (browser + motion OK): rows rise into view on the `motion` axis's
    timing, the +/− glyph morphs, and the answer panel animates its height
    (`smoothDetails`) instead of snapping.

  `smoothDetails` bails under `prefers-reduced-motion`, read at CLICK time so a
  mid-session preference flip is respected — and it now also bails at
  `motion: none`, because a creator who asked for no motion should not get a
  sliding panel.
-->
<script lang="ts">
  import {
    asNumberedGroups,
    asObjectArray,
    asString,
    fieldString,
  } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
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
     * Read for exactly ONE decision, and it is genuinely behaviour rather than
     * paint: whether the answer panel is allowed to ANIMATE its height. Every
     * other axis lands in CSS, because a section's scoped stylesheet cannot
     * reach the ancestor `data-jp-*` attributes — which is what
     * `SectionRenderer` passes this prop for, and why the per-look blocks at the
     * foot of the file wrap their ancestor selectors in `:global()`.
     *
     * `motion: none` means "instant state changes" (research §1.2/§1.5), and a
     * 300ms JS height slide is a state change. The CSS half of the same decision
     * is the `--faq-motion: 0` re-point in the MOTION block.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, variant, design, editable = false, onEdit }: Props = $props();

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
   * THE `motion: none` GATE, in markup because the JS animation cannot be
   * switched off from a scoped stylesheet. `plain-facts` and `syllabus` are the
   * two presets that carry it, and both families specify "None. Instant state
   * changes." (research §1.2, §1.5). String discriminant for the same
   * `strictNullChecks` reason as `collapsible`.
   */
  const stillness = $derived(design?.motion === 'none' ? 'yes' : 'no');

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
   *
   * NOTE this is the REVEAL ordinal and it is capped. The ROW NUMBER the
   * brutalist / technical / playful looks print is a CSS counter instead
   * (`--faq-ordinal`), precisely because it must not clamp at 5.
   */
  const step = (i: number): string => String(Math.min(i + 1, 5));

  /**
   * The studio canvas's inline-edit seam for one field, as a spreadable attribute
   * bag: `contenteditable`, spellcheck ON, `role="textbox"`, an accessible name
   * saying which field this is, and a paste that arrives as PLAIN TEXT.
   *
   * Built in ONE place (`../editable`) rather than here. It used to be eleven
   * byte-identical copies, which is exactly how the same three defects — no
   * spellcheck, no `onpaste`, no role or name — reached all eleven sections at once
   * and stayed there. That module's header carries the full reasoning, including
   * why this is an ATTRIBUTE BAG and not a Svelte action (actions do not run during
   * SSR, so the text has to be a real child node, not something filled in later).
   *
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having no
   * seam at all.
   */
  const editAttrs = (key: string): HTMLAttributes<HTMLElement> =>
    editFieldAttrs('faq', key, editable, onEdit);

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
  //    <details> as the source of truth; under reduced motion — or at
  //    `motion: none` — it does nothing and lets the browser toggle instantly,
  //    which is the accessible baseline. Both are read at click time so a
  //    mid-session preference flip is always respected.
  function smoothDetails(node: HTMLDetailsElement) {
    const summary = node.querySelector<HTMLElement>('.faq__q');
    const panel = node.querySelector<HTMLElement>('.faq__panel');
    if (!summary || !panel) return;

    let animating = false;

    const prefersReduced = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onClick = (event: MouseEvent) => {
      // Reduced motion, `motion: none`, or an editable canvas row: let the
      // browser decide.
      if (prefersReduced() || editable || stillness === 'yes') return;
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
    <div class="faq__inner" use:reveal={{ disabled: editable }}>
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

    /* ── THE LOOK VOCABULARY ────────────────────────────────────────────────
       The properties below are the whole surface the DESIGN LANGUAGES block at
       the foot of this file re-points. Read the component header for WHY they
       are properties and not paint rules; read this for the invariant:

       EVERY VALUE HERE IS THE LITERAL THIS FILE PAINTED BEFORE THIS BLOCK
       EXISTED. So the base rendering — which is Candlelit's — is unchanged, and
       any look that sets nothing gets exactly today's section.

       Three of them are worth calling out because their default encodes a
       decision rather than a number:

       • `--faq-row-rule-width` defaults to the `--border-width` TOKEN, not to
         `--jp-edge-width`. That is deliberate and it is documented on
         `.faq__list` below: letting `edge: none` delete the only boundary
         between rows is a legibility loss rather than a style choice. The
         consequence is that `edge: soft`/`none` alone could never produce the
         BORDERLESS look the soft-organic and luxury families are defined by —
         which is exactly the tell gap this file is closing, and it is closed by
         the LOOK re-pointing this property, not by changing its default.

       • `--faq-motion: 1` is a unitless multiplier on every local transition
         duration. `calc(200ms * 1)` computes to `200ms`, so it is a no-op at
         rest; `motion: none` and `prefers-reduced-motion` set it to `0` and
         every local transition collapses in one declaration instead of seven.
         NO LOOK BLOCK MAY SET IT TO ANYTHING BUT 0 — the reduced-motion override
         is at `.faq` specificity and a (0,3,0) look rule would out-rank it.

       • `--faq-ordinal: none` is the ROW NUMBER, and `content: none` generates no
         box at all, so the numeral costs nothing on the six looks that do not
         print one. */

    /* row separator + row box.

       `--faq-list-rule-width` is SEPARATE from `--faq-row-rule-width` on
       purpose. They are the same value at rest — the single hairline that runs
       above the first row and under every row after it — but a look that turns
       each row into its own card needs the row's boundary WITHOUT a stray line
       floating above the first card. One property could not express that. */
    --faq-list-rule-width: var(--border-width);
    --faq-row-rule-width: var(--border-width);
    --faq-row-rule-color: var(--jp-edge-color);
    /* Zero at rest, so the base row has a bottom rule and nothing else. A look
       that wants a four-sided box sets this instead of painting a `border`,
       which is what keeps looks out of a specificity fight with `boxed`. */
    --faq-row-border-width: 0px;
    --faq-row-border-color: var(--jp-edge-color);
    --faq-row-gap: 0px;
    --faq-row-pad-block: calc(var(--space-5) * var(--jp-rhythm));
    --faq-row-pad-inline: 0px;
    --faq-row-radius: 0px;
    --faq-row-bg: transparent;
    --faq-row-shadow: none;

    /* the `boxed` composition's per-entry plate */
    --faq-box-radius: var(--radius-lg);
    --faq-box-border-width: var(--border-width);
    --faq-box-border-color: var(--jp-edge-color);
    --faq-box-bg: color-mix(in oklab, var(--color-surface) 40%, transparent);
    --faq-box-shadow: var(--jp-edge-shadow);

    /* the +/− control */
    --faq-ic-size: var(--space-9);
    --faq-ic-radius: var(--radius-full);
    --faq-ic-border-width: var(--border-width);
    --faq-ic-border-color: var(--jp-accent-text);
    --faq-ic-bg: transparent;
    --faq-ic-bg-active: color-mix(in oklab, var(--jp-accent-text) 12%, transparent);
    --faq-ic-glyph: var(--jp-accent-text);
    --faq-glyph-size: var(--space-3);
    --faq-glyph-radius: var(--radius-xs);

    /* the ceremonial rule under the section head */
    --faq-head-rule-width: var(--space-12);
    --faq-head-rule-height: var(--border-width);
    --faq-head-rule-margin: auto;

    /* type scale — four rungs, so the `type` axis reaches more than the heading */
    --faq-eyebrow-size: var(--text-sm);
    --faq-label-size: var(--text-sm);
    --faq-answer-size: var(--text-base);
    --faq-answer-leading: var(--leading-relaxed);

    /* the printed row number (brutalist / technical / playful) */
    --faq-ordinal: none;
    --faq-ordinal-min: var(--space-6);
    --faq-ordinal-pad: 0px;
    --faq-ordinal-radius: 0px;
    --faq-ordinal-bg: transparent;
    --faq-ordinal-color: var(--jp-accent-text);
    --faq-ordinal-font: var(--font-mono);
    --faq-ordinal-size: var(--text-sm);
    --faq-ordinal-weight: var(--font-semibold);
    --faq-ordinal-align: baseline;

    /* motion */
    --faq-motion: 1;
    --faq-ease: var(--ease-out);
    --faq-answer-rise: var(--space-1);
  }

  .faq__inner {
    max-width: var(--jp-content-max);
    margin-inline: auto;
    /* The row-number counter. Reset on the INNER wrapper rather than on
       `.faq__list` so `grouped` numbers continuously across its clusters — the
       same reading as the reveal `data-jp-step` ordinal, which is also
       continuous. Declared unconditionally because a counter with no
       `content: counter()` consumer paints nothing at all. */
    counter-reset: faq-n;
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
    /* Same size the shared atom sets, restated as a property so a look can move
       it. It is the one rung of this section's type ladder the `type` axis does
       NOT reach, and the luxury-minimal tell ("three type sizes on the whole
       page") is unreachable without it. */
    font-size: var(--faq-eyebrow-size);
    margin-block-end: var(--space-3);
  }

  .faq__heading {
    margin: 0;
  }

  /* Ceremonial hairline under the heading. `--jp-accent-mark`, never
     `--jp-accent-fill`: the latter is `transparent` at `accent: text` and
     `accent: edge`, so the rule would vanish on two of five values (pilot
     lesson 4).

     `--faq-head-rule-margin` is `auto` at rest, which centres it. That is right
     under a centred head and WRONG under a left-aligned one — a 48px rule
     floating in the middle of a section whose heading starts at the left edge.
     The ALIGN block below re-points it for the four `align: start` looks. */
  .faq__rule {
    width: var(--faq-head-rule-width);
    height: var(--faq-head-rule-height);
    margin: var(--jp-sec-gap) var(--faq-head-rule-margin) 0;
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
    font-size: var(--faq-label-size);
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
       row also carries generous rhythm-scaled padding and its own +/- control.

       A LOOK may still zero this — soft-organic and luxury-minimal are DEFINED by
       having no border anywhere — but only by simultaneously buying the
       separation back with space or elevation, which is what each of those blocks
       does. That is the difference between an axis deleting a boundary by
       accident and a design language removing it on purpose. */
    border-top: var(--faq-list-rule-width) solid var(--faq-row-rule-color);
    text-align: left;
  }

  /* THE SHORTHAND FIRST, THE LONGHAND SECOND, and the order is load-bearing:
     `border` paints all four sides at `--faq-row-border-width` (`0px` at rest,
     so nothing) and `border-block-end` then overrides the bottom with the row
     rule. At rest that is a bottom hairline and no other edge — exactly what
     this section painted before. A look re-points the two widths instead of
     writing its own `border`, so it never has to out-specify the `boxed`
     composition, and `grouped` no longer needs a `:first-child` rule that would
     (at (0,6,0)) strip the top edge off a boxed look's first row. */
  .faq__item {
    border: var(--faq-row-border-width) solid var(--faq-row-border-color);
    border-block-end: var(--faq-row-rule-width) solid var(--faq-row-rule-color);
    border-radius: var(--faq-row-radius);
    padding-inline: var(--faq-row-pad-inline);
    background: var(--faq-row-bg);
    box-shadow: var(--faq-row-shadow);
    counter-increment: faq-n;
  }

  /* Row separation as SPACE rather than as a rule. `0px` at rest, so this is a
     no-op until a look asks for it — and a margin rather than a grid `gap`
     because turning `.faq__list` into a grid changes `min-width` resolution on
     every row and would be a live appearance change on the base look. */
  .faq__item + .faq__item {
    margin-block-start: var(--faq-row-gap);
  }

  /* summary = the question row */
  .faq__q {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
    padding-block: var(--faq-row-pad-block);
    /* The tap target is the ROW, and it must clear the WCAG floor at every
       density — `compact` multiplies the padding by 0.75, so the floor is stated
       rather than assumed (contract A2: density may only make a target larger).
       Every look below may only ever GROW `--faq-row-pad-block`; none reduces it
       below the base, and this floor holds regardless. */
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
     style may not do. NOTE this is deliberately independent of `--jp-edge-*` AND
     of every `--faq-*` property below: `edge: none`, `edge: soft` and the
     borderless LOOKS remove borders and must NEVER remove a focus ring
     (research §5.1). */
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
    transition: color calc(var(--duration-normal) * var(--faq-motion))
      var(--faq-ease);
  }

  /* ── THE ROW NUMBER ──
     `content: var(--faq-ordinal)` is `none` on six of the eight looks, and
     `content: none` on a `::before` generates NO BOX — so this whole rule costs
     nothing where it is not wanted, and needs no per-look duplicate to switch
     off. The three looks that print a number are the three whose families name
     numerals in their tell: brutalist "mono labels", technical "mono numerals",
     playful "big numerals".

     It is a CSS counter and not markup for two reasons. It introduces no new
     user-visible string (a numeral is not English, and i18n is single-owner); and
     the reveal ordinal `data-jp-step` CLAMPS AT 5 by design, so it could not have
     been reused for a number that must keep counting to twelve.

     `tabular-nums` is not decoration here: a column of proportional numerals in
     a technical look does not line up, which is the whole point of the tell. */
  .faq__q-text::before {
    content: var(--faq-ordinal);
    display: inline-block;
    min-width: var(--faq-ordinal-min);
    margin-inline-end: var(--space-3);
    padding: var(--faq-ordinal-pad);
    border-radius: var(--faq-ordinal-radius);
    background: var(--faq-ordinal-bg);
    color: var(--faq-ordinal-color);
    font-family: var(--faq-ordinal-font);
    font-size: var(--faq-ordinal-size);
    font-weight: var(--faq-ordinal-weight);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-normal);
    line-height: var(--leading-none);
    text-align: center;
    vertical-align: var(--faq-ordinal-align);
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
    width: var(--faq-ic-size);
    height: var(--faq-ic-size);
    border-radius: var(--faq-ic-radius);
    background: var(--faq-ic-bg);
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
       text does not, so the 3:1 graphic floor does not apply.

       THE THREE LOOKS THAT DELETE THIS RING (`--faq-ic-border-width: 0px`) are
       the three whose families forbid a box: editorial "no box borders
       anywhere", soft-organic "no borders at all", luxury-minimal "accent
       absent". The GLYPH always survives, at full strength, so the affordance
       and its 3:1 floor are never what gets removed. */
    border: var(--faq-ic-border-width) solid var(--faq-ic-border-color);
    transition:
      border-width calc(var(--duration-slow) * var(--faq-motion))
        var(--faq-ease),
      background calc(var(--duration-slow) * var(--faq-motion)) var(--faq-ease);
  }

  /* `calc(… * 2)` rather than `--border-width-thick` so a ringless look stays
     ringless on hover. The two are identical at the base (`--border-width` is
     `1px`, `--border-width-thick` is `2px`), and `0px * 2` is still `0px`. */
  .faq__item:hover .faq__ic,
  .faq__item[open] .faq__ic {
    border-width: calc(var(--faq-ic-border-width) * 2);
    background: var(--faq-ic-bg-active);
  }

  .faq__ic::before,
  .faq__ic::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--faq-glyph-size);
    height: var(--border-width-thick);
    border-radius: var(--faq-glyph-radius);
    background: var(--faq-ic-glyph);
    transform: translate(-50%, -50%);
    transition:
      transform calc(var(--duration-slow) * var(--faq-motion)) var(--faq-ease),
      opacity calc(var(--duration-slow) * var(--faq-motion)) var(--faq-ease);
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
    transition: height calc(var(--duration-slow) * var(--faq-motion))
      var(--faq-ease);
  }

  .faq__panel-inner {
    padding-block: 0 var(--faq-row-pad-block);
    /* The answer is indented clear of the +/− control. Rhythm-scaled so a
       `compact` section tightens the indent along with everything else. */
    padding-inline: 0 calc(var(--space-12) * var(--jp-rhythm));
  }

  .faq__a {
    margin: 0;
    max-width: var(--jp-measure);
    font-family: var(--font-body);
    font-size: var(--faq-answer-size);
    line-height: var(--faq-answer-leading);
    color: var(--color-text-secondary);
  }

  /* The answer fades in with its own panel, but ONLY inside a collapsible row —
     a static composition has no open state to key off, so the opacity would
     stick at zero. */
  .faq[data-faq='accordion'] .faq__a,
  .faq[data-faq='boxed'] .faq__a,
  .faq[data-faq='grouped'] .faq__a {
    opacity: 0;
    transform: translateY(var(--faq-answer-rise));
    transition:
      opacity calc(var(--duration-slower) * var(--faq-motion)) var(--faq-ease),
      transform calc(var(--duration-slower) * var(--faq-motion))
        var(--faq-ease);
  }

  .faq__item[open] .faq__a {
    opacity: 1;
    transform: none;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITIONS

     Each sets ARRANGEMENT only — alignment, measure, surface, accent, type-scale
     and motion are axes and are already handled above, which is why these blocks
     are short. Where a composition paints, it paints through the LOOK VOCABULARY
     so a design language can still reach it without out-specifying anything.
     ═══════════════════════════════════════════════════════════════════════ */

  /* `boxed` — each entry in its own panel. Ported from the canvas partial's
     `.jp-faq--boxed` (the since-deleted
     `render-edit/journey-sections/_faq.css:45-46`).

     Research §3 marked this a COLLAPSE candidate ("largely `open` +
     `surface: panel`; keep only if the per-entry panel differs from the section
     panel"). It is kept, and the per-entry panel does differ: `surface: panel`
     paints ONE plate behind the whole section, while this paints a plate per
     entry with the section behind them. `LEGACY_SECTION_VARIANTS` carries no
     `faq` entry, so nothing was retired and no stored id needed forwarding. */
  .faq[data-faq='boxed'] .faq__list {
    border-top: 0;
    display: grid;
    /* `max()` so a look asking for MORE air between plates gets it, while the
       composition keeps its own floor. `--faq-row-gap` is `0px` at rest, so this
       resolves to exactly the value this composition shipped. */
    gap: max(calc(var(--space-3) * var(--jp-rhythm)), var(--faq-row-gap));
  }

  /* …and the sibling margin is zeroed here, because a grid `gap` and a
     `margin-block-start` would otherwise ADD and a card look would get double
     the air it asked for. */
  .faq[data-faq='boxed'] .faq__item + .faq__item {
    margin-block-start: 0;
  }

  .faq[data-faq='boxed'] .faq__item {
    border: var(--faq-box-border-width) solid var(--faq-box-border-color);
    border-radius: var(--faq-box-radius);
    padding-inline: calc(var(--space-4) * var(--jp-rhythm));
    background: var(--faq-box-bg);
    box-shadow: var(--faq-box-shadow);
  }

  /* `open` — every answer shown, hairline-ruled, no toggle. */
  .faq[data-faq='open'] .faq__item {
    padding-block: var(--faq-row-pad-block);
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
    padding-block: var(--faq-row-pad-block);
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

  /* `grouped` — a heading per cluster, and NO composition rule of its own any
     more.

     It used to carry a pair: `.faq__list { border-top: 0 }` plus
     `.faq__item:first-child { border-top: <the same hairline> }`. Those two
     cancel — `.faq__list` has no block padding, so the top of the list box and
     the top of its first row are the same y — so the pair painted the identical
     line in the identical place at a specificity of (0,6,0). That made it a
     cascade landmine rather than a feature: any look that gives a row a
     four-sided border would have had its FIRST row's top edge silently reset by
     it, once per cluster. Removed, rendering unchanged; the line now comes from
     `.faq__list`'s own `--faq-list-rule-width` like every other composition,
     which is also the property a card look zeroes. */

  /* ═══════════════════════════════════════════════════════════════════════
     DESIGN LANGUAGES — eight looks, eight tells.

     Each block below re-points the LOOK VOCABULARY so one preset delivers the
     falsifiable signature research §1 gives its family. The header of this file
     carries the two governing rules; this is the proof obligation each block
     discharges in its own comment:

       ① the selector matches its look and NOTHING else, and
       ② it does not match Candlelit.

     `:global()` on the ancestor is mandatory, not stylistic. The `data-jp-*`
     attributes live on `.jp-sec`, which `SectionFrame` renders — a different
     component — so Svelte's static analysis cannot see them and PRUNES the
     scoped form as an unused selector. The rule then compiles away and the look
     silently does nothing. `MapSection.svelte:1467` records the same trap for
     `.reveal--armed`; svelte-check reports it, the browser would not.

     Candlelit is not in this block AT ALL, and that is the point. It is already
     the densest-implemented look in the file — the atmosphere layer, the
     centred serif, the letterbox scrim — and it comes out of this pass
     byte-identical. Its four unique axis values (`surface:media`, `edge:none`,
     `media:bleed`, `accent:glow`) appear in NO selector below.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── ALIGN: the head rule follows the head ──────────────────────────────
     `[data-jp-align='start']` is long-read + plain-facts + syllabus + signal.
     Candlelit is `align: center`, so it cannot match; this is the one place a
     bare shared-value selector is safe, because `center` and `start` partition
     the axis and Candlelit is on the other side.

     The defect this fixes is real and visible today: `.faq__rule` is
     `margin-inline: auto`, so all four left-aligned looks render a 48px
     ceremonial rule floating in the horizontal centre of a section whose eyebrow
     and heading start at the left edge. Editorial's tell is literally "the
     eyebrow and the body share a left edge"; a centred rule breaks it. */
  :global([data-jp-align='start']) .faq {
    --faq-head-rule-margin: 0px;
  }

  /* ── MOTION ─────────────────────────────────────────────────────────────
     The `motion` axis already drives the REVEAL through `--jp-reveal-*`. These
     three blocks make it drive this section's own STATE transitions too — the
     hover tint, the glyph rotation, the panel height, the answer fade — which
     were fixed at `--ease-out` and `--duration-*` regardless of the axis.

     `motion: none` is plain-facts + syllabus, `fade` is quiet-studio only,
     `stagger` is full-send only. Candlelit is `motion: drift`, which appears in
     no selector here — deliberately, because `drift` is shared with open-air and
     a bare rule on it is the single easiest way to regress Candlelit. Open-air
     gets its easing from its own `surface: tint` block instead. */

  /* plain-facts + syllabus — "None. Instant state changes." (research §1.2,
     §1.5). Not a fast animation: a 0 multiplier on every local duration, a 0
     rise on the answer, and the JS height slide gated off in markup by
     `stillness`. */
  :global([data-jp-motion='none']) .faq {
    --faq-motion: 0;
    --faq-answer-rise: 0px;
  }

  /* quiet-studio — "Slow fade only. No transform." (research §1.4). The duration
     survives; the travel does not. */
  :global([data-jp-motion='fade']) .faq {
    --faq-answer-rise: 0px;
  }

  /* full-send — "Stagger with spring easing" (research §1.8). The reveal already
     takes `--ease-spring` from `--jp-reveal-ease`; this hands the same spring to
     the panel, the glyph and the hover so the look's character is in the
     INTERACTION and not only in the entrance. */
  :global([data-jp-motion='stagger']) .faq {
    --faq-ease: var(--ease-spring);
  }

  /* ═══ 1.1 EDITORIAL — `long-read` ══════════════════════════════════════
     TELL: the eyebrow and the body share a left edge, and a hairline under every
     section head.

     ① `surface: bare` is {quiet-studio, long-read}; quiet-studio is
        `align: center`. So `bare` + `start` is long-read alone.
     ② Candlelit is `surface: media`, `align: center` — neither half matches.

     The left edge is already structurally true (`surface: bare` zeroes
     `--jp-sec-pad-inline`, `align: start` sets `--jp-text-align: left`), so the
     work here is the OTHER half of the tell, which was missing entirely: the
     head hairline was a 48px centred gradient that faded out at both ends —
     cinematic, not editorial — and there was none under a cluster head at all.
     Plus the family's negative rules: "hairline horizontal rules only, no box
     borders anywhere", radius none-to-xs, no elevation. */
  :global([data-jp-surface='bare'][data-jp-align='start']) .faq {
    /* a hairline UNDER the head, full measure, on the body's left edge */
    --faq-head-rule-width: 100%;
    --faq-head-rule-height: var(--border-width);
    /* no box borders anywhere: the ring around the +/− goes, the glyph stays */
    --faq-ic-border-width: 0px;
    --faq-ic-size: var(--space-6);
    --faq-ic-bg-active: transparent;
    /* radius none-to-xs, no elevation */
    --faq-row-radius: 0px;
    --faq-row-shadow: none;
    --faq-box-radius: 0px;
    --faq-box-border-width: 0px;
    --faq-box-bg: transparent;
    --faq-box-shadow: none;
    /* the prose IS the product: one step up, at the editorial measure */
    --faq-answer-size: var(--text-lg);
    --faq-answer-leading: var(--leading-relaxed);
    --faq-row-pad-block: calc(var(--space-6) * var(--jp-rhythm));
  }

  /* A flat hairline, not a fade. A gradient that dissolves at both ends is the
     cinematic ceremonial mark; an editorial rule is a rule. */
  :global([data-jp-surface='bare'][data-jp-align='start']) .faq__rule {
    background: var(--color-border);
  }

  /* "…under EVERY section head" — the cluster label is a section head too, and
     it had no rule. */
  :global([data-jp-surface='bare'][data-jp-align='start']) .faq__group-label {
    padding-block-end: calc(var(--space-2) * var(--jp-rhythm));
    border-block-end: var(--border-width) solid var(--color-border);
    letter-spacing: var(--tracking-wide);
  }

  /* `boxed` keeps its own four-sided border at (0,5,0), which the vocabulary
     zeroes — so the row's separating hairline has to come back explicitly. This
     is the only look that needs a per-composition rule, and it is because
     "no box borders anywhere" is a stronger claim than any property re-point. */
  :global([data-jp-surface='bare'][data-jp-align='start'])
    .faq[data-faq='boxed']
    .faq__item {
    border-block-end: var(--border-width) solid var(--color-border);
    padding-inline: 0;
  }

  /* ═══ 1.2 BRUTALIST — `plain-facts` ════════════════════════════════════
     TELL: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere.

     ① `edge: offset` is plain-facts ALONE — the only look on that value.
     ② Candlelit is `edge: none`.

     Three measured defects this closes, all of them the tell failing:
      • `radius 0 everywhere` was false. plain-facts is `surface: panel`, and
        `[data-jp-surface='panel']` sets `--jp-sec-radius: var(--radius-card)`,
        so the section box was ROUNDED; the +/− control was `--radius-full`, a
        pill; `boxed` entries were `--radius-lg`; the glyph bars `--radius-xs`.
      • `2px borders on every block` was false. Rows took the `--border-width`
        hairline, and only the section box and `boxed` entries took the thick
        edge.
      • the hard offset shadow reached the SECTION but no row, so the signature
        appeared once per section instead of once per block. `--jp-edge-shadow`
        at `edge: offset` is `--space-1 --space-1 0 0 --jp-line-strong` — already
        zero-blur, so the offset itself needed no invention, only wiring. */
  :global([data-jp-edge='offset']) .faq {
    /* radius 0 everywhere — including the one the `panel` surface imposes */
    border-radius: var(--radius-none);
    --faq-row-radius: 0px;
    --faq-box-radius: 0px;
    --faq-ic-radius: 0px;
    --faq-glyph-radius: 0px;
    --faq-ordinal-radius: 0px;
    /* EVERY BLOCK IS A VISIBLE BOX, in all five compositions and not only in
       `boxed` — 2px, in the strong rung, because a brutalist border is meant to
       be seen. The list's own top rule goes: it would be a stray line above the
       first box. */
    --faq-list-rule-width: 0px;
    --faq-row-border-width: var(--border-width-thick);
    --faq-row-border-color: var(--color-border-strong);
    --faq-row-rule-width: var(--border-width-thick);
    --faq-row-rule-color: var(--color-border-strong);
    --faq-row-gap: calc(var(--space-3) * var(--jp-rhythm));
    --faq-row-bg: var(--color-surface);
    --faq-row-shadow: var(--jp-edge-shadow);
    --faq-row-pad-block: calc(var(--space-4) * var(--jp-rhythm));
    --faq-row-pad-inline: calc(var(--space-4) * var(--jp-rhythm));
    --faq-box-border-width: var(--border-width-thick);
    --faq-box-border-color: var(--color-border-strong);
    --faq-box-bg: var(--color-surface);
    --faq-box-shadow: var(--jp-edge-shadow);
    --faq-ic-border-width: var(--border-width-thick);
    --faq-ic-border-color: var(--color-border-strong);
    --faq-ic-size: var(--space-8);
    /* the head rule is a thick print rule, flush left */
    --faq-head-rule-width: 100%;
    --faq-head-rule-height: var(--border-width-thick);
    /* mono labels, and a mono row number */
    --faq-eyebrow-size: var(--text-xs);
    --faq-label-size: var(--text-xs);
    --faq-ordinal: counter(faq-n, decimal-leading-zero);
  }

  /* Mono labels. The family has "no separate display face" — the body face at
     heavy weight or the mono face — and the label is where that reads. */
  :global([data-jp-edge='offset']) .faq__eyebrow,
  :global([data-jp-edge='offset']) .faq__group-label {
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-wide);
  }

  :global([data-jp-edge='offset']) .faq__rule {
    background: var(--color-border-strong);
  }

  /* ═══ 1.3 SOFT-ORGANIC — `open-air` ════════════════════════════════════
     TELL: no border anywhere, pill controls, and a shadow you have to look for.

     ① `surface: tint` is open-air ALONE.
     ② Candlelit is `surface: media`.

     THIS IS THE MOST DANGEROUS LOOK IN THE FILE and the selector choice is the
     whole safeguard: open-air shares FOUR axes with Candlelit (`align: center`,
     `density: airy`, `width: text`, `motion: drift`). Keying on any of those
     four — or on `type: expressive`, which it shares with full-send — would
     restyle a look this pass is forbidden to touch. `surface: tint` is the only
     value open-air holds alone besides `edge: soft`, and neither is Candlelit's.

     The defect: "no border anywhere" was UNREACHABLE. `--faq-row-rule-width`
     defaults to the `--border-width` token rather than to `--jp-edge-width`
     (see `.faq__list`), by a deliberate legibility decision — so `edge: soft`
     zeroed `--jp-edge-width` and the rows kept their hairlines anyway. The look
     re-points the property instead, and pays the separation back the way the
     family specifies: space, a soft plate, and elevation. `edge: soft` supplies
     `--shadow-lg`, which is the "large, very diffuse, very low opacity" the
     family asks for. */
  :global([data-jp-surface='tint']) .faq {
    /* NO border anywhere — list rule, row rule, row box, ring, plate; and the
       section box already has none via `edge: soft`. */
    --faq-list-rule-width: 0px;
    --faq-row-rule-width: 0px;
    --faq-row-border-width: 0px;
    --faq-ic-border-width: 0px;
    --faq-box-border-width: 0px;
    /* separation is space + a soft plate + a shadow you have to look for */
    --faq-row-gap: calc(var(--space-3) * var(--jp-rhythm));
    --faq-row-radius: var(--radius-xl);
    --faq-row-bg: color-mix(in oklab, var(--color-surface) 55%, transparent);
    --faq-row-shadow: var(--jp-edge-shadow);
    --faq-row-pad-block: calc(var(--space-6) * var(--jp-rhythm));
    --faq-row-pad-inline: calc(var(--space-5) * var(--jp-rhythm));
    --faq-box-radius: var(--radius-xl);
    --faq-box-bg: color-mix(in oklab, var(--color-surface) 55%, transparent);
    --faq-box-shadow: var(--jp-edge-shadow);
    /* pill controls — and the accent as a tinted wash, never a hard fill */
    --faq-ic-radius: var(--radius-full);
    --faq-ic-size: var(--space-9);
    --faq-ic-bg: color-mix(in oklab, var(--jp-accent-text) 10%, transparent);
    --faq-ic-bg-active: color-mix(in oklab, var(--jp-accent-text) 22%, transparent);
    /* gentle drift, in the interaction as well as the entrance */
    --faq-ease: var(--ease-smooth);
    --faq-answer-leading: var(--leading-relaxed);
  }

  /* Even the head mark loses its hard edge: a soft lozenge, not a hairline. The
     one place this family allows a visible divider is a rounded one. */
  :global([data-jp-surface='tint']) .faq__rule {
    width: var(--space-10);
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--jp-accent-mark) 30%, transparent);
  }

  /* ═══ 1.4 LUXURY-MINIMAL — `quiet-studio` ══════════════════════════════
     TELL: three type sizes, one hairline, no accent colour, and more empty space
     than content.

     ① `accent: none` is quiet-studio ALONE.
     ② Candlelit is `accent: glow`.

     THIS BLOCK IS MOSTLY SUBTRACTION, which is the correct edit for this family
     — "the emptiness IS the design". Counted before: this section rendered ONE
     hairline per row plus a list top rule plus a ring around every +/−, i.e.
     2n+1 hairlines for n questions, and FOUR distinct type sizes (heading
     `--text-4xl`, question `--text-xl`, eyebrow/label `--text-sm`, answer
     `--text-base`). Both numbers contradict the tell directly.

     After: exactly ONE hairline in the whole section — the ceremonial rule under
     the head — and exactly THREE type sizes, because the eyebrow, the cluster
     label and the answer all collapse onto `--text-base`. Separation is bought
     back with `--space-10 × 1.6` of row padding, which is ~128px between
     question baselines at `density: vast`: conspicuous, which is the point.

     `accent: none` already re-points `--jp-accent-text` to `--jp-heading`, so
     every mark in the section is monochrome from the ladder with no work here —
     the axis does that half. */
  :global([data-jp-accent='none']) .faq {
    /* ONE hairline: the head rule. Every row rule and the ring go. */
    --faq-list-rule-width: 0px;
    --faq-row-rule-width: 0px;
    --faq-row-border-width: 0px;
    --faq-ic-border-width: 0px;
    --faq-box-border-width: 0px;
    --faq-box-bg: transparent;
    --faq-box-shadow: none;
    --faq-row-radius: 0px;
    --faq-box-radius: 0px;
    --faq-ic-bg-active: transparent;
    --faq-ic-size: var(--space-6);
    /* more empty space than content */
    --faq-block-gap: calc(var(--jp-sec-gap) * 2.6);
    --faq-row-pad-block: calc(var(--space-10) * var(--jp-rhythm));
    /* THREE type sizes: heading, question, and one shared body rung */
    --faq-eyebrow-size: var(--text-base);
    --faq-label-size: var(--text-base);
    --faq-answer-size: var(--text-base);
    /* the single hairline, wide and level — no fade, no accent */
    --faq-head-rule-width: var(--space-20);
  }

  :global([data-jp-accent='none']) .faq__rule {
    background: var(--color-border);
  }

  /* "Centred; generous." The list is `text-align: left` for the accordion's
     sake — a centred flex row with a control pinned to its end reads as broken —
     but the STATIC `open` composition has no control, so it can honour
     `align: center` properly. Restricted to that one composition on purpose. */
  :global([data-jp-accent='none']) .faq[data-faq='open'] .faq__list {
    text-align: var(--jp-text-align);
  }

  :global([data-jp-accent='none']) .faq[data-faq='open'] .faq__a {
    margin-inline: auto;
  }

  /* ═══ 1.5 TECHNICAL — `syllabus` ═══════════════════════════════════════
     TELL: hairline grid, mono numerals, and a left-border accent stripe rather
     than a filled badge.

     ① `accent: edge` is syllabus ALONE (`type: restrained` would serve equally).
     ② Candlelit is `accent: glow`.

     All three parts of the tell were absent: no numerals of any kind, no left
     stripe, and the grid was a single-axis stack of horizontal rules with
     nothing vertical to make it read as a table. `--jp-accent-edge` is the role
     token `journey-design.css` created for precisely this stripe, and at
     `accent: edge` it is `--jp-ember`; the stripe carries no information the
     adjacent text does not, so the 3:1 graphic floor does not apply to it (the
     A34 decorative-mark rule) — which is also why it is a stripe and not the
     filled badge the family explicitly rejects. */
  :global([data-jp-accent='edge']) .faq {
    /* hairline grid: dense rows, crisp corners, small square control */
    --faq-list-rule-width: var(--border-width);
    --faq-row-rule-width: var(--border-width);
    --faq-row-rule-color: var(--color-border);
    --faq-row-gap: 0px;
    --faq-row-radius: 0px;
    --faq-row-pad-block: calc(var(--space-3) * var(--jp-rhythm));
    --faq-box-radius: var(--radius-sm);
    --faq-ic-radius: var(--radius-sm);
    --faq-ic-size: var(--space-7);
    --faq-glyph-size: var(--space-2);
    --faq-glyph-radius: 0px;
    /* mono numerals, tabular, in ladder ink — `accent: edge` puts
       `--jp-accent-text` on `--jp-text`, which is the neutral this family wants */
    --faq-ordinal: counter(faq-n, decimal-leading-zero);
    --faq-ordinal-size: var(--text-xs);
    --faq-ordinal-min: var(--space-6);
    /* fine-grained, dense hierarchy: many small steps */
    --faq-eyebrow-size: var(--text-xs);
    --faq-label-size: var(--text-xs);
    --faq-answer-size: var(--text-sm);
    --faq-answer-leading: var(--leading-normal);
    --faq-head-rule-width: 100%;
    --faq-head-rule-height: var(--border-width);
  }

  /* THE LEFT-BORDER ACCENT STRIPE. Persistent, not a hover or open state: the
     family's stripes are status marks on a syllabus row, and half of this
     section's compositions (`open`, `paired`) have no open state to key off, so
     a state-dependent stripe would be invisible on exactly the compositions a
     curriculum-heavy page is most likely to pick. */
  :global([data-jp-accent='edge']) .faq__item {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
    padding-inline-start: calc(var(--space-4) * var(--jp-rhythm));
  }

  /* `boxed` paints a four-sided border at (0,5,0), which would overwrite the
     stripe with its own hairline. This is the one composition that has to be
     told, and it is told at (0,6,0). */
  :global([data-jp-accent='edge']) .faq[data-faq='boxed'] .faq__item {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
  }

  :global([data-jp-accent='edge']) .faq__eyebrow,
  :global([data-jp-accent='edge']) .faq__group-label {
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-wide);
  }

  :global([data-jp-accent='edge']) .faq__rule {
    background: var(--color-border);
  }

  /* The vertical half of "reads as a table". Only inside the container width
     where `paired` is actually two columns — a left border on a stacked answer
     is noise, not a grid (contract A14: container query, never viewport). */
  @container (min-width: 44rem) {
    :global([data-jp-accent='edge'])
      .faq[data-faq='paired']
      .faq__panel-inner {
      border-inline-start: var(--border-width) solid var(--color-border);
      padding-inline-start: var(--jp-sec-gap);
    }
  }

  /* ═══ 1.8 PLAYFUL — `full-send` ════════════════════════════════════════
     TELL: whole inverted bands, pill CTAs at `--radius-full`, spring easing, big
     numerals.

     ① `surface: invert` is full-send ALONE (`edge: heavy` and
        `motion: stagger` would serve equally).
     ② Candlelit is `surface: media`.

     The band is the axis's own work — `surface: invert` re-points `--jp-ink` to
     the far pole and the whole section flips, ladder and all. What was missing
     is everything the band is supposed to CONTAIN: no big numerals anywhere in
     the section, the thick accent border landing only on the section box and not
     on any row, and the spring reaching only the entrance (`--jp-reveal-ease`)
     while every interaction stayed on `--ease-out`. The MOTION block above hands
     the spring to the interaction; this block does the numerals and the pills.

     The numeral is a filled pill because this is the one family whose colour
     rule is "accent as fill, everywhere, at full strength" — and it uses the
     `--jp-accent-fill` / `--jp-accent-on-fill` PAIR, which is contrast-calibrated
     together, rather than painting ember under ladder ink. */
  :global([data-jp-surface='invert']) .faq {
    /* pill everything, at full radius */
    --faq-ic-radius: var(--radius-full);
    --faq-ic-size: var(--space-10);
    --faq-glyph-size: var(--space-4);
    --faq-glyph-radius: var(--radius-full);
    --faq-row-radius: var(--radius-xl);
    --faq-box-radius: var(--radius-xl);
    /* thick accent edge on every block, not just the band */
    --faq-list-rule-width: 0px;
    --faq-row-rule-width: 0px;
    --faq-row-border-width: var(--border-width-thick);
    --faq-row-border-color: var(--jp-accent-edge);
    --faq-row-gap: calc(var(--space-4) * var(--jp-rhythm));
    --faq-row-bg: var(--color-surface);
    --faq-row-pad-block: calc(var(--space-5) * var(--jp-rhythm));
    --faq-row-pad-inline: calc(var(--space-5) * var(--jp-rhythm));
    --faq-box-border-width: var(--border-width-thick);
    --faq-box-border-color: var(--jp-accent-edge);
    --faq-box-bg: var(--color-surface);
    --faq-box-shadow: none;
    --faq-ic-border-width: var(--border-width-thick);
    --faq-ic-border-color: var(--jp-accent-edge);
    --faq-ic-bg-active: color-mix(in oklab, var(--jp-accent-fill) 22%, transparent);
    /* BIG NUMERALS, as filled pills. Sized off `--jp-body-size` so the `type`
       axis still reaches them rather than freezing at one hardcoded step. */
    --faq-ordinal: counter(faq-n);
    --faq-ordinal-font: var(--font-heading);
    --faq-ordinal-weight: var(--font-bold);
    --faq-ordinal-size: calc(var(--jp-body-size) * 1.5);
    --faq-ordinal-color: var(--jp-accent-on-fill);
    --faq-ordinal-bg: var(--jp-accent-fill);
    --faq-ordinal-radius: var(--radius-full);
    --faq-ordinal-pad: calc(var(--space-2) * var(--jp-rhythm))
      calc(var(--space-4) * var(--jp-rhythm));
    --faq-ordinal-min: var(--space-14);
    --faq-ordinal-align: middle;
    /* the head mark as a thick accent bar with a pill cap */
    --faq-head-rule-width: var(--space-16);
    --faq-head-rule-height: var(--border-width-toast);
  }

  :global([data-jp-surface='invert']) .faq__rule {
    border-radius: var(--radius-full);
    background: var(--jp-accent-fill);
  }

  /* ═══ 1.9 CONTEMPORARY — `signal` (the platform default) ═══════════════
     TELL: rounded cards with hairlines and a small neutral shadow; ONE filled
     accent button per section.

     ① `surface: panel` is {plain-facts, syllabus, signal}; plain-facts is
        `type: monumental` and syllabus is `type: restrained`. So `panel` +
        `balanced` is signal alone.
     ② Candlelit is `surface: media`, `type: monumental` — neither half matches.

     Before this block, signal's accordion was an undifferentiated stack of
     hairline-ruled rows: no card, no radius, no shadow — none of the three
     things its tell names — and the accent appeared on every row's control at
     once, which is the opposite of "one filled accent per section". The card
     treatment is deliberately NOT delegated to the `boxed` composition: a look
     must not require a particular composition to be recognisable, or it is a
     composition wearing a look's name.

     `--shadow-sm` and not `--jp-edge-shadow`, because this is the one family
     whose shadow is specified as NEUTRAL. `--jp-edge-shadow` at
     `edge: hairline` is `--shadow-xs`, which is a hairline's elevation, not a
     card's. */
  :global([data-jp-surface='panel'][data-jp-type='balanced']) .faq {
    /* rounded cards with hairlines and a small NEUTRAL shadow */
    --faq-list-rule-width: 0px;
    --faq-row-rule-width: 0px;
    --faq-row-border-width: var(--border-width);
    --faq-row-border-color: var(--color-border);
    --faq-row-gap: calc(var(--space-3) * var(--jp-rhythm));
    --faq-row-radius: var(--radius-lg);
    --faq-row-bg: var(--color-surface);
    --faq-row-shadow: var(--shadow-sm);
    --faq-row-pad-block: calc(var(--space-4) * var(--jp-rhythm));
    --faq-row-pad-inline: calc(var(--space-4) * var(--jp-rhythm));
    --faq-box-radius: var(--radius-lg);
    --faq-box-border-color: var(--color-border);
    --faq-box-bg: var(--color-surface);
    --faq-box-shadow: var(--shadow-sm);
    /* the control is neutral chrome at rest — the accent is a STATE, not a skin */
    --faq-ic-radius: var(--radius-md);
    --faq-ic-border-color: var(--color-border);
    --faq-ic-glyph: var(--color-text-secondary);
    --faq-ic-bg-active: color-mix(in oklab, var(--color-text) 8%, transparent);
    --faq-head-rule-width: var(--space-10);
    --faq-head-rule-height: var(--border-width-thick);
  }

  /* ONE FILLED ACCENT CONTROL PER SECTION — the open row's. Set as inherited
     PROPERTIES on the row rather than as paint on the control, so the base
     hover/open rules keep their specificity and the closed rows keep the neutral
     chrome. The pair `--jp-accent-fill` / `--jp-accent-on-fill` is
     contrast-calibrated together. */
  :global([data-jp-surface='panel'][data-jp-type='balanced']) .faq__item[open] {
    --faq-ic-border-color: var(--jp-accent-fill);
    --faq-ic-bg-active: var(--jp-accent-fill);
    --faq-ic-glyph: var(--jp-accent-on-fill);
  }

  :global([data-jp-surface='panel'][data-jp-type='balanced']) .faq__rule {
    border-radius: var(--radius-full);
    background: var(--jp-accent-fill);
  }

  /* ── narrow: drop the answer indent so the measure is not squeezed ──
     A CONTAINER query (contract A14), replacing a raw `35rem` viewport query. */
  @container (max-width: 35rem) {
    .faq__panel-inner {
      padding-inline: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    /* THE PROPERTY OVERRIDES ARE THE REAL GUARANTEE. `--faq-motion: 0` collapses
       every local transition duration to `0ms` wherever it is read, so it does
       not have to out-specify the (0,5,0) composition rule that sets the answer
       transition — which the element list below does NOT manage to do, and never
       did. Kept anyway, because it also covers the `transition-property` list
       itself and costs nothing.

       This is why no look block may re-point `--faq-motion` or
       `--faq-answer-rise` to a non-zero value: both are declared at `.faq`
       specificity here, and a (0,3,0) look selector would beat them. */
    .faq {
      --faq-motion: 0;
      --faq-answer-rise: 0px;
    }

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
