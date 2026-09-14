<!--
  @component ReelSection

  A cinematic practice-preview clip that sits just before the descent map (SPEC
  §4.1 `reel`). Deliberately NOT the intro film: an ultrawide letterbox with an
  editorial split header, a "framed footage" chrome (viewfinder corners, a rec
  tag, a waveform scrubber), and a candlelit poster that breathes.

  ── THE AXES THIS SECTION CONSUMES: ALL NINE ───────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion` `media`.

  `media` is REAL here, and this section is where the axis is most load-bearing,
  because its text sits ON the media. The media-bearing five are named in research
  §2.2 and, machine-checked, in
  `components/page-builder/design-vocabulary.ts:320` —
  `MEDIA_AWARE_SECTION_TYPES = ['hero', 'introVideo', 'reel', 'guide', 'proof']`,
  pinned by `design-vocabulary.test.ts:156`. On the other six the panel HIDES the
  control but the value still resolves and still emits its attribute; nothing
  consumes it. See `IntroVideoSection`'s header for the full note.

  COLOUR STAYS `--color-*` (contract A11); `--jp-accent-*` is the deliberate
  exception.

  ── THE ASPECT ↔ SCRIM RULE (the coupling this section motivated) ───────────
  `IntroVideoSection`'s header states the rule in full. In short:

   1. Text may sit on the media ONLY where the axis ships a scrim — i.e.
      `media: bleed`, and only `bleed`. `overlay` derives that from
      `design.media`; at every other value the caption, meta and transport drop
      BELOW the frame instead of floating over unprotected imagery.
   2. The aspect is NEVER overridden per breakpoint, only FLOORED. This section
      is why: it shipped `aspect-ratio: 4 / 3` at 760px and `3 / 3.4` at 420px
      against a scrim fixed at 62%, so a narrow viewport moved the box's height
      while the gradient stop kept a proportion tuned for a wider one. A
      `min-height` floor can only make the box TALLER, which moves the stop
      further above the text — safe by construction, where a second
      `aspect-ratio` is not.

  ── EIGHT DESIGN LANGUAGES, NOT 38 PERMUTATIONS ────────────────────────────
  The nine axes reach every MAGNITUDE in this file. They do not, on their own,
  make a look recognisable: a design language is also which elements are boxes,
  which corner is square, which label is monospaced and which rule is drawn at
  all — selector-level decisions a properties-only axis file cannot carry and a
  Svelte-scoped style block cannot select on, because the `data-jp-*` attributes
  live on the ANCESTOR `.jp-sec`.

  So seven axis values are re-emitted UNMODIFIED as local `data-*` attributes on
  `.reel` (see `look` in the script; `align` reuses the `data-reel-align` that
  was already there), the ROLE TABLE at the head of the stylesheet turns each
  look into a set of VALUES rather than a set of rules, and the PER-LOOK
  COMMITMENTS block at its foot spends them on each family's documented tell
  (`00-design-language-research.md` §1).

  READ THAT BLOCK'S OWN HEADER before adding a rule to it. It carries the
  selector discipline that keeps `candlelit` — the one preset the product owner
  says already works — out of the blast radius, which is arithmetic rather than
  convention: candlelit is uniquely identified by four of its nine values
  (`surface: media`, `edge: none`, `media: bleed`, `accent: glow`) and SHARES the
  other five, so a bare rule on `type: monumental`, `align: center`,
  `density: airy`, `width: text` or `motion: drift` restyles it. None of the
  twelve attribute-constrained selectors emitted from this file matches the
  candlelit bundle, and every role default is the literal value the declaration
  it replaced carried.

  ── FOUR COMPOSITIONS BUILT, ONE DESCOPED ──────────────────────────────────
  `theatre` (default) · `plain` · `split` · `waveform`. `theatre` is the retired
  `cinema` and `plain` the retired `simple` (`LEGACY_SECTION_VARIANTS` maps both).
  `waveform` is new (research §3): audio-first, where the equaliser and playhead
  ARE the section, because an audio preview should look like audio rather than
  like a video with the picture missing.

  `strip` STAYS DESCOPED per contract A27, and migration 0086 does not change
  that. A27 descoped it because it needs 3–5 clips against a single
  `previewVideoMediaId` — an array-cardinality problem, not a missing slot. 0086
  added `courses.hero_media_id` and `courses.signature_media_id`, both scalar
  `uuid` columns (verified against the live schema), so the clip count available
  to this section is still exactly one. It is declared in the catalogue and left
  unbuilt; `resolveVariant` falls back to `theatre`. Tracked on `Codex-wqxv4`.

  A synthetic gradient plate standing in for absent clips is specifically NOT the
  answer — that is what today's `hero.split` does and A27 names it as the mistake.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): the fully-composed cinematic still —
    header, letterbox frame, layered atmosphere, corner marks, caption whisper
    and a static player-chrome bar. Every word legible; nothing depends on JS.
    The play affordance itself is STREAMED (public preview, no auth) via
    `{#await}` with a skeleton, matching the shell+stream contract.
  • ENHANCED (browser + motion OK): the candlelight bloom breathes, the incense
    haze drifts, the rec dot pulses, the play button carries an invitation ring,
    and (when the org supplies more than one) the whispered caption cross-fades.
    Every duration is derived from `--jp-reveal-duration`, so the `motion` axis
    reaches the ambience and `motion: none` genuinely stops it.

  Real playback stays in `ui/IntroVideoModal` (HLS) — the frame is the poster and
  the click target.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { reveal } from '../reveal';
  import { aliasKeys, asString, asStringArray, asStringFrom } from '../coerce';
  import { editFieldAttrs } from '../editable';
  import type { Snippet } from 'svelte';
  import type {
    ReelSectionProps,
    JourneySalesContext,
    SellPreview,
  } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * `heading` and `duration` are not on `ReelSectionProps` in `render/types.ts`,
   * which is shared across the component worktrees; declared locally, exactly as
   * `AcheSection` declares `AcheCopy`. Consolidation should absorb them.
   */
  interface ReelCopy extends ReelSectionProps {
    heading?: string;
    duration?: string;
  }

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    /**
     * Read for three decisions that are genuinely markup rather than CSS:
     * whether text may sit on the media (`media`), whether the media box renders
     * at all (`media: none`), and whether the ambient caption cycle runs
     * (`motion: none`). A section's scoped stylesheet cannot reach an ancestor
     * `data-jp-*` attribute, which is what `SectionRenderer` passes this for.
     */
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

  const p: ReelCopy = $derived({
    /**
     * Bridged through the alias table, which this renderer did not consume at
     * all before: `coerce.ts` declares `reel: { eyebrow: ['eyebrow', 'kicker'],
     * tag: ['tag', 'clip'] }` and this file had zero `asStringFrom` and zero
     * `aliasKeys` calls. The loss was live — the golden page stores
     * `kicker: "In motion"` and `clip: "Practice preview"`, and the served HTML
     * contained no eyebrow element and the hardcoded word "Preview". Part of
     * `Codex-tqr51`.
     */
    eyebrow: asStringFrom(config, aliasKeys('reel', 'eyebrow')),
    heading: asStringFrom(config, aliasKeys('reel', 'heading')),
    sub: asStringFrom(config, aliasKeys('reel', 'sub')),
    posterUrl: asString(config, 'posterUrl'),
    tag: asStringFrom(config, aliasKeys('reel', 'tag')),
    /**
     * `OWED_READS.reel` (contract A28). The badge was computed from the real clip
     * and the authored field was inert. Authored now takes precedence, per the
     * `authored ?? derived` precedence contract A42 made `proof` conform to; a
     * creator who wants the real clip length clears the field.
     */
    duration: asString(config, 'duration'),
  });

  /**
   * NO HARDCODED EDITORIAL VOICE (`Codex-i9pzs`). This used to fall back to
   * "This is what a descent looks like." — one brand's copy, which every other
   * org's page then published. It falls back to the creator's OWN words instead,
   * and self-hides when there is nothing to say. Deliberately NOT an i18n key: a
   * key holding one brand's editorial voice has not fixed this, it has moved it.
   *
   * `titleFallback`, NOT `context.course.title`: the PAGE decides which single
   * section may borrow the title, because five sections deciding independently is
   * what printed it five times. Not the claimant ⇒ no heading, which the `{#if}`
   * around the `<h2>` already handled.
   */
  const heading = $derived(p.heading ?? titleFallback);

  /**
   * The rec tag, by contrast, IS generic chrome, so it takes the key that already
   * exists — `journey_reel_tag_default`, `messages/en.json:1477`, value
   * "Preview". Authored `tag`/`clip` still wins.
   */
  const tagLabel = $derived(p.tag ?? m.journey_reel_tag_default());

  /**
   * Whispered subtitle(s). `captions` (an array) takes precedence, else a single
   * `caption`. Absent ⇒ no caption line renders. Still read through the coerce
   * guards rather than `p.*` because `props` is org-authored jsonb — the type
   * states intent; the guard is what survives a malformed value.
   */
  const captions = $derived(
    asStringArray(config, 'captions') ??
      (asString(config, 'caption') ? [asString(config, 'caption') as string] : [])
  );

  // Unique-per-instance id so multiple reels on a page never share the waveform
  // <symbol>. Increments in identical order on server + client ⇒ hydration-safe.
  const waveId = `reel-wave-${nextWaveId()}`;

  let open = $state(false);
  let mounted = $state(false);
  let reduced = $state(false);
  let captionIndex = $state(0);
  let captionFading = $state(false);

  const COMPOSITIONS = ['theatre', 'plain', 'split', 'waveform'];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'theatre'
  );

  /**
   * Viewfinder brackets and the rec tag are `theatre`'s own chrome: research §3
   * describes `plain` as "clip with caption only" and `waveform` as having no
   * frame at all. This is the port of `_video.css`'s
   * `.jp-video--simple .jp-video__corner, .jp-video--simple .jp-video__tag
   * { display: none }`, expressed as a positive condition rather than a
   * subtraction. String discriminant, not a boolean: `apps/web` has
   * `strictNullChecks` OFF, so a boolean-literal discriminant does not narrow.
   */
  const framedChrome = $derived(
    composition === 'theatre' || composition === 'split' ? 'yes' : 'no'
  );

  /** `waveform` replaces the poster frame with the equaliser itself. */
  const audioFirst = $derived(composition === 'waveform' ? 'yes' : 'no');

  /**
   * WHERE THE CAPTION, META AND TRANSPORT SIT — the aspect↔scrim rule, half one.
   *
   * `--jp-media-scrim` is `none` at `frame`, `mask`, `inset` and `none`; only
   * `bleed` ships a gradient, and its 21:9 aspect and 62% stop are tuned
   * together. Text over an un-scrimmed poster has no contrast guarantee at all,
   * so at those four values everything that would have floated on the picture
   * sits beneath it instead. Research §5.1: "any composition placing text over
   * media uses `bleed`, not `frame`" — and since `media` is a creator-facing
   * axis, the composition has to degrade rather than demand.
   *
   * `waveform` has no poster to sit on, so it is always `below`.
   */
  const overlay = $derived(
    audioFirst === 'no' && design?.media === 'bleed' ? 'over' : 'below'
  );

  /**
   * WHETHER THIS SECTION HAS ANYTHING TO SAY, independently of whether it has
   * anything to play. Nine of the eleven sections already self-hide on empty data
   * (`TurnSection` renders only if `statement || lede`); this one and `introVideo`
   * did not, and they are the two whose subject is media they may not have.
   */
  const hasCopy = $derived(Boolean(p.eyebrow || heading || p.sub));

  /**
   * WHETHER THE LETTERBOX HAS ANYTHING IN IT — a real clip, or an authored poster
   * still.
   *
   * Before this the frame rendered unconditionally, and the no-clip branch of
   * `transport` drew `<span class="reel__play reel__play--empty">` with a real
   * `PlayIcon` inside it plus a `.reel__rest-rail` — a play glyph and a scrub rail
   * that are not controls and never will be, in a full letterbox frame. `posterUrl`
   * is authored and usually absent, so on a course with no `previewVideoMediaId`
   * there was not even a still behind them: the section published what reads as a
   * broken player.
   */
  const hasStage = (preview: SellPreview | null | undefined) =>
    Boolean(preview?.reel?.playlistUrl) || Boolean(p.posterUrl);

  /**
   * `waveform`'s SEPARATE test, because its whole subject is the transport. It has
   * no poster and no letterbox by definition (research §3: "the equaliser and
   * playhead ARE the section"), so an authored poster cannot save it — with no
   * clip there is nothing for the composition to be about.
   */
  const hasTransport = (preview: SellPreview | null | undefined) =>
    Boolean(preview?.reel?.playlistUrl);

  /** `media: none` emits `--jp-media-display: none` — honoured in markup. */
  const showMedia = $derived(design?.media === 'none' ? 'no' : 'yes');

  const currentCaption = $derived(captions[captionIndex] ?? captions[0]);

  /**
   * SEVEN AXIS VALUES RE-EMITTED UNMODIFIED as local `data-*` attributes, so the
   * PER-LOOK COMMITMENTS block at the foot of the stylesheet can select on them.
   * Exactly the seam `GuideSection` documents: `journey-design.css` emits nothing
   * but custom properties, and a design LANGUAGE is also which elements are
   * boxes, which corner is square, which label is monospaced and which rule is
   * drawn at all — selector-level statements. A Svelte-scoped style block cannot
   * reach the ancestor `.jp-sec`'s `data-jp-*`, hence the mirror.
   *
   * `align` is NOT here: `data-reel-align` already carries it on the same
   * element (the editorial-split container query keys on it), and one axis with
   * two local attributes is one attribute too many — the long-read compound
   * below reads `data-reel-align` instead. `width` is not mirrored either:
   * `--jp-content-max` / `--jp-measure` already carry it and nothing in this
   * file needs to select on it.
   *
   * `undefined` when no `design` arrives ⇒ Svelte omits the attribute and every
   * per-look rule no-ops, which is the honest degradation: a host resolving no
   * axes gets exactly the CSS this component shipped before the per-look pass.
   */
  const look = $derived({
    surface: design?.surface,
    edge: design?.edge,
    type: design?.type,
    accent: design?.accent,
    density: design?.density,
    motion: design?.motion,
    media: design?.media,
  });

  /**
   * The ambient caption cross-fade is CONTINUOUS motion, so contract A40 applies:
   * the static single caption is the baseline and the cycle is the enhancement.
   * `motion: none` stops it as well as `prefers-reduced-motion` — otherwise the
   * axis would reach every animation in this file except the one driven from JS.
   */
  const cycleCaptions = $derived(
    mounted && !reduced && captions.length > 1 && design?.motion !== 'none'
  );

  function formatDuration(seconds: number | null | undefined): string | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * The props key an inline edit must write BACK to: the one the displayed value
   * was actually READ from, never the renderer's own prop name (contract A60).
   * The alias lists are ordered, so a page storing `kicker`/`clip` (the golden
   * page stores both) would, if an edit wrote `eyebrow`/`tag`, end up holding
   * BOTH keys — and the first would keep winning, so the creator's edit would
   * render as nothing while the data silently grew a second copy.
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
    editFieldAttrs('reel', key, editable, onEdit);

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

  /*
   * Slow ambient cross-fade through the whispered captions — enhancement only.
   *
   * SVELTE-AUTOFIXER SUGGESTIONS REJECTED, with reasons. It flags every
   * assignment to `captionIndex` / `captionFading` inside this `$effect` and the
   * four timer calls, suggesting `$derived`.
   *
   * `$derived` cannot express this. A derivation is a pure function of reactive
   * state, and what advances this index is WALL-CLOCK TIME — there is no reactive
   * input whose change should produce the next caption. The state is also
   * genuinely owned here (nothing else writes it) and the effect returns a
   * teardown that clears both timers, which is exactly the contract `$effect`
   * exists for. Same class of rejection as round 3's `performance.now()` rAF
   * loop.
   *
   * The autofixer's own wording concedes it: "Ignore this suggestion if you are
   * sure this function is not assigning any stateful variable or if you can't
   * check if it does" — it cannot see inside the callbacks.
   *
   * `cycleCaptions` IS a `$derived`, and it is the part that should be: whether
   * the cycle may run at all is a pure function of mount, reduced-motion, caption
   * count and the `motion` axis.
   */
  $effect(() => {
    if (!cycleCaptions) {
      captionFading = false;
      return;
    }
    const total = captions.length;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const cycle = setInterval(() => {
      captionFading = true;
      swap = setTimeout(() => {
        captionIndex = (captionIndex + 1) % total;
        captionFading = false;
      }, 420);
    }, 5600);
    return () => {
      clearInterval(cycle);
      if (swap) clearTimeout(swap);
    };
  });
