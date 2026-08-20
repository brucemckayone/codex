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
  import type { ReelSectionProps, JourneySalesContext } from '../types';
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
  }

  const { config, context, variant, design, editable = false, onEdit }: Props =
    $props();

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
   */
  const heading = $derived(p.heading ?? context.course?.title);

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

  /** `media: none` emits `--jp-media-display: none` — honoured in markup. */
  const showMedia = $derived(design?.media === 'none' ? 'no' : 'yes');

  const currentCaption = $derived(captions[captionIndex] ?? captions[0]);

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
   * The inline-edit seam for the studio canvas, as a spreadable attribute bag.
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having
   * no seam at all. DELIBERATELY NOT `render-edit/EditableText.svelte`: it fills
   * `textContent` from a Svelte action and actions do not run during SSR, so the
   * public page would serve an empty heading and paint it in after hydration
   * (pilot lesson 9). Here the text is a real child node.
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
    {:else}
      <!-- No preview configured: keep the still legible, offer no play. -->
      <span class="reel__play reel__play--empty" aria-hidden="true">
        <span class="reel__play-icon"><PlayIcon /></span>
      </span>
      <div class="reel__track" aria-hidden="true">
        <div class="reel__rest-rail"></div>
      </div>
    {/if}
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

<div
  class="reel"
  data-reel-composition={composition}
  data-reel-overlay={overlay}
  data-reel-align={design?.align ?? 'center'}
>
  <div class="reel__inner" use:reveal>
    {#if composition === 'split'}
      <div class="reel__split">
        {@render header()}
        {#if showMedia === 'yes'}{@render stageFigure()}{/if}
      </div>
    {:else if audioFirst === 'yes'}
      {@render header()}
      <!--
        `waveform` — the equaliser and playhead ARE the section. No poster, no
        letterbox: an audio preview should look like audio rather than like a
        video with the picture missing (research §3). Rendered regardless of
        `media`, because this composition's subject is the transport, not a box
        the `media` axis shapes.
      -->
      <div class="reel__audio">
        {@render metaAndLower()}
      </div>
    {:else}
      {@render header()}
      {#if showMedia === 'yes'}{@render stageFigure()}{/if}
    {/if}
  </div>
</div>

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
    border: var(--border-width) solid
      color-mix(in oklab, var(--jp-accent-mark) 22%, transparent);
    box-shadow: var(--shadow-xl);
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
    border: 0 solid color-mix(in oklab, var(--jp-accent-mark) 70%, transparent);
    pointer-events: none;
  }

  .reel__corner--tl {
    top: var(--space-5);
    left: var(--space-5);
    border-top-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }
  .reel__corner--tr {
    top: var(--space-5);
    right: var(--space-5);
    border-top-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
  }
  .reel__corner--bl {
    bottom: var(--space-5);
    left: var(--space-5);
    border-bottom-width: var(--border-width-thick);
    border-left-width: var(--border-width-thick);
  }
  .reel__corner--br {
    bottom: var(--space-5);
    right: var(--space-5);
    border-bottom-width: var(--border-width-thick);
    border-right-width: var(--border-width-thick);
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
    font-size: max(var(--text-xs), calc(var(--jp-body-size) / 1.5));
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
    border-radius: var(--radius-full);
    /* 88%, not a glassy 55%: contract A39 — an alpha low enough to read as faint
       measures against the poster rather than against the plate. */
    background: color-mix(in oklab, var(--color-background) 88%, transparent);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
  }

  .reel__topmeta[data-reel-at='below'] {
    justify-content: var(--jp-align);
  }

  .reel__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    /* 0.28em has no token and `--tracking-wider` (0.05em) is the widest one, so
       the rec tag's deliberately airy tracking is derived from it rather than
       spelled as a raw value. */
    letter-spacing: calc(var(--tracking-wider) * 5.6);
    color: var(--color-heading);
  }

  .reel__dot {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
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
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
  }

  .reel__topmeta[data-reel-at='over'] .reel__dur {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-background) 55%, transparent);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    -webkit-backdrop-filter: blur(var(--blur-sm));
    backdrop-filter: blur(var(--blur-sm));
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

  .reel__caption {
    align-self: center;
    text-align: center;
    margin: 0;
    font-family: var(--font-heading);
    font-style: italic;
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
    opacity: 0.4;
    margin-right: 0.06em;
  }

  .reel__caption::after {
    content: '\201D';
    opacity: 0.4;
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
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: var(--color-heading);
    background: color-mix(in oklab, var(--color-background) 45%, transparent);
    /* Full-strength `--jp-accent-mark`, not a faint mix: no alpha low enough to
       read as faint clears 3:1 at the dark pole (contract A39), and this border
       is the control's only boundary. */
    border: var(--border-width-thick) solid var(--jp-accent-mark);
    /* `accent: glow` IS Candlelit, i.e. what all 695 backfilled pages hold, so an
       unconsumed `--jp-accent-glow` would be a bloom that never blooms on every
       published page. This is its only consumer in the section.

       THE WHOLE VALUE of `box-shadow`, never one item of a list: the token is the
       keyword `none` at the other four accent values, and `none` cannot be a
       shadow-list item — the declaration would be invalid at computed-value time
       and fall back to the initial `none`. That is contract A54's mechanism,
       which is about the KEYWORD rather than the `--jp-edge-*` family, and it
       also catches `--jp-media-scrim` and `--jp-media-mask`. */
    box-shadow: var(--jp-accent-glow);
    -webkit-backdrop-filter: blur(var(--blur-md));
    backdrop-filter: blur(var(--blur-md));
    cursor: pointer;
    transition:
      transform var(--duration-fast) var(--ease-out),
      background-color var(--duration-normal) var(--ease-out);
  }

  .reel__play:hover {
    transform: translateY(calc(var(--space-1) * -0.5));
    background: color-mix(in oklab, var(--jp-accent-mark) 26%, transparent);
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

  .reel__play--pending,
  .reel__play--empty {
    cursor: default;
    opacity: 0.65;
  }

  .reel__play--pending {
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

  .reel__rest-rail {
    position: absolute;
    inset: 45% 0 auto 0;
    height: var(--border-width-thick);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-heading) 22%, transparent);
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
     Arrangement only. Ported from `render-edit/journey-sections/_video.css`
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
    border-radius: var(--radius-card);
    background: var(--color-surface-secondary);
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
