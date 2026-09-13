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

  ── EIGHT DESIGN LANGUAGES, NOT 38 PERMUTATIONS ────────────────────────────
  The eight axes reach every MAGNITUDE in this file. They do not, on their own,
  make a look recognisable: a design language is also which elements are boxes,
  which corner is square, which label is monospaced and which rule is drawn at
  all — selector-level decisions that a properties-only axis file cannot carry
  and a Svelte-scoped style block cannot select on, because the `data-jp-*`
  attributes live on the ANCESTOR `.jp-sec`.

  So seven axis values are re-emitted UNMODIFIED as local `data-*` attributes on
  `.turn` (see `look` in the script), and the PER-LOOK COMMITMENTS block at the
  foot of the stylesheet spends them on each family's documented tell
  (`00-design-language-research.md` §1). Read that block's own header before
  adding a rule to it: it carries the selector discipline that keeps `candlelit`
  — the one preset the product owner says already works — out of the blast
  radius, which is not a convention but arithmetic. Candlelit is uniquely
  identified by four of its nine values (`surface: media`, `edge: none`,
  `media: bleed`, `accent: glow`) and SHARES the other five, so a bare rule on
  `type: monumental`, `align: center`, `density: airy`, `width: text` or
  `motion: drift` restyles it. Every attribute-constrained selector emitted from
  this file names one of TWELVE keys and none matches the candlelit bundle —
  checkable by evaluating each selector against the bundle, and it was.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `statement` (default) · `column` · `paired` · `arc` · `before-after` ·
  `numbered`.

  `column` absorbs the retired prose `centered` + `wide` (they were `align` +
  `width`) and `paired` is the retired `twocol`; both are ported from the since-deleted
  canvas partial `render-edit/journey-sections/_prose.css` (contract A12). `arc` is the
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
  import { editFieldAttrs } from '../editable';
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
     * The resolved axes. Nothing here changes what is RENDERED — every one of
     * them lands in CSS — but seven are MIRRORED onto this section's own root as
     * local `data-*` attributes so the per-look block can select on them. See
     * `look` below.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, variant, design, editable = false, onEdit }: Props = $props();

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

  /**
   * ── THE AXES, MIRRORED ONTO THIS SECTION'S OWN ROOT ────────────────────────
   * `journey-design.css` turns the `data-jp-*` attributes on `.jp-sec` into
   * custom properties, and a section can only ever READ those. That stays the
   * default for everything with a magnitude: every size, colour, rhythm, edge
   * and duration in the stylesheet below is still a `--jp-*` read.
   *
   * It is NOT sufficient for the seven values here, because a design language is
   * not only a set of magnitudes — it is which elements exist as boxes, which
   * corner is square, which label is monospaced, which rule gets drawn at all.
   * Those are selector-level decisions and a scoped style block cannot reach an
   * ancestor's attribute, so the axis value is re-emitted here UNMODIFIED.
   *
   * `width` is deliberately not mirrored: nothing in this file needs to select
   * on it, because `--jp-content-max` / `--jp-measure` already carry it. Neither
   * is `media` — this section has no media reference at any depth (see the
   * header), so mirroring it would be inventing a consumer (contract A50).
   *
   * `undefined` when no `design` arrives, so Svelte omits the attribute and
   * every per-look rule no-ops. That is the honest degradation — a host that
   * resolves no axes gets exactly the markup and CSS this component shipped
   * before the per-look pass, rather than a guessed default look. `SectionFrame`
   * always passes a TOTAL `ResolvedSectionDesign` (`resolveDesign` emits all
   * nine), so both real render paths — the public page and the studio canvas —
   * always have all of them.
   */
  const look = $derived({
    surface: design?.surface,
    edge: design?.edge,
    align: design?.align,
    type: design?.type,
    accent: design?.accent,
    density: design?.density,
    motion: design?.motion,
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
    editFieldAttrs('turn', key, editable, onEdit);
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
  <div
    class="turn"
    data-turn={composition}
    data-split={split}
    data-surface={look.surface}
    data-edge={look.edge}
    data-align={look.align}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
    data-motion={look.motion}
  >
    <!-- The cinematic atmosphere. ONE `--jp-sec-atmos` gate on this wrapper
         rather than one per layer (pilot lesson 3), and the wrapper holds nothing
         but decoration so gating it can never fade the copy. -->
    <div class="turn__atmos" aria-hidden="true">
      <div class="turn__well"></div>
    </div>

    <!-- ONE observer for the whole section, on the container: the shared atom is
         `.reveal--armed .jp-reveal` (a DESCENDANT selector) and the action adds
         `.reveal--armed` to the node it is used on. -->
    <div class="turn__inner" use:reveal={{ disabled: editable }}>
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

    /* ── LOCAL ROLES, so a look is a VALUE and not a rule ──────────────────
       The PER-LOOK COMMITMENTS block at the foot of this file is keyed on axis
       values (`edge: offset`, `accent: none`, …). Written as paint rules, six
       of the eight looks would re-declare the same panel, row and numeral
       declarations — which is the shape that produced the eight different
       spellings of `clamp(2rem, 6cqw, 4.4rem)` this tree is still cleaning up.
       Written as properties, a look states its VALUES and the paint lives in
       one place: the same discipline `journey-design.css` holds itself to
       ("every axis value sets only custom properties").

       EVERY DEFAULT HERE REPRODUCES THE BASE COMMIT EXACTLY, which is the whole
       point: candlelit resolves NONE of the per-look selectors, so it resolves
       these defaults, and a default that merely looked reasonable would have
       silently restyled the one preset that already works. Each default is the
       literal the base declared at its single call site:

         --turn-thread-*    the 6cqw / 2px / round-capped accent gradient bar
         --turn-label-font  `inherit` — neither label declared a family
         --turn-arc-*       `0 none` / `0px` / `none` / `transparent` paint
                            nothing at all, and `var(--space-2) 0px` is the
                            arc's `padding-inline-start` written logically
         --turn-rail-*      `--space-1`, 2px, `--jp-accent-mark`
         --turn-root-radius `--radius-full`
         --turn-num-*       the italic-serif numeral, `normal` numerics
         --turn-row-*       `--space-5 * --jp-rhythm` block padding, a
                            `--border-width` separator in `--jp-edge-color`,
                            no gap, no stripe, `--space-1` of indent per stage
         --turn-panel-*     1px `--jp-edge-color`, `--radius-card`, no shadow,
                            the 4% heading tint, `--jp-accent-mark` on `--to`

       `0px`, `0 none` and `normal`, never a bare `0` or a blank: these are
       substituted into `border`, `padding-inline`, `margin-block-start` and
       `font-variant-numeric`, and a unitless zero in a length slot is the
       A63/A64 class of failure that invalidates the whole declaration
       SILENTLY. `--turn-row-indent` is the one deliberate exception — it is
       multiplied inside `calc()`, where `0px` is what stays valid. */

    /* the decorative thread under the section head */
    --turn-thread-width: clamp(var(--space-12), 6cqw, var(--space-20));
    --turn-thread-height: var(--border-width-thick);
    --turn-thread-radius: var(--radius-full);
    --turn-thread-fill: linear-gradient(
      90deg,
      var(--jp-accent-mark),
      transparent
    );

    /* the two uppercase labels — the eyebrow and the panel captions */
    --turn-label-font: inherit;

    /* the block that holds the stage list, which four looks turn into a box */
    --turn-arc-pad-block: 0px;
    --turn-arc-pad-inline: var(--space-2) 0px;
    --turn-arc-border: 0 none;
    --turn-arc-radius: 0px;
    --turn-arc-shadow: none;
    --turn-arc-bg: transparent;

    /* the descent rail and its root */
    --turn-rail-x: var(--space-1);
    --turn-rail-w: var(--border-width-thick);
    --turn-rail-fill: var(--jp-accent-mark);
    --turn-root-radius: var(--radius-full);

    /* the numeral */
    --turn-num-col: clamp(var(--space-12), 6cqw, var(--space-16));
    --turn-num-font: var(--font-heading);
    --turn-num-style: italic;
    --turn-num-weight: var(--font-normal);
    --turn-num-size: calc(var(--jp-heading-size) / 1.2);
    --turn-num-tracking: var(--tracking-wide);
    --turn-num-numeric: normal;
    --turn-num-color: var(--jp-accent-text);

    /* the stage row */
    --turn-row-pad-block: calc(var(--space-5) * var(--jp-rhythm));
    --turn-row-pad-inline: 0px;
    --turn-row-gap: 0px;
    --turn-row-rule: var(--border-width);
    --turn-row-rule-color: var(--jp-edge-color);
    --turn-row-stripe: 0px;
    --turn-row-stripe-color: var(--jp-accent-edge);
    --turn-row-indent: var(--space-1);

    /* the `before-after` panels */
    --turn-panel-pad: calc(var(--space-6) * var(--jp-rhythm));
    --turn-panel-border: var(--border-width) solid var(--jp-edge-color);
    --turn-panel-radius: var(--radius-card);
    --turn-panel-shadow: none;
    --turn-panel-bg: color-mix(in oklab, var(--color-heading) 4%, transparent);
    --turn-panel-to-border-color: var(--jp-accent-mark);
    --turn-panel-to-bg: var(--turn-panel-bg);
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

  /* The eyebrow's SIZE and TRACKING come from the shared `.jp-sec__eyebrow`
     atom, which reads `--jp-eyebrow-size` — the seam the `type` axis now
     travels down, so this section must not re-pin either. What is left is the
     one thing the atom has no opinion on and two families do: the FACE. */
  .turn__eyebrow {
    font-family: var(--turn-label-font);
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
    width: var(--turn-thread-width);
    height: var(--turn-thread-height);
    border-radius: var(--turn-thread-radius);
    /* `center`, not the original `left center`: the `align` axis can centre this
       section, and a centred bar that grows from its left edge reads as a
       mis-alignment. */
    transform-origin: center;
    background: var(--turn-thread-fill);
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
  /* Four of the eight looks make this element a BOX — a hard-shadowed brutalist
     block, a soft-organic tinted panel, a hairline technical table, a
     contemporary card. It is the one carrier in this section that always exists
     whenever there is a list, so it is where each family's box idiom lands
     rather than on a composition-specific element. Every role defaults to
     paint-nothing, so the base is byte-identical. */
  .turn__arc {
    position: relative;
    width: 100%;
    padding-block: var(--turn-arc-pad-block);
    padding-inline: var(--turn-arc-pad-inline);
    border: var(--turn-arc-border);
    border-radius: var(--turn-arc-radius);
    background: var(--turn-arc-bg);
    box-shadow: var(--turn-arc-shadow);
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
    left: var(--turn-rail-x);
    top: var(--space-6);
    bottom: var(--space-6);
    width: var(--turn-rail-w);
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
    background: var(--turn-rail-fill);
  }

  /* The root — where the descent lands. Its fill is the RAIL's role, not a
     second one: a look that neutralises the rail (syllabus moves the accent
     onto the row edges) must not be left with a lone accent bead at the
     bottom of a grey line. */
  .turn__root {
    position: absolute;
    left: var(--turn-rail-x);
    bottom: var(--space-6);
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--turn-root-radius);
    translate: -50% 50%;
    background: var(--turn-rail-fill);
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
    grid-template-columns: var(--turn-num-col) 1fr;
    column-gap: clamp(var(--space-3), 1.8cqw, var(--space-5));
    align-items: baseline;
    padding-block: var(--turn-row-pad-block);
    padding-inline: var(--turn-row-pad-inline);
    /* THE LEFT ACCENT STRIPE, `0px` on seven looks. A role rather than a rule
       because `syllabus`'s whole tell is "a left-border accent stripe rather
       than a filled badge", and a stripe that has to be added by one selector
       and removed by seven is the wrong way round. */
    border-inline-start: var(--turn-row-stripe) solid
      var(--turn-row-stripe-color);
  }

  /* WIDTH is a token by DEFAULT, COLOUR is the axis: reading `--jp-edge-width`
     here would let `edge: none` delete the only boundary between rows, which is
     a legibility loss rather than a style choice. The looks that DO want the
     axis width (brutalist 2px, playful 2px) opt in by setting the role; the
     two that want no rule at all (soft-organic, luxury-minimal) replace it with
     space, which is what those two families separate with. */
  .turn__stage + .turn__stage {
    margin-block-start: var(--turn-row-gap);
    border-block-start: var(--turn-row-rule) solid var(--turn-row-rule-color);
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
    font-family: var(--turn-num-font);
    font-style: var(--turn-num-style);
    font-weight: var(--turn-num-weight);
    /* A DISPLAY glyph, not card-scale text, so it derives from the heading step
       rather than from `--jp-body-size` — contract A44's prohibition is on
       re-inventing the BODY rung, which `--jp-body-size` now owns. `/ 1.2` lands
       on 40px at `type: monumental`, exactly the `--text-3xl` the numeral
       shipped. */
    font-size: var(--turn-num-size);
    line-height: var(--leading-none);
    letter-spacing: var(--turn-num-tracking);
    font-variant-numeric: var(--turn-num-numeric);
    color: var(--turn-num-color);
  }

  /* `numbered` is the same list without the rail, so its numerals sit upright and
     read as counting rather than as a descent. Stated as the two ROLES rather
     than as declarations on `.turn__num`, so a look can still set the face and
     the size underneath it — a declaration here would have out-specified every
     per-look numeral value in the block at the foot of this file. Nothing
     re-italicises it: no look sets `--turn-num-style: italic`. */
  .turn[data-turn='numbered'] {
    --turn-num-style: normal;
    --turn-num-numeric: tabular-nums;
  }

  /* PROGRESSIVE INDENT — each stage steps a little further right. Was
     `calc(var(--d) * clamp(0px, 1vw, 15px))`; now a space token multiplied by the
     rhythm, which lands on the same ~15px at the fourth stage AND makes `density`
     reach it. */
  .turn__stage-body {
    grid-column: 2;
    padding-inline-start: calc(
      var(--d, 0) * var(--turn-row-indent) * var(--jp-rhythm)
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
    padding: var(--turn-panel-pad);
    border: var(--turn-panel-border);
    /* NOT `var(--jp-sec-radius, …)`: that property is always defined (the axis
       defaults it to `--radius-none`), so the fallback could never fire and every
       panel would be square outside `surface: panel`. A card's radius is a brand
       token, not an axis. */
    border-radius: var(--turn-panel-radius);
    background: var(--turn-panel-bg);
    box-shadow: var(--turn-panel-shadow);
  }

  /* The panel a reader is being moved TOWARD carries the accent edge, so the
     direction of the pair is visible without colour alone. Both roles, because
     three families say "toward" with a wash rather than with an outline and one
     forbids the outline outright. */
  .turn__panel--to {
    border-color: var(--turn-panel-to-border-color);
    background: var(--turn-panel-to-bg);
  }

  .turn__panel-label {
    margin: 0 0 var(--space-2);
    font-family: var(--turn-label-font);
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

  /* ═══ PER-LOOK COMMITMENTS ═══════════════════════════════════════════════
     Everything above is axis-generic: it consumes magnitudes and paints one
     arrangement. What follows commits each design LANGUAGE to its documented
     tell (`00-design-language-research.md` §1), because a tell is a
     SELECTOR-level statement — which elements are boxes, which corner is
     square, which label is monospaced, which rule is drawn — and
     `journey-design.css` deliberately emits nothing but custom properties.

     ── THE SELECTOR DISCIPLINE, stated once so every block can be checked ───
     `candlelit` is the one preset that already works and it must come out of
     this pass byte-identical. It is uniquely identified by FOUR of its nine
     axis values — `surface: media`, `edge: none`, `media: bleed`,
     `accent: glow` — and SHARES the other five: `type: monumental` (with
     quiet-studio, plain-facts), `align: center` (quiet-studio, open-air,
     full-send), `density: airy` (open-air), `width: text` (long-read,
     open-air), `motion: drift` (open-air).

     So NO selector below is keyed on any of those five. Every one of them names
     one of these TWELVE keys, and none matches the candlelit bundle:

       surface: bare                   -> quiet-studio + long-read
       surface: bare  + align: start   -> long-read    only
       edge: offset                    -> plain-facts  only
       edge: soft                      -> open-air     only
       accent: none                    -> quiet-studio only
       density: vast                   -> quiet-studio only
       motion: fade                    -> quiet-studio only
       accent: edge                    -> syllabus     only
       type: restrained                -> syllabus     only
       edge: heavy                     -> full-send    only
       edge: hairline + accent: fill   -> signal       only
       type: expressive                -> open-air + full-send (never candlelit,
                                          which is `monumental`)

     The two COMPOUNDS are compounds by necessity rather than by taste:
     `long-read` and `signal` each share all nine of their axis values with some
     sibling, so neither has a single value to key on. Each is justified in its
     own block.

     `open-air` is the dangerous one — it shares FOUR axes with candlelit
     (align, density, width, motion) — so every open-air rule here is keyed on
     `edge: soft`, which candlelit (`edge: none`) cannot match.

     `motion: stagger` is deliberately ABSENT even though it is full-send's
     alone. The family's motion row asks for spring easing, and it is already
     visible without a rule: `--jp-reveal-ease` is `--ease-spring` at that value
     and `.turn__root` already transitions from `scale(0.4)` on it, which IS an
     overshoot. Adding a second spring transform would have bought a new
     reduced-motion liability for a curve the section already draws. */

  /* ── A BARE SURFACE MUST NOT CARRY A BOX ─────────────────────────────────
     The single highest-leverage line in this pass, and a base DEFECT rather
     than a taste call.

     `.turn` paints `border: var(--jp-edge-width) solid var(--jp-edge-color)`
     and `box-shadow: var(--jp-edge-shadow)` unconditionally. At `edge: none`
     that is `0px` and the keyword `none`, so candlelit paints nothing and
     always has — but both `surface: bare` looks are `edge: hairline`, so
     quiet-studio and long-read each shipped a full 1px `--jp-line` RECTANGLE
     plus `--shadow-xs` around a section whose `--jp-sec-pad-inline` the same
     axis had set to `0px`. A box with zero inset, hugging the copy, on the two
     looks whose tells are "a single hairline, used perhaps twice on the page"
     and "hairline horizontal rules only — no box borders anywhere". Each look
     then spends its hairline where it means something, below.

     `border-width`, the longhand, rather than re-spelling the `border`
     shorthand: the axis keeps ownership of the colour, so a future rule can
     bring one edge back without re-deriving it. */
  .turn[data-surface='bare'] {
    border-width: 0px;
    box-shadow: none;
  }

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `align: start` ──────
     Tell: the eyebrow and the body share a left edge, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY. `surface: bare` is shared with quiet-studio and
     `align: start` with plain-facts, syllabus and signal — but quiet-studio is
     `align: center` and none of the other three is `surface: bare`, so the PAIR
     is long-read alone. Candlelit is `surface: media`, so it matches neither
     half, let alone both.

     Measured on the base: the shared left edge already HOLDS — `align: start`
     resolves `--jp-align: start` and `--jp-measure-margin: 0px`, and the
     eyebrow, statement, lede and thread all sit on it. The HEAD HAIRLINE was
     nowhere: `.turn__thread` is a 6cqw accent gradient with a `--radius-full`
     cap, which is a cinematic flourish and not an editorial rule. It becomes
     the rule. And the `before-after` panels were `--radius-card` boxes on a 4%
     tint — the one thing this family forbids — so they become measure-wide rows
     divided by that same hairline. */
  .turn[data-surface='bare'][data-align='start'] {
    /* THE HAIRLINE UNDER THE SECTION HEAD. `--radius-none` matters as much as
       the height: a 1px bar with a round cap still reads as a graphic. */
    --turn-thread-width: 100%;
    --turn-thread-height: var(--border-width);
    --turn-thread-radius: var(--radius-none);
    /* `--jp-edge-color`, which is `--jp-line` at this look's `edge: hairline`,
       and NOT `--color-border-subtle`. The subtle rung sits below the one the
       baseline already measures at 1.79:1 light / 1.49:1 dark
       (`04-contrast-baseline.md`), and a rule nobody can see does not deliver a
       tell whose whole content is "there IS a hairline here". Every horizontal
       rule in this look is that one colour, owned by the axis, so a creator who
       changes `edge` moves all of them together. */
    --turn-thread-fill: var(--jp-edge-color);
    /* NO BOX BORDERS ANYWHERE: horizontal rules only, on the panels too. */
    --turn-panel-border: 0 none;
    --turn-panel-radius: var(--radius-none);
    --turn-panel-bg: transparent;
    --turn-panel-to-bg: transparent;
    --turn-panel-pad: 0px;
    /* The progressive indent is the descent's flourish and it is the exact
       thing this tell is about, so it goes: every row starts on the left edge
       the eyebrow and the body share. */
    --turn-row-indent: 0px;
  }

  /* The rule spans the MEASURE, not the statement's tight cap, so it reads as a
     section rule and not as an underlined heading. `.turn__head` is a column
     flex box with `align-items: start`, which shrink-wraps every child to its
     content — so the thread needs BOTH the `100%` above and this cap to land on
     the measure rather than on the widest line of copy. */
  .turn[data-surface='bare'][data-align='start'] .turn__thread {
    max-width: var(--jp-measure);
  }

  /* One column, not two. `auto-fit` at `minmax(min(100%, 16rem), 1fr)` is a
     card grid, and this family sets everything in a single measure — two 16rem
     columns of prose in a bare editorial section is a table of contents. */
  .turn[data-surface='bare'][data-align='start'] .turn__panels {
    grid-template-columns: 1fr;
    gap: 0px;
    max-width: var(--jp-measure);
  }

  .turn[data-surface='bare'][data-align='start'] .turn__panel {
    padding-block: calc(var(--jp-sec-gap) / 2);
    border-block-end: var(--border-width) solid var(--jp-edge-color);
  }

  /* "Accent as TEXT: kickers, drop-cap, link underline, footnote markers." So
     the direction of the pair is carried by the caption's colour rather than by
     a coloured box — the box having just been removed. `--jp-accent-text` is
     `--jp-ember-text` at `accent: text`, the rung contract A38 made AA-safe;
     never `--jp-ember`, which measures 2.04:1 in dark on the golden org. */
  .turn[data-surface='bare'][data-align='start']
    .turn__panel--to
    .turn__panel-label {
    color: var(--jp-accent-text);
  }

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere.

     MEASURED ON THE BASE: the 2px border and the hard drop are both reachable
     on the SHELL — `edge: offset` sets `--jp-edge-width: --border-width-thick`
     and `--jp-edge-shadow: --space-1 --space-1 0 0 --jp-line-strong` — and that
     is exactly where they stop. `--jp-edge-shadow` had ONE consumer in this
     file. Radius 0 was found nowhere: this look's surface is `panel`, which
     resolves `--jp-sec-radius` to `--radius-card`, so the brutalist section
     shipped ROUNDED CORNERS carrying a hard un-blurred offset drop — which
     reads as a mistake rather than as a style. Mono labels were nowhere, and
     the loudest glyph in the section, the numeral, was an italic serif.

     `media: none` is this look's media value and this section has no media at
     any depth, so nothing here can be taken away underneath it — the
     `display: none` grid-track defect the sibling media sections hit cannot
     occur in this component. */
  .turn[data-edge='offset'] {
    /* RADIUS 0, ABSOLUTELY — the tell's own adverb. The section SHELL has to be
       squared off too, not just its furniture. */
    border-radius: var(--radius-none);
    --turn-label-font: var(--font-mono);
    /* "Accent as fill: solid RECTANGLES of it." The gradient-to-transparent
       thread with the round cap is ornament twice over; it becomes a slab. */
    --turn-thread-height: var(--jp-edge-width);
    --turn-thread-radius: var(--radius-none);
    --turn-thread-fill: var(--jp-accent-mark);
    /* THE GRID VISIBLE AS ACTUAL LINES, and the hard drop finally gets a second
       carrier: the stage list closes into a 2px box with 2px rules between its
       rows. `box-shadow` takes the token as its WHOLE value and the border does
       plain substitution with no math on the width — the two rules contracts
       A54, A63 and A64 exist for. */
    --turn-arc-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --turn-arc-radius: var(--radius-none);
    --turn-arc-shadow: var(--jp-edge-shadow);
    --turn-arc-pad-inline: var(--space-5) var(--space-4);
    --turn-rail-x: var(--space-2);
    --turn-row-rule: var(--jp-edge-width);
    --turn-row-indent: 0px;
    /* MONO NUMERALS, upright and tabular so the digits cannot shuffle. Sized on
       the BODY rung, not the heading rung: "no separate display face" is this
       family's own type row, and a 40px italic numeral is the opposite of it. */
    --turn-num-font: var(--font-mono);
    --turn-num-style: normal;
    --turn-num-numeric: tabular-nums;
    --turn-num-size: max(var(--text-lg), var(--jp-body-size));
    --turn-num-tracking: var(--tracking-normal);
    --turn-root-radius: var(--radius-none);
    /* Surface: panel — every block is a visible box, with the hard drop. */
    --turn-panel-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --turn-panel-radius: var(--radius-none);
    --turn-panel-shadow: var(--jp-edge-shadow);
    --turn-panel-bg: transparent;
    --turn-panel-to-bg: transparent;
    --turn-panel-pad: var(--space-4);
  }

  /* The accent spent as the family spends it: a solid rectangle with the text
     reversed out. COMPOUNDED with `accent: fill` rather than left on
     `edge: offset` alone, because `--jp-accent-fill` is `transparent` at
     `accent: text` and `accent: edge` — a creator who picked either with this
     edge would get `--jp-accent-on-fill` on the section's own ink, which is the
     measured two-token contrast pair broken in half. `.turn__head` is a column
     flex box with `align-items: var(--jp-align)`, so the slab shrink-wraps its
     text at both align values with no width of its own. */
  .turn[data-edge='offset'][data-accent='fill'] .turn__eyebrow {
    padding: var(--space-1) var(--space-3);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ────────────────────────
     Tell: no border anywhere, pill controls, and a shadow you have to look for.

     KEYED ONLY ON `edge: soft`, and this is the block to check twice. open-air
     shares FOUR axes with candlelit — `align: center`, `density: airy`,
     `width: text`, `motion: drift` — so a bare rule on any of them restyles the
     one preset that already works. `edge: soft` is open-air's and nobody
     else's, and candlelit is `edge: none`.

     Measured on the base: "no border anywhere" was false in three places the
     `edge` axis CANNOT reach, because each spelled its own `--border-width`
     literal — the row separator, the panel box and the `to` panel's accent
     outline. `--jp-edge-width` is `0px` at this value and all three now read
     roles instead. And the diffuse drop — `--jp-edge-shadow` is `--shadow-lg`
     here, literally "the shadow you have to look for" — had exactly ONE
     consumer, the section shell, whose `surface: tint` background is a 6% wash:
     a very soft shadow under a nearly invisible plate. It moves onto the two
     things a reader is actually looking at. */
  .turn[data-edge='soft'] {
    /* `--radius-xl` on panels, `--radius-full` on controls — the family's own
       two radii, and the shell is one of the panels. */
    border-radius: var(--radius-xl);
    --turn-arc-radius: var(--radius-xl);
    --turn-arc-shadow: var(--jp-edge-shadow);
    --turn-arc-bg: color-mix(in oklab, var(--jp-accent-mark) 5%, transparent);
    --turn-arc-pad-block: calc(var(--space-4) * var(--jp-rhythm));
    --turn-arc-pad-inline: calc(var(--space-6) * var(--jp-rhythm));
    --turn-rail-x: var(--space-3);
    /* NO BORDER ANYWHERE. Separation comes from space and soft elevation, so
       the row rule goes and the rhythm it was carrying grows to replace it —
       removing a boundary without replacing it is a legibility loss, not a
       style choice. */
    --turn-row-rule: 0px;
    --turn-row-pad-block: calc(var(--space-6) * var(--jp-rhythm));
    --turn-panel-border: 0 none;
    --turn-panel-radius: var(--radius-xl);
    --turn-panel-shadow: var(--jp-edge-shadow);
    --turn-panel-to-border-color: transparent;
  }

  /* "Surface: tinted — soft washes and GRADIENT BLOOMS, low chroma." The
     `.turn__well` bloom is mounted on every look and gated to zero by
     `--jp-sec-atmos`, which only `surface: media` raises — so the one other
     family whose surface row asks for a bloom has never had one. The gate is
     re-opened at `--opacity-55`: half strength, which is what "low chroma"
     means for a layer whose own stops are already 15% and 11% mixes behind
     `--blur-xl`. Keyed on `edge: soft`, so candlelit's own `1` is untouched. */
  .turn[data-edge='soft'] .turn__atmos {
    opacity: var(--opacity-55);
  }

  /* "Accent as tinted background + accent text. NEVER a hard fill." The `to`
     panel's 1px accent outline (removed above) becomes a wash, which is the
     only way this family is allowed to say "toward".

     The 8% mix sits on `--jp-accent-mark`, which resolves to `--jp-ember-text`
     at four of five accent values and to `--jp-heading` at the fifth — never to
     a pre-mixed value — so this is NOT contract A37's mix-of-a-mix.
     `--jp-accent-edge` would have been exactly that: it is already a 45% ember
     mix at `accent: glow`, and 8% of it lands near 3.6%. */
  .turn[data-edge='soft'] .turn__panel--to {
    background: color-mix(in oklab, var(--jp-accent-mark) 8%, transparent);
  }

  /* PILL CONTROLS. There is no control in this section, so the family's
     roundness lands where it can be seen: the numeral sits in a soft tinted
     disc instead of on the bare page. `aspect-ratio` with `place-content`
     rather than a fixed width and a line-height, so the disc tracks the glyph
     at every `type` value and can never clip it — and `min-width` is derived
     from the numeral's own role, so it cannot fall out of step with it.

     `padding-inline-start: 0` is the same value the narrow-container block at
     the foot of this file sets, so the two cannot disagree — this rule
     out-specifies it (0,2,0 against 0,1,0) and lands on the identical value. */
  .turn[data-edge='soft'] .turn__stage {
    align-items: center;
  }

  .turn[data-edge='soft'] .turn__num {
    display: grid;
    place-content: center;
    aspect-ratio: 1;
    min-width: calc(var(--turn-num-size) * 1.9);
    padding-inline-start: 0;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--jp-accent-mark) 10%, transparent);
  }

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
        · `motion: fade` ─────────────────────────────────────────────────────
     Tell: three type sizes, ONE hairline, no accent colour, and more empty
     space than content.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so every rule below REMOVES
     something. The box around the section has already gone (the `surface: bare`
     rule above, which is half of what was wrong here). What is left is the
     COUNT — and the count is the only form of this tell that can be checked. */
  .turn[data-accent='none'] {
    /* THE ONE HAIRLINE, and only one. `--jp-accent-mark` already resolves to
       `--jp-heading` at `accent: none`, so the base was not leaking ember into
       this bar — it was leaking WEIGHT: 2px with a round cap and a fade to
       transparent is a graphic, not a hairline. */
    --turn-thread-height: var(--border-width);
    --turn-thread-radius: var(--radius-none);
    --turn-thread-fill: var(--jp-edge-color);
    /* No SECOND rule anywhere: the row separator and both panel boxes go, and
       the space below replaces them. */
    --turn-row-rule: 0px;
    --turn-row-indent: 0px;
    --turn-panel-border: 0 none;
    --turn-panel-radius: var(--radius-none);
    --turn-panel-bg: transparent;
    --turn-panel-to-bg: transparent;
    --turn-panel-to-border-color: transparent;
    --turn-panel-pad: 0px;
  }

  /* THREE TYPE SIZES ON THE WHOLE SECTION, as arithmetic rather than as an
     adjective. The base draws EIGHT: eyebrow `--text-sm`, statement
     `--jp-heading-size`, lede `--text-lg`, numeral `--jp-heading-size / 1.2`,
     stage name `max(--text-lg, --jp-body-size)`, gloss
     `max(--text-sm, --jp-body-size / 1.2)`, panel label `--text-sm`, panel body
     `max(--text-base, --jp-body-size)`. Collapsing the four metadata rungs onto
     one and the three running rungs onto `--jp-body-size` leaves exactly
     `--text-sm`, `--jp-body-size` and `--jp-heading-size`.

     Weight and tracking come with the size, because "three sizes" is a
     HIERARCHY claim and a semibold label beside a normal one at the same size
     is a fourth level by another means. `--tracking-widest` is the family's own
     label row ("uppercase with `--tracking-wider` or wider"). */
  .turn[data-density='vast'] .turn__eyebrow,
  .turn[data-density='vast'] .turn__num,
  .turn[data-density='vast'] .turn__gloss,
  .turn[data-density='vast'] .turn__panel-label {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    letter-spacing: var(--tracking-widest);
  }

  .turn[data-density='vast'] .turn__lede,
  .turn[data-density='vast'] .turn__name,
  .turn[data-density='vast'] .turn__panel-body {
    font-size: var(--jp-body-size);
  }

  /* The numeral joins the metadata rung above, so its italic serif goes with
     the rest of the ornament — a roman numeral at label scale, tracked out, is
     what this family does with a sequence. */
  .turn[data-density='vast'] .turn__num {
    font-family: inherit;
    font-style: normal;
  }

  /* MORE EMPTY SPACE THAN CONTENT, on a doubling scale rather than three
     arbitrary values: 3 · 2 · 1 of the section gap, which at `vast` is already
     1.6x the regular rhythm and still multiplies the org's own
     `--brand-density-scale` through `--space-unit`. */
  .turn[data-density='vast'] .turn__grid {
    gap: calc(var(--jp-sec-gap) * 3);
  }

  .turn[data-density='vast'] .turn__panels {
    gap: calc(var(--jp-sec-gap) * 2);
  }

  .turn[data-density='vast'] .turn__head {
    gap: var(--jp-sec-gap);
  }

  /* "Slow fade only. NO TRANSFORM." `motion: fade` already resolves
     `--jp-reveal-distance: 0px`, so the shared `.jp-reveal` atom is a pure
     opacity ramp — but the three bespoke transitions in the ENHANCED block
     above are NOT on that atom, and every one of them is a transform: the
     thread scales in X, the rail scales in Y, the root scales up from 0.4. On
     the base, the one look documented as never transforming animated three
     transforms. They become opacity.

     The thread and the root already carry their own opacity ramp (the thread
     from `.jp-reveal`, the root from its own rule), so taking the transform
     away is the whole edit. The rail is the only one of the three with no ramp
     at all, so it is given one. */
  .turn[data-motion='fade']:global(.reveal--armed) .turn__thread,
  .turn[data-motion='fade']:global(.reveal--armed) .turn__root {
    transform: none;
  }

  .turn[data-motion='fade']:global(.reveal--armed) .turn__rail--progress {
    transform: none;
    opacity: 0;
    transition: opacity var(--jp-reveal-duration) var(--jp-reveal-ease)
      var(--jp-reveal-stagger);
  }

  .turn[data-motion='fade']:global(.reveal--armed.is-in) .turn__rail--progress {
    opacity: 1;
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a hairline grid, mono numerals, and a LEFT-BORDER ACCENT STRIPE
     rather than a filled badge.

     MEASURED ON THE BASE: the numerals are an italic serif; the only accent in
     the section is `.turn__root`, a `--radius-full` disc — which is precisely
     the "filled badge" this tell contrasts itself against — and there is no
     left stripe anywhere in the file. The one thing the base gets right is the
     row separator, which is already a hairline; the work is to CLOSE it into a
     grid and move the accent off the badge and onto the row edge.

     `--jp-accent-edge` is read DIRECTLY with no percentage carried onto it. At
     `accent: edge` it resolves to the full `--jp-ember`, not to a mix, so
     contract A37's mix-of-a-mix and A39's 45%-ember measurement — which is
     `accent: glow`, i.e. candlelit's value — do not apply to this rule. And
     candlelit cannot match this selector to be measured against it. */
  .turn[data-accent='edge'] {
    /* `--radius-sm` — the family's single radius, on the shell and its box. */
    border-radius: var(--radius-sm);
    --turn-label-font: var(--font-mono);
    /* THE HAIRLINE GRID. The rows are already hairline-separated, so the outer
       rule COMPLETES a table rather than adding a second idiom. */
    --turn-arc-border: var(--border-width) solid var(--jp-edge-color);
    --turn-arc-radius: var(--radius-sm);
    --turn-arc-pad-inline: 0px;
    /* THE LEFT-BORDER ACCENT STRIPE, on every row. This is the whole tell. */
    --turn-row-stripe: var(--border-width-thick);
    --turn-row-pad-inline: var(--space-4);
    --turn-row-indent: 0px;
    /* MONO NUMERALS, upright and tabular, at the fine-grained scale this
       family's type row asks for rather than at display scale. */
    --turn-num-font: var(--font-mono);
    --turn-num-style: normal;
    --turn-num-numeric: tabular-nums;
    --turn-num-size: max(var(--text-sm), calc(var(--jp-body-size) / 1.2));
    --turn-num-tracking: var(--tracking-normal);
    /* NOT A FILLED BADGE — and no rail either. The per-row stripe above IS the
       continuous vertical line down the left of the list, so a second line 4px
       inside it (the rail sits at `--turn-rail-x`, inside the row's own
       padding) would be two rules saying one thing. The root is a
       `--radius-full` accent disc, which is the literal "filled badge" this
       tell contrasts itself against, so it goes with the rail it terminated.
       `0px` on the rail width, not `display: none`, so the arc composition
       still emits the same DOM and only the paint changes. */
    --turn-rail-w: 0px;
    --turn-rail-fill: var(--jp-edge-color);
    /* Panel, with a header row (below). */
    --turn-panel-radius: var(--radius-sm);
    --turn-panel-bg: transparent;
    --turn-panel-to-bg: transparent;
    --turn-panel-to-border-color: var(--jp-edge-color);
    --turn-panel-pad: 0px;
  }

  /* THE HEADER ROW the family's surface row asks for. Deliberately a LIFTED
     strip under a hairline and NOT an inversion: research §5.1's rule is that
     any new surface must re-derive its own text ladder, and this component
     cannot — `journey-design.css` re-points `--jp-ink` per SECTION, so a
     locally inverted strip would carry the section's ladder onto the opposite
     pole with nothing measured. `--color-surface-secondary` is `--jp-ink-3`, a
     single rung of lift, and the caption keeps `--color-text-secondary`
     (`--jp-dim`, measured 7.79 dark / 11.05 light against `--jp-ink`) — a rung
     of lift costs a fraction of that and stays clear of the 4.5 floor. */
  .turn[data-accent='edge'] .turn__panel-label {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-block-end: var(--border-width) solid var(--jp-edge-color);
    background: var(--color-surface-secondary);
  }

  .turn[data-accent='edge'] .turn__root {
    display: none;
  }

  .turn[data-accent='edge'] .turn__panel-body {
    padding: var(--space-3) var(--space-4);
  }

  /* The `to` panel says "toward" with an EDGE — the same left stripe as the
     rows — rather than with a coloured outline, which is the distinction the
     tell draws. */
  .turn[data-accent='edge'] .turn__panel--to {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
  }

  /* `type: restrained` is syllabus's value and nobody else's. Its gloss is the
     one place this section can be genuinely dense: at `restrained` the body
     rung floors at `--text-base`, and a technical gloss reads as a caption
     under its row rather than as running copy. */
  .turn[data-type='restrained'] .turn__gloss {
    margin-block-start: var(--space-1);
    line-height: var(--leading-snug);
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` ───────────────────────────
     Tell: whole inverted bands, pill CTAs at `--radius-full`, spring easing,
     and BIG NUMERALS.

     Measured on the base: the inverted band is already right —
     `surface: invert` re-points `--jp-ink` at pole B and `.turn` paints
     `--jp-sec-bg`, so the whole section flips and the ladder re-derives — and
     the 2px accent border is reachable, because `edge: heavy` sets
     `--jp-edge-color: var(--jp-accent-edge)`. Spring easing needs no rule; see
     the block header.

     BIG NUMERALS were not there, anywhere in the tree. The numeral is
     `--jp-heading-size / 1.2` in an italic serif at `--font-normal`: at
     `type: expressive` that is roughly 25px of quiet italic, the SMALLEST
     display glyph in the section, in the one family whose entire point is
     loudness. It becomes the loud half of the row — the full heading rung, the
     brand's own heading weight, upright and tabular so a two-digit stage cannot
     shuffle against a one-digit one. The numeral column widens with it, through
     its own role, so the name beside it cannot be pushed off the grid. */
  .turn[data-edge='heavy'] {
    /* `--radius-xl` on panels, `--radius-full` on every control. */
    border-radius: var(--radius-xl);
    --turn-num-col: clamp(var(--space-16), 9cqw, var(--space-24));
    --turn-num-style: normal;
    --turn-num-weight: var(--heading-weight, var(--font-semibold));
    --turn-num-size: var(--jp-heading-size);
    --turn-num-tracking: var(--tracking-tight);
    --turn-num-numeric: tabular-nums;
    /* Whole BANDS, not hairlines: the list is a 2px-bordered block in the
       accent and the rows are divided at the same weight. */
    --turn-arc-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --turn-arc-radius: var(--radius-xl);
    --turn-arc-pad-block: var(--space-4);
    --turn-arc-pad-inline: var(--space-6);
    --turn-rail-x: var(--space-3);
    --turn-row-rule: var(--jp-edge-width);
    --turn-row-rule-color: var(--jp-edge-color);
    /* The one bar in this section keeps its `--radius-full` cap and takes the
       family's weight. */
    --turn-thread-height: var(--jp-edge-width);
    --turn-panel-radius: var(--radius-xl);
    --turn-panel-border: var(--jp-edge-width) solid var(--jp-edge-color);
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small neutral shadow; ONE filled
     accent button per section.

     ANOTHER COMPOUND BY NECESSITY. `signal` shares all nine of its axis values:
     `edge: hairline` is also quiet-studio, long-read and syllabus, and
     `accent: fill` is also plain-facts and full-send — but those two are
     `edge: offset` and `edge: heavy`, and the three other hairline looks are
     `accent: none` / `text` / `edge`. So the PAIR is signal alone, and
     candlelit (`edge: none`, `accent: glow`) matches neither half.

     Measured on the base: `--jp-edge-shadow` is `--shadow-xs` at this value — a
     1px, 10%-alpha drop, i.e. the "small NEUTRAL shadow" the tell names and not
     a coloured one — and it had exactly ONE consumer in this file, the section
     shell. So the stage list had no card at all and the `before-after` panels
     were flat hairline rectangles with no elevation: the "vanishing card"
     research §5.2 predicts for precisely this family, on the look that is the
     PLATFORM DEFAULT and therefore the one most pages will resolve to.

     There is no button in this section, so "one filled accent element per
     section" lands on the eyebrow — and it stays ONE, because nothing else here
     reads `--jp-accent-fill`. */
  .turn[data-edge='hairline'][data-accent='fill'] {
    --turn-arc-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --turn-arc-radius: var(--radius-card);
    --turn-arc-shadow: var(--jp-edge-shadow);
    --turn-arc-pad-block: var(--space-2);
    --turn-arc-pad-inline: var(--space-5);
    --turn-rail-x: var(--space-2);
    --turn-panel-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --turn-panel-shadow: var(--jp-edge-shadow);
  }

  /* THE ONE FILLED ACCENT ELEMENT. `--jp-accent-fill` / `--jp-accent-on-fill`
     is the measured two-token pair (`--jp-ember` under `--jp-on-ember`), read
     as a pair and never as half of one — which is the reason this look is
     compounded with `accent: fill` rather than keyed on `edge: hairline` alone:
     at `accent: text` and `accent: edge` the fill is `transparent`, and the
     label would then render `--jp-accent-on-fill` on the section's own ink.

     `--radius-full`, not the family's card radius: a chip is a control shape.
     `.turn__head` is a column flex box with `align-items: var(--jp-align)`, so
     it shrink-wraps its text at both align values with no width of its own. */
  .turn[data-edge='hairline'][data-accent='fill'] .turn__eyebrow {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* ── THE `type` AXIS AS A RELATIONSHIP, not four font sizes ──────────────
     `--jp-eyebrow-size` (the shared seam in `journey-sections-shared.css`) now
     moves the label WITH the heading, so the eyebrow needs nothing here — and
     must not be re-pinned, which is why `.turn__eyebrow` above sets only the
     face. What the axis still cannot reach is the GLOSS, the second line of a
     stage: it is floored at `--text-sm`, so at `expressive` it sits three rungs
     under the name it belongs to while the name itself has travelled.

     `monumental` is deliberately ABSENT. It is candlelit's own type value,
     shared with quiet-studio and plain-facts, and both of those take their
     metadata rung from a value that is theirs alone (`density: vast`,
     `edge: offset`). A bare `type: monumental` rule here is the precise shape
     that would have restyled the one preset that already works. */
  .turn[data-type='expressive'] .turn__gloss {
    font-size: max(var(--text-base), calc(var(--jp-body-size) / 1.15));
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

    /* The ONE hidden state the design-language pass added. `motion: fade` —
       quiet-studio's value, and the family documented as never transforming —
       converts the rail's `scaleY` into an OPACITY ramp, and an opacity ramp is
       the one thing the three rules above do not undo: they neutralise
       `transform` and `transition`, which would leave the rail transparent
       forever. Listed explicitly rather than as a wildcard, so the next look
       that adds a hidden state has to come here and say so. */
    .turn[data-motion='fade']:global(.reveal--armed) .turn__rail--progress {
      opacity: 1 !important;
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