</script>

{#snippet header()}
  <header class="reel__head">
    <div class="reel__lead">
      {#if p.eyebrow}
        <p
          class="jp-sec__eyebrow reel__eyebrow jp-reveal"
          {...editAttrs(readKey(aliasKeys('reel', 'eyebrow'), 'kicker'))}
        >
          {p.eyebrow}
        </p>
      {/if}
      {#if heading}
        <h2
          class="jp-sec__heading jp-sec__heading--sub reel__title jp-reveal"
          data-jp-step="1"
          id={waveId + '-heading'}
          {...editAttrs(readKey(['heading'], 'heading'))}
        >
          {heading}
        </h2>
      {/if}
    </div>
    {#if p.sub}
      <p
        class="reel__sub jp-reveal"
        data-jp-step="2"
        {...editAttrs(readKey(aliasKeys('reel', 'sub'), 'sub'))}
      >
        {p.sub}
      </p>
    {/if}
  </header>
{/snippet}

<!--
  The rec tag + total duration. One markup, positioned by `overlay`.

  The editable attributes go on an inner label span rather than on `.reel__tag`
  itself: the tag also contains the decorative rec dot, and making the wrapper
  `contenteditable` would let an edit delete that element and would fold it into
  the value written back.
-->
{#snippet topmeta(durationLabel: string | undefined)}
  <div class="reel__topmeta" data-reel-at={overlay}>
    <span class="reel__tag">
      <span
        class="reel__dot"
        class:is-live={mounted && !reduced}
        aria-hidden="true"
      ></span>
      <span {...editAttrs(readKey(aliasKeys('reel', 'tag'), 'clip'))}>
        {tagLabel}
      </span>
    </span>
    {#if durationLabel}
      <span class="reel__dur">{durationLabel}</span>
    {/if}
  </div>
{/snippet}

<!--
  The waveform equaliser. 32 bars, generated from ONE amplitude array rather
  than 32 hand-authored `<rect>` literals with per-bar x/y/height.

  KEPT AS INLINE SVG DELIBERATELY, and this is the justified half of the
  "no inline SVG — use Icon/*Icon.svelte" rule. That rule exists to stop icons
  being redrawn outside the icon set and to keep their sizing and a11y uniform.
  This is not an icon: it is a 480x40 data-shaped graphic with no symbolic
  meaning, no place in an icon set, and no sensible expression through
  `IconBase`'s square viewBox. The only true ICON here is `PlayIcon`, which is
  already one. What WAS a real defect is the 32 duplicated literals, and that is
  what the array removes — the geometry is byte-identical (x = 4 + 15i,
  y = (40 - h) / 2, width 7, rx 3, exactly as authored).
-->
{#snippet waveBars()}
  <g id={waveId} fill="currentColor">
    {#each WAVE_AMPLITUDES as h, i (i)}
      <rect x={4 + i * 15} y={(40 - h) / 2} width="7" height={h} rx="3" />
    {/each}
  </g>
{/snippet}

{#snippet transport(playlistUrl: string | undefined)}
  <div class="reel__chrome">
    {#if playlistUrl}
      <button
        type="button"
        class="reel__play"
        class:is-armed={mounted && !reduced}
        onclick={() => (open = true)}
        aria-label={m.journey_reel_play_aria()}
      >
        <span class="reel__play-icon" aria-hidden="true">
          <PlayIcon />
        </span>
      </button>
      <div class="reel__track" aria-hidden="true">
        <svg
          class="reel__wave reel__wave--base"
          viewBox="0 0 480 40"
          preserveAspectRatio="none"
        >
          {@render waveBars()}
        </svg>
        <svg
          class="reel__wave reel__wave--fill"
          viewBox="0 0 480 40"
          preserveAspectRatio="none"
        >
          <use href={'#' + waveId} />
        </svg>
        <span class="reel__playhead"></span>
      </div>
      <IntroVideoModal
        {open}
        src={playlistUrl}
        title={heading}
        onclose={() => (open = false)}
      />
    {/if}
    <!--
      NO `reel__play--empty` / `reel__rest-rail` BRANCH. It drew a `PlayIcon` and a
      scrub rail for a course with no preview clip — a play affordance and a
      transport that are not controls, cannot become controls, and are the exact
      shape of a broken player. With no clip and no authored poster the FRAME does
      not render at all now (`hasStage`), and with a poster but no clip the still
      speaks for itself with no dead chrome on it.
    -->
  </div>
{/snippet}

{#snippet pendingTransport()}
  <div class="reel__chrome">
    <span class="reel__play reel__play--pending" aria-hidden="true">
      <span class="reel__play-icon"><PlayIcon /></span>
    </span>
    <div class="reel__track reel__track--pending" aria-hidden="true">
      <div class="reel__skeleton"></div>
    </div>
  </div>
{/snippet}

{#snippet caption()}
  {#if currentCaption}
    <p class="reel__caption" class:is-fading={captionFading}>
      {currentCaption}
    </p>
  {/if}
{/snippet}

<!-- The caption + transport pair, positioned by `overlay`. -->
{#snippet lower()}
  <div class="reel__lower" data-reel-at={overlay}>
    {@render caption()}
    {#await context.sellPreview}
      {@render pendingTransport()}
    {:then preview}
      {@render transport(preview?.reel?.playlistUrl)}
    {/await}
  </div>
{/snippet}

<!--
  The layered candlelit plate. Declared last because snippets hoist, and it reads
  better beside the styles it drives than in the middle of the compositions.
-->
{#snippet framePlate()}
  <!--
    The atmosphere. ONE `--jp-sec-atmos` gate on this shared parent rather than
    per layer (pilot lesson 3): the bloom's opacity is ANIMATED, and a keyframe
    beats a `calc()` on the same element.

    `.reel__base` is INSIDE the gate with the rest, which matters for the four
    `mix-blend-mode: screen` layers above it: `screen` blends against the backdrop
    within its own stacking context, so the warm layers have to share a group with
    the base they are lifting. The axis only ever emits 0 or 1 here, and
    `opacity: 1` does not create a stacking context, so at `surface: media` the
    blending is identical to having no wrapper at all.
  -->
  <div class="reel__atmos" aria-hidden="true">
    <span class="reel__base"></span>
    <span class="reel__body"></span>
    <span class="reel__rim"></span>
    <span class="reel__glow" class:is-live={mounted && !reduced}></span>
    <span class="reel__haze" class:is-live={mounted && !reduced}></span>
    <span class="reel__vignette"></span>
    <span class="reel__grain"></span>
  </div>

  {#if p.posterUrl}
    <!--
      A real poster sits ABOVE the atmosphere and OUTSIDE its gate — it is
      content, not decoration, so `surface: bare` must not erase it.
    -->
    <span
      class="reel__image"
      aria-hidden="true"
      style="--reel-poster: url({JSON.stringify(p.posterUrl)})"
    ></span>
  {/if}

  {#if framedChrome === 'yes'}
    <span class="reel__corner reel__corner--tl" aria-hidden="true"></span>
    <span class="reel__corner reel__corner--tr" aria-hidden="true"></span>
    <span class="reel__corner reel__corner--bl" aria-hidden="true"></span>
    <span class="reel__corner reel__corner--br" aria-hidden="true"></span>
  {/if}

  <!--
    THE SCRIM — `background: var(--jp-media-scrim)` and nothing else in the
    declaration. The token resolves to the keyword `none` on four of five media
    values, and `none` cannot be one item of a larger value, so composing it
    would be invalid at computed-value time and the whole declaration would
    evaporate. That is contract A54's mechanism reaching a second token family.
  -->
  <span class="reel__scrim" aria-hidden="true"></span>
{/snippet}

<!--
  THE MEDIA GATE, in one place for all four compositions.

  A snippet that takes a snippet, so the "is there anything to show" question is
  answered ONCE rather than at each of the three `stageFigure()` call sites (which
  is how the two would eventually disagree). While the promise is PENDING the frame
  renders with its own pending chrome — an honest loading state — and the moment it
  resolves with nothing to show, nothing renders.

  `present` is passed in because `waveform` and the letterbox compositions ask
  DIFFERENT questions: a poster rescues a letterbox, and cannot rescue a transport.
-->
{#snippet whenMedia(
  present: (preview: SellPreview | null | undefined) => boolean,
  node: Snippet
)}
  {#await context.sellPreview}
    {@render node()}
  {:then preview}
    {#if present(preview)}
      {@render node()}
    {/if}
  {:catch}
    <!-- A failed media read is not a reason to draw an empty player; an authored
         poster is still real content, so `hasStage` keeps the frame for it. -->
    {#if present(null)}
      {@render node()}
    {/if}
  {/await}
{/snippet}

<!--
  The letterbox and everything on it. ONE definition serving `theatre`, `plain`
  and `split`, with `overlay` deciding whether the meta and lower block sit
  inside the frame or beneath it — so the two placements can never drift apart.
-->
{#snippet stageFigure()}
  <figure class="reel__stage">
    <div class="reel__frame">
      {@render framePlate()}
      {#if overlay === 'over'}
        {@render metaAndLower()}
      {/if}
    </div>
    {#if overlay === 'below'}
      {@render metaAndLower()}
    {/if}
  </figure>
{/snippet}

{#snippet metaAndLower()}
  {#await context.sellPreview}
    {@render topmeta(p.duration)}
  {:then preview}
    {@render topmeta(
      p.duration ?? formatDuration(preview?.reel?.durationSeconds)
    )}
  {/await}
  {@render lower()}
{/snippet}

{#snippet audioBlock()}
  <!--
    `waveform` — the equaliser and playhead ARE the section. No poster, no
    letterbox: an audio preview should look like audio rather than like a video
    with the picture missing (research §3). Rendered regardless of `media`, because
    this composition's subject is the transport, not a box the `media` axis shapes
    — but NOT regardless of whether a clip exists, which is `hasTransport`.
  -->
  <div class="reel__audio">
    {@render metaAndLower()}
  </div>
{/snippet}

{#snippet shell()}
  <div
    class="reel"
    data-reel-composition={composition}
    data-reel-overlay={overlay}
    data-reel-align={design?.align ?? 'center'}
    data-surface={look.surface}
    data-edge={look.edge}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
    data-motion={look.motion}
    data-media={look.media}
  >
    <div class="reel__inner" use:reveal={{ disabled: editable }}>
      {#if composition === 'split'}
        <div class="reel__split">
          {@render header()}
          {#if showMedia === 'yes'}{@render whenMedia(hasStage, stageFigure)}{/if}
        </div>
      {:else if audioFirst === 'yes'}
        {@render header()}
        {@render whenMedia(hasTransport, audioBlock)}
      {:else}
        {@render header()}
        {#if showMedia === 'yes'}{@render whenMedia(hasStage, stageFigure)}{/if}
      {/if}
    </div>
  </div>
{/snippet}

<!--
  SELF-HIDE, THE WAY NINE OF THE ELEVEN SECTIONS ALREADY DO.

  THE COPY BRANCH IS NOT INSIDE THE `{#await}`, DELIBERATELY: the header is
  SEO-critical and paints immediately, and putting it inside an await branch would
  destroy and re-create it when the promise resolved, re-running `use:reveal` and
  making the copy flash out and back in. The await wrapper is reached only when
  there is NO copy — where there is nothing to flicker and nothing to index, and
  the section's whole existence depends on whether a clip turned up.

  `audioFirst` uses the transport test even here: a `waveform` with no copy and no
  clip has no subject at all.
-->
{#if hasCopy}
  {@render shell()}
{:else}
  {#await context.sellPreview then preview}
    {#if audioFirst === 'yes' ? hasTransport(preview) : showMedia === 'yes' && hasStage(preview)}
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
     the section (pilot lesson 1). `.reel` is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .reel {
    /* ── THE ROLE TABLE, so a look is a VALUE and not a rule ───────────────
       The per-look blocks at the foot of this file are keyed on axis values and
       there are eight of them. Without local roles the same eight blocks would
       each re-declare the plate's border, the pill radius, the play control's
       four paint declarations and the audio panel's box — which is how eight
       looks become forty near-duplicate rules that drift. With roles a look
       states its VALUES and the paint stays in one place.

       EVERY DEFAULT HERE REPRODUCES THE BASE COMMIT EXACTLY. That is not a
       courtesy, it is the whole mechanism: candlelit resolves NONE of the
       per-look selectors below, so it resolves these defaults, and a default
       that merely looked reasonable would silently restyle the one preset the
       product owner says already works. Each default is the literal value the
       declaration it replaced carried, listed against its old spelling:

         --reel-frame-*      was the `theatre`/`split` frame rule's own
                             1px accent-mix border + `--shadow-xl`
         --reel-corner-*     was `block` / `--border-width-thick` / a 70%
                             `--jp-accent-mark` mix
         --reel-pill-radius  was `--radius-full` on the over-plates and the play
                             control
         --reel-plate-*      was 1px `--color-heading` 16% + `--blur-sm`
         --reel-meta-size    was the inline `max(--text-xs, --jp-body-size/1.5)`
         --reel-label-*      `inherit` + `calc(--tracking-wider * 5.6)` is the
                             rec tag exactly as it shipped (0.28em)
         --reel-num-*        `inherit` / `1em` / `--font-semibold` is the
                             duration inheriting the meta rung, i.e. no change
         --reel-dot-*        was `--space-1-5` and `--radius-full`
         --reel-head-*       `0px` paints no rule at all
         --reel-caption-*    was `--font-heading` + `italic`, marks at 0.4
         --reel-play-*       was the glassy 45% background, the full-strength
                             `--jp-accent-mark` 2px border, `--jp-accent-glow`
                             as the whole box-shadow, and `--blur-md`
         --reel-audio-*      was `--color-surface-secondary` at `--radius-card`
                             with no border and no elevation
       ────────────────────────────────────────────────────────────────────── */

    /* the letterbox chrome — read only by `theatre` and `split` */
    --reel-frame-border: var(--border-width) solid
      color-mix(in oklab, var(--jp-accent-mark) 22%, transparent);
    --reel-frame-shadow: var(--shadow-xl);

    /* the viewfinder brackets */
    --reel-corner-display: block;
    --reel-corner-width: var(--border-width-thick);
    --reel-corner-color: color-mix(
      in oklab,
      var(--jp-accent-mark) 70%,
      transparent
    );

    /* pills and plates */
    --reel-pill-radius: var(--radius-full);
    --reel-plate-border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    --reel-plate-blur: var(--blur-sm);

    /* the metadata row */
    --reel-meta-size: max(var(--text-xs), calc(var(--jp-body-size) / 1.5));
    --reel-label-font: inherit;
    --reel-label-tracking: calc(var(--tracking-wider) * 5.6);
    --reel-num-font: inherit;
    --reel-num-size: 1em;
    --reel-num-weight: var(--font-semibold);
    --reel-dot-size: var(--space-1-5);
    --reel-dot-radius: var(--radius-full);

    /* the section head's own rule */
    --reel-head-rule: 0px;
    --reel-head-gap: 0px;

    /* the whispered caption */
    --reel-caption-font: var(--font-heading);
    --reel-caption-style: italic;
    --reel-caption-mark: 0.4;

    /* the play control */
    --reel-play-color: var(--color-heading);
    --reel-play-bg: color-mix(in oklab, var(--color-background) 45%, transparent);
    --reel-play-bg-hover: color-mix(
      in oklab,
      var(--jp-accent-mark) 26%,
      transparent
    );
    --reel-play-border: var(--border-width-thick) solid var(--jp-accent-mark);
    --reel-play-shadow: var(--jp-accent-glow);
    --reel-play-blur: var(--blur-md);

    /* the `waveform` composition's panel */
    --reel-audio-bg: var(--color-surface-secondary);
    --reel-audio-border: 0 none;
    --reel-audio-shadow: none;
    --reel-audio-radius: var(--radius-card);

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

  .reel__inner {
    display: flex;
    flex-direction: column;
    gap: var(--jp-sec-gap);
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* ── the editorial split header ────────────────────────────────────────
     Title one side, whisper the other — but ONLY where the `align` axis asks for
     an asymmetric page. At `align: center` it is a centred stack, because `align`
     IS the text axis and a section that overrode it locally would defeat the very
     axis that exists to delete eight alignment variants.

     This is a MEASURED Candlelit delta and it is deliberate: the base commit
     right-aligned `.reel__sub` at `@media (--breakpoint-md)` unconditionally,
     while Candlelit is `align: center`. The editorial split is not lost — it is
     what `align: start` now draws. See the WT-2 report.

     Container query, not a viewport one (contract A14): `.jp-sec` is the
     container, and the builder canvas renders sections inside a device frame
     narrower than the window, where a viewport query reads the wrong number. */
  .reel__head {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: calc(var(--jp-sec-gap) * 0.5);
    /* THE HEAD'S OWN HAIRLINE, as a role rather than a rule. `long-read`'s tell
       is "a hairline under every section head" and `syllabus`'s is "a hairline
       grid"; both want the same line and neither should re-spell it. `0px`
       paints nothing, so this is inert everywhere else — a `0px` border-width
       draws no line regardless of style or colour. */
    padding-block-end: var(--reel-head-gap);
    border-block-end: var(--reel-head-rule) solid var(--color-border-subtle);
  }

  @container (min-width: 48rem) {
    [data-reel-align='start']:not([data-reel-composition='split']) .reel__head {
      flex-direction: row;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--jp-sec-gap);
    }
    [data-reel-align='start']:not([data-reel-composition='split']) .reel__sub {
      text-align: right;
      padding-bottom: var(--space-1);
    }
  }

  .reel__lead {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: calc(var(--jp-sec-gap) * 0.35);
    max-width: 30ch;
  }

  /* The tight display measure is the COMPOSITION's arrangement, not the `width`
     axis: `--jp-measure` caps running body copy, and a 24ch heading column is a
     typographic choice about the header's asymmetry. Kept in `ch`, which is a
     relative unit that tracks the `type` axis's own scale — the same unit the
     `--measure-*` tokens are themselves expressed in. */
  .reel__title {
    max-width: 24ch;
  }

  .reel__sub {
    margin: 0;
    max-width: 30ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ── THE MEDIA BOX ─────────────────────────────────────────────────────
     `aspect-ratio` sets the SHAPE from the axis; `min-height` floors the SIZE.
     NEVER a second `aspect-ratio` at a breakpoint — that is the decoupling this
     section used to ship. See the coupling note in the component header. */
  .reel__stage {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: calc(var(--jp-sec-gap) * 0.5);
  }

  .reel__frame {
    position: relative;
    /* Keeps the five blend layers inside the frame. Must stay. */
    isolation: isolate;
    width: 100%;
    aspect-ratio: var(--jp-media-aspect);
    padding: var(--jp-media-inset);
    border-radius: var(--jp-media-radius);
    clip-path: var(--jp-media-mask);
    overflow: hidden;
    background: var(--color-surface);
    display: grid;
    place-items: center;
  }

  /* THE ASPECT FLOOR — half two of the coupling rule, and it applies ONLY where
     text actually sits on the media.

     Derived from `--jp-body-size`, the `type` axis rung that sizes the caption it
     protects, so the floor tracks the text rather than pinning a raw px. The
     multiplier is solved backwards from the `min-height: 280px` this section
     shipped at its 760px breakpoint against that rung's `monumental` value
     (24px) — the same backwards-solve the pilot used for its `80svh`.

     A `frame` player carries no text and needs no floor; applying one anyway
     would turn a 16:9 player into a 1.2:1 box at 375px, distorting the aspect to
     protect text that is not there. */
  [data-reel-overlay='over'] .reel__frame {
    min-height: calc(var(--jp-body-size) * 11.5);
  }

  /* `theatre`'s and `split`'s framed-footage chrome. This is the COMPOSITION's
     hairline and elevation, not the `edge` axis — `edge` describes the SECTION's
     border and shadow and is already consumed on `.reel` above. A composition
     whose entire identity is "this is framed footage" cannot have its frame
     deleted by a section-level edge value. Elevation comes from `--shadow-*`
     rather than the old `rgba(0, 0, 0, 0.4)`, which broke on a light brand. */
  [data-reel-composition='theatre'] .reel__frame,
  [data-reel-composition='split'] .reel__frame {
    /* Through the roles, so a LOOK can restate the frame's edge without a
       composition having to know about it. `box-shadow` takes the role as its
       WHOLE value (contract A54) because two looks below hand it
       `--jp-edge-shadow`, which is the keyword `none` at `edge: none` and
       `edge: heavy`. */
    border: var(--reel-frame-border);
    box-shadow: var(--reel-frame-shadow);
  }

  /* thin top sheen — reads like the surface of a screen */
  .reel__frame::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 5%, transparent),
      transparent 12%
    );
  }

  .reel__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    /* The 0/1 gate. See the markup note on why `.reel__base` is inside it. */
    opacity: var(--jp-sec-atmos);
  }

  .reel__atmos > * {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* warm base — a lift where the candle sits, resolved from the org brand */
  .reel__base {
    background: radial-gradient(
      150% 130% at 26% 34%,
      color-mix(in oklab, var(--color-surface) 88%, var(--color-brand-primary) 12%)
        0%,
      var(--color-surface) 42%,
      var(--color-background) 72%
    );
  }

  /* the reclining body — a low warm mass catching flame light */
  .reel__body {
    background: radial-gradient(
      78% 130% at 58% 138%,
      color-mix(in oklab, var(--color-brand-primary) 26%, transparent) 0%,
      color-mix(in oklab, var(--color-brand-accent) 20%, transparent) 34%,
      transparent 62%
    );
    mix-blend-mode: screen;
    opacity: 0.9;
  }

  /* rim light — a skin edge grazed by candlelight */
  .reel__rim {
    background: radial-gradient(
      42% 60% at 38% 74%,
      color-mix(in oklab, var(--color-brand-accent) 34%, transparent) 0%,
      transparent 56%
    );
    mix-blend-mode: screen;
    opacity: 0.8;
  }

  /* candlelight — bloom + brighter core */
  .reel__glow {
    background: radial-gradient(
      closest-side at 25% 40%,
      color-mix(in oklab, var(--color-brand-primary) 92%, var(--color-heading) 8%)
        0%,
      color-mix(in oklab, var(--color-brand-primary) 55%, transparent) 20%,
      color-mix(in oklab, var(--color-brand-accent) 22%, transparent) 46%,
      transparent 66%
    );
    mix-blend-mode: screen;
    transform-origin: 25% 40%;
    opacity: 0.9;
  }

  /* incense/haze drifting slowly across the frame */
  .reel__haze {
    background: radial-gradient(
      60% 90% at 70% 20%,
      color-mix(in oklab, var(--color-brand-accent) 12%, transparent),
      transparent 60%
    );
    mix-blend-mode: screen;
    opacity: 0.6;
  }

  .reel__vignette {
    background: radial-gradient(
      125% 120% at 50% 40%,
      transparent 38%,
      color-mix(in oklab, var(--color-background) 45%, transparent) 74%,
      var(--color-background) 100%
    );
  }

  .reel__grain {
    opacity: 0.07;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='rn'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23rn)'/%3E%3C/svg%3E");
  }

  /* A real poster layers over the atmosphere, outside its gate. */
  .reel__image {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: var(--reel-poster, none) center / cover no-repeat;
    opacity: 0.92;
  }

  /* THE SCRIM — the whole value of its own property, nothing composed in. */
  .reel__scrim {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: var(--jp-media-scrim);
  }

  /* motion is enhancement only — armed once JS confirms motion is welcome.
     Every duration is derived from `--jp-reveal-duration`, so the `motion` axis
     reaches the ambience: at `drift` (800ms) these resolve to 8s / 21.6s / 4s,
     which is what the section shipped as literals. */
  .reel__glow.is-live {
    animation: reel-breath calc(var(--jp-reveal-duration) * 10)
      var(--ease-in-out) infinite;
  }

  .reel__haze.is-live {
    animation: reel-drift calc(var(--jp-reveal-duration) * 27)
      var(--ease-in-out) infinite alternate;
  }

  @keyframes reel-breath {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.82;
    }
    50% {
      transform: scale(1.07);
      opacity: 1;
    }
  }

  @keyframes reel-drift {
    from {
      transform: translate3d(-4%, 2%, 0);
    }
    to {
      transform: translate3d(5%, -3%, 0);
    }
  }

  /* ── viewfinder corner marks ── */
  .reel__corner {
    /* A ROLE, not a rule: three looks below have no business drawing viewfinder
       brackets ("no border anywhere", "one hairline", "hairline rules only"),
       and `display: none` on a decorative `<span>` is the honest removal. */
    display: var(--reel-corner-display);
    position: absolute;
    z-index: 4;
    /* `cqw`, not `vw`: the mark should track the frame it sits on, not the
       window (contract A14). */
    width: clamp(1rem, 2.2cqw, 1.6rem);
    height: clamp(1rem, 2.2cqw, 1.6rem);
    /* `--jp-accent-mark`, never `--jp-accent-edge`: every accent value of
       `--jp-accent-edge` measures below the 3:1 graphic floor on a dark brand
       (1.27 at `glow`, 1.49/2.04/2.04 at text/fill/edge — measured
       independently by both round-3 worktrees). */
    border: 0 solid var(--reel-corner-color);
    pointer-events: none;
  }

  .reel__corner--tl {
    top: var(--space-5);
    left: var(--space-5);
    border-top-width: var(--reel-corner-width);
    border-left-width: var(--reel-corner-width);
  }
  .reel__corner--tr {
    top: var(--space-5);
    right: var(--space-5);
    border-top-width: var(--reel-corner-width);
    border-right-width: var(--reel-corner-width);
  }
  .reel__corner--bl {
    bottom: var(--space-5);
    left: var(--space-5);
    border-bottom-width: var(--reel-corner-width);
    border-left-width: var(--reel-corner-width);
  }
  .reel__corner--br {
    bottom: var(--space-5);
    right: var(--space-5);
    border-bottom-width: var(--reel-corner-width);
    border-right-width: var(--reel-corner-width);
  }

  /* ── top meta: rec tag + duration ── */
  .reel__topmeta {
    display: flex;
    align-items: center;
    /* `duration` is a free-text builder field and can hold anything; wrapping
       degrades a long value rather than truncating a creator's own copy. */
    flex-wrap: wrap;
    gap: var(--space-4);
    /* Metadata one step below the `type` axis's card-scale rung (contract A44),
       derived FROM the rung so `type` reaches it, floored at `--text-xs` which
       research §5.1 permits for metadata only. */
    font-size: var(--reel-meta-size);
  }

  /* AT THE TOP OF THE MEDIA — and `--jp-media-scrim` is bottom-anchored
     (`linear-gradient(to top, …)`), so NOTHING here is scrimmed, at any aspect.
     That is a property of the token, not of this composition, so top-anchored
     chrome must carry its own plate. Measured without one: the tag's worst
     backdrop pixel was `rgb(91,76,108)` — the candlelight bloom — at **2.69:1**
     on `of-blood-and-bones` light. The plates are on the children below. */
  .reel__topmeta[data-reel-at='over'] {
    position: absolute;
    z-index: 4;
    top: 0;
    left: 0;
    right: 0;
    justify-content: space-between;
    padding: clamp(var(--space-4), 2.8cqw, var(--space-7))
      clamp(var(--space-5), 3cqw, var(--space-8));
    pointer-events: none;
  }

  .reel__topmeta[data-reel-at='over'] .reel__tag,
  .reel__topmeta[data-reel-at='over'] .reel__dur {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--reel-pill-radius);
    /* 88%, not a glassy 55%: contract A39 — an alpha low enough to read as faint
       measures against the poster rather than against the plate.

       SEE THE HANDOFF: a duplicate `.reel__topmeta[data-reel-at='over']
       .reel__dur` block further down this file re-declares this background at
       55% and, being later at equal specificity (0,3,0), WINS for the duration
       pill. So A39's 88% currently reaches only the rec tag. That override is on
       `media: bleed`, i.e. candlelit's own pill, so it is deliberately left
       alone here and reported instead — it needs a re-measure, not a
       sibling-look pass. */
    background: color-mix(in oklab, var(--color-background) 88%, transparent);
    border: var(--reel-plate-border);
    -webkit-backdrop-filter: blur(var(--reel-plate-blur));
    backdrop-filter: blur(var(--reel-plate-blur));
  }

  .reel__topmeta[data-reel-at='below'] {
    justify-content: var(--jp-align);
  }

  .reel__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--reel-label-font);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    /* 0.28em has no token; the role's default derives it from `--tracking-wider`
       (0.05em), which is what this shipped. `--tracking-widest` (0.1em) now
       exists and the two mono-label looks below take it — 0.28em on a monospaced
       face reads as spaced-out capitals rather than as a label. */
    letter-spacing: var(--reel-label-tracking);
    color: var(--color-heading);
  }

  .reel__dot {
    width: var(--reel-dot-size);
    height: var(--reel-dot-size);
    border-radius: var(--reel-dot-radius);
    /* `--jp-accent-mark`, never `--jp-accent-fill`: the fill is `transparent` at
       `accent: text` and `accent: edge`, so a small brand dot painted with it
       vanishes on two of five values (pilot lesson 4). */
    background: var(--jp-accent-mark);
  }

  .reel__dot.is-live {
    animation: reel-pulse calc(var(--jp-reveal-duration) * 5) var(--ease-in-out)
      infinite;
  }

  @keyframes reel-pulse {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 1;
    }
  }

  .reel__dur {
    font-family: var(--reel-num-font);
    font-size: var(--reel-num-size);
    font-weight: var(--reel-num-weight);
    letter-spacing: var(--tracking-wide);
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
  }

  /* THE DUPLICATE, LEFT AS IT COMPUTES. Everything here except the background
     alpha repeats the combined rule above, and the 55% is what actually paints —
     which is the A39 defect the note up there records and the handoff carries.
     Its four repeated declarations are routed through the same roles so a look
     cannot get a half-applied pill, and the background is untouched so candlelit
     resolves byte-identically to the base commit. */
  .reel__topmeta[data-reel-at='over'] .reel__dur {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--reel-pill-radius);
    background: color-mix(in oklab, var(--color-background) 55%, transparent);
    border: var(--reel-plate-border);
    -webkit-backdrop-filter: blur(var(--reel-plate-blur));
    backdrop-filter: blur(var(--reel-plate-blur));
  }

  /* ── lower block: caption whisper + player chrome ── */
  .reel__lower {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--space-3), 2cqw, var(--space-5));
  }

  /* THE BLOCK CARRIES ITS OWN COPY OF THE SCRIM.

     `--jp-media-scrim` is a gradient over the MEDIA box, so its opaque end is a
     fixed fraction of a box whose height varies — and a caption that wraps to a
     second line climbs out of the opaque zone onto the raw poster. Reading the
     same token on this block's OWN box makes the guarantee travel with the text:
     the gradient grows with the block, and the extra `padding-block-start` is the
     fade lead-in so the glyphs sit in the opaque part.

     This is the half of the aspect↔scrim rule that a `min-height` floor cannot
     cover: the floor stops the BOX shrinking under the text, and this stops the
     TEXT growing out of the box's protected zone. Both directions matter. */
  .reel__lower[data-reel-at='over'] {
    position: absolute;
    z-index: 4;
    left: 0;
    right: 0;
    bottom: 0;
    padding: clamp(var(--space-4), 3cqw, var(--space-8));
    padding-block-start: calc(var(--jp-sec-gap) * 1.5);
    background: var(--jp-media-scrim);
  }

  /* THE CAPTION NOW READS THE `align` AXIS instead of pinning centre.
     `--jp-align` / `--jp-text-align` are `center` / `center` at `align: center`,
     which is candlelit's value AND the root default, so this resolves
     byte-identically to the `center` / `center` it replaces — and the four
     `align: start` looks stop having one centred line in an otherwise
     left-ranged column, which was the one place this section overrode the axis
     that exists to delete alignment variants. */
  .reel__caption {
    align-self: var(--jp-align);
    text-align: var(--jp-text-align);
    margin: 0;
    font-family: var(--reel-caption-font);
    font-style: var(--reel-caption-style);
    font-weight: var(--font-normal);
    /* Exactly the `type` axis's card-scale rung (contract A44). The old local
       `clamp(--text-base, 2.5vw, --text-2xl)` was an independent invention of
       the same rung — read it, never re-spell it. */
    font-size: var(--jp-body-size);
    line-height: var(--leading-snug);
    color: var(--color-heading);
    max-width: 32ch;
    transition: opacity var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  .reel__caption::before {
    content: '\201C';
    opacity: var(--reel-caption-mark);
    margin-right: 0.06em;
  }

  .reel__caption::after {
    content: '\201D';
    opacity: var(--reel-caption-mark);
    margin-left: 0.06em;
  }

  .reel__caption.is-fading {
    opacity: 0;
  }

  .reel__chrome {
    display: flex;
    align-items: center;
    gap: clamp(var(--space-3), 2cqw, var(--space-5));
  }

  /* play button — glassy invitation, opens the real HLS modal */
  .reel__play {
    position: relative;
    flex: none;
    /* WCAG 2.5.5 measures the POINTER target, i.e. the border box (contract
       A61). The old `clamp(2.7rem, 4.4vw, 3.3rem)` floored at 43.2px — under the
       44px floor at every width below 1000px. */
    width: max(var(--tap-target-min), clamp(2.75rem, 4.4cqw, 3.3rem));
    height: max(var(--tap-target-min), clamp(2.75rem, 4.4cqw, 3.3rem));
    border-radius: var(--reel-pill-radius);
    display: grid;
    place-items: center;
    color: var(--reel-play-color);
    background: var(--reel-play-bg);
    /* Full-strength `--jp-accent-mark`, not a faint mix: no alpha low enough to
       read as faint clears 3:1 at the dark pole (contract A39), and this border
       is the control's only boundary — WHICH IS WHY NO LOOK BELOW DELETES IT.
       `open-air`'s "no border anywhere" is spent on the frame, the brackets and
       the plates; `signal` swaps it for an opaque accent FILL, which is a
       stronger boundary than the border it replaces, not a weaker one. A tell is
       not a licence to drop a control under the 3:1 graphic floor. */
    border: var(--reel-play-border);
    /* `accent: glow` IS Candlelit, i.e. what all 695 backfilled pages hold, so an
       unconsumed `--jp-accent-glow` would be a bloom that never blooms on every
       published page. This is its only consumer in the section.

       THE WHOLE VALUE of `box-shadow`, never one item of a list: the token is the
       keyword `none` at the other four accent values, and `none` cannot be a
       shadow-list item — the declaration would be invalid at computed-value time
       and fall back to the initial `none`. That is contract A54's mechanism,
       which is about the KEYWORD rather than the `--jp-edge-*` family, and it
       also catches `--jp-media-scrim` and `--jp-media-mask`. */
    box-shadow: var(--reel-play-shadow);
    -webkit-backdrop-filter: blur(var(--reel-play-blur));
    backdrop-filter: blur(var(--reel-play-blur));
    cursor: pointer;
    transition:
      transform var(--duration-fast) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out);
  }

  .reel__play:hover {
    transform: translateY(calc(var(--space-1) * -0.5));
    background: var(--reel-play-bg-hover);
  }

  .reel__play:active {
    transform: translateY(0) scale(0.96);
  }

  /* `edge: none` and `edge: soft` remove borders; they must NEVER remove a focus
     ring (research §5.1). The ring is on `outline`, which no `edge` value
     touches. */
  .reel__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  /* `--empty` is gone with its markup: a dimmed, cursor-default play glyph is
     still a play glyph, and a course with no preview clip now renders no frame
     rather than a decorative one. `--pending` stays — it stands for a real clip
     that has not resolved yet. */
  /* Two byte-adjacent blocks on the same selector, merged. Nothing computed
     changes; the pair was a leftover from splitting the `--empty` branch out. */
  .reel__play--pending {
    cursor: default;
    opacity: 0.65;
    animation: reel-skeleton calc(var(--jp-reveal-duration) * 1.75)
      var(--ease-in-out) infinite;
  }

  /* gentle invitation ring — enhancement only (armed by JS).
     On `outline`, with a negative offset, NOT composed into `box-shadow`:
     `--jp-edge-shadow` is the keyword `none` at `edge: none` (Candlelit, so every
     published page) and at `edge: heavy`, and `none` cannot be one item of a
     shadow list — the whole declaration would be invalid at computed-value time
     and fall back to `none`, painting nothing (contract A54). */
  .reel__play::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    outline: var(--border-width) solid
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent);
    outline-offset: calc(var(--border-width) * -1);
    opacity: 0;
  }

  .reel__play.is-armed::after {
    animation: reel-ring calc(var(--jp-reveal-duration) * 3.5) var(--ease-out)
      infinite;
  }

  @keyframes reel-ring {
    0% {
      transform: scale(1);
      opacity: 0.7;
    }
    70% {
      transform: scale(1.55);
      opacity: 0;
    }
    100% {
      transform: scale(1.55);
      opacity: 0;
    }
  }

  .reel__play-icon {
    display: inline-flex;
    width: 44%;
    height: 44%;
    /* Optical centring of the play triangle, on the token scale rather than the
       old raw `3px`. */
    margin-left: calc(var(--space-1) * 0.75);
  }

  /* waveform scrubber */
  .reel__track {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: clamp(1.5rem, 3.4cqw, 2.4rem);
  }

  .reel__wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .reel__wave--base {
    color: color-mix(in oklab, var(--color-heading) 30%, transparent);
  }

  .reel__wave--fill {
    color: var(--jp-accent-mark);
    clip-path: inset(0 100% 0 0);
  }

  .reel__playhead {
    position: absolute;
    top: -12%;
    bottom: -12%;
    left: 0;
    width: var(--border-width-thick);
    background: var(--color-heading);
    opacity: 0;
  }

  /* streamed-play skeleton */
  .reel__track--pending {
    display: flex;
    align-items: center;
  }

  .reel__skeleton {
    width: 100%;
    height: 40%;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-heading) 18%, transparent);
    animation: reel-skeleton calc(var(--jp-reveal-duration) * 1.75)
      var(--ease-in-out) infinite;
  }

  @keyframes reel-skeleton {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 0.85;
    }
  }

  /* ── COMPOSITIONS ──────────────────────────────────────────────────────
     Arrangement only. Ported from the since-deleted `render-edit/journey-sections/_video.css`
     (`.jp-video--split`'s two-column wrap; `.jp-video--simple`'s hidden corners
     and tag, expressed positively as `framedChrome`). No composition sets a type
     scale — that is the `type` axis. */

  /* `split` — copy column beside the clip. `_video.css` used `1fr 1.1fr`; kept,
     with its `@container (max-width: 520px)` breakpoint inverted to a min-width
     so the single column is the baseline rather than the override. */
  .reel__split {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--jp-sec-gap);
    align-items: center;
  }

  @container (min-width: 34rem) {
    .reel__split {
      grid-template-columns: 1fr 1.1fr;
    }
    .reel__split .reel__lead,
    .reel__split .reel__sub {
      max-width: none;
    }
  }

  /* `waveform` — the equaliser IS the section. A panel rather than a letterbox,
     so there is no poster and nothing sits over media. */
  .reel__audio {
    display: flex;
    flex-direction: column;
    gap: var(--jp-sec-gap);
    padding: var(--jp-sec-gap);
    border-radius: var(--reel-audio-radius);
    background: var(--reel-audio-bg);
    /* Both `0 none` / `none` by default, so this panel is exactly the flat
       `--radius-card` block it shipped as. The looks whose whole tell is a boxed
       surface give it a real edge below, and `invert` re-points its background —
       `--color-surface-secondary` is a GLOBAL token, so under `surface: invert`
       the panel stayed at pole A inside a pole-B band, which is an un-inverted
       patch in an inverted section (see the handoff: the generic fix is
       `--jp-ink-2`, but it would move candlelit's `waveform` panel). */
    border: var(--reel-audio-border);
    box-shadow: var(--reel-audio-shadow);
  }

  [data-reel-composition='waveform'] .reel__track {
    /* The transport is the section's subject here, not a 24px afterthought. */
    height: clamp(4rem, 14cqw, 7rem);
  }

  /* ── reveal-on-scroll ──
     The shared `.jp-reveal` atom + `data-jp-step` ladder from
     `journey-sections-shared.css` carry the `motion` axis. The hidden state
     applies only under `.reveal--armed`, which the action adds from JS, so SSR
     and no-JS paint the content fully revealed and can never get stuck. */

  /* ═══ PER-LOOK COMMITMENTS ═══════════════════════════════════════════════
     Everything above is axis-generic: it consumes magnitudes and paints four
     arrangements. What follows commits each design LANGUAGE to its documented
     tell (`00-design-language-research.md` §1), because a tell is a
     SELECTOR-level statement — which elements are boxes, which corner is
     square, which label is monospaced, which rule is drawn at all — and
     `journey-design.css` deliberately emits nothing but custom properties.

     ── WHY THIS SECTION NEEDED THE PASS ─────────────────────────────────────
     MEASURED ON THE BASE: `--jp-edge-width` / `--jp-edge-color` /
     `--jp-edge-shadow` had exactly ONE consumer in this file, `.reel` itself.
     Every box INSIDE the section was edge-blind: the letterbox frame carried a
     fixed `--jp-accent-mark` 22% hairline and `--shadow-xl` whenever the
     composition was `theatre`/`split` and nothing otherwise; the over-plates
     carried a fixed `--color-heading` 16%; and `.reel__audio` — the whole
     subject of the `waveform` composition — painted `--color-surface-secondary`
     at `--radius-card` with no border and no elevation on ALL EIGHT looks.

     The visible consequence is that seven of the eight looks rendered as the
     same cinematic letterbox with different spacing. Candlelit's own tell
     features (ember bloom, viewfinder brackets, drifting haze, grain, the
     `--jp-accent-glow` on the control) are all present and all correct; what was
     missing is any reason to believe the other seven are design languages at
     all. So every block below ADDS a commitment to a sibling — and the
     brackets, which are candlelit's signature, are now switched OFF on five of
     the seven, because differentiating the siblings is the work, not copying the
     one that already reads.

     ── THE SELECTOR DISCIPLINE, stated once so every block can be checked ───
     `candlelit` is the one preset that already works and it must come out of
     this pass byte-identical. It is uniquely identified by FOUR of its nine
     axis values — `surface: media`, `edge: none`, `media: bleed`,
     `accent: glow` — and SHARES the other five: `type: monumental` (with
     quiet-studio, plain-facts), `align: center` (quiet-studio, open-air,
     full-send), `density: airy` (open-air), `width: text` (long-read,
     open-air), `motion: drift` (open-air).

     So NO selector below is keyed on any of those five. Every one names one of
     these twelve, and evaluating each against the candlelit bundle gives zero
     matches:

       edge: offset                     → plain-facts  only
       accent: edge                     → syllabus     only
       type: restrained                 → syllabus     only
       accent: none                     → quiet-studio only
       density: vast                    → quiet-studio only
       motion: fade                     → quiet-studio only
       edge: soft                       → open-air     only
       edge: heavy                      → full-send    only
       motion: stagger                  → full-send    only
       media: mask                      → open-air + full-send (never candlelit,
                                          which is `bleed`)
       surface: bare  + align: start    → long-read    only
       edge: hairline + accent: fill    → signal       only

     The last two are COMPOUNDS by necessity rather than by taste: `long-read`
     and `signal` each share all nine of their axis values with some sibling, so
     neither has a single value to key on. Each is justified in its own block.

     `open-air` is the dangerous one — it shares FOUR axes with candlelit — so
     every open-air rule is keyed on `edge: soft`, which candlelit (`edge: none`)
     cannot match.

     THE ALIGN CHANNEL IS `data-reel-align`, not a second `data-align`: it
     already exists on this element for the editorial-split container query, and
     one axis with two local attributes is one too many. It defaults to
     `'center'` when no design resolves, which only ever makes the `align: start`
     compound fail to match — the safe direction.

     WHAT NO BLOCK BELOW DOES: paint `.cta`. `journey-design.test.ts`
     ("is the only styler of .cta in the section tree", Codex-kdsuo) reserves the
     pay button's colours to `CtaLink`, because that contrast is guaranteed in
     exactly one place. This section has no `.cta` at all; its one control is
     `.reel__play`, which is a preview affordance and not a purchase. */

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `align: start` ──────
     Tell: the eyebrow and the body share a left edge, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY. `surface: bare` is shared with `quiet-studio` and
     `align: start` with `plain-facts`, `syllabus` and `signal` — but
     `quiet-studio` is `align: center` and none of the other three is
     `surface: bare`, so the PAIR is `long-read` alone. Candlelit is
     `surface: media`, so it matches neither half.

     MEASURED ON THE BASE: the head hairline was found NOWHERE in this file, and
     the shared left edge was actively BROKEN — the container query above
     right-aligns `.reel__sub` at `align: start`, which is the correct editorial
     SPLIT for `plain-facts`/`syllabus`/`signal` but is the one thing this look's
     tell forbids. A right-ranged deck does not share a left edge with the
     eyebrow. So this look takes the column and the rule instead of the split,
     and the counterpart lives inside the same container query below. */
  .reel[data-surface='bare'][data-reel-align='start'] {
    --reel-head-rule: var(--border-width);
    --reel-head-gap: calc(var(--jp-sec-gap) / 3);
    /* HAIRLINE HORIZONTAL RULES ONLY; NO BOX BORDERS ANYWHERE. The section's
       own hairline box becomes a single rule beneath it, which is what separates
       one editorial section from the next. */
    border: 0 none;
    border-block-end: var(--jp-edge-width) solid var(--jp-edge-color);
    /* AND THE SHELL'S ELEVATION WITH IT. `.reel` reads `--jp-edge-shadow`, which
       is `--shadow-xs` at this look's `edge: hairline`, and a box shadow paints
       around the border box whether or not the background is transparent — so
       `surface: bare` plus a shadow is a faint box drawn around nothing, which
       is the box border this tell forbids, arriving by another route. */
    box-shadow: none;
    /* The viewfinder brackets are cinematic chrome and this family draws none;
       the frame keeps a neutral hairline instead of the accent mix. */
    --reel-corner-display: none;
    --reel-frame-border: var(--border-width) solid var(--color-border-subtle);
    --reel-frame-shadow: none;
    --reel-plate-border: 0 none;
    --reel-audio-border: 0 none;
    --reel-audio-shadow: none;
    /* THE ACCENT IS TEXT COLOUR AND NOTHING ELSE at this look's `accent: text`,
       so the opening quote is where it lands — full strength rather than the
       0.4 whisper the cinematic caption wants. */
    --reel-caption-mark: 1;
  }

  @container (min-width: 48rem) {
    /* (0,4,0) against the split rule's (0,3,0), so these win on specificity
       wherever both match. Kept inside the same query as the rule they undo, so
       the pair is readable as a pair. */
    .reel[data-surface='bare'][data-reel-align='start'] .reel__head {
      flex-direction: column;
      align-items: flex-start;
      gap: calc(var(--jp-sec-gap) * 0.5);
    }
    .reel[data-surface='bare'][data-reel-align='start'] .reel__sub {
      text-align: left;
      padding-bottom: 0;
    }
  }

  /* The caption joins the running measure rather than sitting on its own 32ch
     display cap — it is body copy in this family, not a cinematic whisper. */
  .reel[data-surface='bare'][data-reel-align='start'] .reel__caption {
    max-width: var(--jp-measure);
  }

  /* The magazine drop-quote. `--jp-accent-text` is `--jp-ember-text` at every
     value that tints text (13.93 light / 5.40 dark on the golden org), NEVER
     `--jp-ember`, which measures 2.04:1 dark — the single most likely
     regression in this programme, per the research. `line-height: 0` keeps the
     1.6em glyph from opening the line box. */
  .reel[data-surface='bare'][data-reel-align='start'] .reel__caption::before {
    color: var(--jp-accent-text);
    font-size: 1.6em;
    line-height: 0;
    vertical-align: -0.3em;
  }

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere.

     MEASURED ON THE BASE: the 2px border was reachable on the shell, but the
     offset shadow reached NOTHING inside the section and radius 0 reached
     NOTHING at all — the shell keeps `--radius-card` under `surface: panel`, the
     pills are `--radius-full`, the play control is `--radius-full` and the
     waveform bars carry `rx="3"`. Worse, `plain-facts` is `media: none`, so the
     letterbox does not render and the ONLY boxes it has are the shell, the head
     and (in `waveform`) the audio panel. That is why this look read as broken
     rather than as plain: it is a look about boxes with no box to draw on.

     The head becomes that box, so the hard drop has a carrier that always
     exists — same move `GuideSection` makes with `.guide__body`. */
  .reel[data-edge='offset'] {
    /* RADIUS 0, ABSOLUTELY — the tell's own adverb, and the shell has to be
       squared off too: `--jp-sec-radius` is `--radius-card` under
       `surface: panel`, which is this look's surface. */
    border-radius: var(--radius-none);
    --reel-pill-radius: var(--radius-none);
    --reel-dot-radius: var(--radius-none);
    --reel-audio-radius: var(--radius-none);
    /* MONO LABELS. `--tracking-widest` (0.1em) rather than the rec tag's
       default 0.28em: on a monospaced face, which already carries its own
       advance, 0.28em reads as spaced-out capitals and not as a label. */
    --reel-label-font: var(--font-mono);
    --reel-label-tracking: var(--tracking-widest);
    --reel-num-font: var(--font-mono);
    /* 2px BORDERS AND A HARD, UN-BLURRED DROP. `--jp-edge-shadow` is
       `var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)` at this value —
       a 4px offset with a zero blur radius, which is the tell exactly. Taken as
       the WHOLE value of each `box-shadow` (contract A54). The backdrop blurs go
       to zero for the same reason the radii do: glass is not a brutalist
       material. */
    --reel-plate-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-plate-blur: 0px;
    --reel-play-blur: 0px;
    --reel-play-shadow: var(--jp-edge-shadow);
    --reel-audio-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-audio-shadow: var(--jp-edge-shadow);
    /* The whispered italic serif caption is the cinematic register; this family
       states facts. */
    --reel-caption-style: normal;
  }

  /* THE BOX THAT ALWAYS EXISTS. `:has()` rather than a bare `.reel__head`
     because the head element renders even when the section has no copy at all
     (the `waveform` composition can stand on a clip alone), and a 2px box with
     `--jp-sec-gap` of padding around nothing is a worse defect than the one this
     fixes. */
  .reel[data-edge='offset']
    .reel__head:has(.reel__eyebrow, .reel__title, .reel__sub) {
    padding: var(--jp-sec-gap);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
    border-radius: var(--radius-none);
  }

  /* RADIUS 0 EVERYWHERE reaches the equaliser too. `rx` is an SVG geometry
     property and is settable from CSS, so the bars square off WITHOUT touching
     the `rx="3"` attribute the test pins as byte-identical to the 32
     hand-authored rects. A browser that does not support geometry properties in
     CSS keeps the rounded bars, which is a graceful floor rather than a break. */
  .reel[data-edge='offset'] .reel__wave rect {
    rx: 0;
  }

  /* The control presses INTO its own offset shadow. `motion: none` is this
     look's motion value, so `--jp-reveal-duration` is `0ms` and the press is a
     genuinely INSTANT state change — which is what the family's motion row asks
     for, not a fast animation. `translate` rather than `transform` so the box
     does not shrink: contract A2's 44px floor is a floor in both directions. */
  .reel[data-edge='offset'] .reel__play:hover {
    transform: none;
    translate: var(--space-1) var(--space-1);
    box-shadow: none;
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ONLY ───────────────────
     Tell: no border anywhere, pill controls, and a shadow you have to look for.

     KEYED ONLY ON `edge: soft`. This look shares FOUR axes with candlelit
     (`align: center`, `density: airy`, `width: text`, `motion: drift`) and a
     bare rule on any of them would restyle the one preset that works.
     `edge: soft` is open-air's and nobody else's, and candlelit is `edge: none`.

     MEASURED ON THE BASE: the pills are genuinely there and the arch comes free
     from `media: mask`. "No border anywhere" was not — the frame's accent-mix
     hairline and the over-plates' 16% border are both spelled locally, which the
     `edge` axis cannot reach at any value. And "a shadow you have to look for"
     reached nothing: `--jp-edge-shadow` is `--shadow-lg` here (a 10%/5%-alpha,
     14px-blur drop — "large, very diffuse, very low opacity") and had no
     consumer inside the section, while the frame carried a flat `--shadow-xl`
     regardless of the axis.

     THE PLAY CONTROL KEEPS ITS 2px BORDER. "No border anywhere" is spent on the
     frame, the brackets and the plates; the control's border is its only 3:1
     boundary (contract A39 — no alpha low enough to read as faint clears it at
     the dark pole), and a tell is not a licence to drop a control under the
     graphic floor. What the control gains instead is the family's elevation. */
  .reel[data-edge='soft'] {
    --reel-frame-border: 0 none;
    --reel-frame-shadow: var(--jp-edge-shadow);
    --reel-plate-border: 0 none;
    --reel-corner-display: none;
    --reel-play-shadow: var(--jp-edge-shadow);
    --reel-audio-border: 0 none;
    --reel-audio-shadow: var(--jp-edge-shadow);
    --reel-audio-radius: var(--radius-xl);
  }

  /* "Accent as tinted background + accent text. NEVER a hard fill." The caption
     becomes a soft tinted panel at `--radius-xl`, the family's own panel radius,
     carrying the same shadow you have to look for.

     The 8% mix sits on `--jp-accent-mark`, which is `--jp-ember-text` at four of
     five accent values and `--jp-heading` at the fifth — never a pre-mixed
     value — so this is NOT contract A37's mix-of-a-mix. `--jp-accent-edge` would
     have been exactly that: it is already a 45% ember mix at `accent: glow`. */
  .reel[data-edge='soft'] .reel__caption {
    padding: var(--space-5) var(--space-7);
    border-radius: var(--radius-xl);
    background: color-mix(in oklab, var(--jp-accent-mark) 8%, transparent);
    box-shadow: var(--jp-edge-shadow);
  }

  /* AN ARCH CLIPS A BRACKET INTO FRAGMENTS — a geometry fact, not a taste call.
     `--jp-media-mask` is a wide ellipse across the top two corners, and
     `.reel__frame` applies it as `clip-path`, so a corner mark inset by
     `--space-5` lands partly outside the clip. `media: mask` is `open-air` +
     `full-send` and never candlelit, which is `bleed`. */
  .reel[data-media='mask'] {
    --reel-corner-display: none;
  }

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
        · `motion: fade` ────────────────────────────────────────────────────
     Tell: three type sizes, ONE hairline, no accent colour, and more empty space
     than content.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so nearly every rule below
     REMOVES something.

     MEASURED ON THE BASE: "no accent colour" already holds — at `accent: none`
     the axis resolves `--jp-accent-mark` to `--jp-heading`, so the brackets and
     the frame hairline are neutral mixes rather than ember. The two that did NOT
     hold are arithmetic. THREE TYPE SIZES: the section renders the heading at
     `--jp-heading-size`, the deck at a flat `--text-base`, the caption at
     `--jp-body-size`, the eyebrow at `--jp-eyebrow-size` and the meta row at
     `max(--text-xs, --jp-body-size / 1.5)` — five, of which the last two differ
     by 2px at this look's `monumental` for no reason anyone can see. ONE
     HAIRLINE: the section shipped a hairline shell box (`edge: hairline`), a
     hairline frame, two bordered over-plates and four bracket marks. */
  .reel[data-accent='none'] {
    /* THE ONE HAIRLINE is the picture mount's own boundary — at this look's
       `media: inset` the frame is a 3:2 image on a `--space-12` mount, which is
       most of what the eye reads, so that is where a single line belongs. Every
       other boundary in the section goes, starting with the shell's: a hairline
       box around a `surface: bare` transparent background is a second line
       drawn around nothing — and its `--shadow-xs` elevation is a third, because
       a box shadow paints around the border box whether or not the background is
       transparent. */
    border: 0 none;
    box-shadow: none;
    --reel-frame-border: var(--border-width) solid var(--color-border-subtle);
    --reel-frame-shadow: none;
    --reel-corner-display: none;
    --reel-plate-border: 0 none;
    --reel-plate-blur: 0px;
    --reel-audio-border: 0 none;
    --reel-audio-shadow: none;
    --reel-audio-radius: var(--radius-none);
    /* THREE TYPE SIZES, as an arithmetic commitment: heading
       (`--jp-heading-size`), body (`--jp-body-size`) and meta
       (`--jp-eyebrow-size`). The meta row folds onto the eyebrow's rung rather
       than keeping a fourth value 2px away from it. */
    --reel-meta-size: var(--jp-eyebrow-size);
  }

  /* The deck joins the body rung, which is the third of the three sizes. */
  .reel[data-accent='none'] .reel__sub {
    font-size: var(--jp-body-size);
  }

  /* The curly quotation ornaments are the cinematic register's decoration, and
       this family has no decoration. `display: none` rather than opacity, so
       they take no advance width either. */
  .reel[data-accent='none'] .reel__caption::before,
  .reel[data-accent='none'] .reel__caption::after {
    display: none;
  }

  /* MORE EMPTY SPACE THAN CONTENT. `density: vast` already multiplies the
     shared rhythm by 1.6; this is the look going further than the axis, which is
     the point of the tell — the axis makes it airy, the LOOK makes the emptiness
     the subject. Keyed on `density: vast`, which is quiet-studio's alone
     (candlelit is `airy`). */
  .reel[data-density='vast'] .reel__inner {
    gap: calc(var(--jp-sec-gap) * 1.5);
  }

  .reel[data-density='vast'] .reel__lower {
    gap: calc(var(--jp-sec-gap) * 0.75);
  }

  /* THE STILLNESS. `motion: fade` is quiet-studio's own motion value and nobody
     else's. `--jp-reveal-distance` is already `0px` at this value, so the reveal
     is a pure opacity ramp — but the rec dot's pulse and the play control's
     invitation ring are CONTINUOUS decorative motion driven from JS, which the
     axis's distance and duration cannot reach, and a luxury-minimal page does
     not blink at you. The atmosphere's bloom and haze need no rule: they are
     inside the `--jp-sec-atmos` gate, which is `0` at every surface but
     `media`. */
  .reel[data-motion='fade'] .reel__dot.is-live,
  .reel[data-motion='fade'] .reel__play.is-armed::after {
    animation: none;
  }

  .reel[data-motion='fade'] .reel__play:hover {
    transform: none;
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a hairline grid, mono numerals, and a left-border accent stripe rather
     than a filled badge.

     MEASURED ON THE BASE: none of the three reached this section. The duration
     carries `font-variant-numeric: tabular-nums` but proportional GLYPHS, which
     is the half of monospacing that does not show; the rec tag is a
     `--radius-full` pill — the filled badge the tell names in opposition; and
     the only rules in the file are the frame's border and the top sheen. The
     `--radius-sm` corner and the hairline are the family's own two values. */
  .reel[data-accent='edge'] {
    --reel-pill-radius: var(--radius-sm);
    --reel-audio-radius: var(--radius-sm);
    /* HAIRLINE ON EVERYTHING — including the brackets, which stop being
       cinematic viewfinder marks at `--border-width` and start reading as the
       crop marks on a technical drawing. */
    --reel-corner-width: var(--border-width);
    /* NEUTRAL crop marks, not dimmed ember ones. `--jp-accent-mark` is
       `--jp-ember-text` at this value, and an ember bracket is candlelit's
       signature read faintly — the opposite of a distinct language. A technical
       drawing's crop marks are drawn in the line colour. */
    --reel-corner-color: var(--color-border-strong);
    --reel-frame-border: var(--border-width) solid var(--color-border-subtle);
    --reel-frame-shadow: none;
    --reel-plate-border: var(--border-width) solid var(--color-border-subtle);
    --reel-plate-blur: 0px;
    --reel-audio-border: var(--border-width) solid var(--color-border-subtle);
    --reel-audio-shadow: none;
    /* The hairline under the section head, so the block reads as a table with a
       header row. Same two roles `long-read` sets — one line, one spelling. */
    --reel-head-rule: var(--border-width);
    --reel-head-gap: calc(var(--jp-sec-gap) / 3);
    /* MONO NUMERALS, and mono labels with them: a dashboard's metadata row is
       one typeface. */
    --reel-num-font: var(--font-mono);
    --reel-label-font: var(--font-mono);
    --reel-label-tracking: var(--tracking-widest);
    --reel-dot-radius: var(--radius-none);
  }

  /* THE LEFT-BORDER ACCENT STRIPE. The tell states it in OPPOSITION to "a
     filled badge", so the rec tag loses the pill and gains a stripe.

     `--jp-accent-mark`, NOT `--jp-accent-edge`: every accent value of
     `--jp-accent-edge` measures below the 3:1 graphic floor on a dark brand
     (2.04:1 at THIS one), which the corner-mark note above already records,
     while `--jp-accent-mark` measures 5.00 dark / 10.47 light. A stripe that
     carries the tell has to be seen. Read directly, with no mix on it
     (contract A37). */
  .reel[data-accent='edge'] .reel__tag {
    padding-inline-start: var(--space-3);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
    border-radius: var(--radius-none);
  }

  /* THE HAIRLINE GRID, on the two rows that always exist. Scoped to
     `data-reel-at='below'`, which is where this look's `media: frame` puts them
     — and which candlelit (`over`) is not, so this is belt and braces on top of
     the `accent: edge` key. */
  .reel[data-accent='edge'] .reel__topmeta[data-reel-at='below'] {
    padding-block-end: calc(var(--jp-sec-gap) / 3);
    border-block-end: var(--border-width) solid var(--color-border-subtle);
  }

  .reel[data-accent='edge'] .reel__lower[data-reel-at='below'] {
    padding-block-start: calc(var(--jp-sec-gap) / 3);
  }

  /* The equaliser gets a baseline rather than tick marks: a ruled axis is
     honest about the data it has, and this transport has no progress to report
     (see the handoff on `.reel__playhead`). */
  .reel[data-accent='edge'] .reel__track {
    border-block-end: var(--border-width) solid var(--color-border-subtle);
  }

  /* `type: restrained` is syllabus's type value and nobody else's, so the
     dense-dashboard reading rhythm lands here: normal rather than relaxed
     leading on the deck, and a caption in the body face set upright. An italic
     serif whisper is the cinematic register; a syllabus annotates. */
  .reel[data-type='restrained'] {
    --reel-caption-font: var(--font-body);
    --reel-caption-style: normal;
  }

  .reel[data-type='restrained'] .reel__sub {
    line-height: var(--leading-normal);
  }

  .reel[data-type='restrained'] .reel__caption::before,
  .reel[data-type='restrained'] .reel__caption::after {
    display: none;
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` · `motion: stagger` ───────
     Tell: whole inverted bands, pill CTAs at `--radius-full`, spring easing, and
     BIG NUMERALS.

     MEASURED ON THE BASE: the inverted band comes free from `surface: invert`
     and the pill control is already `--radius-full`, so two of four hold. BIG
     NUMERALS were found NOWHERE — this section's numeral is the duration badge
     ("0:30"), and at `max(--text-xs, --jp-body-size / 1.5)` inside a glassy pill
     it was the quietest thing in the section. SPRING EASING was found nowhere
     either: `--jp-reveal-ease` is `--ease-spring` at this motion value and the
     reveal already rides it, but a reveal happens once, off-screen, and the one
     place a viewer can FEEL an easing curve is the control they are pointing at.

     `--reel-audio-border` reads `--jp-edge-*`, which is 2px in
     `--jp-accent-edge` here — a thick accent border around an inverted band,
     which is the family's edge row exactly. */
  .reel[data-edge='heavy'] {
    --reel-frame-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-frame-shadow: none;
    --reel-plate-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-audio-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-audio-shadow: none;
    --reel-audio-radius: var(--radius-xl);
    /* BIG NUMERALS — the duration climbs from the metadata rung to the heading
       rung and takes the heading face with it, so the tracked rec label reads as
       the caption to a number rather than as its equal. */
    --reel-num-font: var(--font-heading);
    --reel-num-size: var(--jp-heading-size);
    --reel-num-weight: var(--heading-weight, var(--font-bold));
    --reel-dot-size: var(--space-2-5);
  }

  /* `--leading-none` because the numeral now sets the row's height, and a
     `--leading-snug` line box around a 30px figure opens a gap the tracked label
     beside it cannot fill. */
  .reel[data-edge='heavy'] .reel__dur {
    line-height: var(--leading-none);
  }

  /* An inverted band must invert WHOLE. `--reel-audio-bg` defaults to
     `--color-surface-secondary`, a GLOBAL token that knows nothing about the
     `surface` axis, so at `surface: invert` the `waveform` panel stayed at pole A
     inside a pole-B section — an un-inverted patch in an inverted band.
     `--jp-ink-2` re-derives from whichever pole the section resolved, so it
     follows the flip. Keyed on `surface: invert` (full-send alone) rather than
     fixed on the base, because the generic form would move candlelit's own
     `waveform` panel; the base fix is in the handoff. */
  .reel[data-surface='invert'] {
    --reel-audio-bg: var(--jp-ink-2);
  }

  /* SPRING EASING, MADE VISIBLE, on the one element a pointer is ever on.
     `--jp-reveal-ease` is `--ease-spring` at this motion value, so the curve is
     read rather than re-spelled. It only ever GROWS the target: a `:active`
     shrink would take the border box under contract A2's 44px floor mid-press,
     and A2's floor is a floor in both directions. */
  .reel[data-motion='stagger'] .reel__play {
    transition:
      transform var(--jp-reveal-duration) var(--jp-reveal-ease),
      background-color var(--duration-normal) var(--ease-out);
  }

  .reel[data-motion='stagger'] .reel__play:hover {
    transform: scale(1.14);
  }

  /* THE EQUALISER ANSWERS THE POINTER. `.reel__wave--fill` ships
     `clip-path: inset(0 100% 0 0)` and NOTHING ever changes it, so the accent
     copy of the bars is permanently clipped to zero width on every look — paint
     that is written and never read (the handoff carries the finding; the test
     pins the element, so it stays). Here it becomes a real affordance: pointing
     at the transport sweeps the accent wave across, on the family's own spring.

     `:focus-within` as well as `:hover`, because hover is not a gesture — a
     keyboard user tabbing to the play button gets the same answer. It sweeps to
     FULL width, never to a fraction, so it makes no claim about playback
     position: there is no playback here, only a poster and a modal. */
  .reel[data-motion='stagger'] .reel__wave--fill {
    transition: clip-path var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  .reel[data-motion='stagger'] .reel__chrome:hover .reel__wave--fill,
  .reel[data-motion='stagger'] .reel__chrome:focus-within .reel__wave--fill {
    clip-path: inset(0 0% 0 0);
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small neutral shadow; one filled
     accent button per section.

     ANOTHER COMPOUND BY NECESSITY. `edge: hairline` is also `quiet-studio`,
     `long-read` and `syllabus`, and `accent: fill` is also `plain-facts` and
     `full-send` — but those two are `edge: offset` and `edge: heavy`, and the
     three other hairline looks are `accent: none` / `text` / `edge`. So the PAIR
     is `signal` alone, and candlelit (`edge: none`, `accent: glow`) matches
     neither half.

     MEASURED ON THE BASE: this is the "vanishing card" research §5.2 predicts
     for exactly this family, and here it is literal — `--jp-edge-shadow` is
     `--shadow-xs` at this value (a 1px, 10%-alpha drop, i.e. the small NEUTRAL
     shadow the tell names) and had NO consumer inside the section, so the frame
     carried a flat `--shadow-xl` and the audio panel carried nothing. And there
     was no filled accent button anywhere: `.reel__play` is a glassy 45%
     background behind an accent BORDER, which is the one shape this family does
     not use.

     THE FILL IS A STRONGER BOUNDARY THAN THE BORDER IT REPLACES, not a weaker
     one — an opaque `--jp-accent-fill` plate under `--jp-accent-on-fill`, which
     is the pair the axis guarantees. The 2px border is kept and made
     transparent so the border box, and therefore contract A2's 44px pointer
     target, does not move by a pixel. */
  .reel[data-edge='hairline'][data-accent='fill'] {
    --reel-frame-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-frame-shadow: var(--jp-edge-shadow);
    --reel-plate-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-audio-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --reel-audio-shadow: var(--jp-edge-shadow);
    --reel-audio-radius: var(--radius-card);
    /* Viewfinder brackets are candlelit's signature and are not among the three
       features this tell enumerates; a product look is a rounded card and
       nothing else on top of it. */
    --reel-corner-display: none;
    --reel-play-bg: var(--jp-accent-fill);
    --reel-play-bg-hover: color-mix(
      in oklab,
      var(--jp-accent-fill) 88%,
      var(--jp-accent-on-fill)
    );
    --reel-play-color: var(--jp-accent-on-fill);
    --reel-play-border: var(--border-width-thick) solid transparent;
    --reel-play-shadow: var(--jp-edge-shadow);
    --reel-play-blur: 0px;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Continuous decorative motion STOPS, it does not speed up (research §5.1).
       The shared block in `journey-sections-shared.css` kills `animation` on
       every `.jp-sec` descendant; these pin the resting state, because a stopped
       keyframe holds frame 0 rather than the composed look. */
    .reel__glow {
      opacity: 1;
      transform: scale(1.04);
    }
    .reel__play::after {
      opacity: 0;
    }
    .reel__caption,
    .reel__play {
      transition: none;
    }
    .reel__play:hover {
      transform: none;
    }

    /* THE PER-LOOK MOTION THE DESIGN-LANGUAGE PASS ADDED. All of it is
       transforms and transitions OUTSIDE a keyframe, which is the one thing
       `journey-sections-shared.css`'s `animation: none !important` guard cannot
       reach — and each out-specifies the two rules above ((0,3,0)/(0,4,0)
       against (0,1,0)/(0,2,0)), so none is covered by them.

       Listed explicitly rather than as a wildcard so the next look that adds a
       hover transform has to come here and say so. */
    .reel[data-motion='stagger'] .reel__play,
    .reel[data-motion='stagger'] .reel__wave--fill {
      transition: none;
    }

    .reel[data-motion='stagger'] .reel__play:hover {
      transform: none;
    }

    /* `plain-facts` presses the control INTO its shadow with `translate`, which
       is a separate property from `transform` and so needs its own undo. */
    .reel[data-edge='offset'] .reel__play:hover {
      translate: none;
    }
  }
</style>

<script module lang="ts">
  // Per-instance sequence for the waveform <symbol> id. Module-scoped so it
  // increments in identical order during SSR and hydration (no id clashes,
  // no hydration mismatch even with multiple reels on one page).
  let waveSeq = 0;
  function nextWaveId(): number {
    return waveSeq++;
  }

  /**
   * The equaliser's 32 bar heights, in a 0..40 viewBox.
   *
   * This replaces 32 hand-authored `<rect>` literals whose x, y, width and rx
   * were all derivable: x = 4 + 15i, y = (40 - h) / 2, width 7, rx 3. Only the
   * height ever varied, so only the height is data. The rendered geometry is
   * byte-identical to what the section shipped.
   */
  const WAVE_AMPLITUDES = [
    10, 14, 20, 26, 22, 16, 12, 18, 28, 34, 30, 22, 14, 10, 16, 24, 32, 28, 20,
    12, 16, 22, 30, 26, 18, 12, 10, 16, 22, 18, 12, 8,
  ];
</script>
