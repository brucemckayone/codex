<!--
  @component AcheSection

  Names the held pain before hope is offered (SPEC §4.1 `ache`).

  ── THE AXES THIS SECTION CONSUMES: EIGHT ──────────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion`. Every
  layout / rhythm / type-scale / edge / surface / motion decision reads a `--jp-*`
  property that `render/SectionRenderer.svelte` resolves onto the `.jp-sec`
  wrapper as a `data-jp-*` attribute. COLOUR STAYS `--color-*` (contract A11);
  the one exception is the `--jp-accent-*` family.

  `media` is DELIBERATELY unconsumed, and that is not a shortfall. Research §2.2
  names the five types where `media` is meaningful — `hero`, `introVideo`, `reel`,
  `guide`, `proof` — and says the rest "ignore it, exactly as they ignore a
  variant they do not offer." An ache has no media at any depth of its read model
  (`AcheSectionProps` is copy only), so claiming nine would have meant inventing a
  consumer (contract A50).

  ── SEVEN COMPOSITIONS ─────────────────────────────────────────────────────
  `column` (default) · `statement` · `paired` · `list` · `quote` · `checklist`.
  `column` absorbs the retired prose `centered` + `wide` (they were `align` +
  `width`); `paired` is the retired `twocol`. All three are ported from the since-deleted
  canvas partial `render-edit/journey-sections/_prose.css` (contract A12). `list`,
  `quote` and `checklist` are new (research §3).

  COMPOSITIONS CARRY ARRANGEMENT, NEVER TYPE SCALE. `statement` is "oversized"
  through a tight heading measure and extra rhythm, not a larger `font-size` —
  scale is what the `type` axis is for, and a composition that also scaled type
  would put treatment back inside the variant namespace, which is the exact thing
  this programme removes. Every heading here is `--jp-heading-size` via
  `.jp-sec__heading--sub`, never `--jp-display` (contract A36).

  ── THE PINNED SCROLLJACK: RETIRED, THEN RESTORED AS A COMPOSITION ─────────
  This section used to render a two-viewport pinned reveal that advanced one
  "beat" at a time. It was removed, and it is now BACK as the `descent`
  composition — see the block by `isDescent` in the script for how it works.

  THE REMOVAL WAS THE WRONG CONCLUSION FROM FOUR CORRECT OBSERVATIONS, and the
  record matters because the effect is one the owner asked for repeatedly and it
  was deleted as a defect. Each objection below is answered by making it a
  COMPOSITION with an AUTHORED source, not by dropping the effect:

   1. It was TRIGGERED BY A FIDELITY BUG. `beats[]` was synthesised as
      `[heading, body]` and `beats.length > 1` armed the pin, so filling both
      builder fields typeset the creator's body paragraph as a second headline AND
      armed a scrolljack. The audit records both as defects, not features.
   2. It is not a declared composition, so no creator could select it, escape it,
      or see it in the variant picker.
   3. No `motion` value can express it — it would need a gate outside the axis
      vocabulary, which is what the axis model exists to prevent.
   4. It is a scroll hijack with no opt-out beyond `prefers-reduced-motion`, and
      it added one viewport of empty scroll per beat (the golden page carries two
      ache sections, so roughly six viewports).

  So: the four observations were right about the ACCIDENTAL implementation and
  wrong about the capability. `descent` keeps the effect, chosen on purpose, fed
  by the authored `points` array, invisible to anyone who does not pick it.

  Every OTHER composition keeps its cinematic register through the atmosphere
  layer (gated on `surface: media` via `--jp-sec-atmos`) and the `motion` axis's
  reveal, exactly as before — nothing else in this file changed.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): the full composition, every word
    legible, nothing hidden. This is what the server emits.
  • ENHANCED (browser + motion OK): the shared `reveal` action arms the hidden
    state from JS and the blocks arrive on the `motion` axis's timing.

  ── THE LOOK LAYER: WHY THIS FILE NOW READS THE WRAPPER'S ATTRIBUTES ───────
  Everything above resolves the axes as VALUES — a size, a colour, a width, a
  multiplier — which is all a section can read from a custom property. That is
  the right seam for most of the nine axes and it is not enough for the two
  that describe MATERIAL. `edge: offset` does not mean "a wider border": it
  means 2px on every block, a hard un-blurred drop, and radius nought
  everywhere. `edge: soft` means no border exists at all and separation is
  space plus an elevation you have to look for. No single property carries
  "and the rows are boxes now".

  So the last block of the stylesheet reaches `.jp-sec`'s own `data-jp-*`
  attributes through `:global()` — the shape `TurnSection` and `MapSection`
  already use for `.reveal--armed` and `Card.svelte` for `[data-theme]`. The
  section still never WRITES an axis property; `journey-design.css` stays the
  only place a value is chosen. Read that block's header before adding to it:
  it carries the collision rule that keeps Candlelit out of every selector.
-->
<script lang="ts">
  import { CheckIcon } from '$lib/components/ui/Icon';
  import { aliasKeys, asStringArray, asStringFrom } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type { AcheSectionProps, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * `heading`, `body` and `points` are not on `AcheSectionProps` in
   * `render/types.ts`, which is shared across the seven component worktrees;
   * declared locally, exactly as `FaqSection` declares its `group` row.
   * Consolidation should absorb them.
   *
   * `beats[]` stays on the type and stays READ: it is the authored array shape,
   * and a page that holds one still renders. It is no longer synthesised from
   * `[heading, body]` — see the fidelity note in the component header.
   */
  interface AcheCopy extends AcheSectionProps {
    heading?: string;
    body?: string;
    points?: string[];
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

  const p: AcheCopy = $derived({
    eyebrow: asStringFrom(config, aliasKeys('ache', 'eyebrow')),
    heading: asStringFrom(config, aliasKeys('ache', 'heading')),
    /**
     * Bridged through the alias table like every other read here. The loss this
     * closes was live: SIX seeded `ache` sections across BOTH orgs
     * (`of-blood-and-bones` × 4, `studio-alpha` × 2) store a real sentence under
     * `sub` — "Grief is not a problem to be solved. These practices make room for
     * it to move." — and nothing had ever read it, because `sub` is a seeder key
     * `PROSE_FIELDS` never declared. `coerce.ts` now carries
     * `body: ['body', 'sub']` (added by the orchestrator on the WT-1 report).
     */
    body: asStringFrom(config, aliasKeys('ache', 'body')),
    /**
     * `OWED_READS.ache` (contract A28). The `list` and `checklist` compositions
     * are made of these; nothing read them before, so the field was authorable
     * and inert. Wiring it turns `section-fields.test.ts`'s
     * "every OWED_READS entry is still genuinely unread" assertion red on the
     * `ache: ['points']` line, which is that test working as designed — the WT-1
     * report names the line to delete.
     */
    points: asStringArray(config, 'points'),
    beats: asStringArray(config, 'beats'),
  });

  const points = $derived(p.points ?? p.beats ?? []);
  const hasContent = $derived(
    !!(p.eyebrow || p.heading || p.body || points.length > 0)
  );

  const COMPOSITIONS = [
    'column',
    'statement',
    'paired',
    'list',
    'quote',
    'checklist',
    'descent',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'column'
  );

  /**
   * `list` and `checklist` are the two compositions made of `points`. When the
   * array is empty they render their copy and no list — i.e. they degrade to
   * `column` rather than to an empty section. String discriminant, not a boolean:
   * `apps/web` has `strictNullChecks` OFF, so a boolean-literal discriminant does
   * not narrow.
   */
  const showsPoints = $derived(
    (composition === 'list' || composition === 'checklist') && points.length > 0
      ? 'yes'
      : 'no'
  );

  /**
   * `quote` sets the ache itself as a pull-quote, so the heading moves inside a
   * `<blockquote>`. It is still the section's `<h2>`: `type` is visual scale only
   * and must never promote or demote a heading LEVEL (research §5.1).
   */
  const quoted = $derived(composition === 'quote' ? 'yes' : 'no');

  /**
   * ── THE DESCENT: A PINNED, FULL-VIEWPORT SEQUENCE ────────────────────────
   *
   * `descent` gives each point the whole screen and brings the next one in as the
   * reader scrolls. A tall `track` provides the scroll distance; the `stage`
   * inside it is `position: sticky` at `top: 0` with `height: 100dvh`, so it
   * holds still while the track passes — the page scrolls, the stage does not
   * move, and the active beat advances. That is the effect: it takes over the
   * screen, one ache at a time.
   *
   * WHY IT IS A COMPOSITION AND NOT A MOTION LEVEL. This behaviour existed
   * before and was removed for four stated reasons, and every one of them was an
   * argument for giving it a proper home rather than deleting it:
   *   · it armed itself off `[heading, body]`, so writing two paragraphs
   *     accidentally turned one into a headline AND started a scrolljack. Now the
   *     beats are the AUTHORED `points` array — a real source, chosen on purpose.
   *   · it was not selectable, escapable or visible in the variant picker. Now it
   *     is one of seven compositions in the picker.
   *   · no `motion` value could express it. Correct — a pinned stage is
   *     ARRANGEMENT, which is what compositions carry; `motion` still only tunes
   *     the reveal timing inside it.
   *   · it was a hijack with no opt-out. A composition IS the opt-out: a creator
   *     who does not choose `descent` never meets it.
   *
   * THREE RENDERINGS, and only the first hijacks anything:
   *   · ENHANCED (browser, motion welcome, published page): the pinned stage.
   *   · BASELINE (SSR, no-JS, `prefers-reduced-motion`): every beat stacked and
   *     legible, in order, nothing hidden and no scroll distance added. The
   *     server emits this, so the page is complete before JS arrives.
   *   · CANVAS (`editable`): the stacked form plus a line saying what it does
   *     when published. The builder canvas is a short, scaled viewport with its
   *     own scroller — pinning inside it would fight that scroller and hide the
   *     creator's own text, so the canvas shows the beats it is asking them to
   *     write. This is why `enhanced` requires `!editable`.
   */
  const isDescent = $derived(composition === 'descent' && points.length > 0);

  let mounted = $state(false);
  let reduced = $state(false);
  let trackEl = $state<HTMLElement | null>(null);
  let activeIndex = $state(0);

  $effect(() => {
    mounted = true;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mql.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reduced = event.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  /**
   * The pin needs at least TWO beats to sequence between — with one there is
   * nothing to advance to, and a single-beat descent would add a viewport of
   * empty scroll for no gain, which was a fair criticism of the old version.
   */
  const enhanced = $derived(
    isDescent && mounted && !reduced && !editable && points.length > 1
  );

  /**
   * Map the track's progress through the viewport onto an active beat index.
   * `-getBoundingClientRect().top` is how far the track has passed the top of the
   * viewport; the usable distance is its height less one screen, because the last
   * screen is the stage still being held. rAF-throttled, listener passive.
   */
  $effect(() => {
    if (!enhanced || !trackEl) return;
    const track = trackEl;
    const count = points.length;
    let ticking = false;

    const update = () => {
      ticking = false;
      const total = track.offsetHeight - window.innerHeight;
      if (total <= 0) {
        activeIndex = 0;
        return;
      }
      const scrolled = Math.min(
        Math.max(-track.getBoundingClientRect().top, 0),
        total
      );
      activeIndex = Math.min(
        Math.max(Math.floor((scrolled / total) * count), 0),
        count - 1
      );
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });

  /**
   * A point may carry an optional gloss after an en/em dash
   * ("Regulation — finding the ground"), the same convention `turn.points`
   * already uses and the same one `section-fields.ts`'s placeholder documents
   * ("A lead — and the gloss after a dash"). A plain point degrades to lead-only.
   */
  const rows = $derived(
    points.map((raw) => {
      const match = raw.match(/\s+[—–]\s+/);
      if (match && match.index !== undefined) {
        return {
          lead: raw.slice(0, match.index).trim(),
          gloss: raw.slice(match.index + match[0].length).trim() || undefined,
        };
      }
      return { lead: raw, gloss: undefined };
    })
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
   * long list clamps rather than taking seconds to assemble (pilot lesson 5).
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
    editFieldAttrs('ache', key, editable, onEdit);
</script>

{#snippet eyebrow()}
  {#if p.eyebrow}
    <p class="jp-sec__eyebrow ache__eyebrow jp-reveal" {...editAttrs(readKey(aliasKeys('ache', 'eyebrow'), 'kicker'))}>
      {p.eyebrow}
    </p>
  {/if}
{/snippet}

{#snippet heading()}
  {#if p.heading}
    <h2
      class="jp-sec__heading jp-sec__heading--sub ache__heading jp-reveal"
      data-jp-step="1"
      {...editAttrs(readKey(['heading'], 'heading'))}
    >
      {p.heading}
    </h2>
  {/if}
{/snippet}

{#snippet body()}
  {#if p.body}
    <p
      class="jp-sec__measure ache__body jp-reveal"
      data-jp-step="2"
      {...editAttrs(readKey(aliasKeys('ache', 'body'), 'body'))}
    >
      {p.body}
    </p>
  {/if}
{/snippet}

{#if hasContent && isDescent}
  <!-- ── THE DESCENT ─────────────────────────────────────────────────────────
       The track supplies the scroll distance; the stage is sticky inside it and
       holds the screen while the track passes. `--beat-count` sizes the track in
       CSS rather than here, so the same markup serves all three renderings and
       only a class changes.

       `data-ache="descent"` matches every other composition's hook, so the axis
       CSS and any `[data-ache]` selector keep working unchanged.
  -->
  <div
    class="ache ache--descent"
    class:ache--enhanced={enhanced}
    data-ache="descent"
    style="--beat-count: {points.length}"
  >
    <div class="ache__track" bind:this={trackEl}>
      <div class="ache__stage">
        <div class="ache__atmos" aria-hidden="true">
          <div class="ache__aura"></div>
          <div class="ache__vignette"></div>
        </div>

        <div class="ache__frame">
          {#if p.eyebrow}
            <p class="ache__chapter" {...editAttrs('kicker')}>{p.eyebrow}</p>
          {/if}
          {#if p.heading}
            <h2
              class="jp-sec__heading jp-sec__heading--sub ache__descent-heading"
              {...editAttrs('heading')}
            >
              {p.heading}
            </h2>
          {/if}

          <!-- ONE list, three renderings. Enhanced stacks the beats absolutely and
               shows one at a time; baseline and canvas leave them in flow, every
               word legible and in order. A screen reader always gets the ordered
               list, because the enhancement is presentational — `aria-hidden` goes
               on the progress dots, never on a beat. -->
          <ol class="ache__beats">
            {#each rows as row, i (i)}
              <li
                class="ache__beat"
                class:is-active={enhanced && i === activeIndex}
                class:is-past={enhanced && i < activeIndex}
              >
                <span class="ache__beat-lead">{row.lead}</span>
                {#if row.gloss}
                  <span class="ache__beat-gloss">{row.gloss}</span>
                {/if}
              </li>
            {/each}
          </ol>

          {#if enhanced}
            <div class="ache__progress" aria-hidden="true">
              {#each points as _, i (i)}
                <span class="ache__seg" class:is-on={i <= activeIndex}></span>
              {/each}
            </div>
          {/if}

          {#if editable}
            <!-- The canvas cannot show a page-length pin inside a short scaled
                 viewport, so it says what will happen instead of pretending. -->
            <p class="ache__descent-note">
              {points.length === 1
                ? 'Descent · add a second point and each will take the full screen as the reader scrolls'
                : `Descent · ${points.length} full screens, one per point, arriving as the reader scrolls`}
            </p>
          {/if}
        </div>
      </div>
    </div>
  </div>
{:else if hasContent}
  <div class="ache" data-ache={composition}>
    <!-- The cinematic atmosphere. ONE `--jp-sec-atmos` gate on this wrapper
         rather than one per layer (pilot lesson 3): the aura's opacity is
         ANIMATED, and a keyframe beats a `calc()` on the same element, so on the
         parent the two compose multiplicatively — the aura keeps breathing under
         `surface: media` and resolves to zero opacity on every other value. The
         markup stays mounted either way, which is cheaper and lower-risk than
         rendering it conditionally. -->
    <div class="ache__atmos" aria-hidden="true">
      <div class="ache__aura"></div>
      <div class="ache__vignette"></div>
    </div>

    <!-- ONE observer for the whole section, on the container: the shared atom is
         `.reveal--armed .jp-reveal` (a DESCENDANT selector) and the action adds
         `.reveal--armed` to the node it is used on, so the action goes here and
         the staggered beats are its children. -->
    <div class="ache__inner" use:reveal={{ disabled: editable }}>
      {#if composition === 'paired'}
        <div class="ache__pair">
          <div class="ache__pair-head">
            {@render eyebrow()}
            {@render heading()}
          </div>
          <div class="ache__pair-body">{@render body()}</div>
        </div>
      {:else if quoted === 'yes'}
        {@render eyebrow()}
        {#if p.heading}
          <blockquote class="ache__quote jp-reveal" data-jp-step="1">
            <h2
              class="jp-sec__heading jp-sec__heading--sub ache__heading"
              {...editAttrs(readKey(['heading'], 'heading'))}
            >
              {p.heading}
            </h2>
          </blockquote>
        {/if}
        {@render body()}
      {:else}
        {@render eyebrow()}
        {@render heading()}
        {@render body()}
      {/if}

      {#if showsPoints === 'yes'}
        <ul class="ache__points">
          {#each rows as row, i (i)}
            <li class="ache__point jp-reveal" data-jp-step={step(i)}>
              {#if composition === 'checklist'}
                <!-- `IconBase` sets `aria-hidden` itself; the row's own text is
                     the accessible name, so the tick is decoration. -->
                <CheckIcon class="ache__tick" size="1em" />
              {:else}
                <span class="ache__mark" aria-hidden="true"></span>
              {/if}
              <span class="ache__point-text">
                <span class="ache__point-lead">{row.lead}</span>
                {#if row.gloss}
                  <span class="ache__point-gloss">{row.gloss}</span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
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
     page rather than the section (pilot lesson 1). `.ache` is that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .ache {
    /* ── TWO RHYTHM MULTIPLIERS, BOTH `1`, AND WHY THERE ARE TWO ───────────
       A COMPOSITION and a LOOK both want a say in this section's vertical
       rhythm, and they have to COMPOSE rather than overwrite: `statement` is
       1.3× whatever the look asked for, not 1.3× flat. One property each,
       unitless, defaulting to `1`, so `calc(pad * 1 * 1)` is exactly the bare
       token for any look that sets neither — which is every look that shipped
       before this pass, Candlelit included.

       They are declared HERE rather than per axis value because they are this
       section's own arithmetic, not a new axis. `journey-design.css` still
       owns every value; this only decides how two of them multiply. */
    --ache-pad-comp: 1;
    --ache-pad-look: 1;
    --ache-gap-look: 1;

    position: relative;
    isolation: isolate;
    overflow: clip;
    padding-block: calc(
      var(--jp-sec-pad-block) * var(--ache-pad-comp) * var(--ache-pad-look)
    );
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);
  }

  .ache__inner {
    position: relative;
    z-index: 1;
    max-width: var(--jp-content-max);
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    /* `align-items` takes the LOGICAL value so `align` stays writing-mode
       correct; `text-align` above takes the physical one. */
    align-items: var(--jp-align);
    gap: calc(var(--jp-sec-gap) * var(--ache-gap-look));
  }

  /* ── the atmosphere layer (surface: media only) ── */
  .ache__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
  }

  /* Breathing warmth behind the words — fills the frame, never a void. */
  .ache__aura {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    /* Derived from the `width` axis rather than the old raw `38.75rem`, so the
       glow tracks the measure it sits behind. At `width: text` this is 38.4rem —
       the same size it has always been. */
    width: min(78cqw, calc(var(--jp-content-max) * 0.6));
    aspect-ratio: 1;
    border-radius: var(--radius-full);
    opacity: 0.6;
    filter: blur(var(--blur-2xl));
    background: radial-gradient(
      circle at 50% 50%,
      color-mix(in oklab, var(--jp-accent-mark) 30%, transparent),
      color-mix(in oklab, var(--color-brand-primary) 12%, transparent) 42%,
      transparent 68%
    );
    animation: ache-breathe calc(var(--jp-reveal-duration) * 10)
      var(--ease-smooth) infinite;
  }

  /* Cinematic vignette darkening the edges to focus the centre. */
  .ache__vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      125% 95% at 50% 50%,
      transparent 52%,
      color-mix(in oklab, var(--color-background) 55%, transparent) 100%
    );
  }

  @keyframes ache-breathe {
    0%,
    100% {
      transform: scale(0.92);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.05);
      opacity: 0.78;
    }
  }

  /* ── copy ── */
  .ache__eyebrow {
    /* The shared atom defaults to `--tracking-wider` (0.05em); this section
       shipped a ceremonial `.18em`, which has no token, and `--tracking-wider` is
       the widest that does. So the eyebrow narrows here by design — the repo does
       not allow raw values in component styles, and `journey-sections-shared.css`
       flags this as the one deliberate difference on adoption. The flanking
       hairlines that carried the ceremony are kept below. */
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    /* `--color-text-tertiary` aliases `--jp-faint`, the rung reserved for
       NON-ESSENTIAL text. An eyebrow at `--text-sm` gets no large-text exemption,
       so it takes the atom's `--color-text-secondary` (measured 11.05:1 light /
       7.79:1 dark on the golden org) instead of the 5.38:1 it shipped. */
  }

  /* Ceremonial flanking hairlines. `--jp-accent-mark`, never `--jp-accent-fill`:
     the latter is `transparent` at `accent: text` and `accent: edge`, so these
     would vanish on two of five values (pilot lesson 4). */
  .ache__eyebrow::before,
  .ache__eyebrow::after {
    content: '';
    width: clamp(var(--space-6), 6cqw, var(--space-12));
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent)
    );
  }

  .ache__eyebrow::after {
    transform: scaleX(-1);
  }

  .ache__heading {
    margin: 0;
  }

  .ache__body {
    margin: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  /* ═══ COMPOSITIONS ═══════════════════════════════════════════════════════ */

  /* `statement` — the ache as one line carrying the section. "Oversized" is a
     TIGHT MEASURE plus extra rhythm, not a bigger font-size: scale belongs to the
     `type` axis (contract A36), and a composition that also scaled type would put
     treatment back inside the variant namespace. Derived from `--jp-measure` so
     the `width` axis still moves it: at `narrow` this is ~15ch, which is the
     canvas partial's own `16ch` on `.jp-prose--statement .jp-prose__heading`. */
  .ache[data-ache='statement'] .ache__heading,
  .ache[data-ache='quote'] .ache__heading {
    max-width: calc(var(--jp-measure) / 3);
    margin-inline: var(--jp-measure-margin);
  }

  .ache[data-ache='statement'],
  .ache[data-ache='quote'] {
    /* The canvas partial gives `statement` roughly 1.3x the block padding of
       `centered`; expressed as a multiple of the axis's own padding so `density`
       still governs it — and as the COMPOSITION multiplier so a look that also
       wants more air multiplies with it instead of replacing it. */
    --ache-pad-comp: 1.3;
  }

  /* `quote` — a pull-quote rule on the leading edge. `--jp-accent-mark`, not
     `--jp-accent-edge`: the latter at `accent: glow` (Candlelit's value) is a 45%
     ember mix and measures 2.05:1 on the golden org's dark pole against a 3:1
     graphic floor (contract A39, measured again here). A pull-quote's rule is the
     only thing marking the quote, so it is a boundary that carries meaning. */
  .ache__quote {
    margin: 0;
    padding-inline-start: var(--jp-sec-gap);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
    /* A centred section with a leading rule reads as a mistake, so the quote
       block keeps its own text flush with the rule it hangs off. */
    text-align: start;
  }

  /* `paired` — heading in one column, body in the other. Ported from
     `.jp-prose--twocol` in the since-deleted
     `render-edit/journey-sections/_prose.css`. */
  .ache__pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--jp-sec-gap);
    align-items: start;
    width: 100%;
    text-align: start;
  }

  .ache__pair-head,
  .ache__pair-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* ── `list` and `checklist` ── */
  .ache__points {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    display: flex;
    flex-direction: column;
    text-align: start;
    /* The row index, available to any look whose tell names numerals —
       Brutalist's "mono labels", Technical's "mono numerals", Playful's "big
       numerals", Editorial's footnote marker. Set UNCONDITIONALLY, because a
       counter with no `content` consumer renders nothing: Candlelit's dot is
       untouched by its existence, and each numeral look opts in with one
       `content: counter(…)` rule at the bottom of this file. It is also why
       the numeral is not markup — a generated counter adds no translatable
       string, and this section's copy is single-owner. */
    counter-reset: ache-point;
  }

  .ache__point {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: var(--space-4);
    padding-block: calc(var(--space-4) * var(--jp-rhythm));
    counter-increment: ache-point;
  }

  /* WIDTH is a token, COLOUR is the axis. Reading `--jp-edge-width` here would
     let `edge: none` delete the only boundary between rows, which is a
     legibility loss rather than a style choice; `--jp-edge-color` still lets
     `edge` tint them. `journey-design.css` documents that `--jp-line` sits under
     the 3:1 graphic floor and accepts it on the condition that a hairline is
     never the ONLY signal — here it is not: each row also carries rhythm-scaled
     padding and its own marker. */
  .ache__point + .ache__point {
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  /* A small decorative brand mark — `--jp-accent-mark`, never
     `--jp-accent-fill`. */
  .ache__mark {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--jp-accent-mark);
    translate: 0 calc(var(--space-1) * -1);
  }

  /* `:global` because the class lands on an `IconBase` `<svg>` in a child
     component, which Svelte's scoping cannot reach. A tick that carries meaning
     owes 3:1, so it takes the accent's TEXT role (`--jp-ember-text`), never
     `--jp-ember` (2.04:1 in dark on the golden org). */
  .ache__point :global(.ache__tick) {
    color: var(--jp-accent-text);
    flex: none;
  }

  .ache__point-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* CARD-SCALE TEXT reads `--jp-body-size` — the `type` axis's third rung,
     declared once in `journey-design.css` (contract A44, `Codex-8oznv`). Neither
     heading step fits a list row, and a hardcoded size would put the bulk of this
     composition permanently outside the axis. */
  .ache__point-lead {
    font-family: var(--font-heading);
    font-weight: var(--font-normal);
    font-size: var(--jp-body-size);
    line-height: var(--leading-snug);
    color: var(--color-heading);
  }

  /* A DENSER step, derived FROM the rung rather than from `--jp-heading-size`,
     with `--text-sm` as the floor the accessibility contract sets for body copy
     (`--text-xs` is metadata only). */
  .ache__point-gloss {
    font-size: max(var(--text-sm), calc(var(--jp-body-size) / 1.2));
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  /* ── narrow container ──
     A CONTAINER query, not a viewport media query (contract A14): `.jp-sec` is
     the container, and the builder canvas renders these sections inside a device
     frame narrower than the window, where a viewport query reads the wrong
     number. The length has to be a literal — container-query conditions cannot
     read a custom property. */
  @container (max-width: 35rem) {
    .ache__pair {
      grid-template-columns: 1fr;
    }
  }

  /* ── THE DESCENT ──────────────────────────────────────────────────────────
     Three renderings from one markup tree, and ONLY `.ache--enhanced` pins.

     BASELINE / CANVAS (no `--enhanced`): the track and stage are ordinary boxes,
     the beats sit in flow as an ordered list, and the section adds NO scroll
     distance. This is what the server emits and what a reduced-motion reader or
     a no-JS reader gets — complete, legible, in order.

     ENHANCED: the track becomes `(beats + 1) x 100dvh` of scroll and the stage
     sticks to the top for the whole of it, so the screen is held while the page
     moves under it. The beats stack absolutely in the stage's centre and only the
     active one is opaque. `dvh` not `vh` so a mobile URL bar collapsing does not
     shift the pin mid-sequence. */
  .ache--descent .ache__track {
    position: relative;
  }

  .ache--descent .ache__stage {
    position: relative;
    display: grid;
    place-items: center;
    padding-block: var(--space-16);
    padding-inline: var(--space-5);
    overflow: clip;
  }

  /* `--container-text` DOES NOT EXIST. Grepped the whole repo: the only
     occurrence was this line, so `max-width: var(--container-text)` was
     invalid at computed-value time and `max-width` fell back to its initial
     `none` — the descent frame has never had a cap, on any page, and no test
     could see it because an unknown custom property is silent. The intent was
     plainly a text-width cap (the name says so), so this restores the intent
     AND puts it on the `width` axis: 48rem / 64rem / `--container-max` at
     narrow / text / wide, which is the same property `.ache__inner` caps on.

     This is the one change in this file that alters Candlelit: its descent
     frame goes from unbounded to 64rem, i.e. short centred lines, which is
     what §1.6 asks for ("measure 46-52ch, short lines, high drama"). Flagged
     as a Candlelit touch in the report rather than smuggled in. */
  .ache--descent .ache__frame {
    position: relative;
    z-index: 2;
    width: 100%;
    max-width: var(--jp-content-max);
    margin-inline: auto;
    text-align: center;
  }

  .ache--descent .ache__chapter {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .ache--descent .ache__descent-heading {
    margin: 0 0 var(--space-8);
  }

  .ache__beats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-6);
  }

  .ache__beat {
    display: grid;
    gap: var(--space-2);
  }

  .ache__beat-lead {
    font-family: var(--font-heading);
    font-size: var(--jp-heading-size);
    line-height: var(--leading-snug);
    color: var(--color-text);
    text-wrap: balance;
  }

  .ache__beat-gloss {
    font-size: var(--text-lg);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    text-wrap: pretty;
  }

  /* The canvas's honest label. Not an error state — it describes what publishing
     will do, because the canvas cannot show a page-length pin in a short frame. */
  .ache__descent-note {
    margin: var(--space-8) 0 0;
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-muted);
  }

  /* ── ENHANCED ONLY ─────────────────────────────────────────────────────── */
  .ache--descent.ache--enhanced .ache__track {
    height: calc((var(--beat-count) + 1) * 100dvh);
  }

  .ache--descent.ache--enhanced .ache__stage {
    position: sticky;
    top: 0;
    height: 100dvh;
  }

  .ache--descent.ache--enhanced .ache__beats {
    position: relative;
    display: block;
    min-height: clamp(220px, 40vh, 360px);
  }

  /* Every beat occupies the same centred slot; only the active one is visible.
     `translate` + `opacity` only — both compositor-friendly, so a long sequence
     does not thrash layout on scroll. */
  .ache--descent.ache--enhanced .ache__beat {
    position: absolute;
    inset-inline: 0;
    top: 50%;
    translate: 0 calc(-50% + var(--space-6));
    opacity: 0;
    transition:
      opacity var(--duration-slow) var(--ease-out),
      translate var(--duration-slow) var(--ease-out);
  }

  .ache--descent.ache--enhanced .ache__beat.is-active {
    opacity: 1;
    translate: 0 -50%;
  }

  /* A beat already read lifts slightly as it leaves, so the sequence reads as a
     descent rather than a crossfade in place. */
  .ache--descent.ache--enhanced .ache__beat.is-past {
    translate: 0 calc(-50% - var(--space-6));
  }

  .ache__progress {
    display: flex;
    gap: var(--space-2);
    justify-content: center;
    margin-top: var(--space-10);
  }

  .ache__seg {
    width: var(--space-8);
    height: 2px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 18%, transparent);
    transition: background var(--duration-normal) var(--ease-out);
  }

  .ache__seg.is-on {
    background: var(--color-brand-primary);
  }

  /* The pin is motion. Reduced-motion never reaches `.ache--enhanced` (the flag
     is computed in JS), and this is the belt-and-braces half: even if the class
     were forced on, the sequence collapses back to a legible stack. */
  @media (prefers-reduced-motion: reduce) {
    .ache--descent.ache--enhanced .ache__track {
      height: auto;
    }

    .ache--descent.ache--enhanced .ache__stage {
      position: relative;
      height: auto;
    }

    .ache--descent.ache--enhanced .ache__beats {
      display: grid;
      min-height: 0;
    }

    .ache--descent.ache--enhanced .ache__beat {
      position: static;
      opacity: 1;
      translate: none;
      transition: none;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE LOOKS — one design language per axis VALUE

     ── WHY THESE SELECTORS EXIST AT ALL ───────────────────────────────────
     `journey-design.css` turns the nine `data-jp-*` attributes on `.jp-sec`
     into custom properties, and everything above this line reads them as
     values. That is the correct seam for a size, a colour, a width or a
     multiplier, and it cannot express MATERIAL. `edge: offset` is not "a
     wider border": research §1.2 defines it as 2px on every block plus a hard
     un-blurred drop plus radius nought everywhere. `edge: soft` is the
     absence of borders plus a diffuse plate. No property carries "the rows
     are boxes now", so the rules below read the wrapper attribute directly.
     Nothing here WRITES an axis property — the axis file is still the only
     place a value is chosen.

     ── THE COLLISION RULE. READ IT BEFORE ADDING A SELECTOR ───────────────
     The eight presets are permutations of 38 axis values and 20 of those are
     held by more than one preset, so a bare rule on a shared value restyles
     every look holding it. CANDLELIT — the look that is signed off and must
     come out of this pass as it went in — is uniquely identified by only FOUR
     of its nine values:

         surface: media · edge: none · media: bleed · accent: glow

     Its other five are SHARED: `type: monumental` (also quiet-studio,
     plain-facts), `align: center` (also quiet-studio, open-air, full-send),
     `density: airy` (also open-air), `width: text` (also long-read,
     open-air), `motion: drift` (also open-air).

     So NOTHING below is keyed on those five alone. Every selector here is
     either a value Candlelit does not hold, or a compound that excludes it,
     and `:not([data-jp-accent='glow'])` is the honest spelling of "the other
     seven" for a repair that does not belong to Candlelit. Candlelit's own
     four values are never selected on, because Candlelit is not being
     changed. open-air is the trap: it shares FOUR axes with Candlelit
     (align, density, width, motion), so every open-air rule keys on
     `surface: tint` or `edge: soft`, its only two unique values.

     Each block names the preset it serves and the TELL it owes
     (`00-design-language-research.md` §1). The family labels are that
     document's; the preset↔family mapping was checked against §1's mechanics
     value by value and every one holds — see the report.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ═══ surface ═══════════════════════════════════════════════════════════ */

  /* `bare` — QUIET-STUDIO + LONG-READ, and both families forbid the box in
     terms: Editorial is "hairline horizontal rules only. No box borders
     anywhere" (§1.1) and Luxury-minimal is "a single hairline, used perhaps
     twice on the page" (§1.4). What shipped was a full box border on all four
     sides — and `bare` is the one surface value that also zeroes
     `--jp-sec-pad-inline`, so on a wide container the rule ran hard against
     the copy. One horizontal rule per section replaces it, which is the whole
     edge budget Luxury-minimal allows and the correct material for Editorial.
     Candlelit is `surface: media`; it cannot match. */
  :global(.jp-sec[data-jp-surface='bare']) .ache {
    border: 0px solid transparent;
    border-block-start: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: none;
  }

  /* `tint` — OPEN-AIR, and `tint` is one of its only two unique values. §1.3
     pairs the soft wash with `--radius-xl` on panels; the axis leaves
     `--jp-sec-radius` at `--radius-none`, so a wellness section was painting
     a hard-cornered rectangle, which is the one shape the family never uses.
     (`--jp-sec-radius: var(--radius-xl)` on `[data-jp-surface='tint']` is the
     better home for this and is handed off; this is the same value, locally,
     until that lands.) */
  :global(.jp-sec[data-jp-surface='tint']) .ache {
    border-radius: var(--radius-xl);
  }

  /* ═══ edge — the four materials ═════════════════════════════════════════ */

  /* `offset` — PLAIN-FACTS, and `offset` is unique to it.
     TELL: "2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere" (§1.2). Two thirds of that was missing everywhere:
     the census over the page-builder CSS and all eleven sections found 23 uses
     of a 2px border, ZERO hard offset shadows and ZERO radius-0 declarations.
     The gap was not the axis — `journey-design.css` already defines
     `--jp-edge-shadow` at this value as `--space-1 --space-1 0 0
     --jp-line-strong`, a real un-blurred offset — it was that only the section
     BOX ever read it. Every block in the section reads it now, and the width
     and colour come from the same axis, so a brand still governs them.

     `--radius-none` is not decoration here: plain-facts is `surface: panel`,
     and `panel` sets `--jp-sec-radius: var(--radius-card)` (= `--radius-lg`),
     so the most radius-hostile family in the set was shipping the roundest
     box in the set. */
  :global(.jp-sec[data-jp-edge='offset']) .ache {
    border-radius: var(--radius-none);
  }

  :global(.jp-sec[data-jp-edge='offset']) .ache__points {
    gap: calc(var(--space-4) * var(--jp-rhythm));
  }

  /* Each row is its own visible box — §1.2's "Surface: Panel — every block is
     a visible box". Deliberately NO row background: a lifted plate would need
     its own re-derived text ladder (`journey-palette.css`'s rule for a lifted
     surface), and a 2px outline already reads as a box, so the cheap and
     contrast-safe form is the correct one. */
  :global(.jp-sec[data-jp-edge='offset']) .ache__point {
    padding: calc(var(--space-3) * var(--jp-rhythm))
      calc(var(--space-4) * var(--jp-rhythm));
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-none);
    box-shadow: var(--jp-edge-shadow);
  }

  :global(.jp-sec[data-jp-edge='offset']) .ache__quote {
    padding: calc(var(--space-5) * var(--jp-rhythm));
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-none);
    box-shadow: var(--jp-edge-shadow);
  }

  /* Radius 0 EVERYWHERE means the progress rail too. */
  :global(.jp-sec[data-jp-edge='offset']) .ache__seg {
    border-radius: var(--radius-none);
  }

  /* `soft` — OPEN-AIR's other unique value.
     TELL: "no border anywhere, pill controls, and a shadow you have to look
     for" (§1.3). The axis already zeroes `--jp-edge-width` here, so the
     section box was right; the ROWS were not — they were separated by a
     hairline reading `--jp-edge-color`, i.e. by exactly the border the family
     does not have. Space and elevation replace it, and the elevation is the
     axis's own `--jp-edge-shadow` (`--shadow-lg` at this value) read directly
     rather than re-invented: the shadow scale is built on `--shadow-strength`,
     which is why "a shadow you have to look for" is what it already is. */
  :global(.jp-sec[data-jp-edge='soft']) .ache__points {
    gap: calc(var(--space-4) * var(--jp-rhythm));
  }

  :global(.jp-sec[data-jp-edge='soft']) .ache__point {
    padding: calc(var(--space-4) * var(--jp-rhythm))
      calc(var(--space-5) * var(--jp-rhythm));
    border: 0px solid transparent;
    border-radius: var(--radius-xl);
    background: var(--color-surface);
    box-shadow: var(--jp-edge-shadow);
    align-items: center;
  }

  /* A pull-quote rule is a border, so the plate carries the quote instead —
     and with no rule to hang off, the quote can rejoin the section's own
     alignment (the base rule forces `start` only because a centred block with
     a leading rule reads as a mistake). */
  :global(.jp-sec[data-jp-edge='soft']) .ache__quote {
    padding: calc(var(--space-6) * var(--jp-rhythm));
    border-inline-start: 0px solid transparent;
    border-radius: var(--radius-xl);
    background: var(--color-surface);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);
  }

  /* `heavy` — FULL-SEND, unique to it.
     TELL: "whole inverted bands, pill CTAs at `--radius-full`, spring easing,
     big numerals" (§1.8) — measured at one inverted band, one spring easing
     and no numerals across the whole tree. This section has no CTA, so the
     pill lives where the section actually has repeated blocks: the rows.
     `--jp-edge-color` is `--jp-accent-edge` at this value, so the 2px border
     is the brand accent at the strength the axis chose (contract A37 — read
     the token, never re-mix it). */
  :global(.jp-sec[data-jp-edge='heavy']) .ache {
    border-radius: var(--radius-xl);
  }

  :global(.jp-sec[data-jp-edge='heavy']) .ache__points {
    gap: calc(var(--space-3) * var(--jp-rhythm));
  }

  :global(.jp-sec[data-jp-edge='heavy']) .ache__point {
    padding: calc(var(--space-3) * var(--jp-rhythm))
      calc(var(--space-6) * var(--jp-rhythm));
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-full);
    align-items: center;
  }

  :global(.jp-sec[data-jp-edge='heavy']) .ache__quote {
    padding: calc(var(--space-6) * var(--jp-rhythm));
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-xl);
    text-align: var(--jp-text-align);
  }

  /* ═══ the panel compound — SIGNAL ═══════════════════════════════════════
     Signal is the one preset with no unique axis value: `surface: panel` is
     shared with plain-facts and syllabus, `type: balanced` with long-read.
     The PAIR is unique — plain-facts is `monumental`, syllabus is
     `restrained` — so `[data-jp-surface='panel'][data-jp-type='balanced']` is
     Signal and nothing else, and it cannot reach Candlelit (`media` +
     `monumental`).

     TELL: "rounded cards with hairlines and a small neutral shadow; one filled
     accent button per section" (§1.9). The neutral shadow was the sparsest
     tell in the census after full-send's — six occurrences against Candlelit's
     twenty-seven. `hairline` gives the section box `--shadow-xs`, which is a
     1px hairline of a shadow; §1.9 asks for `--shadow-sm`/`--shadow-md`. */
  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced']) .ache {
    box-shadow: var(--shadow-sm);
  }

  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__points {
    gap: calc(var(--space-3) * var(--jp-rhythm));
  }

  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__point {
    padding: calc(var(--space-4) * var(--jp-rhythm));
    border: var(--border-width) solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
    align-items: center;
  }

  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__quote {
    padding: calc(var(--space-5) * var(--jp-rhythm));
    border: var(--border-width) solid var(--color-border-subtle);
    border-inline-start-width: var(--border-width-thick);
    border-inline-start-color: var(--jp-accent-fill);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
  }

  /* ═══ the bare + start compound — LONG-READ ═════════════════════════════
     quiet-studio is the other `bare` look and it is centred, so this pair is
     Editorial alone.

     TELL: "the eyebrow and the body share a left edge, and a hairline under
     every section head". BOTH halves were absent, and the first was actively
     broken: the eyebrow's leading ceremonial hairline is
     `clamp(--space-6, 6cqw, --space-12)` wide plus a `--space-3` gap, and
     MEASURED in Chromium that puts the eyebrow's first glyph 36.0px / 58.1px /
     60.0px right of the body's left edge at 375 / 768 / 1440 — the exact
     opposite of the tell. The hairline suppression is under `align` (it
     belongs to all four start looks); the head rule is here.

     `width: 100%` and NOT a `max-width`: `statement` and `quote` cap the
     heading at a third of the measure on purpose, and a `max-width` here
     would out-specify and destroy both compositions. `width: 100%` is capped
     BY them, so the rule spans whatever measure the composition chose. */
  :global(.jp-sec[data-jp-surface='bare'][data-jp-align='start'])
    .ache:not([data-ache='quote'])
    .ache__heading {
    width: 100%;
    padding-block-end: calc(var(--space-3) * var(--jp-rhythm));
    border-block-end: var(--border-width) solid var(--color-border);
  }

  /* Editorial pull-quote: rules above and below, never a box and never a
     leading bar — §1.1 is "hairline horizontal rules only". */
  :global(.jp-sec[data-jp-surface='bare'][data-jp-align='start']) .ache__quote {
    padding-inline-start: 0;
    padding-block: calc(var(--space-5) * var(--jp-rhythm));
    border-inline-start: 0px solid transparent;
    border-block: var(--border-width) solid var(--color-border);
  }

  /* ═══ type ══════════════════════════════════════════════════════════════ */

  /* `restrained` — SYLLABUS, unique to it. §1.5 is "1.125–1.2 — many small
     steps, fine-grained hierarchy", and the hierarchy here was INVERTED, not
     fine-grained: the body shipped a flat `--text-lg` (20px desktop) under a
     `--text-xl` heading (24px) and above a 17px row lead, so the body was
     larger than the list it introduced and within 4px of the heading it sat
     under. Candlelit is `monumental`; it cannot match. */
  :global(.jp-sec[data-jp-type='restrained']) .ache__body {
    font-size: var(--text-base);
    line-height: var(--leading-normal);
  }

  /* The hairline grid, half one: the row rules already exist between rows, but
     three loose rules read as three loose rules. A table needs its own top and
     bottom edge. */
  :global(.jp-sec[data-jp-type='restrained']) .ache__point:first-child {
    border-block-start: var(--border-width) solid var(--jp-edge-color);
  }

  :global(.jp-sec[data-jp-type='restrained']) .ache__point:last-child {
    border-block-end: var(--border-width) solid var(--jp-edge-color);
  }

  /* Half two: the vertical rule that turns the marker column into a real
     column. `stretch` overrides the row's baseline alignment for this cell
     only, which is what gives the rule its full-row height. */
  :global(.jp-sec[data-jp-type='restrained']) .ache__mark {
    align-self: stretch;
    padding-inline-end: var(--space-4);
    border-inline-end: var(--border-width) solid var(--jp-edge-color);
  }

  /* ═══ accent — five eyebrow treatments, one per value ═══════════════════
     The eyebrow is where every family puts its accent deployment, and the
     five `accent` values happen to partition the eight presets cleanly:
     `glow` is Candlelit's and is left exactly as it is (the flanking
     ceremonial hairlines, below). The other four each get the deployment
     their own family names. */

  /* THE CEREMONY IS CANDLELIT'S. The flanking hairlines are a cinematic
     chapter mark; on every other look they are either wrong material (a
     start-aligned label must be flush — see the long-read block) or wrong
     vocabulary (Luxury-minimal has no accent to flank with, Soft-organic has
     no borders, Playful reverses its label out of a fill). Suppressed on the
     four values that cover the other seven presets; `content: none` so no box
     is generated at all. */
  :global(.jp-sec[data-jp-align='start']) .ache__eyebrow::before,
  :global(.jp-sec[data-jp-align='start']) .ache__eyebrow::after,
  :global(.jp-sec[data-jp-accent='none']) .ache__eyebrow::before,
  :global(.jp-sec[data-jp-accent='none']) .ache__eyebrow::after,
  :global(.jp-sec[data-jp-edge='soft']) .ache__eyebrow::before,
  :global(.jp-sec[data-jp-edge='soft']) .ache__eyebrow::after,
  :global(.jp-sec[data-jp-edge='heavy']) .ache__eyebrow::before,
  :global(.jp-sec[data-jp-edge='heavy']) .ache__eyebrow::after {
    content: none;
  }

  /* `text` — LONG-READ + OPEN-AIR. "Accent as TEXT: kickers, drop-cap, link
     underline, footnote markers" (§1.1) and "accent tinted background + accent
     text" (§1.3). `--jp-accent-text` is the AA-safe `--jp-ember-text` rung
     (contract A38), and it re-derives through `--jp-heading` against the
     SECTION's own ink — so it is safe on `bare` and on `tint` alike without a
     second measurement. */
  :global(.jp-sec[data-jp-accent='text']) .ache__eyebrow {
    color: var(--jp-accent-text);
  }

  /* `edge` — SYLLABUS, unique to it. Its tell is literally "a left-border
     accent stripe RATHER THAN a filled badge", so the label is the stripe's
     first home. `--jp-accent-edge` read straight, no mix: contract A37 —
     re-mixing an axis token double-counts the strength the axis already
     chose, and A39 says any alpha faint enough to look faint fails 3:1 at the
     dark pole. */
  :global(.jp-sec[data-jp-accent='edge']) .ache__eyebrow {
    padding-inline-start: var(--space-3);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
  }

  /* `fill` — PLAIN-FACTS + FULL-SEND + SIGNAL, and all three deploy the accent
     as a solid with the label reversed out of it: "solid rectangles of it,
     text reversed out" (§1.2), "accent as fill, everywhere, at full strength"
     (§1.8), "accent as fill on the CTA only" (§1.9). This section has no CTA,
     so the label is the one filled element in it, which is exactly Signal's
     "one filled accent button per section" read honestly.

     `--jp-accent-on-fill` is the ONE accent pairing in this palette that a
     creator cannot break: it is decided on the fill's relative luminance, and
     `journey-palette.css` records the sweep — a 4.58:1 floor across all
     16 777 216 sRGB brands, 0 failures. So this needs no per-brand
     measurement, unlike every other coloured pairing in the file. */
  :global(.jp-sec[data-jp-accent='fill']) .ache__eyebrow {
    padding: var(--space-1) var(--space-3);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
  }

  /* …and the RADIUS is what separates the three. Brutalist inherits the base's
     no-radius (§1.2: "`--radius-none`, absolutely"), so only the two rounded
     families declare anything. */
  :global(.jp-sec[data-jp-edge='heavy']) .ache__eyebrow,
  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__eyebrow {
    border-radius: var(--radius-full);
  }

  /* Mono labels — BRUTALIST ("mono labels", §1.2) and TECHNICAL ("mono
     numerals … no display face at all", §1.5). The descent's chapter mark is
     the same label in the pinned composition, so it takes the same face. */
  :global(.jp-sec[data-jp-edge='offset']) .ache__eyebrow,
  :global(.jp-sec[data-jp-edge='offset']) .ache__chapter,
  :global(.jp-sec[data-jp-accent='edge']) .ache__eyebrow,
  :global(.jp-sec[data-jp-accent='edge']) .ache__chapter {
    font-family: var(--font-mono);
  }

  /* Ceremonial tracking is Candlelit's too. The shared eyebrow atom exposes
     `--jp-eyebrow-tracking` for precisely this (`journey-sections-shared.css`
     documents the seam), so this is choosing a value, not overriding a rule.
     Technical and Product labels are set, not tracked out. */
  :global(.jp-sec[data-jp-type='restrained']) .ache,
  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced']) .ache {
    --jp-eyebrow-tracking: var(--tracking-wide);
  }

  /* ═══ THE ROW MARKER, once per design language ══════════════════════════
     One `<span class="ache__mark">` serves eight looks. Candlelit's is a
     `--space-2` brand dot and stays one; four looks want a numeral, one wants
     a hairline dash, one wants a softer dot and one wants a filled chip. */

  /* THE NUMERAL RESET — the four looks whose tell names numerals: Brutalist
     ("mono labels"), Technical ("mono numerals"), Playful ("big numerals")
     and Editorial (the footnote marker). The dot stops being a dot. */
  :global(.jp-sec[data-jp-edge='offset']) .ache__mark,
  :global(.jp-sec[data-jp-accent='edge']) .ache__mark,
  :global(.jp-sec[data-jp-edge='heavy']) .ache__mark,
  :global(.jp-sec[data-jp-surface='bare'][data-jp-align='start']) .ache__mark {
    width: auto;
    height: auto;
    border-radius: var(--radius-none);
    background: transparent;
    translate: none;
    line-height: var(--leading-snug);
    font-variant-numeric: tabular-nums;
  }

  :global(.jp-sec[data-jp-edge='offset']) .ache__mark::before,
  :global(.jp-sec[data-jp-accent='edge']) .ache__mark::before,
  :global(.jp-sec[data-jp-edge='heavy']) .ache__mark::before,
  :global(.jp-sec[data-jp-surface='bare'][data-jp-align='start'])
    .ache__mark::before {
    content: counter(ache-point, decimal-leading-zero);
  }

  /* BRUTALIST — reversed out of a solid accent rectangle, radius 0, mono. */
  :global(.jp-sec[data-jp-edge='offset']) .ache__mark {
    min-width: var(--space-8);
    padding-inline: var(--space-1);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    text-align: center;
  }

  /* TECHNICAL — a mono tabular index and NO badge, because "rather than a
     filled badge" is half the tell; the accent is spent on the row stripe
     below. `--color-text-secondary` (`--jp-dim`, measured 11.05:1 light /
     7.79:1 dark) rather than `--color-text-muted`, which aliases the
     `--jp-faint` rung reserved for non-essential text. */
  :global(.jp-sec[data-jp-accent='edge']) .ache__mark {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  /* PLAYFUL — big numerals, filled, `--radius-full`, in the heading face.
     Derived from `--jp-heading-size` so the `type` axis still governs it: at
     full-send's `expressive` that is 22–30px against a 20px row lead, which is
     what makes it read as a numeral rather than a bullet. */
  :global(.jp-sec[data-jp-edge='heavy']) .ache__mark {
    min-width: calc(var(--space-10) + var(--space-2));
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
    font-family: var(--font-heading);
    font-size: calc(var(--jp-heading-size) * 0.75);
    font-weight: var(--font-bold);
    text-align: center;
  }

  /* EDITORIAL — a footnote marker, not a badge: the body face, small, in the
     accent's text role (§1.1's "footnote markers"). */
  :global(.jp-sec[data-jp-surface='bare'][data-jp-align='start']) .ache__mark {
    color: var(--jp-accent-text);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  /* LUXURY-MINIMAL — `accent: none` resolves `--jp-accent-mark` to
     `--jp-heading`, so the dot would paint at FULL heading strength: the
     loudest marker in the set, on the look whose tell is "no accent colour".
     A hairline dash is the family's own vocabulary and spends nothing. The
     shift lifts it to the first line's optical centre, as the dot's does. */
  :global(.jp-sec[data-jp-accent='none']) .ache__mark {
    width: var(--space-5);
    height: var(--border-width);
    border-radius: var(--radius-none);
    background: var(--color-border-strong);
    translate: 0 calc(var(--space-2) * -1);
  }

  /* SOFT-ORGANIC — the same dot, larger, because it now sits on a soft plate
     rather than against a hairline. Full-strength `--jp-accent-mark`: A39
     measured that anything faint enough to LOOK faint fails 3:1 at the dark
     pole, so the softness comes from the plate, never from an alpha. */
  :global(.jp-sec[data-jp-edge='soft']) .ache__mark {
    width: var(--space-3);
    height: var(--space-3);
  }

  /* CONTEMPORARY — a small filled accent chip carrying a plain index. Same
     luminance-decided pairing as the label, so same proven 4.58:1 floor. */
  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__mark {
    display: grid;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
  }

  :global(.jp-sec[data-jp-surface='panel'][data-jp-type='balanced'])
    .ache__mark::before {
    content: counter(ache-point);
  }

  /* TECHNICAL's pull-quote is another row of the same table: the grid's
     hairline above and below, and the leading bar recoloured from
     `--jp-accent-mark` (the AA-safe text rung, correct for a marker) to
     `--jp-accent-edge` (the axis's own STRIPE role, which is what a status
     stripe is). Read at full strength, per A37. */
  :global(.jp-sec[data-jp-accent='edge']) .ache__quote {
    padding-block: calc(var(--space-4) * var(--jp-rhythm));
    border-block: var(--border-width) solid var(--jp-edge-color);
    border-inline-start-color: var(--jp-accent-edge);
  }

  /* THE ROW STRIPE — TECHNICAL's actual tell, and the reason its marker is
     bare. Applied to the row rather than the marker so it reads as a status
     stripe on a table row, which is what §1.5 describes. Not the only signal
     on the row (there is also the index, the rule above it and the lead), so
     the 3:1 graphic floor is not load-bearing here — and the token is read at
     full strength either way. */
  :global(.jp-sec[data-jp-accent='edge']) .ache__point {
    padding-inline-start: var(--space-4);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-edge);
  }

  /* ═══ density ═══════════════════════════════════════════════════════════ */

  /* `vast` — QUIET-STUDIO, unique to it.
     TELL: "three type sizes, one hairline, no accent colour, and more empty
     space than content" (§1.4). The census found it at one hairline and six
     no-accent declarations against Candlelit's twenty-eight-a-tell, and the
     whitespace half was not reaching the page at all. MEASURED, Chromium, at
     the three builder preview widths (A10), `--jp-sec-pad-block` for
     regular / airy / vast:

         375px   32     40      51.2
         768px   46.08  46.08   51.2
        1440px   80     86.4    86.4

     `--jp-rhythm` multiplies only the clamp's TWO ENDPOINTS; the middle term
     is a bare `6cqw`, and above ~850px it sits inside every density's range
     and wins. So at 1440 `vast` — the axis's most extreme density — is
     BYTE-IDENTICAL to `airy` and just 8% above `regular`, and at 768 `airy` is
     identical to `regular`. That is a shared-table defect affecting all eleven
     sections and is handed off; the fix belongs in the role alias, not here.
     Half again on top meanwhile, through the LOOK multiplier so `statement`
     still gets its 1.3 as well.

     THE OTHER HALF OF THIS LOOK IS REMOVAL, and that is the correct edit: the
     row rules go (the section's single top hairline is the whole edge budget),
     the quote's leading bar goes, and the list separates by air. */
  :global(.jp-sec[data-jp-density='vast']) .ache {
    --ache-pad-look: 1.5;
    --ache-gap-look: 1.5;
  }

  :global(.jp-sec[data-jp-density='vast']) .ache__points {
    gap: calc(var(--space-8) * var(--jp-rhythm));
  }

  :global(.jp-sec[data-jp-density='vast']) .ache__point {
    padding-block: 0;
    border: 0px solid transparent;
  }

  :global(.jp-sec[data-jp-density='vast']) .ache__quote {
    padding-inline-start: 0;
    border-inline-start: 0px solid transparent;
    text-align: var(--jp-text-align);
  }

  /* THREE TYPE SIZES ON THE WHOLE SECTION — the half of the tell that is
     arithmetic rather than taste, so it is checkable: eyebrow `--text-sm`,
     heading `--jp-heading-size`, body `--text-lg`. The list row shipped a
     FOURTH (`--jp-body-size`) and a FIFTH (a derived denser step), taking the
     section to five sizes on the one look that is allowed three. Both collapse
     onto the body size; weight and colour carry the difference, which is what
     a three-size page does. The descent adds none — its chapter is `--text-sm`
     and its beat lead is `--jp-heading-size`, both already in the three. */
  :global(.jp-sec[data-jp-density='vast']) .ache__point-lead,
  :global(.jp-sec[data-jp-density='vast']) .ache__point-gloss {
    font-size: var(--text-lg);
  }

  /* ═══ motion ════════════════════════════════════════════════════════════ */

  /* `none` — PLAIN-FACTS + SYLLABUS: "None. Instant state changes" (§1.2),
     "None. Interactions are instant" (§1.5). The reveal atom is already still
     at this value (`--jp-reveal-distance: 0px`, duration `0ms`), but this
     section runs two motions the axis never reached. The ember breathe is
     mounted on EVERY surface and merely resolves to zero opacity off `media`,
     so at `motion: none` + `surface: media` — a combination the axes make
     reachable — an infinite keyframe was running with nothing to show. And the
     descent's beat and segment transitions were pinned to raw `--duration-*`.
     `none` has to mean none, so it does. Candlelit is `drift`. */
  :global(.jp-sec[data-jp-motion='none']) .ache__aura {
    animation: none;
  }

  :global(.jp-sec[data-jp-motion='none']) .ache__beat,
  :global(.jp-sec[data-jp-motion='none']) .ache__seg {
    transition: none;
  }

  /* `fade` — QUIET-STUDIO: "Slow fade only. NO TRANSFORM" (§1.4). The reveal
     atom honours that (`--jp-reveal-distance: 0px`); the descent did not — its
     beats translated by `--space-6` in, and lifted by another `--space-6`
     out, on every motion value. Opacity only here, and the spent beat stops
     lifting. Candlelit is `drift`, so its descent is untouched. */
  :global(.jp-sec[data-jp-motion='fade'])
    .ache--descent.ache--enhanced
    .ache__beat,
  :global(.jp-sec[data-jp-motion='fade'])
    .ache--descent.ache--enhanced
    .ache__beat.is-past {
    translate: 0 -50%;
    transition: opacity var(--duration-slower) var(--ease-out);
  }

  /* `stagger` — FULL-SEND: "Stagger with SPRING EASING" (§1.8). The census
     found spring easing implemented exactly once in the entire tree. The
     shared `.jp-reveal` ladder already staggers these rows and already reads
     `--jp-reveal-ease`, which IS `--ease-spring` at this value — so what was
     missing was anything for the spring to act on. `cubic-bezier(0.22, 1.2,
     0.36, 1)` overshoots past 1, so a scale is the property that shows it.

     AN ANIMATION, NOT A TRANSITION, deliberately: the shared atom owns the
     `transition` SHORTHAND on `.jp-reveal`, and a higher-specificity
     `transition` here would replace it wholesale and silently kill the row's
     own opacity and transform. `scale` is an independent property, so an
     animation composes with the atom instead of competing with it.

     REDUCED MOTION IS COVERED TWICE. `render/reveal.ts` never adds
     `.reveal--armed` when `prefers-reduced-motion` matches or when there is no
     JS — it takes the immediate path and adds only `is-in` — so this rule is
     inert for those readers and cannot strand a row at 92%. And
     `journey-sections-shared.css`'s guard is `animation: none !important` on
     everything inside `.jp-sec`, which an animation (unlike a transition) is
     caught by. */
  @keyframes ache-spring {
    from {
      scale: 0.92;
    }

    to {
      scale: 1;
    }
  }

  /* LONGHANDS, NOT THE `animation` SHORTHAND, and this one is measured rather
     than reasoned: the shorthand was written first and it RESET
     `animation-delay` to `0s`, because it out-specifies the per-step ladder
     below — the whole cascade collapsed onto a single simultaneous pop, and
     `getComputedStyle` read `animation-delay: 0s` on every row while the
     ladder's rules sat there looking correct. Longhands leave the delay to the
     ladder, which is the only rule that declares it. */
  :global(.jp-sec[data-jp-motion='stagger'])
    .ache__inner:global(.reveal--armed.is-in)
    .ache__point {
    animation-name: ache-spring;
    animation-duration: var(--jp-reveal-duration);
    animation-timing-function: var(--jp-reveal-ease);
    animation-fill-mode: both;
  }

  /* The cascade, laddered on the SAME formula the shared atom uses for its own
     `transition-delay` (`--jp-reveal-stagger` × step), so the spring and the
     fade arrive together instead of racing. Five rungs because the ladder
     stops at five and `step()` clamps there; `animation-delay` with no
     animation is inert, so these cost nothing on the other seven looks. */
  :global(.jp-sec[data-jp-motion='stagger']) .ache__point[data-jp-step='1'] {
    animation-delay: var(--jp-reveal-stagger);
  }

  :global(.jp-sec[data-jp-motion='stagger']) .ache__point[data-jp-step='2'] {
    animation-delay: calc(var(--jp-reveal-stagger) * 2);
  }

  :global(.jp-sec[data-jp-motion='stagger']) .ache__point[data-jp-step='3'] {
    animation-delay: calc(var(--jp-reveal-stagger) * 3);
  }

  :global(.jp-sec[data-jp-motion='stagger']) .ache__point[data-jp-step='4'] {
    animation-delay: calc(var(--jp-reveal-stagger) * 4);
  }

  :global(.jp-sec[data-jp-motion='stagger']) .ache__point[data-jp-step='5'] {
    animation-delay: calc(var(--jp-reveal-stagger) * 5);
  }

  /* ═══ two repairs that belong to the other seven ════════════════════════
     `:not([data-jp-accent='glow'])` is the only handle that means "every look
     except Candlelit" — `glow` is one of Candlelit's four unique values, so
     the negation excludes it and nothing else. Used ONLY here, for two defects
     whose fix would otherwise change the one look that is signed off. */

  /* The descent's progress rail painted its resting segments at
     `color-mix(--color-text 18%, transparent)`. A39 measured that 45% already
     falls to 2.05:1 at the dark pole against a 3:1 graphic floor, so 18% is
     not "subtle", it is absent — and its active segment read a raw
     `--color-brand-primary`, bypassing the accent axis entirely, so
     `accent: none` still got a brand-coloured rail on a look defined by
     having no accent colour.

     `--jp-accent-mark` and not `--jp-accent-fill` for the active state: the
     fill is `transparent` at `accent: text` and `accent: edge`, which would
     make the rail's ONE meaningful state invisible on two of five values
     (`journey-design.css` records this as the WT-3 pilot's lesson 4). */
  :global(.jp-sec:not([data-jp-accent='glow'])) .ache__seg {
    background: var(--color-border-strong);
  }

  :global(.jp-sec:not([data-jp-accent='glow'])) .ache__seg.is-on {
    background: var(--jp-accent-mark);
  }

  /* An orphaned last word is a defect in seven design languages and a change
     to the eighth, so it is applied to the seven. */
  :global(.jp-sec:not([data-jp-accent='glow'])) .ache__body,
  :global(.jp-sec:not([data-jp-accent='glow'])) .ache__point-lead {
    text-wrap: pretty;
  }
</style>
