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
  their arrangement from the canvas partial
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
-->
<script lang="ts">
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import SectionSkeleton from '../SectionSkeleton.svelte';
  import { aliasKeys, asString, asStringFrom } from '../coerce';
  import * as m from '$paraglide/messages';
  import { reveal } from '../reveal';
  import type { IntroVideoSectionProps, JourneySalesContext } from '../types';
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
  }

  const { config, context, variant, design, editable = false, onEdit }: Props =
    $props();

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
   */
  const heading = $derived(p.heading ?? context.course?.title);

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
   * be both the axis's switch and the composition's layout mode. Reading it here
   * also means the streamed promise is never awaited for a box nobody will see.
   */
  const showMedia = $derived(design?.media === 'none' ? 'no' : 'yes');

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
   * The inline-edit seam for the studio canvas, as a spreadable attribute bag.
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having
   * no seam at all.
   *
   * DELIBERATELY NOT `render-edit/EditableText.svelte`: it renders an EMPTY
   * element and fills `textContent` from a Svelte action, and actions do not run
   * during SSR — so the public page would serve `<h2></h2>` and paint the text in
   * only after hydration, an SEO hole (pilot lesson 9). Here the text is a real
   * child node.
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

{#snippet stage()}
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

      {#await context.sellPreview}
        <SectionSkeleton shape="media" label={m.journey_intro_skeleton_label()} />
      {:then preview}
        {#if preview?.intro}
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
              aria-label={m.journey_intro_play_aria({
                seconds: Math.round(intro.durationSeconds ?? 90),
              })}
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
        {:else}
          <div class="iv__empty" aria-hidden="true"></div>
        {/if}
      {/await}
    </div>

    <!--
      Beneath the frame. Re-awaits the same promise rather than lifting the
      `{#await}`: the promise is already resolved by then so there is no second
      request, and keeping the meta inside the media box for `over` is what makes
      the scrim protect it.
    -->
    {#if overlay === 'below'}
      {#await context.sellPreview then preview}
        {@render meta(p.duration ?? formatDuration(preview?.intro?.durationSeconds))}
      {/await}
    {/if}
  </div>
{/snippet}

<div class="iv" data-iv-composition={composition} data-iv-overlay={overlay}>
  <div class="iv__inner" use:reveal={{ disabled: editable }}>
    {#if composition === 'split'}
      <div class="iv__split">
        {@render lead()}
        {#if showMedia === 'yes'}{@render stage()}{/if}
      </div>
    {:else if composition === 'card'}
      <div class="iv__card">
        {@render lead()}
        {#if showMedia === 'yes'}{@render stage()}{/if}
      </div>
    {:else}
      {@render lead()}
      {#if showMedia === 'yes'}{@render stage()}{/if}
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

  .iv__image {
    position: absolute;
    inset: 0;
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
    transition:
      transform var(--duration-slow) var(--ease-smooth),
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

  .iv__empty {
    width: 100%;
    height: 100%;
  }

  /* `SectionSkeleton` hardcodes `aspect-ratio: 16 / 9` for its media shape
     (audit §C.4), which is wider than the box at `media: mask` (4/5) and taller
     than it at `media: bleed` (21/9). It is a grid child under `place-items:
     center`, so it is not stretched — but it can still overflow its own frame
     during the pending state. Capped here rather than by changing the shared
     primitive, which serves other sections and is not this worktree's file. */
  .iv__media :global(.section-skeleton) {
    max-width: 100%;
    max-height: 100%;
  }

  /* ── COMPOSITIONS ──────────────────────────────────────────────────────
     Arrangement only. Ported from `render-edit/journey-sections/_video.css`
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
  }

  [data-iv-composition='card'] .iv__stage {
    order: -1;
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
    .iv__play {
      transition: none;
    }
    .iv__play:hover {
      transform: none;
    }
  }
</style>
