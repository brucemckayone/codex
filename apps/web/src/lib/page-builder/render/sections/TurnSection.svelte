<!--
  @component TurnSection

  The pivot from pain to promise (SPEC §4.1 `turn`).

  ── THE AXES THIS SECTION CONSUMES: EIGHT ──────────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion`. Every
  layout / rhythm / type-scale / edge / surface / motion decision reads a `--jp-*`
  property that `render/SectionRenderer.svelte` resolves onto the `.jp-sec`
  wrapper as a `data-jp-*` attribute. COLOUR STAYS `--color-*` (contract A11);
  the one exception is the `--jp-accent-*` family.

  `media` is DELIBERATELY unconsumed. Research §2.2 names the five types where it
  is meaningful — `hero`, `introVideo`, `reel`, `guide`, `proof` — and says the
  rest "ignore it, exactly as they ignore a variant they do not offer."
  `TurnSectionProps` is `{eyebrow, statement, lede, points}`: no media reference
  at any depth, so claiming nine would have meant inventing a consumer (A50).

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `statement` (default) · `column` · `paired` · `arc` · `before-after` ·
  `numbered`.

  `column` absorbs the retired prose `centered` + `wide` (they were `align` +
  `width`) and `paired` is the retired `twocol`; both are ported from the canvas
  partial `render-edit/journey-sections/_prose.css` (contract A12). `arc` is the
  numbered descent rail this component has always drawn — the behaviour existed
  and had no name (research §3). `before-after` and `numbered` are new.

  COMPOSITIONS CARRY ARRANGEMENT, NEVER TYPE SCALE. `statement` is "oversized"
  through a tight measure and extra rhythm, not a larger `font-size`: scale is
  what the `type` axis is for. The section `<h2>` is `--jp-heading-size` via
  `.jp-sec__heading--sub`, never `--jp-display` (contract A36).

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): the fully-composed layout — statement,
    lede, thread, rail drawn, root lit, every stage visible. This is what the
    server emits, so the section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): the shared `reveal` action arms the hidden
    state from JS and the blocks arrive on the `motion` axis's timing; the rail
    draws downward into the root.

  The static composition is the baseline and the motion is layered on top of it,
  never the other way round (contract A40): the hidden states apply ONLY under
  `.reveal--armed`, which the action adds from JS and withholds entirely under
  `prefers-reduced-motion`.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { aliasKeys, asStringArray, asStringFrom } from '../coerce';
  import { reveal } from '../reveal';
  import type { TurnSectionProps, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * `from` and `to` are the `OWED_READS.turn` entries (contract A28) — the
   * builder has written them since F-C and nothing read them, so the
   * `before-after` composition had no content. Declared here rather than on
   * `TurnSectionProps` in `render/types.ts`, which is shared across the seven
   * component worktrees; consolidation should absorb them.
   *
   * Wiring them turns `section-fields.test.ts`'s "every OWED_READS entry is still
   * genuinely unread" assertion red on the `turn: ['from', 'to']` line, which is
   * that test working as designed — the WT-1 report names the line to delete.
   */
  interface TurnCopy extends TurnSectionProps {
    from?: string;
    to?: string;
  }

  interface Props {
    config: SectionProps;
    /** Present for a uniform section-component contract; unused by this section. */
    context: JourneySalesContext;
    variant?: string;
    /**
     * Present for the uniform contract and NOT destructured: all eight axes this
     * section consumes land in CSS, because none of them changes what is
     * RENDERED.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, variant, editable = false, onEdit }: Props = $props();

  // The builder authors this section as flat `{kicker, heading, body}`, which maps
  // 1:1 onto eyebrow/statement/lede through the shared alias table. The
  // preference lists come from `aliasKeys`, never from inline literals: seven
  // worktrees read these keys, and a hand-copied list drifts INVISIBLY, because it
  // degrades to a fallback rather than failing.
  const p: TurnCopy = $derived({
    eyebrow: asStringFrom(config, aliasKeys('turn', 'eyebrow')),
    statement: asStringFrom(config, aliasKeys('turn', 'statement')),
    lede: asStringFrom(config, aliasKeys('turn', 'lede')),
    points: asStringArray(config, 'points'),
    from: asStringFrom(config, aliasKeys('turn', 'from')),
    to: asStringFrom(config, aliasKeys('turn', 'to')),
  });

  const COMPOSITIONS = [
    'statement',
    'column',
    'paired',
    'arc',
    'before-after',
    'numbered',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'statement'
  );

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
      const base = { roman: toRoman(i + 1), ordinal: String(i + 1) };
      if (match && match.index !== undefined) {
        return {
          ...base,
          name: raw.slice(0, match.index).trim(),
          gloss: raw.slice(match.index + match[0].length).trim() || undefined,
        };
      }
      return { ...base, name: raw, gloss: undefined };
    })
  );

  /**
   * `arc` and `numbered` are the two compositions made of `points`. With an empty
   * array they render the copy and no list — they degrade to `statement` rather
   * than to an empty section. String discriminants, not booleans: `apps/web` has
   * `strictNullChecks` OFF, so a boolean-literal discriminant does not narrow.
   */
  const stageList = $derived(
    (composition === 'arc' || composition === 'numbered') && stages.length > 0
      ? composition
      : 'none'
  );

  /** `before-after` needs at least one panel; with neither it degrades to copy. */
  const panels = $derived(
    composition === 'before-after' && (p.from || p.to) ? 'yes' : 'no'
  );

  /** `arc` is the only composition that puts the copy and the list side by side. */
  const split = $derived(
    composition === 'arc' || composition === 'paired' ? 'yes' : 'no'
  );

  const hasContent = $derived(
    !!(p.statement || p.lede || p.eyebrow || stages.length > 0 || p.from || p.to)
  );


  /**
   * The props key an inline edit must write BACK to: the one the displayed value
   * was actually READ from, never the renderer's own prop name.
   *
   * This matters because the alias lists are ordered. A page that stores
   * `eyebrow` (the six seeded `ache` sections do) would, if an edit wrote
   * `kicker`, end up holding BOTH keys — and `eyebrow` wins the preference list,
   * so the creator's edit would render as nothing at all while the data silently
   * grew a second copy. The fallback is the key `section-fields.ts` writes, which
   * is what a page that holds neither should acquire.
   */
  const readKey = (keys: readonly string[], fallback: string): string => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim() !== '') return key;
    }
    return fallback;
  };

  /**
   * The shared `.jp-reveal[data-jp-step]` ladder stops at 5 and
   * `--jp-reveal-stagger` is calibrated for about that many block beats, so a
   * long stage list clamps rather than taking seconds to assemble (pilot
   * lesson 5). This replaces the six bespoke `60ms`/`120ms`/`200ms`/`110ms`/
   * `150ms`/`1000ms` delays, which hardcoded their own ladder and so ignored the
   * `motion` axis entirely.
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
   * only after hydration. Here the text is a real child node.
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
</script>

{#snippet lede()}
  {#if p.lede}
    <p class="turn__lede jp-reveal" data-jp-step="2" {...editAttrs(readKey(aliasKeys('turn', 'lede'), 'body'))}>
      {p.lede}
    </p>
  {/if}
{/snippet}

{#snippet head(withLede)}
  <div class="turn__head">
    {#if p.eyebrow}
      <p class="jp-sec__eyebrow turn__eyebrow jp-reveal" {...editAttrs(readKey(aliasKeys('turn', 'eyebrow'), 'kicker'))}>
        {p.eyebrow}
      </p>
    {/if}
    {#if p.statement}
      <h2
        class="jp-sec__heading jp-sec__heading--sub turn__statement jp-reveal"
        data-jp-step="1"
        {...editAttrs(readKey(aliasKeys('turn', 'statement'), 'heading'))}
      >
        {p.statement}
      </h2>
    {/if}
    {#if withLede === 'yes'}
      {@render lede()}
    {/if}
    <div class="turn__thread jp-reveal" data-jp-step="3" aria-hidden="true"></div>
  </div>
{/snippet}

{#snippet stageRows(numbering)}
  <ol
    class="turn__stages"
    aria-label={numbering === 'arc'
      ? m.journey_turn_stages_label_descent()
      : m.journey_turn_stages_label()}
  >
    {#each stages as stage, i (i)}
      <li class="turn__stage jp-reveal" data-jp-step={step(i)} style="--d: {i}">
        <!-- `aria-hidden` on the numeral: the `<ol>` already conveys order, so a
             screen reader would otherwise hear "i" or "1" twice per row. -->
        <span class="turn__num" aria-hidden="true">
          {numbering === 'arc' ? stage.roman : stage.ordinal}
        </span>
        <div class="turn__stage-body">
          <h3 class="turn__name">{stage.name}</h3>
          {#if stage.gloss}
            <p class="turn__gloss">{stage.gloss}</p>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

{#if hasContent}
  <div class="turn" data-turn={composition} data-split={split}>
    <!-- The cinematic atmosphere. ONE `--jp-sec-atmos` gate on this wrapper
         rather than one per layer (pilot lesson 3), and the wrapper holds nothing
         but decoration so gating it can never fade the copy. -->
    <div class="turn__atmos" aria-hidden="true">
      <div class="turn__well"></div>
    </div>

    <!-- ONE observer for the whole section, on the container: the shared atom is
         `.reveal--armed .jp-reveal` (a DESCENDANT selector) and the action adds
         `.reveal--armed` to the node it is used on. -->
    <div class="turn__inner" use:reveal>
      <div class="turn__grid">
        <!-- `paired` is the one composition whose SECOND column is the lede, so
             the lede is rendered as a grid child rather than inside the head. One
             snippet, two placements — cheaper than a second DOM shape. -->
        {@render head(composition === 'paired' ? 'no' : 'yes')}
        {#if composition === 'paired'}
          {@render lede()}
        {/if}

        {#if stageList !== 'none'}
          <div class="turn__arc">
            {#if stageList === 'arc'}
              <span class="turn__rail turn__rail--base" aria-hidden="true"></span>
              <span
                class="turn__rail turn__rail--progress"
                aria-hidden="true"
              ></span>
              <span class="turn__root" aria-hidden="true"></span>
            {/if}
            {@render stageRows(stageList)}
          </div>
        {/if}

        {#if panels === 'yes'}
          <div class="turn__panels">
            <div class="turn__panel jp-reveal" data-jp-step="1">
              <p class="turn__panel-label">{m.journey_turn_panel_from()}</p>
              {#if p.from}
                <p class="turn__panel-body" {...editAttrs('from')}>{p.from}</p>
              {/if}
            </div>
            <div class="turn__panel turn__panel--to jp-reveal" data-jp-step="2">
              <p class="turn__panel-label">{m.journey_turn_panel_to()}</p>
              {#if p.to}
                <p class="turn__panel-body" {...editAttrs('to')}>{p.to}</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
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
     page rather than the section (pilot lesson 1). `.turn` is that descendant.

     `text-align` was a hardcoded `left` here — the only left-aligned section in
     the tree — and is now the `align` axis. See the WT-1 report's Candlelit
     verdict: the golden page's own `turn` section carries a section-level
     `{"align":"center"}` override, so on the one page this type exists on, centred
     IS the stored intent.
     ═══════════════════════════════════════════════════════════════════════ */
  .turn {
    position: relative;
    isolation: isolate;
    overflow: clip;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);
  }

  .turn__inner {
    position: relative;
    z-index: 1;
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  .turn__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: calc(var(--jp-sec-gap) * 2);
    justify-items: var(--jp-align);
  }

  /* ── the atmosphere layer (surface: media only) ── */
  .turn__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
  }

  /* A warm well the eye descends toward. */
  .turn__well {
    position: absolute;
    left: 50%;
    bottom: -16%;
    width: min(115cqw, calc(var(--jp-content-max) * 0.94));
    aspect-ratio: 1;
    translate: -50% 0;
    filter: blur(var(--blur-xl));
    background: radial-gradient(
      circle at 50% 50%,
      color-mix(in oklab, var(--jp-accent-mark) 15%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 11%, transparent) 40%,
      transparent 66%
    );
  }

  /* ── the head ── */
  .turn__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: var(--jp-align);
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  .turn__statement {
    margin: 0;
  }

  .turn__lede {
    margin: 0;
    max-width: var(--jp-measure);
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* Decorative thread — the descent begins here. `--jp-accent-mark`, never
     `--jp-accent-fill`: the latter is `transparent` at `accent: text` and
     `accent: edge`, so this would vanish on two of five values (pilot lesson 4). */
  .turn__thread {
    width: clamp(var(--space-12), 6cqw, var(--space-20));
    height: var(--border-width-thick);
    border-radius: var(--radius-full);
    /* `center`, not the original `left center`: the `align` axis can centre this
       section, and a centred bar that grows from its left edge reads as a
       mis-alignment. */
    transform-origin: center;
    background: linear-gradient(90deg, var(--jp-accent-mark), transparent);
  }

  /* ═══ COMPOSITIONS ═══════════════════════════════════════════════════════ */

  /* `statement` — the pivot as one line carrying the section. "Oversized" is a
     TIGHT MEASURE plus extra rhythm, not a bigger font-size (contract A36).
     Derived from `--jp-measure`, so the `width` axis still moves it; at `narrow`
     it lands on ~15ch, which is the canvas partial's own `16ch`. */
  .turn[data-turn='statement'] .turn__statement {
    max-width: calc(var(--jp-measure) / 3);
  }

  .turn[data-turn='statement'] {
    /* The canvas partial gives `statement` roughly 1.3x the block padding of
       `centered`; a multiple of the axis's own padding, so `density` still
       governs it. */
    padding-block: calc(var(--jp-sec-pad-block) * 1.3);
  }

  /* `arc` and `paired` put the copy beside its second column. The asymmetric
     0.9/1.1 split is the one this component has always drawn. */
  @container (min-width: 48rem) {
    .turn[data-split='yes'] .turn__grid {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: calc(var(--jp-sec-gap) * 2.7);
      align-items: center;
      /* Columns must FILL in split mode; `justify-items` from the `align` axis
         would otherwise shrink each column to its content width. */
      justify-items: stretch;
    }

    .turn[data-split='yes'] .turn__well {
      left: 50%;
      bottom: 4%;
      width: min(140cqw, calc(var(--jp-content-max) * 0.65));
    }
  }

  /* `paired` lets the head fill its own column, since the lede has moved to the
     second one. */
  .turn[data-turn='paired'] .turn__head {
    max-width: none;
  }

  /* ── the descent arc ── */
  .turn__arc {
    position: relative;
    padding-inline-start: var(--space-2);
    width: 100%;
    text-align: start;
  }

  /* The rail: a faint base plus an accent progress line that draws downward.
     `--jp-accent-edge` is read DIRECTLY, with no percentage carried onto it — at
     `accent: glow` it is already a 45% ember mix, so a further 28% would land near
     12% and the rail would disappear (contract A37) — and even read directly it
     fails the graphic floor, which is why the progress line below reads
     `--jp-accent-mark`. Resting weight is carried on
     BORDER WIDTH and colour, never on a low opacity: measured three times across
     two components, any alpha faint enough to look faint fails 3:1 at the dark
     pole (contract A39). */
  .turn__rail {
    position: absolute;
    left: var(--space-1);
    top: var(--space-6);
    bottom: var(--space-6);
    width: var(--border-width-thick);
    translate: -50% 0;
    border-radius: var(--radius-full);
  }

  .turn__rail--base {
    background: var(--jp-edge-color);
  }

  .turn__rail--progress {
    transform-origin: top center;
  /* `--jp-accent-mark`, NOT `--jp-accent-edge`. MEASURED on the golden org's dark
     pole: `--jp-accent-edge` at `accent: glow` — which is Candlelit's own value,
     i.e. what all 695 pages carry — is `color-mix(--jp-ember 45%, transparent)`,
     and `--jp-ember` is the 2.04:1-in-dark purple, so the rule reads **2.05:1**
     against a 3:1 graphic floor. That is contract A39's own third measurement
     reproduced exactly (45% -> 2.05), from a different component. `--jp-accent-mark`
     is the role A38 made AA-safe for precisely this — a decorative brand mark that
     must be a real colour on all five accent values — and measures 6.04 dark /
     14.62 light on the same page. The WT-1 report asks the orchestrator to decide
     whether `glow`'s edge mix should be raised in `journey-design.css`. */
    background: var(--jp-accent-mark);
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
    background: var(--jp-accent-mark);
    box-shadow: var(--jp-accent-glow);
  }

  .turn__stages {
    margin: 0;
    padding: 0;
    list-style: none;
    width: 100%;
  }

  .turn__stage {
    position: relative;
    display: grid;
    grid-template-columns: clamp(var(--space-12), 6cqw, var(--space-16)) 1fr;
    column-gap: clamp(var(--space-3), 1.8cqw, var(--space-5));
    align-items: baseline;
    padding-block: calc(var(--space-5) * var(--jp-rhythm));
  }

  /* WIDTH is a token, COLOUR is the axis: reading `--jp-edge-width` here would
     let `edge: none` delete the only boundary between rows, which is a legibility
     loss rather than a style choice. */
  .turn__stage + .turn__stage {
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  /* The numeral was `color-mix(brand-accent calc(58% + var(--d) * 10%),
     text-secondary)` — a per-index colour ramp that made the first numerals the
     LOWEST contrast, on top of routing a raw brand token into text. It now reads
     the accent's TEXT role, which resolves to the AA-calibrated `--jp-ember-text`
     and never to `--jp-ember` (8.49:1 light but 2.04:1 DARK on the golden org —
     the single most likely regression in this programme, per the research). */
  .turn__num {
    grid-column: 1;
    justify-self: start;
    padding-inline-start: clamp(var(--space-3), 1.6cqw, var(--space-5));
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    /* A DISPLAY glyph, not card-scale text, so it derives from the heading step
       rather than from `--jp-body-size` — contract A44's prohibition is on
       re-inventing the BODY rung, which `--jp-body-size` now owns. `/ 1.2` lands
       on 40px at `type: monumental`, exactly the `--text-3xl` the numeral
       shipped. */
    font-size: calc(var(--jp-heading-size) / 1.2);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-wide);
    color: var(--jp-accent-text);
  }

  /* `numbered` is the same list without the rail, so its numerals sit upright and
     read as counting rather than as a descent. */
  .turn[data-turn='numbered'] .turn__num {
    font-style: normal;
    font-variant-numeric: tabular-nums;
  }

  /* PROGRESSIVE INDENT — each stage steps a little further right. Was
     `calc(var(--d) * clamp(0px, 1vw, 15px))`; now a space token multiplied by the
     rhythm, which lands on the same ~15px at the fourth stage AND makes `density`
     reach it. */
  .turn__stage-body {
    grid-column: 2;
    padding-inline-start: calc(
      var(--d, 0) * var(--space-1) * var(--jp-rhythm)
    );
  }

  /* CARD-SCALE TEXT reads `--jp-body-size` — the `type` axis's third rung,
     declared once in `journey-design.css` (contract A44, `Codex-8oznv`). A stage
     name is neither the section `h2` nor running body copy, and a hardcoded size
     would put it permanently outside the axis. `--text-lg` is the floor, which is
     what it shipped. */
  .turn__name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: max(var(--text-lg), var(--jp-body-size));
    line-height: var(--leading-snug);
    color: var(--color-heading);
  }

  .turn__gloss {
    margin: var(--space-2) 0 0;
    max-width: var(--jp-measure);
    font-size: max(var(--text-sm), calc(var(--jp-body-size) / 1.2));
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  /* ── `before-after` ── */
  .turn__panels {
    display: grid;
    /* A FLEXIBLE max. `minmax(min(100%, 18rem), 24rem)` collapses to a single
       track at 768px, because a fixed max makes the repetition count resolve
       to 1 — measured, and it looks like a design choice rather than a bug
       (contract A48). */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    gap: var(--jp-sec-gap);
    width: 100%;
    max-width: var(--jp-content-max);
    text-align: start;
  }

  .turn__panel {
    padding: calc(var(--space-6) * var(--jp-rhythm));
    border: var(--border-width) solid var(--jp-edge-color);
    /* NOT `var(--jp-sec-radius, …)`: that property is always defined (the axis
       defaults it to `--radius-none`), so the fallback could never fire and every
       panel would be square outside `surface: panel`. A card's radius is a brand
       token, not an axis. */
    border-radius: var(--radius-card);
    background: color-mix(in oklab, var(--color-heading) 4%, transparent);
  }

  /* The panel a reader is being moved TOWARD carries the accent edge, so the
     direction of the pair is visible without colour alone. */
  .turn__panel--to {
    border-color: var(--jp-accent-mark);
  }

  .turn__panel-label {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .turn__panel-body {
    margin: 0;
    font-size: max(var(--text-base), var(--jp-body-size));
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  /* ── ENHANCED: the rail draw and the root landing ──
     Everything else rides the shared `.jp-reveal` atoms. These two are bespoke
     because a scale is not a translate: the hidden state applies ONLY while armed
     and not yet in view, so SSR / no-JS / reduced-motion clients paint the
     composed baseline and can never get stuck. Both timings come from the
     `motion` axis, so `motion: none` is a genuine no-op rather than a fast
     animation. */
  .turn:global(.reveal--armed) .turn__rail--progress {
    transform: scaleY(0);
    transition: transform calc(var(--jp-reveal-duration) * 2)
      var(--jp-reveal-ease) var(--jp-reveal-stagger);
  }

  .turn:global(.reveal--armed.is-in) .turn__rail--progress {
    transform: scaleY(1);
  }

  .turn:global(.reveal--armed) .turn__root {
    opacity: 0;
    transform: scale(0.4);
    transition:
      opacity var(--jp-reveal-duration) var(--jp-reveal-ease)
        calc(var(--jp-reveal-stagger) * 5),
      transform var(--jp-reveal-duration) var(--jp-reveal-ease)
        calc(var(--jp-reveal-stagger) * 5);
  }

  .turn:global(.reveal--armed.is-in) .turn__root {
    opacity: 1;
    transform: none;
  }

  /* The thread stretches rather than rises, so it overrides the shared atom's
     translate with its own scale. */
  .turn:global(.reveal--armed) .turn__thread {
    transform: scaleX(0);
  }

  .turn:global(.reveal--armed.is-in) .turn__thread {
    transform: none;
  }

  /* Belt-and-braces: the `reveal` action already withholds arming under reduced
     motion, so these hidden states normally never apply at all. This covers the
     one case it cannot — a preference flipped AFTER the section armed — and it is
     a WCAG obligation rather than a preference, which is what warrants
     `!important` here. */
  @media (prefers-reduced-motion: reduce) {
    .turn:global(.reveal--armed) .turn__rail--progress,
    .turn:global(.reveal--armed) .turn__thread {
      transform: none !important;
      transition: none !important;
    }

    .turn:global(.reveal--armed) .turn__root {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }
  }

  /* ── narrow container ──
     CONTAINER queries, not viewport media queries (contract A14): `.jp-sec` is
     the container, and the builder canvas renders these sections inside a device
     frame narrower than the window, where a viewport query reads the wrong
     number. The lengths have to be literals — a container-query condition cannot
     read a custom property. */
  @container (max-width: 30rem) {
    .turn__stage {
      grid-template-columns: 1fr;
      row-gap: var(--space-2);
    }

    .turn__num {
      padding-inline-start: 0;
    }

    .turn__stage-body {
      grid-column: 1;
      padding-inline-start: 0;
    }
  }
</style>
