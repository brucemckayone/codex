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
    gap: var(--jp-sec-gap);
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
       still governs it. */
    padding-block: calc(var(--jp-sec-pad-block) * 1.3);
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
  }

  .ache__point {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: var(--space-4);
    padding-block: calc(var(--space-4) * var(--jp-rhythm));
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

  .ache--descent .ache__frame {
    position: relative;
    z-index: 2;
    width: 100%;
    max-width: var(--container-text);
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

</style>
