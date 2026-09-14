<!--
  @component MapSection

  The course map (SPEC §4.1 `map`): the course's ordered stages and the pool of
  practices inside each. This is the PUBLIC sales view — it renders from the
  awaited `context.stages` and shows NO progress and NO completion state (those
  belong to the member dashboard, WP-4). The practice's `completed` field is
  omitted server-side on the public page.

  ── THE NINE AXES ──────────────────────────────────────────────────────────
  Every layout / rhythm / type-scale / edge / surface / motion decision in this
  file reads a `--jp-*` property that `render/SectionRenderer.svelte` resolves
  onto the `.jp-sec` wrapper as a `data-jp-*` attribute
  (`docs/design/journey-sections/02-axis-contract.md` A9). COLOUR STAYS
  `--color-*` (A11) — `.journey-palette--page` already re-points those onto the
  `--jp-*` ladder. The one colour exception is the `--jp-accent-*` family, which
  this section reads through two local aliases — `--descent-signal` for the spine,
  node ring and numeral (they carry meaning, so they owe 3:1) and
  `--descent-bloom` for the purely decorative glow. Neither is ever
  `--jp-accent-fill`, which is `transparent` at `accent: text` and `accent: edge`
  and would make both graphics vanish on two of five values. See the block
  comment on `.descent` for the measurement that decided the split.

  `media` is the one axis this type does not consume, and that is the contract's
  own answer rather than an omission: research §2.2 declares `media` meaningful
  on `hero`, `introVideo`, `reel`, `guide` and `proof` and says "sections without
  media ignore it, exactly as they ignore a variant they do not offer." The map
  renders stages, and a stage has no media in the read model.

  Two axes are read in MARKUP rather than CSS, because a Svelte-scoped `<style>`
  cannot reach an ancestor attribute and they change what is RENDERED: `motion`
  (whether the scroll choreography is wired at all) and the composition itself.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `spine` (default) · `rows` · `cards` · `table` · `timeline` · `numbered-prose`.
  The first three are ports of the since-deleted canvas tree's working implementations
  (`render-edit/journey-sections/_descent.css` — `.jp-descent`, `.jp-stages`,
  `.jp-stagegrid`), which is contract A12: port, do not invent. `spine`/`rows`/
  `cards` carry the retired `descent`/`list`/`grid` ids forward through
  `LEGACY_SECTION_VARIANTS`, a pure rename with no axis payload.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED (mirrors AcheSection) ────────────
  • BASELINE (SSR, no-JS, reduced-motion, `motion: none`): every gate and
    practice card is fully lit and legible at once and the spine is drawn to full
    height. This is what the server emits, so the section is never blank and
    never depends on JS.
  • ENHANCED (`spine` + browser + motion OK): the cinematic descent — one
    monotonic scroll value grows the spine downward, and as the drawn edge passes
    each gate node that gate ignites in turn (node warms, its meta rises, its
    practice cards fade up on a stagger). Header and closing note fade/rise in
    through the shared `reveal` action and the `.jp-reveal` atom, so both ride the
    `motion` axis rather than local hardcoded timings.

  Enhancement is gated on `mounted && !reduced && !motionOff` (the
  `descent--enhanced` class), so the accessible baseline always ships first; the
  scroll math lives in an `$effect` that re-wires if the preference flips
  mid-session.

  CONTRACT GAP (flagged for the conductor): the prototype's free-taste door — a
  single "free" practice badge on the map — has no field on the frozen
  `JourneyPracticeView`. It is intentionally NOT rendered here to keep typecheck
  clean; when WP-6/WP-2 add a public `isFree`/`preview` flag to the practice
  read-model, add the badge here (additive). Likewise per-practice MINUTES have
  no read-model field, which is why the `table` composition carries stage /
  includes / practices and not the research's "stage / lessons / minutes /
  access": three of those four columns cannot be filled from what the public
  query returns.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    FileTextIcon,
    LockIcon,
    MusicIcon,
    PlayIcon,
  } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { aliasKeys, asString, asStringFrom } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type { JourneySalesContext, MapSectionProps } from '../types';
  import type {
    JourneyContentType,
    JourneyStageView,
    ResolvedSectionDesign,
    SectionProps,
  } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
    /**
     * The course title, and ONLY when this section is the one the page has let
     * claim it (`SectionComponentProps.titleFallback`). Five sections fell back to
     * `context.course.title` independently, so an under-authored page printed the
     * same sentence as its `<h1>` four more times.
     */
    titleFallback?: string;
  }

  const {
    config,
    context,
    variant,
    design,
    editable = false,
    onEdit,
    titleFallback,
  }: Props = $props();

  /**
   * THE READ BOUNDARY (`05-bridge-table.md` WT-4, bead `Codex-tqr51`).
   *
   * `title` ← `heading` and `foot` ← `note` were a LIVE copy loss on all seven
   * journey pages, verified against the database and the served HTML before this
   * change:
   *
   *  - every stored map section holds exactly `{eyebrow, heading, sub, note}` —
   *    no `title`, no `foot`;
   *  - `note` ("One door is already ajar." on the golden page) appeared in the
   *    served document ONLY inside the hydration payload, and no `.descent__foot`
   *    element existed at all, because `{#if p.foot}` was false;
   *  - `heading` was MASKED rather than correct: all seven pages store
   *    "Everything you'll walk.", byte-identical to the hardcoded fallback that
   *    used to live below, so it rendered right by coincidence and any creator
   *    edit was silently discarded.
   *
   * `aliasKeys` rather than an inline literal array on purpose: seven worktrees
   * read this table, and a hand-copied preference list drifts INVISIBLY — it
   * degrades to a fallback rather than failing.
   */
  const p: MapSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    title: asStringFrom(config, aliasKeys('map', 'title')),
    sub: asString(config, 'sub'),
    foot: asStringFrom(config, aliasKeys('map', 'foot')),
  });

  const stages = $derived(
    [...context.stages].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  /**
   * FALL BACK TO DATA, NEVER TO INVENTED PROSE (`Codex-i9pzs`). This used to be
   * the hardcoded `"Everything you'll walk."` — one org's editorial voice
   * compiled into every org's sell page.
   *
   * THE ORIGINAL RULE HERE — "the heading is NOT allowed to self-hide", because
   * the outline is `h1` (hero) → `h2` (this section) → `h3` (stage) and dropping
   * the `h2` orphans the stage names — IS PRESERVED VERBATIM ABOVE THIS LINE AND
   * IS NOW OVERRULED, deliberately, with the reasoning stated rather than the
   * comment deleted:
   *
   *  · The heading it was defending was `context.course.title`, and FOUR other
   *    sections resolved the same fallback independently. The document that
   *    protected the outline was `<h1>Bone Deep</h1>` + `<h2>Bone Deep</h2>` ×4 —
   *    a keyword-stuffed outline with no informational hierarchy, which is a worse
   *    outline defect than the one it avoided.
   *  · A skipped heading LEVEL (h1 → h3 inside this section) is valid HTML and an
   *    advisory `heading-order` finding. A heading that repeats the page title four
   *    times is neither valid information architecture nor advisory.
   *  · `claimTitleFallback` gives a heading-less `hero` the claim wherever it sits,
   *    so on the ordinary page shape the hero owns the title and this section is
   *    quiet; this section only claims when the hero is authored — i.e. when the
   *    page is one where a course-titled `h2` reads as a real section heading.
   *
   * So the `<h2>` now self-hides when this section did not claim the title, and a
   * creator who wants a heading here types one (`map.title`, aliased from the
   * builder's stored `heading`).
   */
  const title = $derived(p.title ?? titleFallback);

  // ── COMPOSITION ──────────────────────────────────────────────────────────
  // `resolveVariant` has already mapped every retired id forward, so an unknown
  // value here can only come from a client older than the catalogue. Falling
  // back to `spine` keeps such a page rendering its stages rather than nothing.
  const COMPOSITIONS = [
    'spine',
    'rows',
    'cards',
    'table',
    'timeline',
    'numbered-prose',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'spine'
  );

  // ── AXES READ IN MARKUP ──────────────────────────────────────────────────
  // String discriminants, not booleans: `apps/web` has `strictNullChecks` OFF,
  // so a boolean-literal discriminant does not narrow.
  const motionOff = $derived(design?.motion === 'none');

  /**
   * ── THE AXES, MIRRORED ONTO THIS SECTION'S OWN ROOT ────────────────────────
   * `journey-design.css` turns the nine `data-jp-*` attributes on `.jp-sec` into
   * custom properties, and a section can only ever READ those. That stays the
   * default for everything with a MAGNITUDE: every size, colour, rhythm, edge
   * and duration in the stylesheet below is still a `--jp-*` read.
   *
   * It is not sufficient for the eight values here, because a design language is
   * not only a set of magnitudes — it is which elements exist as boxes, which
   * corner is square, which label is monospaced, which rule gets drawn at all.
   * Those are SELECTOR-level decisions, a Svelte-scoped style block cannot
   * select on an ancestor's attribute, and `journey-design.css` deliberately
   * emits nothing but custom properties. So the axis value is re-emitted here
   * UNMODIFIED as a local `data-*` attribute. `GuideSection` and `FeelSection`
   * established the shape; `ProofSection` (`data-motion`) established the idea.
   *
   * `width` is deliberately not mirrored — `--jp-content-max` / `--jp-measure`
   * already carry it and nothing here needs to select on it — and neither is
   * `media`, which this section type does not consume at all (see the header).
   *
   * `undefined` when no `design` arrives, so Svelte omits the attribute and every
   * per-look rule no-ops: a host that resolves no axes gets exactly the markup and
   * paint this component shipped before the per-look pass, rather than a guessed
   * default look. `SectionFrame` always passes a TOTAL `ResolvedSectionDesign`, so
   * both real render paths — the public page and the studio canvas — have all
   * nine.
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

  // The stats row is chrome. `table` states the same counts per row and
  // `numbered-prose` is defined as having no chrome at all, so both drop it.
  const showStats = $derived(
    composition !== 'table' && composition !== 'numbered-prose'
  );

  /**
   * WHETHER THE `<header>` HAS ANYTHING TO HOLD — the guard each of the four
   * contents of `.descent__head` already had and the element around them did not.
   *
   * Every child of that header is individually `{#if}`-guarded (eyebrow, the
   * self-hiding `<h2>`, sub, and the stats row, which `table` and
   * `numbered-prose` drop), so on those two compositions all four can be false at
   * once and the header rendered as an EMPTY LANDMARK carrying
   * `margin: 0 0 calc(var(--space-12) * var(--jp-rhythm))` — a `--space-12` band
   * of nothing above the stages, under a `header` role announcing no content.
   *
   * REACHABLE, and the whole-catalogue sweep is what found it: `props: {}` with
   * no claimed title fallback on `map: table` or `map: numbered-prose`. The other
   * four compositions are immune only because `showStats` is true for them — i.e.
   * the header was empty on exactly the two compositions defined as having no
   * chrome, which is the pair a creator picks when they want the stages and
   * nothing else.
   *
   * Derived from the same four expressions the children read rather than from
   * `config`: a guard that re-derives its own answer is how a heading self-hides
   * while the frame around it still renders (this section's own `title` history),
   * and `title` in particular depends on `titleFallback`, which only the page can
   * decide.
   */
  const hasHead = $derived(!!(p.eyebrow || title || p.sub) || showStats);

  /**
   * THE GENERIC CHROME, NOW THROUGH THE i18n LAYER.
   *
   * This block used to hold ten raw English literals with a comment explaining
   * that the keys had been REQUESTED but not added, because the orchestrator owns
   * `messages/en.json` (contract A7/A20). The keys were in fact added — all ten of
   * them are in `apps/web/messages/en.json` and compiled — so the deferral had
   * quietly become the shipped state: this was the last section still publishing
   * raw strings to the public page while `InviteSection`, `FeelSection`,
   * `HeroSection`, `IntroVideoSection` and `ReelSection` all routed their chrome
   * through `m.*()`.
   *
   * STILL COLLECTED IN ONE OBJECT rather than called at each use site, and that is
   * not laziness: `countLabel` below takes the singular and plural forms as
   * ARGUMENTS, so they have to be values. paraglide-js 1.11.8 has NO plural
   * support, so a call-site ternary over two keys is the mechanism — never ICU
   * `{count, plural, …}`, which compiles to a literal here.
   *
   * The values are read EAGERLY inside a `$derived` so a locale change
   * re-resolves them, which a module-level constant would not.
   */
  const CHROME = $derived({
    stages: m.journey_map_stat_stages(),
    stagesOne: m.journey_map_stat_stages_one(),
    practices: m.journey_map_stat_practices(),
    practicesOne: m.journey_map_stat_practices_one(),
    colStage: m.journey_map_col_stage(),
    colIncludes: m.journey_map_col_includes(),
    colPractices: m.journey_map_col_practices(),
    locked: m.journey_map_locked_hint(),
    audio: m.journey_map_audio_label(),
    written: m.journey_map_written_label(),
  });

  function countLabel(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
  }

  /**
   * The practice's content type, as a label and as an ICON. The icon replaces the
   * `▶ ♪ ✎` glyph map: `▶` (U+25B6) carries emoji presentation on Apple
   * platforms, so a "typographic" glyph map was shipping an emoji to a real page.
   * `IconBase` sets `aria-hidden` itself and the label beside it carries the
   * meaning.
   */
  const TYPE_ICON = {
    video: PlayIcon,
    audio: MusicIcon,
    written: FileTextIcon,
  } as const;

  function typeLabel(type: string): string {
    if (type === 'audio') return CHROME.audio;
    if (type === 'written') return CHROME.written;
    return m.journey_map_practice_label();
  }

  function typeIcon(type: string) {
    return TYPE_ICON[type as JourneyContentType] ?? PlayIcon;
  }

  /**
   * Lowercase roman numerals, with no ceiling. The previous `ROMAN` table stopped
   * at ten and fell through to arabic, so an eleven-stage course read
   * `… ix, x, 11, 12` — a change of numbering system mid-list.
   */
  const ROMAN_STEPS: ReadonlyArray<readonly [number, string]> = [
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];

  function roman(index: number): string {
    let left = index + 1;
    let out = '';
    for (const [value, glyph] of ROMAN_STEPS) {
      while (left >= value) {
        out += glyph;
        left -= value;
      }
    }
    return out;
  }

  function sortedPractices(stage: JourneyStageView) {
    return [...stage.practices].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * One row per content type present in the stage, for the `table` composition.
   * A plain record rather than a `Map`: this is a pure per-render accumulator, and
   * a `Map` trips the Svelte autofixer's "use SvelteMap" rule — which is right
   * about reactive state and beside the point for a local.
   */
  function typeBreakdown(
    stage: JourneyStageView
  ): Array<{ type: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const practice of stage.practices) {
      counts[practice.contentType] = (counts[practice.contentType] ?? 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({ type, count }));
  }

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
    editFieldAttrs('map', key, editable, onEdit);

  // ── Progressive enhancement state ──
  let mounted = $state(false);
  let reduced = $state(false);
  let bodyEl = $state<HTMLElement | undefined>(undefined);
  let drawEl = $state<HTMLElement | undefined>(undefined);
  // How many leading gates have been reached by the descending ember (monotonic).
  let litCount = $state(0);

  // The descent choreography belongs to ONE composition, needs motion, and needs
  // at least one gate to ignite. `motion: none` is the axis half of what the
  // retired `minimal`-style presets used to do by hand.
  const enhanced = $derived(
    composition === 'spine' && mounted && !reduced && !motionOff && stages.length > 0
  );

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

<!--
  The stage's practice pool. Shared by `spine` (inside a band) and nothing else
  today, but kept as a snippet so a later composition can reuse the card without
  copying the lock semantics.
-->
{#snippet practiceCards(stage: JourneyStageView)}
  <div class="descent__practices">
    {#each sortedPractices(stage) as practice, i (practice.contentId)}
      {@const Icon = typeIcon(practice.contentType)}
      <article class="descent__card" style="--descent-i: {i}">
        <div class="descent__card-top">
          <span class="descent__card-type">
            <Icon class="descent__card-glyph" size="0.875rem" />
            {typeLabel(practice.contentType)}
          </span>
          <LockIcon class="descent__card-lock" size="0.875rem" />
        </div>
        <h4 class="descent__card-title">{practice.title}</h4>
        <span class="sr-only">{CHROME.locked}</span>
      </article>
    {/each}
  </div>
{/snippet}

{#snippet stageCount(stage: JourneyStageView)}
  {stage.practices.length}
  {countLabel(stage.practices.length, CHROME.practicesOne, CHROME.practices)}
{/snippet}

{#if stages.length > 0}
  <!--
    `data-map` is the COMPOSITION; the seven `data-*` below are the axis values
    mirrored verbatim, so the per-look blocks at the foot of the stylesheet can
    select on a design language. See `look` in the script for why a section that
    reads nothing but custom properties still needs them.
  -->
  <div
    class="descent"
    class:descent--enhanced={enhanced}
    data-map={composition}
    data-surface={look.surface}
    data-edge={look.edge}
    data-align={look.align}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
    data-motion={look.motion}
  >
    <div class="descent__inner">
      <!-- NO EMPTY LANDMARK, AND NO PHANTOM BAND — see `hasHead`. Every child
           below self-hides, so on `table` / `numbered-prose` (the two that drop
           the stats row) an unauthored section rendered this `<header>` with
           nothing in it and `--space-12` of margin under it. -->
      {#if hasHead}
        <header class="descent__head" use:reveal={{ disabled: editable }}>
          {#if p.eyebrow}
            <p
              class="jp-sec__eyebrow jp-reveal descent__eyebrow"
              data-jp-step="1"
              {...editAttrs('eyebrow')}
            >
              {p.eyebrow}
            </p>
          {/if}
          {#if title}
            <h2
              class="jp-sec__heading jp-sec__heading--sub jp-reveal descent__title"
              data-jp-step="2"
              {...editAttrs('heading')}
            >
              {title}
            </h2>
          {/if}
          {#if p.sub}
            <p
              class="jp-sec__measure jp-reveal descent__sub"
              data-jp-step="3"
              {...editAttrs('sub')}
            >
              {p.sub}
            </p>
          {/if}
          {#if showStats}
            <p class="jp-reveal descent__stats" data-jp-step="4">
              <span class="descent__stat">
                <b>{context.course.stageCount}</b>
                {countLabel(
                  context.course.stageCount,
                  CHROME.stagesOne,
                  CHROME.stages
                )}
              </span>
              <span class="descent__stat">
                <b>{context.course.practiceCount}</b>
                {countLabel(
                  context.course.practiceCount,
                  CHROME.practicesOne,
                  CHROME.practices
                )}
              </span>
            </p>
          {/if}
        </header>
      {/if}

      {#if composition === 'spine'}
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
                  {@render practiceCards(stage)}
                {/if}
              </li>
            {/each}
          </ol>
        </div>
      {:else if composition === 'rows'}
        <!-- Ported from the canvas tree's `.jp-stages` / `.jp-stage` (A12). -->
        <ol class="descent__rows" use:reveal={{ disabled: editable }}>
          {#each stages as stage, i (stage.id)}
            <li
              class="jp-reveal descent__row descent__item"
              style="--descent-i: {i}"
            >
              <span class="descent__row-rn" aria-hidden="true">{roman(i)}</span>
              <h3 class="descent__row-name">{stage.name}</h3>
              <span class="descent__row-count">{@render stageCount(stage)}</span>
            </li>
          {/each}
        </ol>
      {:else if composition === 'cards'}
        <!-- Ported from the canvas tree's `.jp-stagegrid` / `.jp-stagecard` (A12). -->
        <ol class="descent__cards" use:reveal={{ disabled: editable }}>
          {#each stages as stage, i (stage.id)}
            <li
              class="jp-reveal descent__stagecard descent__item"
              style="--descent-i: {i}"
            >
              <span class="descent__row-rn" aria-hidden="true">{roman(i)}</span>
              <h3 class="descent__stagecard-name">{stage.name}</h3>
              {#if stage.gloss}
                <p class="descent__gloss">{stage.gloss}</p>
              {/if}
              <p class="descent__row-count">{@render stageCount(stage)}</p>
            </li>
          {/each}
        </ol>
      {:else if composition === 'table'}
        <!--
          A real data table, for buyers who scan. `<th scope="row">` on the stage
          name rather than an `h3`, because in a table the row header IS the
          heading relationship — and per research §5.1 the `type` axis must never
          promote or invent a heading level.

          THREE columns, not the research's four: `minutes` and per-stage `access`
          have no field on `JourneyPracticeView` / `JourneyStageView`, so a column
          for either would be a control that renders nothing. Deliberately NOT
          wrapped in an `overflow-x` scroller — that would add an unnamed tab stop
          on every page; the cells wrap instead, and the narrow container query
          below tightens them.
        -->
        <table class="descent__table">
          <thead>
            <tr>
              <th scope="col">{CHROME.colStage}</th>
              <th scope="col">{CHROME.colIncludes}</th>
              <th scope="col" class="descent__num">{CHROME.colPractices}</th>
            </tr>
          </thead>
          <tbody>
            {#each stages as stage, i (stage.id)}
              <tr>
                <th scope="row" class="descent__cell-stage">
                  <span class="descent__row-rn" aria-hidden="true"
                    >{roman(i)}</span
                  >
                  <span class="descent__cell-name">{stage.name}</span>
                  {#if stage.gloss}
                    <span class="descent__cell-gloss">{stage.gloss}</span>
                  {/if}
                </th>
                <td>
                  <span class="descent__inc">
                    {#each typeBreakdown(stage) as entry (entry.type)}
                      {@const Icon = typeIcon(entry.type)}
                      <span class="descent__inc-item">
                        <Icon class="descent__card-glyph" size="0.875rem" />
                        {entry.count}
                        {typeLabel(entry.type)}
                      </span>
                    {/each}
                  </span>
                </td>
                <td class="descent__num">{stage.practices.length}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if composition === 'timeline'}
        <!--
          A horizontal scroll-snap track, one panel per stage. `tabindex="0"` is
          required, not decorative: a scrollable region that only responds to a
          pointer fails WCAG 2.1.1, and nothing inside a panel is focusable. The
          focus ring is declared below because `edge: none` / `edge: soft` remove
          borders and must NEVER remove a focus ring.

          The tabindex sits on a wrapping `div` rather than on the `ol` on
          purpose: a list has a non-interactive role, and giving THAT a
          non-negative tabindex is the `a11y_no_noninteractive_tabindex` case. A
          generic wrapper takes the focus and the list stays a list.

          The track is start-anchored on purpose and does not read `--jp-align`:
          `justify-content: center` on an overflowing scroll container makes the
          first panel unreachable in every engine that does not support `safe`.
        -->
        <!--
          The rule models "tabindex on a non-interactive element" as a mistake.
          Here it is the fix: WCAG 2.1.1 requires a scrollable region to be
          operable by keyboard, nothing inside a panel is focusable, and no ARIA
          role describes "a thing that scrolls". `role="region"` would need an
          accessible name and this section already has its `h2` — a second,
          unnamed landmark would be noise. Focus ring declared below.
        -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="descent__track" tabindex="0">
          <ol class="descent__panels" use:reveal={{ disabled: editable }}>
            {#each stages as stage, i (stage.id)}
              <li
                class="jp-reveal descent__panel descent__item"
                style="--descent-i: {i}"
              >
                <span class="descent__row-rn" aria-hidden="true">{roman(i)}</span
                >
                <h3 class="descent__panel-name">{stage.name}</h3>
                {#if stage.gloss}
                  <p class="descent__gloss">{stage.gloss}</p>
                {/if}
                <p class="descent__row-count">{@render stageCount(stage)}</p>
              </li>
            {/each}
          </ol>
        </div>
      {:else}
        <!-- `numbered-prose`: stages as numbered editorial paragraphs, no chrome. -->
        <ol class="descent__prose" use:reveal={{ disabled: editable }}>
          {#each stages as stage, i (stage.id)}
            {@const practices = sortedPractices(stage)}
            <li
              class="jp-reveal descent__para descent__item"
              style="--descent-i: {i}"
            >
              <h3 class="descent__para-name">
                <span class="descent__para-rn" aria-hidden="true"
                  >{roman(i)}.</span
                >
                {stage.name}
              </h3>
              {#if stage.gloss}
                <p class="descent__para-gloss">{stage.gloss}</p>
              {/if}
              {#if practices.length > 0}
                <p class="descent__para-list">
                  {practices.map((practice) => practice.title).join(' · ')}
                </p>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if p.foot}
        <div class="descent__footwrap" use:reveal={{ disabled: editable }}>
          <p class="jp-reveal descent__foot" {...editAttrs('note')}>{p.foot}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX

     `--jp-sec-pad-block` / `--jp-sec-pad-inline` are the shared role aliases
     declared once in `journey-design.css`. They contain `6cqw`, so they MUST be
     consumed on a DESCENDANT of `.jp-sec` — an element is not its own query
     container, and reading them on the wrapper silently gives page-relative
     padding (pilot lesson 1). `.descent` is that descendant.

     `text-align` is deliberately NOT set here. The `align` axis governs this
     section's COPY blocks (head, foot, prose) — a spine, a row list and a table
     are inherently start-anchored, and centring their contents at
     `align: center` would have centred every stage name on all seven live pages.
     ═══════════════════════════════════════════════════════════════════════ */
  .descent {
    /* The gate node's diameter. `cqw`, not the previous `vw` (contract A14): the
       builder canvas renders this section inside a device frame narrower than
       the window, where a viewport unit reads the wrong number. The 2.75rem
       floor is the WCAG tap-target size, so a node is never a dot. */
    --descent-node: clamp(2.75rem, 8cqw, 3.75rem);
    --descent-spine-x: calc(var(--descent-node) / 2);
    /* Per-item reveal step. `--jp-reveal-stagger` is calibrated for ~5 block
       beats and is 200ms at `drift`; a map can hold twenty stages and sixty
       practice cards, so the step is HALVED and the accumulated delay is capped
       at one `--duration-slowest` (pilot lesson 5). Without the cap a long
       curriculum would take ten seconds to assemble. */
    --descent-step: calc(var(--jp-reveal-stagger) / 2);
    --descent-step-max: var(--duration-slowest);
    /*
      TWO ACCENT ROLES — now the SAME token, and that collapse is measured.

      The spine, the node ring and the roman numeral are MEANINGFUL graphics, so
      research §5.1 puts them under the 3:1 UI/graphic floor. `--jp-accent-mark`
      is the role for a brand mark and the right answer in principle. Round 2
      could not use it for the signal, and recorded why: accent-mark resolved to
      the theme-blind `--jp-ember` (`Codex-8jve9`), measured at 8.49 light and
      2.04 dark — below the floor at one pole. So the signal borrowed
      `--jp-accent-text` and only the decorative bloom kept accent-mark.

      THAT IS NO LONGER TRUE, and the 2.04 figure was misattributed. Re-measured
      on the golden org (`of-blood-and-bones`, `pricing-smoke-test`), both poles,
      all five accent values, with the A67 method — `copy` composite, ancestor
      walk to alpha > 250, both `data-theme` AND `.dark`, 2× rAF + 1300ms:

        accent  | mark dark | text dark | mark light | text light
        none    |   17.51   |   17.51   |   18.38    |   18.38
        text    |    6.04   |    6.04   |   14.62    |   14.62
        fill    |    6.04   |    6.04   |   14.62    |   14.62
        edge    |    6.04   |   11.04   |   14.62    |   15.41
        glow    |    6.04   |    6.04   |   14.62    |   14.62

      `--jp-accent-mark` now resolves to `--jp-ember-text`, so it is IDENTICAL to
      `--jp-accent-text` at four of five accent values and clears both floors at
      every one. The token that actually measures 2.04 dark is `--jp-ember` /
      `--jp-accent-fill` (`rgb(85,46,142)`); accent-mark is `rgb(155,132,187)` at
      6.04. Round 2 read `--jp-ember`'s ratio onto the token that merely pointed
      at it — a real hazard whenever one token aliases another.

      So the signal reads `--jp-accent-mark` directly. The only behaviour change
      is at `accent: edge`, where it moves 11.04 → 6.04 dark and 15.41 → 14.62
      light — both still far above the 4.5 text floor and the 3 graphic floor.
      `Codex-8jve9` stays open on its own terms (`--jp-ember` is still
      theme-blind, and the CTA still disagrees with the accent ladder), but it no
      longer gates this: A38 repointed accent-mark off ember.

      Signal and bloom are now the same token. Keeping both names for one value
      is redundant — a later sweep should read `--jp-accent-mark` at the call
      sites and drop both aliases. Not done here to avoid churning six call sites
      for no behaviour change.
    */
    --descent-signal: var(--jp-accent-mark);
    --descent-bloom: var(--jp-accent-mark);

    /* ── THE ROLE TABLE, so a look is a VALUE and not a rule ───────────────
       The per-look blocks at the foot of this file are keyed on axis values
       (`edge: offset`, `accent: none`, …). Written as paint rules, this section
       would re-declare the same box recipe on four item selectors × seven
       looks — the shape that produced the eight different spellings of
       `clamp(2rem, 6cqw, 4.4rem)` this tree is still cleaning up. Written as
       properties, a look states its VALUES and the paint stays in one place,
       which is the discipline `journey-design.css` holds itself to.

       IT IS ALSO THE ONLY SAFE MECHANISM HERE, for a reason specific to this
       component. The `spine` choreography's pre-lit state is
       `.descent--enhanced .descent__band:not(.is-lit) .descent__node` — (0,4,0).
       A per-look rule keyed on two attributes plus a descendant is also (0,4,0),
       so a look that repainted the node DIRECTLY would tie with the armed state
       and win on source order, silently disabling the ignition it sits after.
       A property set on the ROOT cannot: it feeds the (0,1,0) base rule and the
       (0,4,0) armed rule still overrides it.

       EVERY DEFAULT BELOW REPRODUCES THE BASE COMMIT EXACTLY, which is the whole
       point — candlelit matches none of the per-look selectors, so it resolves
       these defaults, and a default that merely looked reasonable would have
       restyled the one preset that already works.

       Two spellings are load-bearing rather than stylistic:
         · `0px`, never a bare `0`, wherever the value is substituted into a
           shorthand — `--jp-edge-width` carries a unit for exactly this reason
           (A63/A64), and a unitless zero in a length slot invalidates the whole
           declaration SILENTLY.
         · `--descent-item-stripe` / `--descent-item-rule` default to
           `var(--descent-item-border)` rather than to `0 none`. They are applied
           as `border-inline-start` / `border-block-end` AFTER the `border`
           shorthand, so a `0 none` default would have deleted two sides of the
           box every published page draws. Defaulting to the box means a look
           that changes `--descent-item-border` moves all four sides together and
           can then single out a side. */

    /* items: the practice card, the stage row, the stage card, the timeline
       panel — one material repeated, so they share one recipe. */
    --descent-item-radius: var(--radius-card);
    --descent-item-border: max(var(--jp-edge-width), var(--border-width)) solid
      var(--jp-edge-color);
    --descent-item-stripe: var(--descent-item-border);
    --descent-item-rule: var(--descent-item-border);
    --descent-item-bg: var(--color-surface-secondary);
    --descent-item-shadow: var(--jp-edge-shadow);
    --descent-item-hover-bg: var(--color-surface);
    --descent-item-hover-edge: color-mix(
      in oklab,
      var(--descent-bloom) 45%,
      transparent
    );
    /* The one-line row is the only item with its own corner (`--radius-md`,
       ported from `_descent.css`), so it gets its own knob. */
    --descent-row-radius: var(--radius-md);

    /* the two stat chips in the header */
    --descent-chip-radius: var(--radius-full);
    --descent-chip-border: var(--border-width) solid var(--color-border-subtle);
    --descent-chip-bg: var(--color-surface-secondary);
    --descent-chip-shadow: none;
    --descent-chip-pad: var(--space-1) var(--space-3);

    /* labels (the uppercase content-type caps, the table's column heads) and
       the roman numerals. `inherit` is the inherited family, i.e. no change. */
    --descent-label-font: inherit;
    --descent-num-font: var(--font-heading);
    --descent-num-style: italic;
    --descent-num-size: var(--text-lg);
    --descent-num-weight: var(--font-normal);
    --descent-num-color: var(--descent-signal);
    /*
      THE DISC NUMERAL IS SIZED SEPARATELY FROM THE STANDALONE ONES, and that
      split is a constraint rather than a preference.

      `--descent-num-size` lands on `.descent__row-rn`, which sits in a wrapping
      flex row / grid cell and can grow. `.descent__rn` sits inside
      `--descent-node`, a FIXED `clamp(2.75rem, 8cqw, 3.75rem)` box floored at
      the WCAG tap-target size — and a lowercase roman numeral runs to five
      glyphs (`xviii`), so at 44px of box the 18px rung is already close to the
      wall. Any look that wanted "big numerals" through one shared property
      would have pushed the disc's numeral out through its own ring. Two
      properties, and the disc keeps its rung.
    */
    --descent-node-num-size: var(--text-lg);

    /* the gate node — a filled disc with an accent ring today. Its numeral has
       its own ink role because one look reverses it out of a filled plate. */
    --descent-node-radius: var(--radius-full);
    --descent-node-bg: radial-gradient(
      circle at 50% 34%,
      /* 18%, not the 26% this shipped with. The tint lifts the node's centre
         toward the bloom's mid-lightness purple, and in DARK theme that lift is
         what put the numeral at 4.42:1 against a 4.5 floor (measured). 18%
         reads as the same warm centre and clears the floor at both poles; the
         numeral is 20px/400, so it gets no large-text allowance. */
        color-mix(in oklab, var(--descent-bloom) 18%, var(--color-surface-secondary)),
      var(--color-surface)
    );
    /*
      THE RING READS THE TOKEN DIRECTLY — no percentage carried onto it.

      This was `color-mix(--descent-signal 60%, transparent)` and measured 3.35:1
      light and **2.53:1 dark** against the node's own surface, under a 3:1 floor.
      A ring is a resting boundary that has to read, and no alpha low enough to
      look "faint" survives the dark pole: the sweep needed 80% before dark
      cleared (3.45). Full strength measures 7.88 / 4.60. The lesson generalises —
      carry state on fill and border WEIGHT, never on the boundary's opacity.
    */
    --descent-node-ring: var(--border-width) solid var(--descent-signal);
    --descent-node-ink: var(--descent-num-color);
    /* The ring bloom and the drop bloom are atmosphere and ride the
       `--jp-sec-atmos` 0/1 gate; the inset highlight is material and does not. */
    --descent-node-shadow:
      0 0 0 var(--border-width)
        color-mix(
          in oklab,
          var(--descent-bloom) calc(22% * var(--jp-sec-atmos)),
          transparent
        ),
      0 var(--space-2-5) var(--space-8) calc(var(--space-3-5) * -1)
        color-mix(
          in oklab,
          var(--descent-bloom) calc(80% * var(--jp-sec-atmos)),
          transparent
        ),
      inset 0 var(--border-width) 0
        color-mix(in oklab, var(--color-heading) 12%, transparent);

    /* rules the section draws. `0px` paints no rule at all — the base state. */
    --descent-head-rule: 0px;
    --descent-head-gap: 0px;
    --descent-rule: var(--border-width) solid var(--color-border-subtle);
    /* The closing note's rule. A 14% mix of `--jp-accent-mark` — a REAL colour
       at every accent value, so this is not contract A37's mix-of-a-mix. */
    --descent-foot-rule: var(--border-width) solid
      color-mix(in oklab, var(--descent-bloom) 14%, transparent);

    position: relative;
    isolation: isolate;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
  }

  .descent__inner {
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* ── header ──
     The eyebrow, title and sub adopt the shared `.jp-sec__eyebrow`,
     `.jp-sec__heading` and `.jp-sec__measure` atoms, which is where the `type`
     and `width` axes actually land. `--jp-sec__heading--sub` is the axis's
     SECOND type step: at `type: monumental` that is `--text-4xl`, which is
     exactly the size this title shipped before the axes existed. The first step
     (`--jp-display`) is the PAGE's display heading — the hero's `h1` — and using
     it for a section `h2` would make every section heading the same size as the
     page title (80px against 48px, measured). */
  .descent__head {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: calc(var(--space-3) * var(--jp-rhythm));
    margin: 0 0 calc(var(--space-12) * var(--jp-rhythm));
    /* The hairline under the section head, drawn by exactly two looks
       (`long-read`, `syllabus`) and by nothing else. `0px` is the default, so on
       every other look this pair paints nothing and costs nothing. It is the
       flex CONTAINER that takes the rule, not a child, so the rule spans the
       head rather than underlining one line of text. */
    padding-block-end: var(--descent-head-gap);
    border-block-end: var(--descent-head-rule) solid var(--color-border-subtle);
    text-align: var(--jp-text-align);
  }

  .descent__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: var(--jp-align);
    gap: var(--space-2);
    margin: calc(var(--space-3) * var(--jp-rhythm)) 0 0;
  }

  .descent__stat {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--descent-chip-pad);
    border-radius: var(--descent-chip-radius);
    border: var(--descent-chip-border);
    background: var(--descent-chip-bg);
    /* `none` by default, so this declaration is inert on every look that has
       not asked for elevation. */
    box-shadow: var(--descent-chip-shadow);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* Accent as TEXT, so never `--jp-ember` (2.04:1 in dark, measured) and never
     the raw `--color-brand-primary` this used to read. */
  .descent__stat b {
    font-family: var(--font-heading);
    font-weight: var(--font-semibold);
    color: var(--descent-signal);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 1 · `spine` — the descent (today's look)
     ═══════════════════════════════════════════════════════════════════════ */
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

  /* Baseline: the spine reads as fully drawn (no JS to animate it).

     `--jp-accent-mark`, NOT `--jp-accent-fill`: the fill is `transparent` at
     `accent: text` and `accent: edge`, so the spine and every gate node would
     have vanished on two of five values (pilot lesson 4). The spine is a
     MEANINGFUL graphic, so it also owes the 3:1 UI-contrast floor, which is why
     it reads a real colour on all five values rather than a mix.

     The BLOOM around it is atmosphere rather than meaning, so its strength is
     multiplied by the `--jp-sec-atmos` 0/1 gate inside the `color-mix`
     percentage: 60% under `surface: media` (Candlelit, i.e. today), 0% —
     fully transparent, no glow — on every other surface value. Gating the mix
     rather than the element keeps it one declaration and needs no extra node. */
  .descent__spine-draw {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-full);
    /*
      THE TOP STOP IS 80%, NOT THE 45% THIS SHIPPED WITH.

      The spine is a meaningful graphic, so every part of it owes 3:1 — including
      the end of its own fade. Measured over the page background: 45% gives
      2.81:1 light and 2.05:1 DARK, i.e. the kindling fade was below the floor for
      its whole upper stop. Swept 45/60/70/80/90/100: dark clears 3:1 at 70%
      (3.45) and clears with margin at 80% (4.19 dark / 8.21 light). 80% keeps a
      visible gradient — the spine still kindles — and passes at both poles.
    */
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--descent-signal) 80%, transparent),
      var(--descent-signal)
    );
    box-shadow: 0 0 var(--space-2-5)
      color-mix(
        in oklab,
        var(--descent-bloom) calc(60% * var(--jp-sec-atmos)),
        transparent
      );
  }

  /* The glowing edge dot only rides the draw while it is animating. */
  .descent__spine-draw::after {
    content: '';
    display: none;
    position: absolute;
    bottom: calc(var(--space-1) * -0.75);
    left: 50%;
    width: var(--space-2-5);
    height: var(--space-2-5);
    transform: translateX(-50%);
    border-radius: var(--radius-full);
    background: var(--descent-signal);
    box-shadow: 0 0 var(--space-3) var(--space-0-5)
      color-mix(in oklab, var(--descent-bloom) 75%, transparent);
  }

  .descent__stages {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-12) * var(--jp-rhythm));
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* ── a band: [gate] [concurrent practices] ── */
  .descent__band {
    position: relative;
    display: grid;
    grid-template-columns: minmax(13rem, 16.5rem) minmax(0, 1fr);
    column-gap: calc(var(--space-8) * var(--jp-rhythm));
    align-items: start;
  }

  /* gate = spine node + name/gloss */
  .descent__gate {
    display: grid;
    grid-template-columns: var(--descent-node) minmax(0, 1fr);
    column-gap: calc(var(--space-4) * var(--jp-rhythm));
    align-items: start;
  }

  /*
    THE GATE NODE — and the fix for `Codex-rvkmc`'s open half.

    `04-contrast-baseline.md` recorded this surface as `rgb(56,21,17)` "identical
    in light AND dark", i.e. theme-invariant, and concluded that no palette change
    could lift `.descent__rn` off 4.45:1. Re-measured with the settle the pilot
    added (2× rAF + ~260ms after the flip), the surface DOES flip — the invariance
    was the missing-settle artifact, and the same document's two readings of this
    one element disagree with each other (`rgb(210,204,196)` in the first pass,
    `rgb(56,21,17)` in the second) which is the tell. Full numbers in the WP report.

    The ratio was still a real failure, and its real cause is the FOREGROUND: the
    numeral painted `--color-brand-accent`, the raw org brand, which is exactly
    the "accent as text" case the contract forbids. It now reads
    `--jp-accent-text` (`--jp-ember-text`, calibrated at 55% for precisely this).
  */
  .descent__node {
    grid-row: 1 / span 2;
    width: var(--descent-node);
    height: var(--descent-node);
    /* Baseline / lit look — the final warm state. Every one of the four values
       below is a role from the table on `.descent`, so a design language can
       square this disc, flatten it, un-ring it or reverse it out of a filled
       accent plate WITHOUT out-specifying the armed pre-lit state. The
       measurements that fixed the defaults are recorded beside them there. */
    border-radius: var(--descent-node-radius);
    display: grid;
    place-items: center;
    background: var(--descent-node-bg);
    border: var(--descent-node-ring);
    box-shadow: var(--descent-node-shadow);
  }

  .descent__rn {
    font-family: var(--descent-num-font);
    font-style: var(--descent-num-style);
    font-weight: var(--descent-num-weight);
    font-size: var(--descent-node-num-size);
    color: var(--descent-node-ink);
  }

  .descent__gate-meta {
    padding-top: var(--space-0-5);
  }

  /*
    THE STAGE NAME — the third heading level in a section whose `type` axis
    provides two steps.

    Half the section-heading step lands on exactly today's `--text-xl` at
    `type: monumental` (Candlelit) at desktop widths, with `--text-lg` as the
    floor so `restrained` can never push a stage name down into body copy. The
    alternative — reading `--jp-heading-size` directly, as
    `journey-sections-shared.css`'s comment suggests — makes a stage name the same
    size as the section heading above it and flattens the outline visually.
  */
  .descent__gate-name,
  .descent__row-name,
  .descent__stagecard-name,
  .descent__panel-name,
  .descent__para-name {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    /* `--jp-body-size` (A44) with this component's own --text-lg floor kept:
       the rung alone would drop a stage name 20px -> 17px at `restrained` and
       `balanced`, which no published page uses but the axis does. */
    font-size: max(var(--text-lg), var(--jp-body-size));
    line-height: var(--leading-snug);
    letter-spacing: var(--tracking-tight);
    color: var(--color-heading);
  }

  .descent__gloss {
    margin: var(--space-2) 0 0;
    max-width: var(--jp-measure);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* the concurrent pool — peers side by side, wrap as needed */
  .descent__practices {
    display: flex;
    flex-wrap: wrap;
    gap: calc(var(--space-3) * var(--jp-rhythm));
  }

  /*
    THE REPEATED MATERIAL — practice cards, stage cards, rows, timeline panels.

    These read the `edge` axis, because `edge` is the section's material and a
    card is that material repeated. The width is floored at `--border-width` so
    `edge: none` and `edge: soft` cannot dissolve a card boundary entirely: the
    boundary carries structure, research §5.1 puts it under the 3:1 UI-contrast
    floor, and every one of the seven live pages ships these cards with a
    hairline today. `--jp-edge-shadow` is `none` at `edge: none`, so under
    Candlelit these stay flat exactly as they are now.
  */
  .descent__card,
  .descent__row,
  .descent__stagecard,
  .descent__panel {
    position: relative;
    border-radius: var(--descent-item-radius);
    background: var(--descent-item-bg);
    border: var(--descent-item-border);
    /* The two sides a design language singles out: the accent STRIPE that
       replaces a badge, and the horizontal RULE that replaces a box. Both
       default to the box above, so this pair is a no-op until a look asks — see
       the note on the role table for why they may not default to `0 none`.
       Declared after the shorthand on purpose: a logical longhand wins its own
       side by declaration order. */
    border-inline-start: var(--descent-item-stripe);
    border-block-end: var(--descent-item-rule);
    box-shadow: var(--descent-item-shadow);
    text-align: start;
  }

  .descent__card {
    flex: 1 1 11rem;
    /*
      THE FLOOR THAT MAKES THE ROW WRAP INSTEAD OF CRUSHING A CARD — the fix for a
      live overflow at a 390px viewport.

      WHERE THE SQUEEZE COMES FROM, and it is NOT the line above. The narrow
      block near the foot of this stylesheet, `@container (max-width: 45rem)`,
      deliberately overrides the basis to `flex: 1 1 8.25rem` (132px) so a narrow
      container still gets a TWO-UP practice pool. At a 390px viewport the
      practices row measures 279px, so two 132px cards plus the 12px gap (276px)
      fit on one line — and each card's content box is 132 − 40 padding − 2 border
      = 90px.

      `.descent__card-top` is a flex row holding the uppercase type label
      ("REFLECTION" at `--text-xs` / `--tracking-wider`, beside a 14px glyph) and
      the lock, and its min-content is 131px. MEASURED LIVE on
      of-blood-and-bones/bone-deep, 390 viewport, light, reveals forced in:
      `.descent__card` scrollWidth 151 / clientWidth 130 and `.descent__card-top`
      scrollWidth 131 / clientWidth 90 — the label spilling 41px past its box
      under `overflow: visible`, painting over the card's own edge.
      `document.documentElement.scrollWidth` stayed equal to `clientWidth`
      throughout, which is why a horizontal-overflow check at three widths never
      saw it.

      `@container (max-width: 24rem)` below already forces `flex-basis: 100%`, so
      the mitigation EXISTS — it just starts one breakpoint too late: 384px, and
      390px is the width of every iPhone from the 12 to the 15. It missed by six
      pixels. Raising it would be a third hand-maintained number in a chain whose
      real constraint moves with the `type` and `density` axes.

      So state the constraint instead. `min-width: min(100%, 11rem)` says a card is
      never narrower than its BASE basis unless the row itself is narrower — so the
      flex row wraps to one-up exactly when two-up would crush a card, at every
      axis bag and every width, with no breakpoint to keep in step. The two-up
      design SURVIVES wherever it fits: a 45rem container gives a ~609px row and
      two 298px cards. The `100%` term is what stops a card overflowing a container
      narrower than the floor.

      FALSIFIED IN ISOLATION, narrow basis held at `8.25rem` in both arms and only
      this declaration varied: `.descent__card-top` 121/92 (29px spill, both cards
      on one line) → 92/92 (0px, one card per line). The live 41px and the
      harness's 29px differ only by the page's real font stack and tracking.
    */
    min-width: min(100%, 11rem);
    padding: calc(var(--space-4) * var(--jp-rhythm));
  }

  .descent__card:hover,
  .descent__row:hover,
  .descent__stagecard:hover,
  .descent__panel:hover {
    border-color: var(--descent-item-hover-edge);
    background: var(--descent-item-hover-bg);
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
    font-family: var(--descent-label-font);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  /* `:global` because the class lands on an `IconBase` `<svg>` in a child
     component, which Svelte's scoping cannot reach. */
  .descent__card-type :global(.descent__card-glyph) {
    color: var(--descent-signal);
    flex: none;
  }

  .descent__card-top :global(.descent__card-lock) {
    color: var(--color-text-secondary);
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

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 2 · `rows` — compact one-line stage rows
     Ported from `_descent.css`'s `.jp-stages` / `.jp-stage`.
     ═══════════════════════════════════════════════════════════════════════ */
  .descent__rows {
    display: grid;
    gap: calc(var(--space-2) * var(--jp-rhythm));
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .descent__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(var(--space-3) * var(--jp-rhythm));
    padding: calc(var(--space-3) * var(--jp-rhythm))
      calc(var(--space-4) * var(--jp-rhythm));
    border-radius: var(--descent-row-radius);
  }

  .descent__row-rn {
    flex: none;
    min-width: 2ch;
    font-family: var(--descent-num-font);
    font-style: var(--descent-num-style);
    /* `--font-normal` by default, which is the weight this span already
       inherited from the row — stated so a look can make the numeral loud. */
    font-weight: var(--descent-num-weight);
    font-size: var(--descent-num-size);
    color: var(--descent-num-color);
  }

  .descent__row-count {
    margin: 0;
    margin-inline-start: auto;
    flex: none;
    font-family: var(--descent-label-font);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 3 · `cards` — a card per stage
     Ported from `_descent.css`'s `.jp-stagegrid` / `.jp-stagecard`.

     MEASURED TRAP: `auto-fit` needs a FLEXIBLE max. This shipped as
     `minmax(min(16rem, 100%), 24rem)` and Chrome collapsed it to a SINGLE
     384px track at a 768px grid — three stages stacked in one column at every
     width, including 1440. Reproduced in isolation on a bare 768px probe:
     `minmax(min(16rem,100%), 24rem)` → `384px`, `minmax(16rem, 24rem)` →
     `384px`, `minmax(min(100%,16rem), 1fr)` → `374px 374px`. A fixed max makes
     the repetition count resolve to one; only an `fr` max repeats.

     `1fr` alone then stretches a single-stage course across the whole content
     width, which reads as a broken grid rather than a small curriculum — so the
     CARD carries the cap and `justify-self` places it on the `align` axis.
     ═══════════════════════════════════════════════════════════════════════ */
  .descent__cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    justify-items: var(--jp-align);
    gap: calc(var(--space-4) * var(--jp-rhythm));
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .descent__stagecard {
    width: 100%;
    max-width: 24rem;
    padding: calc(var(--space-5) * var(--jp-rhythm));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 4 · `table` — the dense scan
     ═══════════════════════════════════════════════════════════════════════ */
  .descent__table {
    width: 100%;
    border-collapse: collapse;
    text-align: start;
  }

  .descent__table th,
  .descent__table td {
    padding: calc(var(--space-3) * var(--jp-rhythm));
    border-block-end: var(--descent-rule);
    vertical-align: top;
    text-align: start;
    font-size: var(--text-base);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .descent__table thead th {
    font-family: var(--descent-label-font);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
    /* Colour only, so a look that zeroes `--descent-rule` removes this rule
       too rather than leaving one stray 1px line under the column heads. */
    border-block-end-color: var(--color-border);
  }

  .descent__cell-name {
    display: block;
    font-family: var(--font-heading);
    /* One step tighter than `--jp-body-size` because a table cell is denser
       than a card. /1.2 off the rung reproduces the old /2.4 off
       `--jp-heading-size` EXACTLY at all four type values (17/17/17/20). */
    font-size: max(var(--text-base), calc(var(--jp-body-size) / 1.2));
    line-height: var(--leading-snug);
    color: var(--color-heading);
  }

  .descent__cell-gloss {
    display: block;
    margin-top: var(--space-1);
    max-width: var(--jp-measure);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__inc {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .descent__inc-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-family: var(--descent-label-font);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .descent__inc-item :global(.descent__card-glyph) {
    color: var(--descent-signal);
    flex: none;
  }

  /* Beats the `text-align: start` on every `th`/`td` above, so the count column
     reads as a number column at both `align` values. */
  .descent__table .descent__num {
    text-align: end;
    font-family: var(--descent-label-font);
    font-variant-numeric: tabular-nums;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 5 · `timeline` — a horizontal scroll-snap track
     ═══════════════════════════════════════════════════════════════════════ */
  .descent__track {
    overflow-x: auto;
    scroll-snap-type: inline mandatory;
    overscroll-behavior-inline: contain;
    /* Room for the scrollbar gutter, so it never overlaps a panel's border. */
    padding-block-end: var(--space-3);
  }

  .descent__panels {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: min(22rem, 78cqw);
    gap: calc(var(--space-4) * var(--jp-rhythm));
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* `edge: none` and `edge: soft` remove borders; they must never remove this. */
  .descent__track:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .descent__panel {
    scroll-snap-align: start;
    padding: calc(var(--space-5) * var(--jp-rhythm));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITION 6 · `numbered-prose` — no chrome at all
     The only composition where `align` reaches the stage list, because a
     paragraph IS copy.
     ═══════════════════════════════════════════════════════════════════════ */
  .descent__prose {
    display: grid;
    gap: calc(var(--space-8) * var(--jp-rhythm));
    max-width: var(--jp-measure);
    /* LONGHAND, and the only consumer that was not (`Codex-3kqqp`). This was
       `margin: 0 var(--jp-measure-margin)`, the one shorthand among the 22
       consumers of that token. `align: end` gives the token a TWO-VALUE inline
       pair (`auto 0`), which in that shorthand expands to `margin: 0 auto 0`
       — top 0, inline auto, bottom 0. Valid CSS, silently CENTRED, and the one
       asymmetric value would have been the only one it broke. Same class as
       this file's own `max(var(--jp-edge-width), …)` regression: the
       declaration stays parseable and does the wrong thing. */
    margin-block: 0;
    margin-inline: var(--jp-measure-margin);
    padding: 0;
    list-style: none;
    text-align: var(--jp-text-align);
  }

  /* Deliberately NOT sized off `--descent-num-size`: this numeral is inline
     inside the `h3`, so it already travels with the stage-name rung. Giving it
     the standalone numeral size would shrink it below the words beside it. */
  .descent__para-rn {
    font-family: var(--descent-num-font);
    font-style: var(--descent-num-style);
    color: var(--descent-num-color);
  }

  .descent__para-gloss,
  .descent__para-list {
    margin: var(--space-2) 0 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .descent__para-list {
    color: var(--color-text-tertiary);
  }

  /* ── closing note ── */
  .descent__footwrap {
    margin-top: calc(var(--space-12) * var(--jp-rhythm));
  }

  .descent__foot {
    margin: 0;
    padding-top: calc(var(--space-8) * var(--jp-rhythm));
    border-top: var(--descent-foot-rule);
    text-align: var(--jp-text-align);
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE PER-ITEM REVEAL STEP

     The shared `.jp-reveal` atom carries the transition and reads the whole
     `motion` axis; `data-jp-step` covers the four header beats it is calibrated
     for. The stage LISTS are unbounded, so they get their own accumulated delay
     from the same axis property — halved, and capped at one `--duration-slowest`
     so a twenty-stage curriculum still finishes assembling.

     `:global(.reveal--armed)` because that class is added by the `reveal` ACTION
     at runtime. Svelte's static analysis cannot see it, so the scoped form is
     PRUNED as an unused selector — the rule compiles away and the stagger
     silently does nothing. svelte-check reports it; the browser would not.
     ═══════════════════════════════════════════════════════════════════════ */
  :global(.reveal--armed) .descent__item {
    transition-delay: min(
      calc(var(--descent-step) * var(--descent-i, 0)),
      var(--descent-step-max)
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ENHANCED: the ember descent

     Only applied when JS has confirmed motion is welcome AND the composition is
     `spine` (`.descent--enhanced`); the baseline above stays the SSR / no-JS /
     reduced-motion / `motion: none` fallback. Every duration and distance is the
     `motion` axis rather than the literals this block used to carry.
     ═══════════════════════════════════════════════════════════════════════ */

  /* Start the draw empty; the scroll driver sets its height in px. */
  .descent--enhanced .descent__spine-draw {
    height: 0;
    transition: height var(--duration-normal) var(--jp-reveal-ease);
  }
  .descent--enhanced .descent__spine-draw::after {
    display: block;
  }

  /* Transitions live on the always-matching enhanced selector so the un-lit →
     lit change animates in both directions. */
  .descent--enhanced .descent__node {
    transition:
      opacity var(--jp-reveal-duration) var(--jp-reveal-ease),
      transform var(--jp-reveal-duration) var(--jp-reveal-ease),
      border-color var(--jp-reveal-duration) var(--jp-reveal-ease),
      box-shadow var(--jp-reveal-duration) var(--jp-reveal-ease),
      background var(--jp-reveal-duration) var(--jp-reveal-ease);
  }
  .descent--enhanced .descent__rn {
    transition: color var(--jp-reveal-duration) var(--jp-reveal-ease);
  }
  .descent--enhanced .descent__gate-meta,
  .descent--enhanced .descent__card {
    transition:
      opacity var(--jp-reveal-duration) var(--jp-reveal-ease),
      transform var(--jp-reveal-duration) var(--jp-reveal-ease),
      border-color var(--jp-reveal-duration) var(--jp-reveal-ease),
      background var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  /* Armed (pre-lit) hidden/dim state — enhanced only. The distance is the axis's
     own, so `motion: fade` arrives with no travel and `motion: none` never
     reaches this state at all. */
  .descent--enhanced .descent__band:not(.is-lit) .descent__node {
    opacity: 0.48;
    transform: scale(0.94);
    border-color: var(--color-border-subtle);
    background: var(--color-surface-secondary);
    box-shadow: inset 0 var(--border-width) 0
      color-mix(in oklab, var(--color-heading) 8%, transparent);
  }
  /*
    The pre-lit numeral keeps `--descent-signal` and is dimmed ONLY by the node's
    own `opacity: 0.48` above. Re-colouring it to a lower text rung as well —
    which this rule used to do, with `--color-text-tertiary` — put a 3.63:1
    reading on a 4.5 floor in dark (measured) for no visual gain, because the
    opacity is already doing the dimming. Opacity is also the honest mechanism:
    it dims the whole graphic uniformly rather than desaturating one part of it.
  */
  .descent--enhanced .descent__band:not(.is-lit) .descent__gate-meta,
  .descent--enhanced .descent__band:not(.is-lit) .descent__card {
    opacity: 0;
    transform: translateY(var(--jp-reveal-distance));
  }

  /* Practice-pool stagger as a band ignites — the axis step, halved for the same
     reason the list step is. */
  .descent--enhanced .descent__band.is-lit .descent__card {
    transition-delay: min(
      calc(var(--descent-step) * var(--descent-i, 0)),
      var(--descent-step-max)
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     NARROW CONTAINERS — container queries, not viewport media queries (A14).
     `.jp-sec` is the container, so these track the SECTION's width and stay
     correct inside the builder's device frame.
     ═══════════════════════════════════════════════════════════════════════ */
  @container (max-width: 45rem) {
    /* stack cleanly — gate (node + name + gloss), then its practices */
    .descent__band {
      display: block;
      position: relative;
      padding-left: calc(
        var(--descent-node) + calc(var(--space-4) * var(--jp-rhythm))
      );
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
    .descent__practices {
      margin-top: calc(var(--space-4) * var(--jp-rhythm));
    }
    /*
      THE NARROW TWO-UP BASIS, KEPT — and it is no longer the whole story.
      Unclamped it produced two 132px cards in a 279px row at a 390px viewport,
      a 90px content box, and a 131px label spilling past the card edge. The
      constraint now lives on `.descent__card`'s `min-width` floor rather than in
      a breakpoint here, so this basis only decides how cards SHARE a line they
      already fit on. Read that floor's comment before changing either number.
    */
    .descent__card {
      flex: 1 1 8.25rem;
    }
    /* The table keeps all three columns and lets the cells wrap rather than
       becoming a scroll region — a scroller here would add an unnamed tab stop
       to every narrow viewport. */
    .descent__table th,
    .descent__table td {
      padding: calc(var(--space-2) * var(--jp-rhythm));
    }
    .descent__inc-item {
      white-space: normal;
    }
  }

  @container (max-width: 24rem) {
    .descent__card {
      flex-basis: 100%;
    }
    .descent__cell-gloss {
      display: none;
    }
  }

  /* ═══ PER-LOOK COMMITMENTS ═══════════════════════════════════════════════
     Everything above is axis-GENERIC: it consumes magnitudes and paints one
     arrangement per composition. What follows commits each design LANGUAGE to
     its documented tell (`00-design-language-research.md` §1), because a tell is
     a SELECTOR-level statement — which elements are boxes, which corner is
     square, which label is monospaced, which rule is drawn — and
     `journey-design.css` deliberately emits nothing but custom properties.

     ── THE SELECTOR DISCIPLINE, stated once so every block can be checked ───
     `candlelit` is the one preset that already works and it must come out of
     this pass byte-identical. It is uniquely identified by FOUR of its nine axis
     values — `surface: media`, `edge: none`, `media: bleed`, `accent: glow` —
     and SHARES the other five: `type: monumental` (with quiet-studio,
     plain-facts), `align: center` (quiet-studio, open-air, full-send),
     `density: airy` (open-air), `width: text` (long-read, open-air),
     `motion: drift` (open-air).

     So NO selector below is keyed on any of those five ALONE. Every one names a
     value from this list, and none of them matches the candlelit bundle:

       edge: offset                    → plain-facts  only
       accent: edge                    → syllabus     only
       type: restrained                → syllabus     only
       accent: none                    → quiet-studio only
       density: vast                   → quiet-studio only
       motion: fade                    → quiet-studio only
       surface: bare                   → quiet-studio + long-read
       surface: bare  + align: start   → long-read    only
       edge: soft                      → open-air     only
       edge: heavy                     → full-send    only
       motion: stagger                 → full-send    only
       edge: hairline + accent: fill   → signal       only

     `surface: bare` is used as a SHARED key on purpose rather than by accident:
     the two bare looks are exactly the two whose families forbid box borders
     ("no box borders anywhere" for editorial, "one hairline" for
     luxury-minimal), so the removals they have in common belong on the value
     they have in common. Candlelit is `surface: media` and cannot match it.

     `long-read` and `signal` each share all nine of their axis values with some
     sibling, so neither has a single value to key on; both compounds are
     justified in their own block.

     `open-air` is the dangerous one — it shares FOUR axes with candlelit — so
     every open-air rule here is keyed on `edge: soft`, which candlelit
     (`edge: none`) cannot match.

     WHAT IS NOT DONE HERE, and why. This section never renders `.cta`:
     `journey-design.test.ts` ("is the only styler of .cta in the section tree",
     `Codex-kdsuo`) reserves the pay button's colours to `render/CtaLink.svelte`,
     because that one contrast pair is guaranteed in exactly one place. So
     `signal`'s "one filled accent BUTTON per section" has no carrier in a
     section with no conversion affordance; what lands instead is the family's
     fill DISCIPLINE on the one badge this section owns. Nothing below sets
     `color` or `background` on `.cta`, and nothing should.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 EVERYWHERE.

     MEASURED ON THE BASE: two of the three already held and the third held
     nowhere. The 2px border and the hard offset drop arrive on their own,
     because `.descent`'s shell and the four item selectors already read
     `--jp-edge-width` / `--jp-edge-color` / `--jp-edge-shadow` — this file was
     never the "vanishing card" case GuideSection found. What was found NOWHERE
     is radius 0 and the mono label: the shell rounds to `--jp-sec-radius`
     (`--radius-card` under this look's own `surface: panel`), the items round to
     `--radius-card`, the row to `--radius-md`, the stat chips to `--radius-full`
     and the node to `--radius-full`, and not one label in the section was
     monospaced.

     The numerals also lose their SERIF ITALIC here. Brutalism has no ornament,
     so this is one of the places where the correct edit is a removal. */
  .descent[data-edge='offset'] {
    /* The shell has to be squared off too, not just its furniture — the tell's
       own adverb is "everywhere". */
    border-radius: var(--radius-none);
    --descent-item-radius: var(--radius-none);
    --descent-row-radius: var(--radius-none);
    --descent-node-radius: var(--radius-none);
    --descent-chip-radius: var(--radius-none);
    /* "Every block is a visible box": the chips take the section's own 2px edge
       and its hard drop rather than a hairline and no elevation. */
    --descent-chip-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --descent-chip-shadow: var(--jp-edge-shadow);
    --descent-chip-pad: var(--space-2) var(--space-3);
    /* MONO LABELS — the caps on a practice card, the table's column heads, the
       practice counts and the count column. */
    --descent-label-font: var(--font-mono);
    --descent-num-font: var(--font-mono);
    --descent-num-style: normal;
    /* The node stops being a lit disc and becomes a square 2px-ruled cell. Its
       ring is INK, not accent: brutalist borders are structure. */
    --descent-node-bg: var(--color-surface-secondary);
    --descent-node-ring: var(--jp-edge-width) solid var(--jp-edge-color);
    --descent-node-shadow: var(--jp-edge-shadow);
    --descent-foot-rule: var(--jp-edge-width) solid var(--jp-edge-color);
  }

  /* The spine's two gradients go flat. A 180° fade is the opposite of an
     "un-blurred" material, and the `--jp-sec-atmos` gate already zeroes the
     bloom at every surface but `media`, so the glow needs no undoing — only the
     fade does. */
  .descent[data-edge='offset'] .descent__spine-track {
    background: var(--jp-edge-color);
  }

  .descent[data-edge='offset'] .descent__spine-draw {
    background: var(--descent-signal);
    box-shadow: none;
  }

  /* MONO TABULAR FIGURES on the counts. `.descent__stat b` is the one figure
     that carries `--font-heading` explicitly, so the role property cannot reach
     it. Tabular so digits do not shuffle between rows. */
  .descent[data-edge='offset'] .descent__stat b,
  .descent[data-edge='offset'] .descent__row-count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* The accent spent as the family spends it: "solid rectangles of it, text
     reversed out". COMPOUNDED with `accent: fill` rather than left on
     `edge: offset` alone, because `--jp-accent-fill` is `transparent` at
     `accent: text` and `accent: edge` — a creator who picked either with this
     edge would get `--jp-accent-on-fill` ink on the section's own surface, which
     is the two-token contrast pair broken in half. `.descent__head` is a column
     flex box with `align-items: var(--jp-align)`, so the slab shrink-wraps its
     own text at both align values with no width of its own. */
  .descent[data-edge='offset'][data-accent='fill'] .descent__eyebrow {
    padding: var(--space-1) var(--space-3);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a hairline GRID, mono numerals, and a left-border accent stripe
     rather than a filled badge.

     MEASURED ON THE BASE: the section drew hairlines in exactly one place — the
     `table` composition's row rules — and a hairline grid needs two axes and has
     to survive the composition switch, because the ruled list is the LOOK's
     shape and not one arrangement's. Mono numerals: nowhere. The left stripe:
     nowhere; the node was a filled accent-ringed disc, which is precisely the
     "filled badge" the tell names in opposition. */
  .descent[data-accent='edge'] {
    --descent-item-radius: var(--radius-sm);
    --descent-row-radius: var(--radius-sm);
    /* THE BOX GOES, THE RULES STAY. `--descent-item-border: 0 none` cascades
       into both `--descent-item-stripe` and `--descent-item-rule` (they default
       to it), so those two re-state what this look keeps: a hairline UNDER every
       item, and the accent stripe BESIDE it. */
    --descent-item-border: 0 none;
    --descent-item-bg: transparent;
    --descent-item-shadow: none;
    /* THE LEFT-BORDER ACCENT STRIPE. `--jp-accent-mark`, NOT `--jp-accent-edge`:
       the edge token is a 45%-ember mix at `accent: glow` and `--jp-line` at
       two more values, i.e. below the 3:1 graphic floor a stripe that CARRIES
       the tell has to clear. accent-mark is a real colour at every accent value
       and measures 6.04 dark / 14.62 light (the table on `.descent`). Read
       directly, with no mix carried onto it (A37). */
    --descent-item-stripe: var(--border-width-thick) solid var(--jp-accent-mark);
    --descent-item-rule: var(--border-width) solid var(--color-border-subtle);
    /* So the stripe still reads on hover: `border-color` paints all four sides,
       and only the inline-start side has any width here. */
    --descent-item-hover-edge: var(--jp-accent-mark);
    --descent-item-hover-bg: var(--color-surface-secondary);
    --descent-chip-radius: var(--radius-sm);
    --descent-label-font: var(--font-mono);
    --descent-num-font: var(--font-mono);
    --descent-num-style: normal;
    /* The disc becomes a ruled CELL with an accent tab — no longer filled with
       accent, which is the half of the tell stated in opposition. It keeps an
       opaque surface because the spine passes behind it. */
    --descent-node-radius: var(--radius-sm);
    --descent-node-bg: var(--color-surface);
    --descent-node-ring: var(--border-width) solid var(--color-border);
    --descent-node-shadow: none;
    /* A hairline under the section head, so the block reads as a table with a
       header row. */
    --descent-head-rule: var(--border-width);
    --descent-head-gap: calc(var(--jp-sec-gap) / 3);
    --descent-foot-rule: var(--border-width) solid var(--color-border-subtle);
  }

  .descent[data-accent='edge'] .descent__node {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  /* THE SECOND AXIS OF THE GRID. Vertical hairlines between the columns, with
     the last one dropped so the table does not draw its own right-hand box —
     "hairline on everything" is about the grid, not about a frame. */
  .descent[data-accent='edge'] .descent__table th,
  .descent[data-accent='edge'] .descent__table td {
    border-inline-end: var(--border-width) solid var(--color-border-subtle);
  }

  .descent[data-accent='edge'] .descent__table th:last-child,
  .descent[data-accent='edge'] .descent__table td:last-child {
    border-inline-end: 0;
  }

  /* The practice pool becomes the ruled list too. Left as a wrapping flex row
     it would put two stripes side by side and the hairlines would not line up
     into a grid; one column makes the rules continuous.

     `gap: 0` so consecutive rules abut, and the padding moves onto the row —
     compounded rather than declared on the bare `.descent__card` selector,
     which `journey-design.test.ts`'s F4 model reads verbatim. */
  .descent[data-accent='edge'] .descent__practices {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }

  .descent[data-accent='edge'] .descent__card {
    padding: calc(var(--space-2) * var(--jp-rhythm))
      calc(var(--space-3) * var(--jp-rhythm));
  }

  .descent[data-accent='edge'] .descent__rows {
    gap: 0;
  }

  /* MONO TABULAR FIGURES, as at `plain-facts` — the one figure the role
     property cannot reach plus the counts. */
  .descent[data-accent='edge'] .descent__stat b,
  .descent[data-accent='edge'] .descent__row-count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* `type: restrained` is `syllabus`'s type value and nobody else's, so the
     dense-dashboard reading rhythm lands here: normal rather than relaxed
     leading — "many small steps, fine-grained hierarchy", 0.75× rhythm. */
  .descent[data-type='restrained'] .descent__gloss,
  .descent[data-type='restrained'] .descent__cell-gloss,
  .descent[data-type='restrained'] .descent__para-gloss {
    line-height: var(--leading-normal);
  }

  /* ── SURFACE: BARE — the two looks whose families forbid boxes ───────────
     `quiet-studio` ("three type sizes, ONE hairline, no accent colour, and more
     empty space than content") and `long-read` ("hairline horizontal rules
     only, no box borders anywhere") are the only two `surface: bare` looks, and
     these are the removals they share. Candlelit is `surface: media`.

     MEASURED ON THE BASE: the section drew a full hairline box around every
     practice card, stage row, stage card and timeline panel, a bordered pill
     around each stat chip, and a ringed disc per gate — because the item border
     is FLOORED at `max(--jp-edge-width, --border-width)` and both looks are
     `edge: hairline`, so the floor is not even the active term. That is "boxes
     everywhere" on the two looks defined by their absence.

     THE SPINE GOES WITH THE DISC, and that pairing is mechanical rather than
     aesthetic. `.descent__spine` sits at `z-index: 0` behind `.descent__stages`,
     and the disc is what occludes it: un-fill the disc without hiding the spine
     and a 2px ink line runs straight through the numeral. At `accent: none`
     `--jp-accent-mark` resolves to `--jp-heading`, so the spine there is not
     merely visible but the highest-contrast graphic in the section — a
     full-height near-black stripe on the quietest look in the family. Hiding it
     is one declaration and the numerals still carry the sequence; the markup
     stays mounted, so the scroll driver and the enhancement gate are untouched. */
  .descent[data-surface='bare'] {
    --descent-item-border: 0 none;
    --descent-item-bg: transparent;
    --descent-item-shadow: none;
    --descent-item-hover-bg: transparent;
    --descent-item-hover-edge: transparent;
    --descent-chip-border: 0 none;
    --descent-chip-bg: transparent;
    --descent-chip-pad: 0px;
    --descent-chip-radius: var(--radius-none);
    --descent-node-bg: transparent;
    --descent-node-ring: 0 none;
    --descent-node-shadow: none;
  }

  .descent[data-surface='bare'] .descent__spine {
    display: none;
  }

  /* One column, and no inline inset: with no box to sit inside, a padded card
     just breaks the left edge its own copy should share. */
  .descent[data-surface='bare'] .descent__practices {
    display: grid;
    grid-template-columns: 1fr;
  }

  .descent[data-surface='bare'] .descent__card,
  .descent[data-surface='bare'] .descent__row,
  .descent[data-surface='bare'] .descent__stagecard,
  .descent[data-surface='bare'] .descent__panel {
    padding-inline: 0;
  }

  /* The chips lose their pill, so they need real space between them or "3
     stages 12 practices" reads as one phrase. */
  .descent[data-surface='bare'] .descent__stats {
    gap: calc(var(--space-6) * var(--jp-rhythm));
  }

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `align: start` ──────
     Tell: the eyebrow and the body share a left edge, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY. `long-read` has no axis value of its own:
     `surface: bare` is shared with `quiet-studio` and `align: start` with
     `plain-facts`, `syllabus` and `signal` — but `quiet-studio` is
     `align: center` and none of the other three is `surface: bare`, so the PAIR
     is `long-read` alone. Candlelit is `surface: media`, so it matches neither
     half, let alone both.

     MEASURED ON THE BASE: the shared left edge already holds, and by the axis
     rather than by luck — `align: start` sets `--jp-measure-margin: 0px`, and
     the eyebrow, heading, sub, gloss and prose list all sit on it. The HEAD
     HAIRLINE was found nowhere in the section. */
  .descent[data-surface='bare'][data-align='start'] {
    --descent-head-rule: var(--border-width);
    --descent-head-gap: calc(var(--jp-sec-gap) / 3);
    /* HAIRLINE HORIZONTAL RULES ONLY: the box is already gone (above), and what
       replaces it is one rule per item rather than nothing at all, so a list of
       practices still reads as a list. */
    --descent-item-rule: var(--border-width) solid var(--color-border-subtle);
    --descent-item-radius: var(--radius-none);
    --descent-row-radius: var(--radius-none);
    --descent-foot-rule: var(--border-width) solid var(--color-border-subtle);
    /* THE HOVER MUST NOT ERASE THE RULE IT JUST DREW. `surface: bare` sets the
       hover edge to `transparent` — correct for `quiet-studio`, which has no
       item boundary at all, and a live defect here: `border-color` paints all
       four sides, so pointing at a practice row would have made its own
       hairline disappear. It darkens one rung instead, which is also the
       family's whole hover vocabulary. */
    --descent-item-hover-edge: var(--color-border);
  }

  /* Flush, so consecutive rules read as a ruled column and not as a dashed
     one. Compounded, never on the bare selectors — see the F4 note above. */
  .descent[data-surface='bare'][data-align='start'] .descent__practices,
  .descent[data-surface='bare'][data-align='start'] .descent__rows {
    gap: 0;
  }

  .descent[data-surface='bare'][data-align='start'] .descent__card,
  .descent[data-surface='bare'][data-align='start'] .descent__row {
    padding-block: calc(var(--space-3) * var(--jp-rhythm));
  }

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
        · `motion: fade` ────────────────────────────────────────────────────
     Tell: three type sizes, ONE hairline, no accent colour, and more empty
     space than content.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so every rule below REMOVES
     something. The boxes went with `surface: bare`; what is left is the
     arithmetic.

     NO ACCENT COLOUR is already true of the colour LADDER and was worth
     checking rather than assuming: at `accent: none` `--jp-accent-mark` resolves
     to `--jp-heading`, so `--descent-signal` carries no hue at all. What it does
     carry is maximum contrast, which is wrong for the DECORATIVE uses — the
     content-type glyph on every practice card was painting at heading strength.
     A glyph beside a label it does not add to is furniture, so it demotes.

     ONE HAIRLINE, as an arithmetic claim rather than an adjective, because that
     is the only form of it that can be checked. After the removals the section
     draws exactly one rule outside the `table` composition — the closing note's
     — and a table's own row rules stay, because there they are the data
     structure and not decoration. */
  .descent[data-accent='none'] {
    /* Letter-spaced small caps, the family's own label treatment, through the
       shared eyebrow seam rather than a local override.

       THE SEAM ONLY WORKS IF NOTHING LOCAL OUT-SPECIFIES IT, which is how the
       first draft of this rule died: the three-sizes collapse below also set
       `letter-spacing` on `.descent__eyebrow`, at (0,3,0) against the shared
       atom's (0,1,0), so the atom never read this property and the declaration
       was inert — present, plausible, and doing nothing. The eyebrow is out of
       that group now. It needs nothing from it anyway: `--jp-eyebrow-size` is
       already `--text-sm` at this look's `type: monumental`, i.e. the metadata
       rung, so only the WEIGHT is a fourth level by another means. */
    --jp-eyebrow-tracking: var(--tracking-widest);
    /* The numerals join the METADATA rung rather than sitting between the
       metadata and the copy. A roman numeral here labels a stage; it is not a
       display figure, and at `--text-lg` it was a fourth size all by itself —
       the one rung that made the arithmetic below false. Small, tracked and
       still serif-italic is also this family's own treatment of a marginal
       number. */
    --descent-num-size: var(--text-sm);
    --descent-node-num-size: var(--text-sm);
  }

  .descent[data-accent='none'] .descent__eyebrow {
    font-weight: var(--font-normal);
  }

  .descent[data-accent='none'] .descent__card-type :global(.descent__card-glyph),
  .descent[data-accent='none'] .descent__inc-item :global(.descent__card-glyph) {
    color: var(--color-text-secondary);
  }

  /* THREE TYPE SIZES ON THE WHOLE SECTION. The base draws seven: eyebrow, stat
     chip, sub, stage name, gloss, card type and card title. Collapsing the four
     metadata rungs onto `--text-sm` and the three copy rungs onto
     `--jp-body-size` leaves exactly `--text-sm` · `--jp-body-size` ·
     `--jp-heading-size` (14 / 24 / 48px at this look's `type: monumental`).

     Weight and tracking travel with the size, because "three sizes" is a
     HIERARCHY claim and a semibold label at the same size as a normal one is a
     fourth level by another means.

     Keyed on `density: vast`, which is quiet-studio's and nobody else's — a bare
     `type: monumental` rule here is the precise shape that would have restyled
     candlelit.

     `.descent__eyebrow` is deliberately absent: it already sits on `--text-sm`
     through `--jp-eyebrow-size`, and listing it here would out-specify the
     shared atom's tracking seam — see the note above. */
  .descent[data-density='vast'] .descent__stat,
  .descent[data-density='vast'] .descent__card-type,
  .descent[data-density='vast'] .descent__row-count {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    letter-spacing: var(--tracking-widest);
  }

  .descent[data-density='vast'] .descent__sub,
  .descent[data-density='vast'] .descent__gloss,
  .descent[data-density='vast'] .descent__card-title,
  .descent[data-density='vast'] .descent__para-gloss,
  .descent[data-density='vast'] .descent__para-list,
  .descent[data-density='vast'] .descent__foot {
    font-size: var(--jp-body-size);
  }

  /* THE TABLE COMPOSITION IS PART OF THE CLAIM, not an exception to it. Its
     cells sit at `--text-base`, its column heads at `--text-xs` and its row
     header at `max(--text-base, --jp-body-size / 1.2)` — three more rungs, on
     the one composition a "three type sizes" look is most likely to be judged
     by. They fold onto the same two. */
  .descent[data-density='vast'] .descent__table th,
  .descent[data-density='vast'] .descent__table td {
    font-size: var(--text-sm);
  }

  .descent[data-density='vast'] .descent__cell-name {
    font-size: var(--jp-body-size);
  }

  /* The stage name folds onto the copy rung rather than adding a fourth size.
     It keeps its own family and colour, so the outline is still legible — by
     weight, family and the space around it, which is how this family builds
     hierarchy. */
  .descent[data-density='vast'] .descent__gate-name,
  .descent[data-density='vast'] .descent__row-name,
  .descent[data-density='vast'] .descent__stagecard-name,
  .descent[data-density='vast'] .descent__panel-name,
  .descent[data-density='vast'] .descent__para-name {
    font-size: var(--jp-body-size);
  }

  /* MORE EMPTY SPACE THAN CONTENT, on a doubling of the section's own rhythm
     rather than three arbitrary values. `--jp-rhythm` is already 1.6 at `vast`
     and still multiplies the org's `--brand-density-scale` through
     `--space-unit`, so this compounds with both rather than replacing them. */
  .descent[data-density='vast'] .descent__head {
    margin-block-end: calc(var(--space-12) * var(--jp-rhythm) * 2);
  }

  .descent[data-density='vast'] .descent__stages {
    gap: calc(var(--space-12) * var(--jp-rhythm) * 2);
  }

  .descent[data-density='vast'] .descent__practices,
  .descent[data-density='vast'] .descent__rows {
    gap: calc(var(--space-6) * var(--jp-rhythm));
  }

  .descent[data-density='vast'] .descent__footwrap {
    margin-top: calc(var(--space-12) * var(--jp-rhythm) * 2);
  }

  /* "SLOW FADE ONLY. NO TRANSFORM." `motion: fade` already zeroes
     `--jp-reveal-distance`, so the shared reveal is a pure opacity ramp — but
     the descent's own armed state scales the gate node to 0.94, which is a
     transform the axis cannot reach. It goes.

     `.descent--enhanced` is carried in the selector deliberately: the armed rule
     is (0,4,0) and so is `.descent[data-motion='fade'] … .descent__node`, so
     without it this would tie and win only on source order. */
  .descent[data-motion='fade'].descent--enhanced
    .descent__band:not(.is-lit)
    .descent__node {
    transform: none;
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ───────────────────────
     Tell: no border ANYWHERE, pill controls, and a shadow you have to look for.

     Keyed ONLY on `edge: soft`. This look shares four axes with candlelit
     (`align: center`, `density: airy`, `width: text`, `motion: drift`) and a
     bare rule on any of them would restyle the one preset that works;
     `edge: soft` is open-air's and nobody else's, and candlelit is `edge: none`.

     MEASURED ON THE BASE: the pills are genuinely there — the stat chip is
     already `--radius-full`. "No border anywhere" was not, and the cause is this
     file's own FLOOR: the four item selectors read
     `max(var(--jp-edge-width), var(--border-width))`, and `edge: soft` sets the
     axis width to `0px` precisely so that "elevation, no border" stays
     reachable. The floor overrode the axis's one value for a borderless
     material and drew a hairline on every card. The comment defending that
     floor is right about `edge: none` dissolving a boundary silently and wrong
     about this look, which asks for it by name — and the boundary is not lost,
     it becomes the shadow. */
  .descent[data-edge='soft'] {
    --descent-item-border: 0 none;
    /* THE SHADOW YOU HAVE TO LOOK FOR. `--jp-edge-shadow` is `--shadow-lg` at
       this value: a 10%/5%-alpha, 14px-blur drop — "large, very diffuse, very
       low opacity" — and it is already this section's item shadow, so the only
       change needed is that it is no longer competing with a hairline. */
    --descent-item-radius: var(--radius-xl);
    --descent-row-radius: var(--radius-xl);
    --descent-item-hover-bg: color-mix(
      in oklab,
      var(--jp-accent-mark) 6%,
      var(--color-surface)
    );
    --descent-item-hover-edge: transparent;
    /* Pill controls with no border, and the diffuse drop instead. */
    --descent-chip-border: 0 none;
    --descent-chip-shadow: var(--jp-edge-shadow);
    --descent-chip-pad: var(--space-2) var(--space-4);
    /* The disc keeps its organic radial fill and loses its ring; the drop is
       what makes it sit above the page. */
    --descent-node-ring: 0 none;
    --descent-node-shadow: var(--jp-edge-shadow);
    /* No border anywhere includes the table's row rules. The rows separate by
       tint and rhythm instead — see below. */
    --descent-rule: 0 none;
    --descent-foot-rule: 0 none;
  }

  /* "Accent as a TINTED BACKGROUND + accent text. NEVER a hard fill." With the
     rules gone the table needs banding, and this is the family's own way to
     spend accent. The 8% mix sits on `--jp-accent-mark`, a real colour at every
     accent value, so it is not A37's mix-of-a-mix — `--jp-accent-edge` would
     have been exactly that. */
  .descent[data-edge='soft'] .descent__table tbody tr:nth-child(odd) {
    background: color-mix(in oklab, var(--jp-accent-mark) 8%, transparent);
  }

  /* Rhythm is the other half of the separation once the rules are gone. */
  .descent[data-edge='soft'] .descent__table th,
  .descent[data-edge='soft'] .descent__table td {
    padding: calc(var(--space-4) * var(--jp-rhythm));
  }

  /* The closing note keeps its air but loses its rule, per "no border
     anywhere". Removing the rule without keeping the space would have pulled
     the note up against the stages. */
  .descent[data-edge='soft'] .descent__foot {
    padding-top: 0;
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` · `motion: stagger` ───────
     Tell: whole inverted bands, pill CTAs at `--radius-full`, spring easing,
     and BIG NUMERALS.

     MEASURED ON THE BASE: the inverted band already arrives — `surface: invert`
     re-points `--jp-ink` at the other pole and `.descent` paints `--jp-sec-bg`,
     so the whole section flips, and `--color-surface*` re-derive with it through
     `journey-palette.css`. Big numerals were found NOWHERE: this section is full
     of figures — two stat counts, a roman numeral per stage, a practice count
     per row, a count column — and every one of them sat at `--text-lg` or
     smaller, which made the loudest family in the set the quietest thing on the
     page. Spring easing was reachable but invisible: `--jp-reveal-ease` is
     `--ease-spring` here and the reveal rides it, but a reveal fires once and
     the one place a viewer can FEEL a curve is the thing they are pointing at.

     The disc numeral is deliberately NOT enlarged — see the note on
     `--descent-node-num-size` for the box it would have to fit through. */
  .descent[data-edge='heavy'] {
    /* Pills at `--radius-full` on the furniture that is pill-shaped (the
       one-line row, the chips), and the family's soft panel corner on the rest. */
    --descent-row-radius: var(--radius-full);
    --descent-item-radius: var(--radius-xl);
    --descent-chip-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --descent-chip-pad: var(--space-3) var(--space-5);
    /* BIG NUMERALS, one step and a weight up: `--text-2xl` rather than the full
       `--jp-heading-size`, because `.descent__row-rn` also renders inside a
       table cell, where a 40px glyph sets the height of every row. */
    --descent-num-size: var(--text-2xl);
    --descent-num-weight: var(--font-semibold);
    --descent-num-style: normal;
    --descent-node-ring: var(--jp-edge-width) solid var(--jp-edge-color);
  }

  /* The stat chip becomes a stat BLOCK, with the figure as the loud half.
     `column`, never `column-reverse`: the visual order then still matches the
     DOM order, so the figure reads before its unit either way. */
  .descent[data-edge='heavy'] .descent__stat {
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
  }

  .descent[data-edge='heavy'] .descent__stat b {
    font-size: var(--jp-heading-size);
    line-height: var(--leading-none);
    font-variant-numeric: tabular-nums;
  }

  /* SPRING EASING, MADE VISIBLE. The overshoot only ever GROWS the item, and it
     is a lift rather than a scale on the numerals' own box, so nothing crosses
     contract A2's 44px floor in either direction.

     The transition is declared ONLY on the three items that have none: the
     practice card already carries one from `.descent--enhanced` (and only ever
     renders under `spine`), and re-declaring it here at higher specificity would
     drop `opacity` from that list and make the ignition fade instant. */
  .descent[data-motion='stagger'] .descent__row,
  .descent[data-motion='stagger'] .descent__stagecard,
  .descent[data-motion='stagger'] .descent__panel {
    transition: transform var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  .descent[data-motion='stagger'] .descent__card:hover,
  .descent[data-motion='stagger'] .descent__row:hover,
  .descent[data-motion='stagger'] .descent__stagecard:hover,
  .descent[data-motion='stagger'] .descent__panel:hover {
    transform: translateY(calc(var(--space-1) * -1));
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small NEUTRAL shadow; one filled
     accent button per section.

     ANOTHER COMPOUND BY NECESSITY. `signal` shares all nine of its axis values:
     `edge: hairline` is also `quiet-studio`, `long-read` and `syllabus`, and
     `accent: fill` is also `plain-facts` and `full-send` — but those two are
     `edge: offset` and `edge: heavy`, and the three other hairline looks are
     `accent: none` / `text` / `edge`. So the PAIR is `signal` alone, and
     candlelit (`edge: none`, `accent: glow`) matches neither half.

     MEASURED ON THE BASE, and this is the honest finding: the first half of the
     tell ALREADY HOLDS and needs nothing. The items read `--radius-card`,
     `--jp-edge-width` (a hairline here) and `--jp-edge-shadow`, which is
     `--shadow-xs` at this edge — a 1px, 10%-alpha drop, i.e. the small NEUTRAL
     shadow the tell names rather than a coloured one. This file never had the
     "vanishing card" defect.

     What was missing is the FILL. `accent: fill` resolves `--jp-accent-fill` to
     `--jp-ember` and `--jp-accent-on-fill` to `--jp-on-ember` — the pinned
     contrast PAIR — and this section spent neither, so the one family whose
     signature is a single confident accent object had no accent object at all.
     The gate node is the section's one badge, so it takes the fill and its
     numeral reverses out of it. The pair is used TOGETHER, which is the whole
     point of there being two tokens; `--jp-on-ember`'s own AA behaviour is
     modelled and pinned in `journey-design.test.ts`.

     Set as properties, not as paint: the armed pre-lit state out-specifies a
     per-look rule at equal specificity, so a direct repaint here would have
     silently disabled the ignition. See the role table for the arithmetic. */
  .descent[data-edge='hairline'][data-accent='fill'] {
    --descent-node-bg: var(--jp-accent-fill);
    --descent-node-ring: 0 none;
    --descent-node-ink: var(--jp-accent-on-fill);
    --descent-node-shadow: var(--jp-edge-shadow);
    /* THE TELL HAS TO REACH THE HEADER TOO. The stat chips were the one piece of
       furniture in the section that opted out of the card recipe: a `--radius-full`
       pill with a `--color-border-subtle` hairline and NO elevation, i.e. neither
       "rounded card" nor "small neutral shadow". A pill is the playful and
       soft-organic families' chip; this one is a small card, so it takes the
       section's own edge and the same `--shadow-xs`. */
    --descent-chip-radius: var(--radius-card);
    --descent-chip-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --descent-chip-shadow: var(--jp-edge-shadow);
    /* A crisper hover than the shared 45% mix — "medium contrast, one confident
       accent". `--jp-accent-mark` (6.04 dark / 14.62 light) rather than
       `--jp-accent-fill`, which is `--jp-ember` and measures 2.04:1 dark: a
       boundary owes 3:1 even when it only appears on hover.

       Spent through the hover ROLES rather than as a new rule on purpose. The
       practice card's only transition comes from `.descent--enhanced`, whose
       list is `opacity, transform, border-color, background`; a per-look
       transition at (0,4,0) would replace that list and make the ignition fade
       instant. Staying inside the two properties that list already carries means
       the hover animates and the choreography is untouched. */
    --descent-item-hover-edge: var(--jp-accent-mark);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REDUCED MOTION

     `journey-sections-shared.css` stops keyframe ANIMATIONS under `.jp-sec` and
     `journey-design.css` zeroes `--jp-reveal-distance`; this block stops the
     TRANSITIONS this section owns. `.descent--enhanced` is never applied under
     reduced motion anyway (the class is gated in JS) — these rules are the
     belt-and-braces for a preference that flips mid-transition.
     ═══════════════════════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .descent__spine-draw,
    .descent__node,
    .descent__rn,
    .descent__gate-meta,
    .descent__card,
    .descent__item {
      transition: none;
    }
    .descent__spine-draw::after {
      display: none;
    }

    /*
      THE ONE HOVER TRANSFORM THE DESIGN-LANGUAGE PASS ADDED, undone.

      A media query adds NO specificity, so the `transition: none` above —
      (0,1,0) on `.descent__item`, which every row / stage card / panel carries —
      does not reach `full-send`'s (0,3,0) rules. Both halves have to be
      restated at or above that specificity, and both are: the transition that
      would carry the lift, and the lift itself.

      Listed explicitly rather than behind a wildcard so the next look that adds
      a hover transform has to come here and say so. `journey-sections-shared.css`
      kills keyframes under `.jp-sec` with `!important`; a transform driven by a
      TRANSITION outside a keyframe is the one thing that guard cannot see.
    */
    .descent[data-motion='stagger'] .descent__row,
    .descent[data-motion='stagger'] .descent__stagecard,
    .descent[data-motion='stagger'] .descent__panel {
      transition: none;
    }

    .descent[data-motion='stagger'] .descent__card:hover,
    .descent[data-motion='stagger'] .descent__row:hover,
    .descent[data-motion='stagger'] .descent__stagecard:hover,
    .descent[data-motion='stagger'] .descent__panel:hover {
      transform: none;
    }
  }
</style>
