<!--
  @component IntroVideoSection

  The sell film (SPEC §4.1 `introVideo`, §10). The heading/sub render immediately
  (SEO-critical); the play affordance is STREAMED — it fills in when the public
  30s `preview.m3u8` resolves (HARDENING §E: NO `canView` on the shell, public
  preview, no auth). While the preview promise is pending we show a poster
  skeleton; a resolution failure `.catch()`-es to null and the section degrades to
  just its copy. Playback reuses `ui/IntroVideoModal` (HLS.js).

  ── THE AXES THIS SECTION CONSUMES: ALL NINE ───────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion` `media`.

  `media` is REAL here, not a documented N/A. Research §2.2 names five types
  where it is meaningful, and there is a MACHINE-CHECKED source for that list:
  `components/page-builder/design-vocabulary.ts:320` declares
  `MEDIA_AWARE_SECTION_TYPES = ['hero', 'introVideo', 'reel', 'guide', 'proof']`,
  and `design-vocabulary.test.ts:156` asserts the design panel offers the `media`
  control on exactly those five. Cite the constant as well as the prose — it is
  the thing that fails if someone later disagrees. (Its JSDoc also explains the
  one non-obvious entry: `proof` is there for its avatars.)

  This section is one of the five: its whole lower half is a media box, so all
  six of the axis's properties (`--jp-media-aspect` / `-radius` / `-inset` /
  `-scrim` / `-mask` / `-display`) have a genuine consumer. Contrast `map`, which
  wired eight and was right to (contract A50).

  NOTE what "N/A on the other six" does and does not mean. The panel HIDES the
  control there; it does not drop the value. A stored `media` override on a `faq`
  still resolves and still emits its `data-jp-media` attribute — there is simply
  nothing in that component consuming it. "Not worth a creator's attention", not
  "inert in the cascade".

  COLOUR STAYS `--color-*` (contract A11); the one exception is the
  `--jp-accent-*` family, which is the axis system's deliberate colour role.

  ── THE ASPECT ↔ SCRIM COUPLING, AND THE RULE THIS SECTION SETS ────────────
  `media: bleed` is the ONLY value that ships a scrim, and its 21:9 aspect and
  62% gradient stop are tuned together (research §2.3). So:

   1. TEXT MAY ONLY SIT ON THE MEDIA WHEN THE AXIS SHIPS A SCRIM. `overlay`
      below derives that from `design.media`, and at every other value the meta
      row drops BELOW the frame rather than floating over unprotected imagery.
      Research §5.1 states the floor as "any composition placing text over media
      uses `bleed`, not `frame`" — but `media` is a creator-facing axis, so the
      composition cannot simply demand `bleed`. It has to degrade instead.

   2. THE ASPECT IS NEVER OVERRIDDEN PER BREAKPOINT; IT IS FLOORED. A second
      `aspect-ratio` at a narrow container is what decouples the pair — the box
      gets shorter while the scrim keeps a proportion tuned for a taller one.
      `min-height` only ever makes the box TALLER, which moves the 62% stop
      further above the text, so it is the safe direction by construction. The
      floor is derived from `--jp-body-size`, the rung that sizes the text it
      protects, so it tracks the `type` axis instead of pinning a raw px.

  Every other media-bearing type inherits both halves. `ReelSection` is the
  second implementation and the reason the rule exists: it shipped
  `aspect-ratio: 4 / 3` at 760px and `3 / 3.4` at 420px against a fixed-62%
  scrim, which is exactly the decoupling (1).

  ── FIVE COMPOSITIONS ──────────────────────────────────────────────────────
  `theatre` (default) · `plain` · `split` · `bleed` · `card`. `theatre` is the
  retired `cinema`; `plain` is the retired `simple` (LEGACY_SECTION_VARIANTS
  already maps both). `bleed` and `card` are new (research §3). All five port
  their arrangement from the since-deleted canvas partial
  `render-edit/journey-sections/_video.css` (contract A12).

  COMPOSITIONS CARRY ARRANGEMENT, NEVER TYPE SCALE — scale is the `type` axis's
  job. The `<h2>` is `--jp-heading-size` via `.jp-sec__heading--sub`, never
  `--jp-display` (contract A36). Verified against the base commit as A55
  requires: `.intro__heading` shipped `var(--text-4xl)`, and at `type:
  monumental` `--jp-heading-size` IS `--text-4xl` — 48px → 48px, zero delta. This
  is NOT the `invite` exception, which shipped `--text-display`.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): the copy and a fully-composed
    play-frame paint immediately — every layer visible, nothing hidden behind JS.
  • ENHANCED (browser + motion OK): copy + frame arrive on the `motion` axis's
    timing via the shared `reveal` action, a key-light aura breathes behind the
    play button, and two pulse rings ripple outward. All continuous motion stops
    under `prefers-reduced-motion` (research §5.1) — stopped, not sped up.

  ── THE LOOK PASS: NINE AXES WIRED IS NOT EIGHT DESIGN LANGUAGES ───────────
  Wiring the axes (A9 stage 1) made the section reach 8 preset points. It did
  not make each point RECOGNISABLE as its research family, because a family is
  identified by a TELL — a falsifiable signature — and a token read only carries
  the tells the token happens to encode. Measured across the page-builder CSS
  and all eleven sections before this pass: Cinematic's three tells appear 27–28×
  each, while `plain-facts`'s "hard offset shadow" and "radius 0", `long-read`'s
  "hairline under every section head" and `full-send`'s "big numerals" appeared
  ZERO times. That density gap — not a missing axis — is why seven of the eight
  looks read as permutations.

  So the block at the end of this stylesheet is organised BY TELL, and every
  rule in it is keyed on the axis value(s) that identify the look it serves.
  Cinematic (`candlelit`) is the one look that already worked and is the one
  look this pass must not move, so every selector was checked against the four
  axis values that identify it UNIQUELY — `surface: media` · `edge: none` ·
  `media: bleed` · `accent: glow` — and against the five it SHARES:
  `type: monumental` (also quiet-studio, plain-facts), `align: center` (also
  quiet-studio, open-air, full-send), `density: airy` (also open-air),
  `width: text` (also long-read, open-air), `motion: drift` (also open-air).
  A bare rule on one of those five would restyle Candlelit; each rule below is
  either keyed on a value Candlelit does not hold, or compounded until it is.

  ── WHY THIS COMPONENT MIRRORS THE AXES ONTO ITS OWN ROOT ──────────────────
  `journey-design.css` states the constraint: "a section's own `<style>` is
  Svelte-scoped and cannot reach an ancestor attribute, so sections can only
  ever READ these properties." Reading a property is enough for everything the
  axis expresses as a VALUE — a size, a gap, a colour, an aspect. It is not
  enough for what a design language actually needs, which is a STRUCTURAL
  decision: "on a bare surface this section's edge is a single rule, not a box",
  "at radius 0 there is no rounded corner anywhere", "continuous decoration
  belongs only to the two continuous-motion values". Those cannot be a token.
  `ReelSection.svelte:679` set the precedent with `data-reel-align`; `axis`
  below is the same seam, widened to the seven values this section's tells need.
-->
<script lang="ts">
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import SectionSkeleton from '../SectionSkeleton.svelte';
  import { aliasKeys, asString, asStringFrom } from '../coerce';
  import * as m from '$paraglide/messages';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type {
    IntroVideoSectionProps,
    JourneySalesContext,
    SellPreview,
  } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * `clip` and `duration` are not on `IntroVideoSectionProps` in
   * `render/types.ts`, which is shared across the component worktrees; declared
   * locally, exactly as `AcheSection` declares `AcheCopy` and `FaqSection` its
   * `group` row. Consolidation should absorb them.
   */
  interface IntroVideoCopy extends IntroVideoSectionProps {
    clip?: string;
    duration?: string;
  }

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    /**
     * Read for ONE decision each, both of which are genuinely markup rather than
     * CSS: whether text may sit on the media (`media`), and whether the play
     * button has a fill to paint with (`accent`). A section's scoped stylesheet
     * cannot reach an ancestor `data-jp-*` attribute, which is what
     * `SectionRenderer` passes this prop for. Every other axis lands in CSS.
     *
     * NOTE the wording: a second literal opening-style-tag spelling anywhere in a
     * component — prose, JSDoc or CSS comment — makes `vitePreprocess` pair the
     * wrong opener with the real closing tag and hand postcss a stylesheet
     * beginning mid-sentence. The error points at line 1 of the EXTRACTED css,
     * nowhere near the cause. One spelling per file, and it has to be the real one.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
    /**
     * The course title, and ONLY when this section is the one the page has let
     * claim it (`SectionComponentProps.titleFallback`). Five sections fell back to
     * `context.course.title` independently, so a page with the hero filled and the
     * section headings blank served the same sentence as its `<h1>` and four of
     * its `<h2>`s.
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

  const p: IntroVideoCopy = $derived({
    // Bridged through the alias table (`coerce.ts` declares
    // `introVideo: { eyebrow: ['eyebrow', 'kicker'] }`). The loss this closes is
    // live and measured: the golden page stores `kicker: "The film"` and the
    // served HTML contained no eyebrow element at all. Part of `Codex-tqr51`.
    eyebrow: asStringFrom(config, aliasKeys('introVideo', 'eyebrow')),
    heading: asStringFrom(config, aliasKeys('introVideo', 'heading')),
    sub: asStringFrom(config, aliasKeys('introVideo', 'sub')),
    posterUrl: asString(config, 'posterUrl'),
    /**
     * `OWED_READS.introVideo` (contract A28), both entries.
     *
     * `clip` is the on-frame label the canvas has always drawn
     * (`_video.css` `.jp-video__tag`) and the public frame never had. The golden
     * page stores a real authored value for it — a person typed
     * "THIS IS NOT WHAT YOU EXPECTED" into the builder and it rendered as
     * nothing.
     *
     * `duration` is the advisory badge. It takes precedence over the computed
     * value, per the `authored ?? derived` precedence every other prop in this
     * tree uses and contract A42 made `proof` conform to. A creator who wants the
     * real clip length clears the field.
     */
    clip: asString(config, 'clip'),
    duration: asString(config, 'duration'),
  });

  /**
   * NO HARDCODED EDITORIAL VOICE (`Codex-i9pzs`). This used to fall back to
   * "Ninety seconds inside the work." — one brand's copy, which every other org's
   * page then published. It falls back to the creator's OWN words instead, the
   * same fix `HeroSection` uses for its headline and `InviteSection` for its
   * heading, and self-hides when there is nothing to say. Deliberately NOT an
   * i18n key: a key holding one brand's editorial voice has not fixed this, it
   * has moved it.
   *
   * `titleFallback`, NOT `context.course.title`. The course title is still the
   * fallback — but the page decides WHICH section gets to use it, because five
   * sections making that call independently is what printed it five times. When
   * this section is not the claimant the heading resolves undefined and the `<h2>`
   * self-hides, which it already guarded for.
   */
  const heading = $derived(p.heading ?? titleFallback);

  let open = $state(false);

  const COMPOSITIONS = ['theatre', 'plain', 'split', 'bleed', 'card'];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'theatre'
  );

  /**
   * Viewfinder brackets are `theatre`'s own chrome — research §3 describes
   * `bleed` as "no frame, no brackets" and `plain` as a "bare player". String
   * discriminant, not a boolean: `apps/web` has `strictNullChecks` OFF, so a
   * boolean-literal discriminant does not narrow.
   */
  const brackets = $derived(composition === 'theatre' ? 'yes' : 'no');

  /**
   * WHERE THE META ROW SITS — the aspect↔scrim rule, half one.
   *
   * `--jp-media-scrim` is `none` at `frame`, `mask`, `inset` and `none`; only
   * `bleed` ships a gradient. Text over an un-scrimmed poster has no contrast
   * guarantee at all (it is arbitrary imagery), so at those four values the tag
   * and duration move out of the frame and sit beneath it as a plain meta row.
   *
   * `card` always keeps its meta below the frame — research §3 defines it as
   * "stacked title/duration/access rows" beneath the player, so the arrangement
   * is the composition's, not the axis's.
   */
  const overlay = $derived(
    composition !== 'card' && design?.media === 'bleed' ? 'over' : 'below'
  );

  /**
   * WHETHER THE PLAY BUTTON HAS A FILL TO PAINT WITH.
   *
   * `--jp-accent-fill` is `transparent` at `accent: text` and `accent: edge`
   * (`journey-design.css`), which is the same trap the WT-3 pilot hit on the
   * hero's decorative marks — except this is a FUNCTIONAL control, where an
   * invisible result is worse than a missing decoration. `--jp-accent-mark` is
   * the documented answer for a mark, but a play button needs an ink colour that
   * is correct for whatever it is sitting on, so the two states are drawn
   * separately and the axis is read here rather than guessed at in CSS.
   */
  const plate = $derived(
    design?.accent === 'text' || design?.accent === 'edge' ? 'hollow' : 'solid'
  );

  /**
   * `media: none` emits `--jp-media-display: none` (research §2.3). It is honoured
   * in markup rather than as `display: var(--jp-media-display)` because the media
   * box needs `display: grid` to centre the play button, and one property cannot
   * be both the axis's switch and the composition's layout mode.
   */
  const showMedia = $derived(design?.media === 'none' ? 'no' : 'yes');

  /**
   * THE NINE AXES, MIRRORED ONTO THIS COMPONENT'S ROOT. Read the header note for
   * why a token read cannot carry a structural decision; this is the seam.
   *
   * The fallbacks are `SECTION_DESIGN_DEFAULTS` verbatim (contract A21:
   * width `text` · density `regular` · surface `bare` · edge `hairline` · align
   * `center` · type `balanced` · accent `fill` · motion `rise` · media `frame`),
   * so a caller that omits `design` renders what `resolveDesign` — which is total
   * and can never emit an empty axis — would have produced anyway. `width` and
   * `media` are absent because nothing below needs them as a SELECTOR: `width` is
   * fully expressed by `--jp-content-max` / `--jp-measure`, and `media` already
   * has two markup consumers of its own (`overlay`, `showMedia`).
   */
  const axis = $derived({
    surface: design?.surface ?? 'bare',
    edge: design?.edge ?? 'hairline',
    align: design?.align ?? 'center',
    type: design?.type ?? 'balanced',
    density: design?.density ?? 'regular',
    accent: design?.accent ?? 'fill',
    motion: design?.motion ?? 'rise',
  });

  /**
   * WHETHER THIS SECTION HAS ANYTHING TO SAY, independently of whether it has
   * anything to play. Nine of the eleven sections already self-hide on empty data
   * (`TurnSection` renders only if `statement || lede`); this one did not, and it
   * is one of the two whose subject is media it may not have.
   */
  const hasCopy = $derived(Boolean(p.eyebrow || heading || p.sub));

  /**
   * WHETHER THERE IS ANYTHING TO PUT IN THE FRAME — a real clip, or an authored
   * poster still.
   *
   * Before this the frame rendered unconditionally: the 16:9 `.iv__media` box with
   * its atmosphere layers, its scrim and (on `theatre`) four viewfinder brackets,
   * and with no intro clip its only content was `<div class="iv__empty">` — a
   * decorative empty letterbox under the course's own title. `posterUrl` is
   * authored and usually absent, so there was not even a still behind it. A
   * journey page carrying this section for a course with no `introVideoMediaId`
   * published what reads as a broken player.
   */
  const hasStage = (preview: SellPreview | null | undefined) =>
    Boolean(preview?.intro) || Boolean(p.posterUrl);

  /** Advisory duration → a compact `M:SS` badge. Never fabricates a value. */
  function formatDuration(seconds: number | null | undefined): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * THE PLAY BUTTON'S NAME, DERIVED FROM THE BADGE IT SITS BESIDE (`Codex-3tmt1`).
   *
   * The badge and the aria-label read the same field through DIFFERENT precedence
   * rules, ten lines apart: the badge honoured the AUTHORED `duration` string, the
   * label ignored it and always emitted raw seconds. The shipped test fixtures
   * demonstrate it — `duration: '1:00'` with `durationSeconds: 90` rendered a
   * "1:00" badge on a button announcing "Play the 90-second intro film". Both
   * halves now come from ONE resolved `durationLabel`, so they cannot disagree.
   *
   * AND THE FABRICATED NUMBER IS GONE. The label was `Math.round(intro.durationSeconds ?? 90)`:
   * an unprobed clip (`durationSeconds: null`) made the button announce a
   * "90-second" film while the badge correctly rendered nothing, because
   * `formatDuration` returns null for non-finite input. No duration ⇒ a
   * duration-free name, never an invented one.
   *
   * The upstream number is separately wrong and is NOT fixed here: `toClip`
   * reports `mediaItems.durationSeconds` — the SOURCE asset's runtime — on a clip
   * built from `hlsPreviewKey`, which is a fixed 30-second preview, so a
   * 30-minute intro yields `durationSeconds: 1800`. That is
   * `packages/access/src/services/course-journey-service.ts`, outside this tree.
   */
  const playAria = (durationLabel: string | null): string =>
    durationLabel
      ? m.journey_intro_play_aria_labelled({ duration: durationLabel })
      : m.journey_intro_play();

  /**
   * The props key an inline edit must write BACK to: the one the displayed value
   * was actually READ from, never the renderer's own prop name (contract A60).
   *
   * The alias lists are ordered preference lists, so a page storing `kicker` (the
   * golden page's `introVideo` does) would, if an edit wrote `eyebrow`, end up
   * holding BOTH — and `eyebrow` wins, so the creator's edit would render as
   * nothing while the data silently grew a second copy.
   */
  const readKey = (keys: readonly string[], fallback: string): string => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim() !== '') return key;
    }
    return fallback;
  };

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
    editFieldAttrs('introVideo', key, editable, onEdit);
</script>

<!--
  `media: none` REMOVES THE PLATE, NOT THE FILM.

  The axis is honoured exactly as `showMedia` states it: no media box, no
  atmosphere, no poster, no scrim, no aspect. What was ALSO happening is that a
  section whose entire subject is the sell film had no way to reach the film on
  that one value — and `media: none` is `plain-facts`'s value, so a creator
  picking the Brutalist look got a heading, a paragraph, and no way to watch
  anything. The film was not suppressed by a design decision; it was
  unreachable as a side effect of one.

  This is `HeroSection`'s A75 decision applied one level in: "the three
  compositions without a plate OFFER the film instead of showing it … the
  author's intent to feature a video becomes an invitation rather than being
  silently dropped." A75 keeps the hero's affordance behind `!mediaOff` because
  a hero's film is an embellishment beside its headline and CTAs, so dropping it
  costs the hero nothing structural. Here it is the section's whole reason to
  exist, and the Brutalist family's own image treatment is "None, or unframed
  and full-bleed" — i.e. that family expresses a film as a hard-edged filled
  BLOCK, which is exactly its `accent: fill` tell ("solid rectangles of it, text
  reversed out"). So the invitation IS the look, not a workaround for it.

  Bounded deliberately: it renders only where there is no plate AND a real clip
  resolved, it never appears beside the frame, and it lives inside `.iv__lead`
  so `split` and `card` keep their two-column grids intact and the `align` axis
  places it. It reuses the EXISTING `journey_intro_play` key — the one the
  frame's `aria-label` already spends — so no new English enters the tree.

  This is a contract-level question rather than a component one, because the
  same reasoning applies to `ReelSection`; it is raised in the handoff. Reverting
  it is deleting this snippet's render call above.
-->
{#snippet watch()}
  {#if showMedia === 'no'}
    {#await context.sellPreview then preview}
      {#if preview?.intro}
        {@const intro = preview.intro}
        {@const durationLabel = p.duration ?? formatDuration(intro.durationSeconds)}
        <button
          type="button"
          class="iv__watch jp-reveal"
          data-jp-step="3"
          data-iv-plate={plate}
          onclick={() => (open = true)}
        >
          <span class="iv__watch-icon" aria-hidden="true">
            <PlayIcon />
          </span>
          <span class="iv__watch-label">{m.journey_intro_play()}</span>
          {#if durationLabel}
            <!-- Same resolved `durationLabel` the badge and the frame's
                 aria-label spend, so the three cannot disagree (Codex-3tmt1).
                 It is inside the button, so it is part of the accessible name
                 rather than a second unnamed chip. -->
            <span class="iv__watch-time">{durationLabel}</span>
          {/if}
        </button>

        <IntroVideoModal
          {open}
          src={intro.playlistUrl}
          title={heading}
          onclose={() => (open = false)}
        />
      {/if}
    {/await}
  {/if}
{/snippet}

{#snippet lead()}
  <div class="iv__lead">
    {#if p.eyebrow}
      <p
        class="jp-sec__eyebrow iv__eyebrow jp-reveal"
        {...editAttrs(readKey(aliasKeys('introVideo', 'eyebrow'), 'kicker'))}
      >
        {p.eyebrow}
      </p>
    {/if}
    {#if heading}
      <h2
        class="jp-sec__heading jp-sec__heading--sub iv__heading jp-reveal"
        data-jp-step="1"
        {...editAttrs(readKey(['heading'], 'heading'))}
      >
        {heading}
      </h2>
    {/if}
    {#if p.sub}
      <p
        class="jp-sec__measure iv__sub jp-reveal"
        data-jp-step="2"
        {...editAttrs(readKey(aliasKeys('introVideo', 'sub'), 'sub'))}
      >
        {p.sub}
      </p>
    {/if}
    {@render watch()}
  </div>
{/snippet}

<!--
  The tag + duration pair. Rendered in ONE place and positioned by the
  `overlay` derivation, so the two placements can never drift apart — over the
  media only where a scrim exists, beneath it otherwise.
-->
{#snippet meta(durationLabel: string | null)}
  {#if p.clip || durationLabel}
    <div class="iv__meta" data-iv-meta={overlay}>
      {#if p.clip}
        <span
          class="iv__tag"
          {...editAttrs(readKey(['clip'], 'clip'))}>{p.clip}</span>
      {/if}
      {#if durationLabel}
        <span class="iv__duration">
          <span class="iv__duration-dot" aria-hidden="true"></span>
          {durationLabel}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

<!--
  THE FRAME, AND IT NO LONGER RENDERS WITHOUT SOMETHING IN IT.

  `preview` + `pending` arrive as arguments rather than being awaited in here: the
  CALLER decides whether the frame exists at all, which is the only place that
  decision can be made (a snippet cannot un-render its own wrapper). `pending` is
  its own argument rather than `preview === null`, because "not resolved yet" and
  "resolved to nothing" now have OPPOSITE renderings — a skeleton and no frame.
-->
{#snippet stage(preview: SellPreview | null, pending: boolean)}
  <div class="iv__stage">
    <div class="iv__media">
      <!--
        The atmosphere layer. ONE `--jp-sec-atmos` gate on this shared parent
        rather than per layer (pilot lesson 3): the aura's opacity is ANIMATED,
        and a keyframe beats a `calc()` on the same element, so gating each layer
        individually would leave the glow breathing at `surface: bare`. On the
        parent the two compose multiplicatively.
      -->
      <div class="iv__atmos" aria-hidden="true">
        <div class="iv__aura"></div>
        <div class="iv__vignette"></div>
        <div class="iv__sheen"></div>
      </div>

      {#if p.posterUrl}
        <!--
          A real poster sits ABOVE the atmosphere and outside its gate — it is
          content, not decoration, so `surface: bare` must not erase it. The URL
          reaches a custom property rather than an `src`, so it is escaped with
          `JSON.stringify` and additionally guarded by `url()`'s own quoting.
        -->
        <div
          class="iv__image"
          aria-hidden="true"
          style="--iv-poster: url({JSON.stringify(p.posterUrl)})"
        ></div>
      {/if}

      {#if brackets === 'yes'}
        <span class="iv__corner iv__corner--tl" aria-hidden="true"></span>
        <span class="iv__corner iv__corner--tr" aria-hidden="true"></span>
        <span class="iv__corner iv__corner--bl" aria-hidden="true"></span>
        <span class="iv__corner iv__corner--br" aria-hidden="true"></span>
      {/if}

      <!--
        The scrim. `background: var(--jp-media-scrim)` and NOTHING else in the
        declaration — the token resolves to the keyword `none` on four of five
        media values, and `none` cannot be one item of a larger value. Composing
        it (`background: var(--jp-media-scrim), var(--color-surface)`) would be
        invalid at computed-value time and evaporate, which is contract A54's
        mechanism reaching a second token family.
      -->
      <span class="iv__scrim" aria-hidden="true"></span>

      {#if pending}
        <SectionSkeleton shape="media" label={m.journey_intro_skeleton_label()} />
      {:else if preview?.intro}
        {@const intro = preview.intro}
        {@const durationLabel = p.duration ?? formatDuration(intro.durationSeconds)}
        <div class="iv__controls">
          <span class="iv__pulse" aria-hidden="true"></span>
          <span class="iv__pulse iv__pulse--2" aria-hidden="true"></span>
          <button
            type="button"
            class="iv__play"
            data-iv-plate={plate}
            onclick={() => (open = true)}
            aria-label={playAria(durationLabel)}
          >
            <span class="iv__play-icon" aria-hidden="true">
              <PlayIcon />
            </span>
          </button>
        </div>

        {#if overlay === 'over'}
          {@render meta(durationLabel)}
        {/if}

        <IntroVideoModal
          {open}
          src={intro.playlistUrl}
          title={heading}
          onclose={() => (open = false)}
        />
      {/if}
      <!--
        NO `iv__empty` BRANCH. A resolved preview with no intro clip used to draw a
        full-height decorative void here; the frame itself is now conditional on
        the caller, so this state cannot be reached with an empty box.
      -->
    </div>

    <!--
      Beneath the frame. Reads the SAME resolved preview the frame did, so the two
      placements cannot disagree; keeping the meta inside the media box for `over`
      is what makes the scrim protect it.
    -->
    {#if overlay === 'below' && !pending}
      {@render meta(p.duration ?? formatDuration(preview?.intro?.durationSeconds))}
    {/if}
  </div>
{/snippet}

<!--
  THE MEDIA HALF'S GATE, in one place for all three compositions.

  `media: none` is honoured first (`showMedia`) — the axis, then the fact. While
  the promise is PENDING the frame renders with its skeleton, which is an honest
  loading affordance with a `role="status"` label; the moment it resolves with
  neither a clip nor an authored poster the frame is gone rather than empty.
-->
{#snippet mediaStage()}
  {#if showMedia === 'yes'}
    {#await context.sellPreview}
      {@render stage(null, true)}
    {:then preview}
      {#if hasStage(preview)}
        {@render stage(preview, false)}
      {/if}
    {:catch}
      <!-- A failed media read is not a reason to draw an empty player. An
           authored poster is still real content, so it survives. -->
      {#if p.posterUrl}
        {@render stage(null, false)}
      {/if}
    {/await}
  {/if}
{/snippet}

{#snippet shell()}
  <div
    class="iv"
    data-iv-composition={composition}
    data-iv-overlay={overlay}
    data-iv-surface={axis.surface}
    data-iv-edge={axis.edge}
    data-iv-align={axis.align}
    data-iv-type={axis.type}
    data-iv-density={axis.density}
    data-iv-accent={axis.accent}
    data-iv-motion={axis.motion}
  >
    <div class="iv__inner" use:reveal={{ disabled: editable }}>
      {#if composition === 'split'}
        <div class="iv__split">
          {@render lead()}
          {@render mediaStage()}
        </div>
      {:else if composition === 'card'}
        <div class="iv__card">
          {@render lead()}
          {@render mediaStage()}
        </div>
      {:else}
        {@render lead()}
        {@render mediaStage()}
      {/if}
    </div>
  </div>
{/snippet}

<!--
  SELF-HIDE, THE WAY NINE OF THE ELEVEN SECTIONS ALREADY DO (`AcheSection`,
  `TurnSection`, `FeelSection`, `ProofSection`, `GuideSection`, `FaqSection`,
  `MapSection` all render only when they have something to show). This section and
  `reel` were the two that did not, and they are the two whose subject is media
  they may not have.

  THE COPY BRANCH IS NOT INSIDE THE `{#await}`, DELIBERATELY. The heading and sub
  are SEO-critical and this component's contract is that they paint immediately;
  putting them inside an await branch would also destroy and re-create them when
  the promise resolves, which re-runs `use:reveal` and makes the copy flash out and
  back in. So when there IS copy the shell renders synchronously and only the media
  waits. The await wrapper is reached only when there is NO copy — where there is
  nothing to flicker and nothing to index, and the section's whole existence
  depends on whether a clip turned up.
-->
{#if hasCopy}
  {@render shell()}
{:else if showMedia === 'yes'}
  {#await context.sellPreview then preview}
    {#if hasStage(preview)}
      {@render shell()}
    {/if}
  {/await}
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX — every value an axis read.

     `--jp-sec-pad-block` / `-pad-inline` / `-gap` are the shared role aliases
     from `journey-design.css`. They contain `6cqw`, so they MUST be consumed on
     a DESCENDANT of `.jp-sec` — an element is not its own query container, and
     reading them on the wrapper resolves the `cqw` against the page rather than
     the section (pilot lesson 1). `.iv` is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .iv {
    position: relative;
    isolation: isolate;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);
  }

  .iv__inner {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: var(--jp-sec-gap);
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* `bleed` takes the media edge-to-edge, so the CAP moves off the wrapper and
     onto the copy — "full width" describes the surface, never the text. */
  [data-iv-composition='bleed'] .iv__inner {
    max-width: none;
  }
  [data-iv-composition='bleed'] .iv__lead {
    max-width: var(--jp-content-max);
    margin-inline: var(--jp-measure-margin);
  }

  .iv__lead {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: calc(var(--jp-sec-gap) * 0.5);
    width: 100%;
  }

  .iv__sub {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ── THE MEDIA BOX ─────────────────────────────────────────────────────
     `aspect-ratio` sets the SHAPE from the axis; `min-height` floors the SIZE.
     Never a second `aspect-ratio` at a breakpoint — see the coupling note in the
     component header. `aspect-ratio` plus a definite cross-size is a blowout
     rather than a constraint (pilot lesson 7), so the inline size is the
     definite one and `min-height` is only ever a minimum. */
  .iv__stage {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: calc(var(--jp-sec-gap) * 0.5);
  }

  .iv__media {
    position: relative;
    isolation: isolate;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: var(--jp-media-aspect);
    padding: var(--jp-media-inset);
    border-radius: var(--jp-media-radius);
    clip-path: var(--jp-media-mask);
    overflow: hidden;
    background: var(--color-surface);
  }

  /* THE ASPECT FLOOR — half two of the coupling rule, and it applies ONLY where
     text actually sits on the media.

     Solved backwards from the 280px floor `ReelSection` shipped at its narrow
     breakpoint, against `--jp-body-size`'s `monumental` rung (24px) — the same
     backwards-solve the pilot used for its `80svh`. Expressed against that rung
     rather than as a raw px so the floor tracks the `type` axis: smaller text
     needs a shorter box to clear the scrim's stop.

     Scoped to `overlay='over'` deliberately. A `frame` player carries no text and
     needs no floor, and applying one anyway would turn a 16:9 player into a
     1.2:1 box at 375px — distorting the aspect in the name of protecting text
     that is not there. */
  [data-iv-overlay='over'] .iv__media {
    min-height: calc(var(--jp-body-size) * 11.5);
  }

  /* `theatre`'s framed-footage chrome. This is the COMPOSITION's hairline, not
     the `edge` axis — `edge` describes the SECTION's border and elevation, and
     it is already consumed on `.iv` above. A composition whose whole identity is
     "framed" cannot have its frame deleted by a section-level edge value. */
  [data-iv-composition='theatre'] .iv__media,
  [data-iv-composition='card'] .iv__media {
    border: var(--border-width) solid
      color-mix(in oklab, var(--jp-accent-mark) 24%, transparent);
  }

  .iv__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    /* The 0/1 gate. `surface: media` unlocks the cinematic layer; every other
       surface resolves the whole stack to zero opacity, markup still mounted. */
    opacity: var(--jp-sec-atmos);
  }

  .iv__atmos > * {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* Soft central key-light — the warmth falling on the seated figure. */
  .iv__aura {
    inset: auto;
    left: 50%;
    top: 46%;
    translate: -50% -50%;
    width: min(64cqw, 35rem);
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    opacity: 0.82;
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 46%,
      color-mix(in oklab, var(--jp-accent-mark) 42%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 16%, transparent) 46%,
      transparent 70%
    );
    /* Derived from the `motion` axis rather than a literal `9s`, so `drift`
       breathes slowly and `none` is genuinely still. */
    animation: iv-breathe calc(var(--jp-reveal-duration) * 11)
      var(--ease-in-out) infinite;
  }

  @keyframes iv-breathe {
    0%,
    100% {
      opacity: 0.66;
      scale: 1;
    }
    50% {
      opacity: 0.9;
      scale: 1.07;
    }
  }

  /* Deep vignette — seats the warm centre in shadow, cinematic edge fall-off. */
  .iv__vignette {
    background: radial-gradient(
      86% 82% at 50% 45%,
      transparent 44%,
      color-mix(in oklab, var(--color-background) 58%, transparent) 100%
    );
  }

  /* Top catch-light sheen. */
  .iv__sheen {
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 9%, transparent),
      transparent 22%
    );
  }

  /* THE POSTER HONOURS `--jp-media-inset`, which it previously ignored.
     `inset: 0` pinned the still to the BOX, so at `media: inset` — the axis
     value whose entire description is "inset with an enormous margin" — the
     `var(--space-12)` padding the axis emits changed nothing that paints: the
     grid's `place-items: center` re-centred the play button inside the same
     visual rectangle and the poster covered the padding. The mat existed in the
     box model and nowhere on screen.

     Every other `media` value emits `0px` here, so this is byte-identical at
     `bleed` (Candlelit), `frame`, `mask` and — trivially — `none`. `inset` is
     `quiet-studio`'s value and the only one that moves, which is the point:
     Luxury-minimal's image treatment is a matted print, and now the mat is
     real, painted by the box's own `--color-surface`. */
  .iv__image {
    position: absolute;
    inset: var(--jp-media-inset);
    z-index: 1;
    pointer-events: none;
    background: var(--iv-poster, none) center / cover no-repeat;
  }

  /* THE SCRIM — the whole value of its own property, nothing composed in. */
  .iv__scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: var(--jp-media-scrim);
  }

  /* ── theatre's viewfinder corners ── */
  .iv__corner {
    position: absolute;
    z-index: 3;
    width: clamp(1rem, 2.2cqw, 1.6rem);
    height: clamp(1rem, 2.2cqw, 1.6rem);
    border: 0 solid color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
    pointer-events: none;
  }

  .iv__corner--tl {
    top: var(--space-4);
    left: var(--space-4);
    border-top-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }
  .iv__corner--tr {
    top: var(--space-4);
    right: var(--space-4);
    border-top-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
  }
  .iv__corner--bl {
    bottom: var(--space-4);
    left: var(--space-4);
    border-bottom-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }
  .iv__corner--br {
    bottom: var(--space-4);
    right: var(--space-4);
    border-bottom-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
  }

  .iv__controls {
    position: relative;
    z-index: 4;
    display: grid;
    place-items: center;
  }

  .iv__controls > * {
    grid-area: 1 / 1;
  }

  .iv__play {
    position: relative;
    z-index: 1;
    display: inline-grid;
    place-items: center;
    /* WCAG 2.5.5 measures the POINTER target, i.e. the border box (contract
       A61). `--tap-target-min` is `max(2.75rem, var(--space-11))`, so density
       may only ever make it larger. */
    width: max(var(--tap-target-min), var(--space-16));
    height: max(var(--tap-target-min), var(--space-16));
    border-radius: var(--radius-full);
    cursor: pointer;
    /* `--jp-accent-glow` is `none` at four of five accent values, so it is the
       WHOLE value here — never one item of a shadow list (contract A54's
       mechanism, which is about the keyword rather than the token family). */
    box-shadow: var(--jp-accent-glow);
    /* THE EASING IS THE `motion` AXIS'S, THE DURATION IS THE CONTROL'S.
       `--ease-smooth` was a literal, so the hover felt identical under all five
       motion values — including `stagger`, whose whole tell is spring easing.
       `--jp-reveal-ease` at `drift` IS `var(--ease-smooth)`, so Candlelit is
       byte-identical here; `stagger` gets `--ease-spring` (full-send's tell),
       `rise`/`fade` get `--ease-out`, `none` gets `linear` and is additionally
       made instant below. The DURATION stays literal on purpose: at `drift`
       `--jp-reveal-duration` is 800ms, and an 800ms hover lift on a control is
       an axis value leaking into an interaction it does not describe. */
    transition:
      transform var(--duration-slow) var(--jp-reveal-ease),
      background-color var(--duration-fast) var(--ease-default);
  }

  .iv__play[data-iv-plate='solid'] {
    border: none;
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* `accent: text` and `accent: edge` resolve `--jp-accent-fill` to
     `transparent`, so the solid plate would be an invisible control. The hollow
     state carries the affordance on a full-strength `--jp-accent-mark` ring —
     never a faint mix, because no alpha low enough to read as faint clears 3:1
     at the dark pole (contract A39). */
  .iv__play[data-iv-plate='hollow'] {
    border: var(--border-width-thick) solid var(--jp-accent-mark);
    color: var(--jp-accent-mark);
    background: color-mix(in oklab, var(--color-background) 55%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
  }

  /* Two breathing pulse rings — the ember, waiting to be watched. */
  .iv__pulse {
    z-index: 0;
    width: max(var(--tap-target-min), var(--space-16));
    height: max(var(--tap-target-min), var(--space-16));
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
    pointer-events: none;
    animation: iv-pulse calc(var(--jp-reveal-duration) * 4) var(--ease-out)
      infinite;
  }

  .iv__pulse--2 {
    animation-delay: calc(var(--jp-reveal-duration) * 2);
  }

  @keyframes iv-pulse {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    100% {
      transform: scale(1.9);
      opacity: 0;
    }
  }

  .iv__play:hover {
    transform: translateY(calc(var(--space-1) * -0.5)) scale(1.05);
  }

  /* `edge: none` and `edge: soft` remove borders; they must NEVER remove a focus
     ring (research §5.1). The ring is on `outline`, which no `edge` value
     touches. */
  .iv__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .iv__play-icon {
    display: inline-flex;
    width: var(--space-6);
    height: var(--space-6);
    /* Optical centring: a play triangle's visual centre of mass sits left of its
       bounding box. Expressed on the token scale rather than the old raw `3px`. */
    margin-left: calc(var(--space-1) * 0.75);
  }

  /* ── THE META ROW — tag + duration, one markup, two placements ────────── */
  .iv__meta {
    display: flex;
    align-items: center;
    /* `duration` is a free-text builder field, so it can hold anything — the
       golden page stores a 33-character sentence in it. Wrapping degrades that
       gracefully; truncating would hide a creator's own copy, which is the class
       of defect this round exists to close. Reported as a field-shape issue. */
    flex-wrap: wrap;
    gap: var(--space-3);
    /* `--jp-body-size` is the `type` axis's card-scale rung (contract A44), and
       this row is metadata one step below it. Derived FROM the rung, never
       re-spelled and never taken from `--jp-heading-size`. Floored at
       `--text-xs`, which research §5.1 permits for metadata only. */
    font-size: max(var(--text-xs), calc(var(--jp-body-size) / 1.4));
  }

  /* OVER the media: only reachable at `media: bleed`, which is the only value
     shipping a scrim.

     THE BLOCK CARRIES ITS OWN COPY OF THE SCRIM. `--jp-media-scrim` is a
     gradient over the MEDIA box, so its opaque end is a fixed fraction of a box
     whose height varies — and a text block that grows (this row WRAPS, because
     `duration` is free text) climbs out of the opaque zone and onto the raw
     poster. Measured before this rule: the tag's worst backdrop pixel was
     `rgb(85,46,142)` — `--jp-ember` itself, from the aura behind it — at
     **2.16:1** on `of-blood-and-bones` light.

     Reading the same token on the text block's OWN box makes the guarantee
     travel with the text: however tall the block grows, its gradient grows with
     it, and `padding-block-start` is the fade lead-in so the glyphs sit in the
     opaque lower part rather than in the transition. */
  .iv__meta[data-iv-meta='over'] {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    bottom: 0;
    padding: calc(var(--jp-sec-gap) * 1.2) var(--space-4) var(--space-4);
    justify-content: space-between;
    pointer-events: none;
    background: var(--jp-media-scrim);
  }

  /* BELOW the media: no scrim, so no text on the picture. */
  .iv__meta[data-iv-meta='below'] {
    justify-content: var(--jp-align);
    gap: var(--space-4);
    color: var(--color-text-secondary);
  }

  .iv__tag {
    text-transform: uppercase;
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .iv__meta[data-iv-meta='over'] .iv__tag {
    color: var(--color-heading);
  }

  .iv__duration {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wide);
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
  }

  /* Both over-media chips carry their own plate, at an alpha high enough to
     MEASURE rather than one that merely looks like glass.

     `--jp-media-scrim` is bottom-anchored (`to top`), so it protects
     bottom-anchored text and NOTHING at the top of the box — `ReelSection`'s rec
     tag sits up there and is unscrimmed by construction, whatever the aspect.
     A plate is the only guarantee available to it, and contract A39's lesson
     applies to the plate too: 55% measured 4.85:1 here and 2.69:1 on the reel's
     un-plated tag, so the alpha is 88%, which measures against the plate rather
     than against whatever the poster happens to be. */
  .iv__meta[data-iv-meta='over'] .iv__tag,
  .iv__meta[data-iv-meta='over'] .iv__duration {
    padding-block: var(--space-1);
    padding-inline: var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    background: color-mix(in oklab, var(--color-background) 88%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
  }

  .iv__duration-dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    /* `--jp-accent-mark`, never `--jp-accent-fill`: the fill is `transparent` at
       two of five accent values and this is a 6px decorative dot (pilot 4). */
    background: var(--jp-accent-mark);
  }

  /* `.iv__empty` and the `.section-skeleton` size cap that used to sit here are
     both GONE.

     The cap existed only to work around `SectionSkeleton`'s hardcoded
     `aspect-ratio: 16 / 9`, which disagreed with the box at every value of the
     `media` axis but two — its own comment said so and said it could not fix the
     shared primitive from this worktree. `SectionSkeleton` now resolves
     `var(--jp-media-aspect)`, which it INHERITS from the `.jp-sec` wrapper, so the
     shimmer is the same shape as the box it stands in and there is nothing left to
     clamp (`Codex-ae2ea`). `.iv__empty` was the decorative void this section drew
     when the preview resolved with no clip; the frame is now conditional instead. */

  /* ── COMPOSITIONS ──────────────────────────────────────────────────────
     Arrangement only. Ported from the since-deleted `render-edit/journey-sections/_video.css`
     (`.jp-video--split`'s two-column wrap, `.jp-video--simple`'s hidden corners
     and tag). No composition sets a type scale — that is the `type` axis. */

  /* `split` — copy column beside the player. `_video.css` used `1fr 1.1fr`; kept,
     with the breakpoint moved to a CONTAINER query (contract A14). */
  .iv__split {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--jp-sec-gap);
    align-items: center;
    width: 100%;
  }

  @container (min-width: 34rem) {
    .iv__split {
      grid-template-columns: 1fr 1.1fr;
    }
  }

  /* `card` — the player inside a panel with the copy and meta stacked. The plate
     speaks SEMANTIC colour (`--color-surface-secondary`, which
     `.journey-palette--page` re-points onto the `--jp-*` ladder) rather than
     naming a `--jp-ink` rung directly: contract A11 keeps colour on `--color-*`
     in the section tree, with `--jp-accent-*` the single exception. */
  .iv__card {
    display: flex;
    flex-direction: column;
    gap: var(--jp-sec-gap);
    width: 100%;
    padding: var(--jp-sec-gap);
    border-radius: var(--radius-card);
    background: var(--color-surface-secondary);
    /* THE CARD'S EDGE IS THE `edge` AXIS'S, which it was not reading at all —
       so a panel whose entire job is to look like a card looked identical under
       all five values of the axis that describes cards. Each token is the WHOLE
       value of its property (contract A63), never one item of a list.

       Zero delta at `edge: none`, which is Candlelit: `--jp-edge-width` is `0px`
       and `--jp-edge-shadow` is `none`, exactly the unbordered unshadowed card
       that shipped. `hairline` → 1px + `--shadow-xs` (signal's "rounded cards
       with hairlines and a small neutral shadow"); `soft` → no border and
       `--shadow-lg` (open-air's "shadow you have to look for"); `heavy` → 2px in
       the accent (full-send); `offset` → 2px + the hard un-blurred drop, and
       radius 0 from the tell block below (plain-facts). */
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
  }

  [data-iv-composition='card'] .iv__stage {
    order: -1;
  }

  /* ── THE PLATE-LESS INVITATION ─────────────────────────────────────────
     Reached only at `media: none`. Every property here is an axis read, so the
     one control carries whichever look asked for it rather than needing five
     variants: `edge` gives it its border, its elevation and (below) its radius,
     `accent` gives it its fill through the same `plate` discriminant the frame's
     button uses, `type` gives it its label size, `motion` its easing.

     `min-height` is the WCAG 2.5.5 floor on the POINTER target, i.e. the border
     box (contract A61). `--tap-target-min` is `max(2.75rem, var(--space-11))`,
     so an org density below 1 can only ever make it larger (A2). This is the
     same defect A34 found on `CtaLink`, which measured 40–41px against the 44px
     floor because nothing declared one — so it is declared here from the start
     rather than inherited from a padding sum that happens to clear it. */
  .iv__watch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: var(--tap-target-min);
    padding-block: var(--space-3);
    padding-inline: var(--space-5);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-full);
    box-shadow: var(--jp-edge-shadow);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--jp-body-size);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    letter-spacing: var(--tracking-wide);
    text-align: center;
    transition:
      translate var(--duration-slow) var(--jp-reveal-ease),
      background-color var(--duration-fast) var(--ease-default);
  }

  /* The same two states the frame's button draws, for the same reason:
     `--jp-accent-fill` is `transparent` at `accent: text` and `edge`, so one
     solid rule would be an invisible control on two of five values. */
  .iv__watch[data-iv-plate='solid'] {
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  .iv__watch[data-iv-plate='hollow'] {
    color: var(--jp-accent-mark);
    border-color: var(--jp-accent-mark);
    border-width: var(--border-width-thick);
    background: transparent;
  }

  .iv__watch:hover {
    translate: 0 calc(var(--space-1) * -0.5);
  }

  /* `edge: none`/`soft` remove borders; they must NEVER remove a focus ring
     (research §5.1). `outline` is untouched by every `edge` value. */
  .iv__watch:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .iv__watch-icon {
    display: inline-flex;
    width: var(--space-5);
    height: var(--space-5);
    flex: none;
  }

  .iv__watch-time {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE EIGHT LOOKS — ONE BLOCK PER TELL

     Read the component header first: these rules exist because the axes alone
     deliver Cinematic's tells 27–28× and four of the other seven looks' tells
     ZERO times, and a design language is recognised by its tell.

     THE SELECTOR DISCIPLINE, stated once and applied to every rule below.
     Eight looks are built from 38 axis values and 20 of those are SHARED, so a
     bare rule on a shared value restyles every look holding it. Each block
     therefore names which looks it reaches, and Candlelit's five shared values
     (`type: monumental`, `align: center`, `density: airy`, `width: text`,
     `motion: drift`) are never keyed on alone — where one is needed it is
     compounded with a value Candlelit does not hold.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── 1 · `surface: bare` — THE EDGE IS A RULE, NOT A BOX ────────────────
     REACHES: quiet-studio (Luxury-minimal) + long-read (Editorial). Those are
     the only two `bare` looks, and Candlelit is `surface: media`.

     Both families forbid what this section was drawing. Editorial: "Hairline
     horizontal rules only. No box borders anywhere … Shadow/elevation: None."
     Luxury-minimal: "A single hairline, used perhaps twice on the page …
     Shadow/elevation: None." Both are `edge: hairline`, so `.iv` was painting a
     full 1px box plus `--shadow-xs` around a surface that is by definition
     unpainted — `bare` is also the one value that zeroes `--jp-sec-pad-inline`,
     so the box was hugging the page gutter with no inset to sit in.

     The `edge` axis still decides the WEIGHT (`0px` at `none`/`soft`, 1px at
     `hairline`, 2px at `heavy`/`offset`); this decides where it lands. */
  .iv[data-iv-surface='bare'] {
    border-width: var(--jp-edge-width) 0 0;
    box-shadow: none;
  }

  /* ── 2 · `bare` + `align: start` — THE EDITORIAL HAIRLINE ───────────────
     REACHES: long-read ONLY. `bare` is quiet-studio + long-read; adding
     `align: start` excludes quiet-studio (centred), and Candlelit is neither.

     THE TELL, VERBATIM: "the eyebrow and the body share a left edge, and there
     is a hairline under every section head." The left edge already came free
     from the axis — `--jp-align: start` on the lead's `align-items` and
     `--jp-measure-margin: 0px` on `.jp-sec__measure` put the eyebrow, the
     heading and the sub on one line. The hairline did not exist anywhere in the
     tree, which is why the tell measured ZERO.

     `width: 100%` is load-bearing: at `align: start` the heading is a flex item
     under `align-items: start`, so it shrinks to its text and the rule would
     stop mid-sentence instead of spanning the column.

     `--color-border` is the A11 spelling — `journey-palette.css:525` re-points
     it onto `--jp-line`, so it re-derives per section surface. It measures
     1.79:1 light / 1.49:1 dark, which `journey-design.css` documents and accepts
     for a DECORATIVE rule; the boundary itself is carried by the heading and the
     space, never by this line alone. */
  [data-iv-surface='bare'][data-iv-align='start'] .iv__heading {
    width: 100%;
    padding-block-end: calc(var(--jp-sec-gap) * 0.5);
    border-block-end: var(--border-width) solid var(--color-border);
  }

  /* The caption line. Editorial's image treatment is "framed with a visible
     caption line" — and `media: frame` is long-read's value, so the meta row
     is already BELOW the frame (the aspect↔scrim rule). A rule above it is what
     turns a floating tag pair into a caption. */
  [data-iv-surface='bare'][data-iv-align='start']
    .iv__meta[data-iv-meta='below'] {
    width: 100%;
    padding-block-start: calc(var(--jp-sec-gap) * 0.5);
    border-block-start: var(--border-width) solid var(--color-border);
  }

  /* ── 3 · `density: vast` — THE EMPTINESS IS THE DESIGN ──────────────────
     REACHES: quiet-studio ONLY. `vast` is the one density value no other preset
     holds; Candlelit is `airy`.

     THE TELL: "more empty space than content." `--jp-rhythm: 1.6` already
     multiplies the section's padding and gap, but a 1.6× multiplier is not
     conspicuous — it reads as "slightly roomier", and Luxury-minimal's whole
     price signal is that the emptiness is impossible to miss. Doubling the
     inner gap and doubling the lead's internal gap (from `× 0.5` to `× 1`) puts
     the whitespace above the noticing threshold while still deriving every
     value from the axis's own rhythm rather than from a literal. */
  [data-iv-density='vast'] .iv__inner {
    gap: calc(var(--jp-sec-gap) * 2);
  }

  [data-iv-density='vast'] .iv__lead {
    gap: var(--jp-sec-gap);
  }

  /* ── 4 · `accent: none` — THREE TYPE SIZES, NO ACCENT COLOUR ────────────
     REACHES: quiet-studio ONLY. `none` is the one accent value no other preset
     holds; Candlelit is `glow`.

     THE TELL: "three type sizes, one hairline, no accent colour." The section
     shipped FOUR sizes — eyebrow `--text-sm`, heading `--text-4xl`, sub
     `--text-lg`, meta `max(--text-xs, --jp-body-size / 1.4)` ≈ 17px — so the
     count was simply wrong, and the meta's near-but-not-equal 17px against the
     sub's 20px read as an accident rather than a decision. Folding the meta onto
     the body rung makes it exactly three, which is countable and therefore
     falsifiable.

     The dot goes. It is `aria-hidden` decoration and it is a MARK — the one
     thing the family says the accent may never be ("Accent absent. Monochrome
     from the ladder; the accent appears at most as one hairline"). Removing is
     the correct edit on the quiet looks. */
  [data-iv-accent='none'] .iv__meta {
    font-size: var(--text-lg);
  }

  [data-iv-accent='none'] .iv__duration-dot {
    display: none;
  }

  /* ── 5 · `accent: text` — THE ACCENT IS INK, NOT A FILL ─────────────────
     REACHES: long-read (Editorial) + open-air (Soft-organic). Both deploy the
     accent as text — Editorial "as text: kickers, drop-cap, link underline",
     Soft-organic "accent text. Never a hard fill" — and on both the eyebrow IS
     the kicker. Candlelit is `accent: glow`, so it keeps its neutral eyebrow.

     `--jp-accent-text` and not `--jp-accent-fill`: the fill is `transparent` at
     this value, and the text role resolves to `--jp-ember-text`, which exists
     precisely because `--jp-ember` measures 2.98:1 on dark ink and 2.46:1 on
     light (research §0.1 names this the single most likely regression in the
     programme). This is the `--jp-accent-*` exception to A11, which is the one
     place a section may speak colour outside `--color-*`. */
  [data-iv-accent='text'] .iv__eyebrow {
    color: var(--jp-accent-text);
  }

  /* ── 6 · `edge: offset` — RADIUS 0 EVERYWHERE, AND MONO LABELS ──────────
     REACHES: plain-facts (Brutalist) ONLY. `offset` is unique to it; Candlelit
     is `edge: none`.

     THE TELL: "2px borders with a hard un-blurred offset shadow, mono labels,
     and radius 0 everywhere." Two of the three already arrived from the axis —
     `--jp-edge-width: var(--border-width-thick)` and `--jp-edge-shadow:
     var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)`, which `.iv` and
     now `.iv__card` and `.iv__watch` read. The other two measured ZERO in the
     whole tree, and "radius 0 EVERYWHERE" is the kind of tell that is destroyed
     by a single exception: `surface: panel` hands this look `--radius-card` on
     the section, and the controls and chips are `--radius-full` pills.

     So every corner in the component is enumerated. An exception here is not a
     rounding error, it is the tell failing. */
  .iv[data-iv-edge='offset'],
  [data-iv-edge='offset'] .iv__card,
  [data-iv-edge='offset'] .iv__media,
  [data-iv-edge='offset'] .iv__play,
  [data-iv-edge='offset'] .iv__pulse,
  [data-iv-edge='offset'] .iv__watch,
  [data-iv-edge='offset'] .iv__tag,
  [data-iv-edge='offset'] .iv__duration,
  [data-iv-edge='offset'] .iv__duration-dot {
    border-radius: var(--radius-none);
  }

  /* THE TWO OVER-MEDIA CHIPS NEED A SECOND, LONGER SELECTOR, and this was
     MEASURED rather than assumed. Svelte scopes a descendant as
     `:where(.svelte-hash)` — zero specificity — while the ancestor gets a real
     class, so the chip's own pill rule is
     `.iv__meta[data-iv-meta='over'].hash .iv__tag:where(.hash)` at (0,4,0) and
     the rule above is only (0,3,0). It loses, silently, and `--radius-full`
     survives on the one look whose tell is that nothing is rounded.

     Unreachable at the preset (plain-facts is `media: none`, so there is no
     over-media chip), which is exactly why it would have gone unnoticed: it
     needs `edge: offset` with any other `media` value, i.e. a creator mixing the
     Brutalist edge into a look that has a plate. "Radius 0 everywhere" is not a
     rule with exceptions. */
  [data-iv-edge='offset'] .iv__meta[data-iv-meta='over'] .iv__tag,
  [data-iv-edge='offset'] .iv__meta[data-iv-meta='over'] .iv__duration {
    border-radius: var(--radius-none);
  }

  /* "The BODY face at heavy weight, or the MONO face. No separate display
     face." The labels are the mono half — the eyebrow, the on-frame tag and the
     invitation's own label. `--jp-eyebrow-tracking` is the seam
     `journey-sections-shared.css` documents for exactly this ("a section that
     wants it sets `--jp-eyebrow-tracking`"), and mono at `--tracking-wider` is
     already wide, so the tighter step is the legible one. */
  .iv[data-iv-edge='offset'] {
    --jp-eyebrow-tracking: var(--tracking-wide);
  }

  [data-iv-edge='offset'] .iv__eyebrow,
  [data-iv-edge='offset'] .iv__tag,
  [data-iv-edge='offset'] .iv__watch-label,
  [data-iv-edge='offset'] .iv__watch-time {
    font-family: var(--font-mono);
  }

  /* The press. Brutalist motion is not "no state changes", it is "None.
     INSTANT state changes" — so the control moves into its own drop shadow with
     no transition at all, which is the idiom the offset shadow exists to set
     up. `motion: none` is what makes it instant (block 10). */
  [data-iv-edge='offset'] .iv__watch:hover {
    translate: var(--space-1) var(--space-1);
    box-shadow: none;
  }

  /* ── 7 · `accent: edge` — A STRIPE, NOT A BADGE ─────────────────────────
     REACHES: syllabus (Technical) ONLY, for the stripe on the copy column —
     `edge` is unique to it, and it is compounded with `align: start` anyway so
     a deliberate centred override cannot end up with a stripe down one side of
     a centred column. Candlelit is `accent: glow`.

     THE TELL: "hairline grid, mono numerals, and a left-border accent stripe
     rather than a filled badge." All three measured low or zero here: the
     duration was a dot plus proportional numerals, and there was no stripe and
     no grid rule anywhere in the component.

     `--jp-accent-mark` carries the stripe, NOT `--jp-accent-edge`. The edge role
     resolves to `--jp-ember` at this value, which is a FILL token measuring
     2.46:1 light — under the 3:1 graphic floor — and contract A38 settled that
     marks route through the AA-safe `--jp-ember-text` after two components
     measured exactly the 2.04:1 the axis file's own comment predicted. The
     observation that `--jp-accent-edge` cannot carry a graphic is handed off,
     not worked around a second time. */
  [data-iv-accent='edge'][data-iv-align='start'] .iv__lead {
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
    padding-inline-start: var(--jp-sec-gap);
  }

  /* Mono numerals, and the badge replaced by the stripe. `tabular-nums` was
     already here; the mono face and the stripe are what make it read as a
     duration in a syllabus rather than a chip. */
  [data-iv-accent='edge'] .iv__duration {
    font-family: var(--font-mono);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
    padding-inline-start: var(--space-3);
  }

  [data-iv-accent='edge'] .iv__duration-dot {
    display: none;
  }

  /* The grid. One rule between the copy and the plate, which is what makes a
     dense technical section read as a table rather than as a stack. */
  [data-iv-accent='edge'] .iv__stage {
    padding-block-start: var(--jp-sec-gap);
    border-block-start: var(--border-width) solid var(--color-border);
  }

  /* ── 8 · `panel` + `hairline` — THE FRAME'S HAIRLINE IS NEUTRAL ─────────
     REACHES: syllabus + signal. `panel` is plain-facts + syllabus + signal and
     `hairline` is quiet-studio + long-read + syllabus + signal, so the pair is
     exactly those two; Candlelit is `media`/`none` and holds neither.

     Both tells name a NEUTRAL hairline — syllabus "hairline on everything —
     reads as a table", signal "rounded cards with hairlines and a small neutral
     shadow" — and the frame was drawing a 24% mix of the ACCENT instead, which
     on signal put a brand-tinted line around a card whose tell is that the line
     is not brand-tinted. Applied on every composition, not just `theatre`,
     because "hairline on everything" is the point.

     Three attribute selectors out-specify the composition rule above them by
     construction, so this does not depend on source order. */
  [data-iv-surface='panel'][data-iv-edge='hairline'] .iv__media {
    border: var(--border-width) solid var(--color-border);
  }

  /* ── 9 · `panel` + `hairline` + `fill` — SIGNAL'S SMALL NEUTRAL SHADOW ──
     REACHES: signal ONLY. The pair above is syllabus + signal; `accent: fill`
     excludes syllabus (`edge`). Candlelit holds none of the three.

     THE TELL: "rounded cards with hairlines and a SMALL NEUTRAL shadow; ONE
     FILLED ACCENT BUTTON per section." The filled button already arrives —
     `accent: fill` resolves `--jp-accent-fill` to the ember and `plate` picks
     `solid` — and it is the section's only filled control, so the tell's second
     half holds. What was missing was the neutral elevation: `--shadow-sm` on the
     plate and `--shadow-md` under the one button, which is exactly the
     `--shadow-sm`/`--shadow-md` pair the family table names.

     `.iv__play`'s `box-shadow` is `var(--jp-accent-glow)`, which is `none` at
     `fill`, so this replaces nothing — and it stays the WHOLE value of the
     property, never one item of a list (A63). Syllabus keeps `--shadow-xs` from
     its own `edge` value, which its table also names as its ceiling. */
  [data-iv-surface='panel'][data-iv-edge='hairline'][data-iv-accent='fill']
    .iv__media {
    box-shadow: var(--shadow-sm);
  }

  [data-iv-surface='panel'][data-iv-edge='hairline'][data-iv-accent='fill']
    .iv__play {
    box-shadow: var(--shadow-md);
  }

  /* ── 10 · `edge: soft` — NO BORDER ANYWHERE, PILL CONTROLS ──────────────
     REACHES: open-air (Soft-organic) ONLY. `soft` is unique to it.

     OPEN-AIR IS THE DANGEROUS LOOK AND THIS IS WHY THE KEY IS `edge`. It shares
     FOUR axes with Candlelit — `align: center`, `density: airy`, `width: text`,
     `motion: drift` — so it is the one preset where the obvious selector is a
     Candlelit regression. `surface: tint`, `edge: soft` and `accent: text` are
     the three values that separate them, and every open-air rule in this file
     is keyed on one of those.

     THE TELL: "no border anywhere, pill controls, and a shadow you have to look
     for." `.iv` already drops its border (`--jp-edge-width: 0px`) and takes
     `--shadow-lg` — but the media box was still drawing the composition's
     hairline, so the look with "Edge treatment: NONE. No borders at all" was
     shipping a bordered frame. That is the whole tell failing on one selector.

     Ordered after the composition rule deliberately: both are two
     attribute/class steps, so equal specificity makes source order the decider
     here, unlike block 8. */
  [data-iv-edge='soft'] .iv__media {
    border: none;
  }

  /* The hollow plate becomes an opaque soft one. The glassy 55% backdrop was
     unmeasurable by construction — 55% of the background over an arbitrary
     poster has no contrast guarantee at all — and A39's lesson is that no alpha
     low enough to read as faint survives the dark pole. An opaque
     `--color-surface` puts the icon on a KNOWN colour and lets the diffuse
     elevation do the separating, which is what the family asks for. */
  [data-iv-edge='soft'] .iv__play[data-iv-plate='hollow'] {
    background: var(--color-surface);
    box-shadow: var(--jp-edge-shadow);
  }

  /* Pill controls. `media: mask` puts the meta row below the frame, where it had
     no treatment at all; as pills on the section's own surface with a shadow at
     the edge of visibility it reads as the family's control vocabulary. */
  [data-iv-edge='soft'] .iv__meta[data-iv-meta='below'] .iv__tag,
  [data-iv-edge='soft'] .iv__meta[data-iv-meta='below'] .iv__duration {
    padding-block: var(--space-1);
    padding-inline: var(--space-4);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }

  /* ── 11 · `surface: invert` + `edge: heavy` — BIG NUMERALS, PILL CHIPS ──
     REACHES: full-send (Playful) ONLY. Both values are unique to it; Candlelit
     is `surface: media` / `edge: none`.

     THE TELL: "whole inverted bands, pill CTAs at `--radius-full`, spring
     easing, big numerals." The band arrives from `surface: invert` re-pointing
     `--jp-ink` (and `journey-palette.css:517` re-declares the whole ladder on
     `.jp-sec`, so `--color-surface` inside the section re-derives against the
     inverted ink rather than the page's — the media box inverts with the band
     and needs no rule). The pill CTA is the play button at `--radius-full`. The
     spring is now real, from `--jp-reveal-ease` on the control transition.

     "Big numerals" measured ZERO across the tree, and this section owns the only
     numeral on it. `--jp-body-size` is the `type` axis's card rung (A44), so the
     numeral scales with the axis instead of pinning a size — 1.4× of it at
     `expressive` lands a display-weight duration under the frame. */
  [data-iv-surface='invert'] .iv__duration {
    font-size: calc(var(--jp-body-size) * 1.4);
    font-weight: var(--font-bold);
    line-height: var(--leading-none);
  }

  [data-iv-edge='heavy'] .iv__meta[data-iv-meta='below'] .iv__tag,
  [data-iv-edge='heavy'] .iv__meta[data-iv-meta='below'] .iv__duration {
    padding-block: var(--space-2);
    padding-inline: var(--space-4);
    border: var(--border-width-thick) solid var(--jp-edge-color);
    border-radius: var(--radius-full);
  }

  /* ── 12 · `type` — THE AXIS REACHES THE BODY COPY ──────────────────────
     REACHES: long-read + signal (`balanced`), syllabus (`restrained`), open-air
     + full-send (`expressive`). It EXCLUDES every `monumental` look, which is
     how Candlelit is kept byte-identical — and quiet-studio and plain-facts with
     it, since they share that value.

     THE DEFECT THIS FIXES, measured: `.iv__sub` shipped a literal `--text-lg`
     (20px), so at `type: restrained` the heading was `--text-xl` (24px) over a
     20px sub — a 1.2 ratio where the tell is "many small steps, FINE-GRAINED
     hierarchy", and close enough to read as a mistake. The brief's requirement
     is that the `type` axis "visibly change the relationship between eyebrow,
     heading, body and caption, not just font-size", and a literal in the middle
     of that ladder is what prevented it.

     `--jp-body-size` is the card rung: 17 / 17 / 20 / 24px across restrained /
     balanced / expressive / monumental. So restrained becomes 24 over 17,
     balanced 30 over 17, expressive 36 over 20 — three distinct relationships
     where there was one. Monumental keeps the literal, which is the value it
     already had. */
  [data-iv-type='restrained'] .iv__sub,
  [data-iv-type='balanced'] .iv__sub,
  [data-iv-type='expressive'] .iv__sub {
    font-size: var(--jp-body-size);
  }

  /* ── 13 · `motion` — CONTINUOUS DECORATION IS NOT A CONSTANT ────────────
     REACHES: plain-facts + syllabus (`none`), quiet-studio (`fade`), long-read +
     signal (`rise`). Candlelit is `drift` and keeps both rings; full-send is
     `stagger` and keeps them, which is right for Playful.

     THE PRINCIPLE: continuous decorative motion belongs to the two values that
     DESCRIBE continuous motion. Two infinitely expanding rings around the play
     button were unconditional, so "Motion: None. Instant state changes" shipped
     an infinite animation, "Slow fade only. No transform" shipped a repeating
     scale, and "fade + rise with a short stagger" shipped a throb. At
     `motion: none` it was worse than wrong: `--jp-reveal-duration` is `0ms`
     there, so the rings were an infinite zero-duration animation pinned to
     their final keyframe — invisible by accident rather than still by design.

     `display: none` rather than an `{#if}` so SSR markup is unchanged and the
     rings can never flash before the axis resolves. */
  [data-iv-motion='none'] .iv__pulse,
  [data-iv-motion='fade'] .iv__pulse,
  [data-iv-motion='rise'] .iv__pulse {
    display: none;
  }

  /* `motion: none` means INSTANT, not frozen: the two families holding it both
     name instant interaction as the idiom ("Instant state changes",
     "Interactions are instant"). The hover state survives — a control with no
     feedback is a worse outcome than a control with fast feedback — it simply
     stops being animated. */
  [data-iv-motion='none'] .iv__play,
  [data-iv-motion='none'] .iv__watch {
    transition: none;
  }

  /* ── reveal-on-scroll ──
     The shared `.jp-reveal` atom + `data-jp-step` ladder from
     `journey-sections-shared.css` carry the `motion` axis. The hidden state
     applies only under `.reveal--armed`, which the action adds from JS, so SSR
     and no-JS paint the content fully revealed. */

  @media (prefers-reduced-motion: reduce) {
    /* Continuous decorative motion STOPS, it does not speed up (research §5.1).
       The shared block in `journey-sections-shared.css` kills `animation` on
       every `.jp-sec` descendant; these two also need their resting state
       pinned, because a stopped keyframe holds frame 0 rather than the composed
       look. */
    .iv__aura {
      opacity: 0.82;
      scale: 1;
    }
    .iv__pulse {
      opacity: 0;
    }
    .iv__play,
    .iv__watch {
      transition: none;
    }
    .iv__play:hover {
      transform: none;
    }
    /* The invitation's hover, and the Brutalist press with it. Both are
       instantaneous rather than animated, so neither is caught by the shared
       `animation: none !important` block nor by the `transition: none` above —
       a reduced-motion reader still gets a state change, just no travel.

       THE SECOND SELECTOR IS NOT REDUNDANT. A media query adds no specificity,
       so `[data-iv-edge='offset'] .iv__watch:hover` (three steps) would out-rank
       a bare `.iv__watch:hover` (two) and the press would survive here. Matching
       its shape makes them equal, and this block is later in the file. */
    .iv__watch:hover,
    [data-iv-edge='offset'] .iv__watch:hover {
      translate: none;
    }
  }
</style>
