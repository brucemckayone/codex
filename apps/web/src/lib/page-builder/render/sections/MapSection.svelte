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
  <div
    class="descent"
    class:descent--enhanced={enhanced}
    data-map={composition}
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
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    background: var(--color-surface-secondary);
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
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    /* Baseline / lit look — the final warm state. */
    background: radial-gradient(
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
    border: var(--border-width) solid var(--descent-signal);
    /* The ring and the drop bloom are atmosphere and ride the `--jp-sec-atmos`
       gate; the inset highlight is material and does not. */
    box-shadow:
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
  }

  .descent__rn {
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: var(--text-lg);
    color: var(--descent-signal);
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
    border-radius: var(--radius-card);
    background: var(--color-surface-secondary);
    border: max(var(--jp-edge-width), var(--border-width)) solid
      var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
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
    border-color: color-mix(in oklab, var(--descent-bloom) 45%, transparent);
    background: var(--color-surface);
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
    border-radius: var(--radius-md);
  }

  .descent__row-rn {
    flex: none;
    min-width: 2ch;
    font-family: var(--font-heading);
    font-style: italic;
    font-size: var(--text-lg);
    color: var(--descent-signal);
  }

  .descent__row-count {
    margin: 0;
    margin-inline-start: auto;
    flex: none;
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
    border-block-end: var(--border-width) solid var(--color-border-subtle);
    vertical-align: top;
    text-align: start;
    font-size: var(--text-base);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .descent__table thead th {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
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
    margin: 0 var(--jp-measure-margin);
    padding: 0;
    list-style: none;
    text-align: var(--jp-text-align);
  }

  .descent__para-rn {
    font-family: var(--font-heading);
    font-style: italic;
    color: var(--descent-signal);
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
    border-top: var(--border-width) solid
      color-mix(in oklab, var(--descent-bloom) 14%, transparent);
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
  }
</style>
