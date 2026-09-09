<!--
  @component ProofSection

  Testimonials and social proof (SPEC §4.1 `proof`).

  ── THE NINE AXES ──────────────────────────────────────────────────────────
  Every layout / rhythm / type-scale / edge / surface / motion decision in this
  file reads a `--jp-*` property that `render/SectionRenderer.svelte` resolves
  onto the `.jp-sec` wrapper as a `data-jp-*` attribute
  (`docs/design/journey-sections/02-axis-contract.md` A9). COLOUR STAYS
  `--color-*` (A11) — `.journey-palette--page` already re-points those onto the
  `--jp-*` ladder, so they are brand-derived and auto-contrasted. The one colour
  exception is the `--jp-accent-*` family, which exists so `accent: none` drops
  the brand out of the decoration in a handful of declarations.

  Two axes are read in MARKUP rather than CSS, because a component's scoped
  styles cannot reach an ancestor attribute: `accent` (whether `--jp-accent-fill`
  is a real colour at all — see the avatar note) and `motion` (whether the
  `marquee` ticker runs at all). The composition itself is the third markup read.

  ── AND THE EIGHT LOOKS, WHICH ARE NOT THE SAME THING ──────────────────────
  The axes above are MAGNITUDES, and a magnitude is enough for anything that is
  a number. A design LANGUAGE is also a set of selector-level facts — which
  elements exist as boxes, which corner is square, which label is monospaced,
  which rule is drawn at all — so eight of the nine axis values are ALSO
  mirrored into markup as plain `data-*` attributes on this section's own root
  (`look` in the script), and the block at the foot of the style sheet keys one
  per-look treatment on each. Read that block's header before editing it: it
  records which axis values are unique to a look, which are shared, and why
  every selector there is either a unique value or a compound whose intersection
  is one look.

  CANDLELIT MATCHES NOTHING IN THAT BLOCK. Its four identifying values
  (`surface: media`, `edge: none`, `media: bleed`, `accent: glow`) appear in no
  selector, and its five SHARED values (`type: monumental`, `align: center`,
  `density: airy`, `width: text`, `motion: drift`) are keyed on nowhere, bare or
  compounded. It resolves the role table's defaults, every one of which
  reproduces this file's pre-look commit line for line.

  ── SIX COMPOSITIONS ───────────────────────────────────────────────────────
  `grid` (default) · `stack` · `spotlight` · `wall` · `marquee` · `pull`.
  `grid`/`stack`/`spotlight` are ported from the since-deleted canvas partial
  (`render-edit/journey-sections/_proof.css`, contract A12); `wall`, `marquee`
  and `pull` are new.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ─────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): every quote legible at once, no
    entrance offsets, no ticker movement. This is what the server emits, so the
    section is never blank and never depends on JS.
  • ENHANCED (browser + motion OK): quotes rise into place on scroll on the
    `motion` axis's own timing, cards lift on hover, and `marquee` scrolls.

  `marquee` ships its static fallback in the same commit, and ships it by being
  static BY DEFAULT: the wrapped list is the baseline and the ticker only exists
  inside `@media (prefers-reduced-motion: no-preference)` with `motion` not
  `none`. Written the usual way round — animate, then override — a stopped ticker
  is not a fallback at all, because the track is one long row inside a clipped
  strip and stopping it parks most quotes outside the box. That was measured: two
  of three quotes were unreachable before this was inverted (research §5.1 —
  keyframes must STOP, not merely accelerate, and the content must still be there
  once they have).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import { PauseIcon, PlayIcon } from '$lib/components/ui/Icon';
  import { aliasKeys, asNumberedGroups, asString, asStringFrom } from '../coerce';
  import { reveal } from '../reveal';
  import { editFieldAttrs } from '../editable';
  import type { ProofSectionProps, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props {
    config: SectionProps;
    context: JourneySalesContext;
    variant?: string;
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const {
    config,
    context,
    variant,
    design,
    editable = false,
    onEdit,
  }: Props = $props();

  const p: ProofSectionProps = $derived({
    eyebrow: asString(config, 'eyebrow'),
    heading: asString(config, 'heading'),
    trustLabel: asStringFrom(config, aliasKeys('proof', 'trustLabel')),
  });

  type Testimonial = JourneySalesContext['testimonials'][number];

  /** The builder's numbered `q1/n1/c1…` fields (`section-fields.ts:173-191`). */
  const authored: Testimonial[] = $derived(
    asNumberedGroups<Testimonial>(
      config,
      { quote: 'q', authorName: 'n', authorContext: 'c' },
      ({ quote, authorName, authorContext }, index) =>
        quote
          ? {
              id: `authored-${index}`,
              sortOrder: index,
              quote,
              authorName: authorName ?? '',
              authorContext,
            }
          : null
    ) ?? []
  );

  /**
   * AUTHORED COPY WINS; the course's `course_testimonials` rows are the fallback.
   *
   * This INVERTS the precedence this section shipped with, and the inversion is
   * the fix rather than a regression. Every other prop in the renderer reads
   * `authored ?? derived` (`p.heading ?? context.course.title`,
   * `p.eyebrow ?? context.course.kicker`); `proof` was the only place the order
   * was reversed, and the audit (§B.8, "Precedence trap") named the consequence:
   * a creator types three quotes in the builder, sees them in the canvas, and
   * the published page shows the course's rows instead. Nothing errors and
   * nothing warns — the builder field is simply inert, which is the failure mode
   * amendment A21 exists to prevent.
   *
   * Safe to change NOW, and only now: `course_testimonials` is empty for every
   * course in the database, so no page's rendered output moves. Left as it was,
   * the bug is LATENT — the first creator to add a testimonial row would have
   * every authored quote on their proof section silently disappear. Flipping it
   * while the table is empty costs nothing; flipping it later is a migration.
   *
   * The loss asymmetry also runs this way. Authored-wins supersedes course rows
   * only through a deliberate, visible, reversible act of authoring (clear the
   * fields and the rows come back). Context-wins discards typed copy invisibly.
   */
  const usingAuthored = $derived(authored.length > 0);
  const testimonials = $derived(
    usingAuthored
      ? authored
      : [...context.testimonials].sort((a, b) => a.sortOrder - b.sortOrder)
  );

  /**
   * NO HARDCODED FALLBACK HEADING (`Codex-i9pzs`). This section used to fall back
   * to `'What the ground gives back.'` — copy in one org's voice, compiled into a
   * component every other org's sell page renders. There is no course field that
   * is honestly a testimonials heading (the course TITLE is not one), so the
   * element self-hides instead. An absent heading rendering nothing is honest; an
   * invented sentence in someone else's voice is not. Deliberately NOT an i18n
   * key: a key holding that sentence has moved the problem, not fixed it.
   */
  const heading = $derived(p.heading);

  const COMPOSITIONS = [
    'grid',
    'stack',
    'spotlight',
    'wall',
    'marquee',
    'pull',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'grid'
  );

  /** `spotlight` and `pull` are single-quote compositions. */
  const solo = $derived(composition === 'spotlight' || composition === 'pull');
  const shown = $derived(solo ? testimonials.slice(0, 1) : testimonials);

  /**
   * THE TWO COMPOSITIONS THAT BECOME A HORIZONTAL SCROLLER, and why they need a
   * `tabindex` in MARKUP rather than a rule in CSS (WCAG 2.1.1).
   *
   * `grid` and `wall` are rewritten by `@container (max-width: 48rem)` into a
   * snap-row: `display: flex`, `overflow-x: auto`, `flex: 0 0 84%` per quote and
   * `scrollbar-width: none`. Nothing inside a quote is focusable — a `<figure>`
   * with a `<blockquote>` and a `<figcaption>` — so the box scrolls and no
   * keyboard can scroll it: Chrome gives no keyboard scrolling to a non-focusable
   * overflow box. MEASURED at a 674px section (the builder canvas's own width,
   * and every phone and tablet): three quotes at 84% = 252% of the box, so two of
   * the three were unreachable without a pointer, with the scrollbar hidden so
   * nothing said they were there.
   *
   * Two siblings in this tree already solved this and neither could be reused
   * directly: `MapSection`'s `.descent__track` is a scroller at EVERY width, so
   * an unconditional `tabindex` is free there; `InviteSection`'s
   * `.invite__scroller` is a `role="region"` named by its table caption, which
   * this list has no caption for. So this takes `MapSection`'s bare-`tabindex`
   * shape (a landmark with no name would be noise beside the section's own `h2`)
   * and narrows it to the case that can actually scroll.
   *
   * THE COST, STATED: at a container WIDER than 48rem these two compositions are
   * a plain grid with nothing to scroll, and the element is still a tab stop. A
   * container query cannot set an attribute, and gating on a measured
   * `scrollWidth > clientWidth` would need JS — which would leave the barrier in
   * place for the SSR and no-JS render, where the CSS scroller still applies.
   * A spare tab stop is the smaller harm, and `> 1` keeps it off the single-quote
   * case that never overflows.
   */
  const scrollable = $derived(
    (composition === 'grid' || composition === 'wall') && shown.length > 1
  );

  /**
   * `accent: text` and `accent: edge` resolve `--jp-accent-fill` to
   * `transparent`, so a filled plate has nothing to paint and its paired ink
   * (`--jp-accent-on-fill`) would sit on the section background instead — which
   * is how a white avatar letter lands on a cream page. On those two values the
   * avatar becomes a RING with ladder ink; on the other three it stays the
   * filled plate it is today. String discriminant, not a boolean: `apps/web`
   * has `strictNullChecks` OFF and a boolean-literal discriminant does not
   * narrow.
   */
  const plated = $derived(
    design?.accent !== 'text' && design?.accent !== 'edge' ? 'yes' : 'no'
  );

  /** The trust stack shows at most five dots regardless of quote count. */
  const dots = $derived(Math.min(shown.length, 5));

  /**
   * The `motion` axis, read in MARKUP because a component's scoped styles cannot
   * reach the ancestor `data-jp-motion` attribute. `marquee`'s ticker is an
   * enhancement over a static wrapped list, and `motion: none` must switch it off
   * — a creator who asks for no motion should not get a scrolling ticker.
   */
  const motion = $derived(design?.motion === 'none' ? 'none' : 'on');

  /**
   * THE AXIS VALUES, MIRRORED INTO MARKUP so this file's own CSS can select on
   * them (the `GuideSection.svelte` shape, contract A9).
   *
   * `journey-design.css` resolves the nine axes onto `.jp-sec` as `--jp-*`
   * MAGNITUDES, and those are enough for anything that is a number: padding, a
   * type step, a border width. They are NOT enough for a design LANGUAGE, which
   * is also a set of selector-level facts — which elements exist as boxes, which
   * corner is square, which label is monospaced, which rule is drawn at all. A
   * Svelte-scoped style block cannot reach the ancestor `data-jp-*` attribute, so
   * the value is re-emitted here UNMODIFIED as a local `data-*`.
   *
   * `motion` IS DELIBERATELY ABSENT FROM THIS BAG. `data-motion` on this root is
   * already taken, and it does not hold the axis value: it is the TICKER GATE
   * (`'on'` / `'none'`, above) and `ProofSection.svelte.test.ts` pins both
   * strings. Re-pointing it at the axis would turn `data-motion="drift"` into a
   * silently-off marquee on every published Candlelit page. So the two looks that
   * need a motion-shaped rule key on an axis of their own instead —
   * `quiet-studio` on `accent: none` (its `motion: fade`) and `full-send` on
   * `edge: heavy` (its `motion: stagger`) — and read `--jp-reveal-ease`, which is
   * the motion axis, for the curve itself.
   *
   * `width` and `media` are not mirrored either, for the ordinary reason: nothing
   * in this file needs to select on them. `--jp-content-max` / `--jp-measure`
   * already carry `width`, and this section renders no media.
   *
   * `undefined` when no `design` arrives, so Svelte omits the attribute and every
   * per-look rule no-ops — the honest degradation. A host that resolves no axes
   * gets exactly the markup and CSS this component shipped before this pass,
   * rather than a guessed default look. `SectionRenderer` always passes a TOTAL
   * `ResolvedSectionDesign`, so both real render paths have all nine.
   */
  const look = $derived({
    surface: design?.surface,
    edge: design?.edge,
    align: design?.align,
    type: design?.type,
    accent: design?.accent,
    density: design?.density,
  });

  /**
   * THE MARQUEE'S PAUSE CONTROL — WCAG 2.2.2, and the mechanism this file already
   * claimed to have.
   *
   * The ticker is `animation: proof-marquee … linear infinite` (15.6s–42s per
   * cycle depending on the `motion` axis), it starts on its own, and the only
   * declared way to stop it was
   * `.proof__marquee:hover, .proof__marquee:focus-within`. `:focus-within` CANNOT
   * MATCH: there is not one focusable node inside the strip — the quotes are
   * `<figure>`/`<blockquote>`/`<figcaption>` and the clone track is
   * `aria-hidden`. So the comment beside those selectors was wrong about half its
   * own claim ("a pointer or keyboard user landing anywhere in the strip"), and
   * the real coverage was pointer-only: no keyboard user and no touch user had
   * any mechanism at all, on content that moves for more than five seconds.
   *
   * A REAL BUTTON, not a `tabindex` on the strip, and it costs no new copy:
   * `marquee_pause` / `marquee_resume` already exist in `messages/en.json`
   * ("Pause the moving row" / "Resume the moving row") for
   * `components/pricing/ContentMarquee.svelte`, which is the house pattern for
   * exactly this control — same keys, same `PauseIcon`/`PlayIcon` pair, same
   * absolutely-positioned pill. Reusing it keeps one answer to "how does a moving
   * row stop" instead of two.
   *
   * IT RENDERS ONLY WHEN THE TICKER IS REALLY MOVING (`ticking`), because a
   * button that pauses nothing is a dead-end affordance — the class of defect
   * this whole sweep is looking for. The ticker exists only inside
   * `@media (prefers-reduced-motion: no-preference)` and only at
   * `data-motion='on'`, so both predicates are read here too, and `mounted` keeps
   * the SSR/no-JS render byte-identical to what it serves today (no JS ⇒ no
   * animation control ⇒ no control offered).
   */
  let mounted = $state(false);
  let reduced = $state(false);
  let paused = $state(false);

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

  const ticking = $derived(
    composition === 'marquee' && motion === 'on' && mounted && !reduced
  );

  /**
   * `--jp-reveal-stagger` is calibrated for ~5 block beats, and the shared
   * `.jp-reveal[data-jp-step]` ladder in `journey-sections-shared.css` stops at
   * 5 — so a wall of twelve quotes clamps rather than taking three seconds to
   * assemble (pilot lesson 5).
   */
  const step = (i: number): string => String(Math.min(i + 1, 5));

  /** First letter of a name for the avatar (falls back to a bullet). */
  function initial(name: string): string {
    const match = name.trim().match(/\p{L}|\p{N}/u);
    return match ? match[0].toUpperCase() : '•';
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
    editFieldAttrs('proof', key, editable, onEdit);

  /**
   * Per-quote edit keys only exist on the authored path — a `course_testimonials`
   * row has no `props` key to write back to, so those render read-only even in
   * the canvas.
   */
  const itemAttrs = (prefix: string, i: number) =>
    usingAuthored ? editAttrs(`${prefix}${i + 1}`) : {};
</script>

{#if shown.length > 0}
  <div
    class="proof"
    data-proof={composition}
    data-plated={plated}
    data-motion={motion}
    data-surface={look.surface}
    data-edge={look.edge}
    data-align={look.align}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
  >
    <!-- Local warmth behind the header. Decorative, never load-bearing for
         legibility, and gated by the `surface` axis's 0/1 `--jp-sec-atmos` so the
         markup stays mounted and simply resolves to zero opacity outside
         `surface: media` (research §2.3). -->
    <div class="proof__atmos" aria-hidden="true"></div>

    <!-- ONE observer for the whole section, on the container.

         The shared atom in `journey-sections-shared.css` is
         `.reveal--armed .jp-reveal` — a DESCENDANT selector — and the `reveal`
         action adds `.reveal--armed` / `.is-in` to the node it is used on. So the
         action goes on the container and the staggered beats are its children;
         putting both on the same element matches nothing. One IntersectionObserver
         per section rather than one per quote is also the cheaper shape. -->
    <div class="proof__inner" use:reveal={{ disabled: editable }}>
      {#if p.eyebrow || heading}
        <header class="proof__head jp-reveal">
          {#if p.eyebrow}
            <p class="jp-sec__eyebrow proof__eyebrow" {...editAttrs('eyebrow')}>
              {p.eyebrow}
            </p>
          {/if}
          {#if heading}
            <h2
              class="jp-sec__heading jp-sec__heading--sub proof__heading"
              {...editAttrs('heading')}
            >
              {heading}
            </h2>
          {/if}
        </header>
      {/if}

      {#if composition === 'marquee'}
        <!-- THE WRAPPER EXISTS FOR THE CONTROL, and only for it. The edge fade is
             a `mask-image` on `.proof__marquee`, and a mask applies to every
             descendant — a pause pill inside the strip would be faded out by the
             very gradient that implies continuation. So the strip keeps the mask
             and the clipping, and the button is its SIBLING inside a positioning
             context. `components/pricing/ContentMarquee.svelte` splits it the same
             way (`.marquee__window` + `.marquee__pause`) for the same reason. -->
        <div class="proof__ticker">
          <!-- Two tracks so the loop is seamless. The clone is `aria-hidden` and
               removed entirely under reduced motion, so assistive tech and
               reduced-motion users never meet duplicated quotes. -->
          <div class="proof__marquee" data-paused={paused ? 'true' : undefined}>
            <ul class="proof__track">
              {#each shown as t, i (t.id)}
                <li class="proof__item">
                  <figure class="proof__figure">
                    <blockquote class="proof__quote" {...itemAttrs('q', i)}>
                      {t.quote}
                    </blockquote>
                    <figcaption class="proof__cite">
                      <span class="proof__avatar" aria-hidden="true">
                        {initial(t.authorName)}
                      </span>
                      <span class="proof__id">
                        <span class="proof__author">{t.authorName}</span>
                        {#if t.authorContext}
                          <span class="proof__context">{t.authorContext}</span>
                        {/if}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              {/each}
            </ul>
            <ul class="proof__track proof__track--clone" aria-hidden="true">
              {#each shown as t (t.id)}
                <li class="proof__item">
                  <figure class="proof__figure">
                    <blockquote class="proof__quote">{t.quote}</blockquote>
                    <figcaption class="proof__cite">
                      <span class="proof__avatar">{initial(t.authorName)}</span>
                      <span class="proof__id">
                        <span class="proof__author">{t.authorName}</span>
                        {#if t.authorContext}
                          <span class="proof__context">{t.authorContext}</span>
                        {/if}
                      </span>
                    </figcaption>
                  </figure>
                </li>
              {/each}
            </ul>
          </div>
          <!-- THE PAUSE CONTROL (WCAG 2.2.2) — see `ticking` in the script for
               why it is a real button rather than a `tabindex` on the strip, and
               why it renders only while the ticker is actually running. -->
          {#if ticking}
            <button
              type="button"
              class="proof__pause"
              onclick={() => (paused = !paused)}
              aria-label={paused ? m.marquee_resume() : m.marquee_pause()}
            >
              {#if paused}
                <PlayIcon size={16} />
              {:else}
                <PauseIcon size={16} />
              {/if}
            </button>
          {/if}
        </div>
      {:else}
        <!-- `tabindex` ONLY on the two compositions the mobile container query
             turns into a scroller, and only with something to scroll to — see
             `scrollable` in the script. `undefined` removes the attribute, so the
             other four compositions and the single-quote case emit no tab stop. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <ul class="proof__grid" tabindex={scrollable ? 0 : undefined}>
          {#each shown as t, i (t.id)}
            <li class="proof__item jp-reveal" data-jp-step={step(i)}>
              <figure class="proof__figure">
                <blockquote class="proof__quote" {...itemAttrs('q', i)}>
                  {t.quote}
                </blockquote>
                <figcaption class="proof__cite">
                  <span class="proof__avatar" aria-hidden="true">
                    {initial(t.authorName)}
                  </span>
                  <span class="proof__id">
                    <span class="proof__author" {...itemAttrs('n', i)}>
                      {t.authorName}
                    </span>
                    {#if t.authorContext}
                      <span class="proof__context" {...itemAttrs('c', i)}>
                        {t.authorContext}
                      </span>
                    {/if}
                  </span>
                </figcaption>
              </figure>
            </li>
          {/each}
        </ul>
      {/if}

      {#if p.trustLabel}
        <p class="proof__trust jp-reveal" data-jp-step="5">
          <span class="proof__stack" aria-hidden="true">
            {#each Array.from({ length: dots }) as _, d (d)}
              <span class="proof__dot"></span>
            {/each}
          </span>
          <span class="proof__count" {...editAttrs('trust')}>
            {p.trustLabel}
          </span>
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════
     THE SECTION BOX — every value an axis read.

     `--jp-sec-pad-block` / `--jp-sec-pad-inline` / `--jp-sec-gap` are the shared
     role aliases declared once in `journey-design.css`. They contain `6cqw`, so
     they MUST be consumed on a DESCENDANT of `.jp-sec` — an element is not its
     own query container, and reading them on the wrapper silently resolves the
     `cqw` against the page instead of the section (pilot lesson 1). `.proof` is
     that descendant.
     ═══════════════════════════════════════════════════════════════════════ */
  .proof {
    position: relative;
    isolation: isolate;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--jp-sec-radius);
    box-shadow: var(--jp-edge-shadow);
    text-align: var(--jp-text-align);

    /* THE THIRD TYPE STEP, derived.

       The `type` axis has exactly two steps — `--jp-display` for a section's
       headline and `--jp-heading-size` for a subordinate heading — and a
       card-scale quote is neither. Rather than hardcode a size (which would put
       `type` out of reach of the thing this section is mostly made of), derive a
       third step from the second and bound it at both ends, so no axis value can
       push a quote below body size or above the sub-heading step.

       0.5 is solved backwards from Candlelit exactly as the pilot solved its
       `80svh`: at `type: monumental` this lands on the `--text-xl` the quote
       shipped before the axes existed (24px at a 1440 viewport). The four values
       then read 17 / 17 / 20 / 24px, so the axis genuinely reaches the quote. */
    /* Promoted to `--jp-body-size` in `journey-design.css` (A44,
       `Codex-8oznv`). The expression that used to live here IS that rung, so this
       is the same value from one source instead of two. */
    --proof-quote-size: var(--jp-body-size);

    /* The gap between the section's three blocks (header / quotes / trust line).
       It was a fixed `--space-12`, so `density` could not reach it. Expressed as a
       multiple of the shared `--jp-sec-gap` — which already carries the rhythm —
       and 1.6 is solved backwards from Candlelit so `density: airy` lands on the
       48px this section shipped before the axes existed. A `regular` page now
       gets 38px, which is the axis doing its job. */
    --proof-block-gap: calc(var(--jp-sec-gap) * 1.6);

    /* ── THE ROLE TABLE, so a look is a VALUE and not a paint rule ────────
       The per-look blocks at the foot of this file are keyed on axis values
       (`edge: offset`, `accent: none`, …). Written as paint rules, seven of the
       eight looks would re-declare the same six card declarations — which is the
       shape that produced the eight different spellings of
       `clamp(2rem, 6cqw, 4.4rem)` this tree is still cleaning up. Written as
       properties, a look states its VALUES and the paint stays in one place.

       EVERY DEFAULT HERE REPRODUCES THE BASE COMMIT EXACTLY, which is the whole
       point: Candlelit resolves NONE of the per-look selectors, so it resolves
       these defaults, and a default that merely looked reasonable would have
       silently restyled the one preset that already works. Line-for-line:
         --proof-card-pad     was `calc(var(--space-6) * var(--jp-rhythm))`
         --proof-card-radius  was `--radius-card`
         --proof-card-border  was `var(--jp-edge-width) solid var(--jp-edge-color)`
         --proof-card-shadow  was `var(--jp-edge-shadow)`
         --proof-card-bg      was this exact two-stop gradient
         --proof-quote-lead   was `calc(var(--space-8) * var(--jp-rhythm))`
         --proof-catch/mark   `block` is what an absolutely-positioned pseudo
                              already computes to, i.e. no change
         --proof-round        was `--radius-full` on avatar / dot / pause
         --proof-meta-*       `inherit` + `--text-sm` is what the byline computed
         --proof-count-*      `inherit` + `--text-sm` is the inherited trust line
         --proof-head-*       `0px` paints no rule at all

       `0px` and `inherit`, never a bare `0` or an empty value: these are
       substituted into `padding` and `border-block-end`, and a UNITLESS zero in
       a length slot invalidates the WHOLE declaration silently — the A63/A64
       class of failure `[data-jp-edge='none']`'s own comment was written about. */
    --proof-card-pad: calc(var(--space-6) * var(--jp-rhythm));
    --proof-card-radius: var(--radius-card);
    --proof-card-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --proof-card-shadow: var(--jp-edge-shadow);
    --proof-card-bg: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-surface-secondary) 90%, transparent),
      color-mix(in oklab, var(--color-surface) 70%, transparent)
    );
    --proof-quote-lead: calc(var(--space-8) * var(--jp-rhythm));
    --proof-catch-display: block;
    --proof-mark-display: block;
    --proof-round: var(--radius-full);
    --proof-meta-font: inherit;
    --proof-meta-size: var(--text-sm);
    --proof-count-font: inherit;
    --proof-count-size: var(--text-sm);
    --proof-head-rule: 0px;
    --proof-head-gap: 0px;
  }

  .proof__atmos {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
    background: radial-gradient(
      78% 55% at 50% 0%,
      color-mix(in oklab, var(--jp-accent-mark) 9%, transparent),
      transparent 62%
    );
  }

  .proof__inner {
    position: relative;
    z-index: 1;
    max-width: var(--jp-content-max);
    margin-inline: auto;
  }

  /* `--proof-head-rule` is `0px` by default, so no look but the two that ask for
     it draws anything here — see `long-read` and `syllabus` at the foot. The gap
     travels with the rule so the underline never sits tight against the type. */
  .proof__head {
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    margin-block-end: var(--proof-block-gap);
    padding-block-end: var(--proof-head-gap);
    border-block-end: var(--proof-head-rule) solid var(--color-border-subtle);
  }

  .proof__eyebrow {
    margin-block-end: var(--space-2);
  }

  .proof__heading {
    margin: 0;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE QUOTE LIST

     `auto-fit` + `minmax` rather than breakpointed column counts. The audit
     flagged the old `1fr` → `repeat(2,…)` → `repeat(3,…)` ladder as a baked-in
     column count; auto-fit makes the count fall out of the container's own
     width, which is what container-query scoping (A14) is for and removes two
     media queries outright. `min()` keeps a single card from overflowing a
     container narrower than the track floor.
     ═══════════════════════════════════════════════════════════════════════ */
  .proof__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: var(--jp-sec-gap);
    align-items: stretch;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* THE RING FOR THE KEYBOARD-SCROLLABLE CASE (see `scrollable` in the script).
     `edge: none` and `edge: soft` strip borders from this section; they must never
     strip a focus ring (contract R14), so this reads `--color-focus` directly
     rather than any edge token. `outline-offset` is negative because the row
     bleeds to the section edges at the width where it scrolls — a positive offset
     would draw the ring outside the section's own padding. */
  .proof__grid:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: calc(var(--space-0-5) * -1);
  }

  .proof__item {
    display: flex;
  }

  /* The card. Border and elevation come from the `edge` axis — that is what puts
     the brutalist (`offset`) and wellness (`soft`) families within reach of the
     thing this section is made of. Under `edge: none` (Candlelit) the card keeps
     its own plate: the surface gradient and the candle-catch hairline below are
     its identity, not the border.

     RADIUS IS A TOKEN, NOT AN AXIS, deliberately: `radius` was considered and
     CUT as an axis (research §2.7), and `--jp-sec-radius` describes the SECTION
     box, which is squared under `surface: bare`/`media`. A card is a component,
     so it reads the component token. */
  .proof__figure {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: calc(var(--space-4) * var(--jp-rhythm));
    margin: 0;
    padding: var(--proof-card-pad);
    border-radius: var(--proof-card-radius);
    border: var(--proof-card-border);
    box-shadow: var(--proof-card-shadow);
    background: var(--proof-card-bg);
    overflow: hidden;
    /* A CARD's copy stays left-aligned regardless of `align`, and this is
       deliberate rather than an oversight: `align` positions the section's own
       column, and a centred multi-line quote inside a 17rem card is markedly
       harder to read than a left-aligned one. The single-quote compositions
       (`spotlight`, `pull`) DO follow the axis, because there the quote IS the
       section's column — which is exactly what the canvas partial does
       (`.jp-proof--spotlight .jp-proof-card { text-align: center }`). */
    text-align: left;
    transition:
      transform var(--duration-normal) var(--ease-out),
      border-color var(--duration-normal) var(--ease-out),
      box-shadow var(--duration-normal) var(--ease-out);
  }

  /* Candle-catch hairline along the top edge — brightens on hover.
     CANDLELIT'S OWN TELL, and the highest-leverage measurement of this pass: it
     was drawn on ALL EIGHT looks, so the cinematic ember catch appeared once per
     card on the brutalist panel, the technical table and the luxury-minimal
     page alike. That is the arithmetic the brief describes from the other end —
     Candlelit's signatures counted 27-28 across the tree because they were
     never scoped to Candlelit. `--proof-catch-display` is `block` here (no
     change) and `none` in all seven sibling look blocks, so the catch now
     appears in exactly one look. No selector names Candlelit; it simply keeps
     the default. */
  .proof__figure::after {
    content: '';
    display: var(--proof-catch-display);
    position: absolute;
    inset: 0 0 auto 0;
    height: var(--border-width);
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent) 22%,
      color-mix(in oklab, var(--jp-accent-mark) 55%, transparent) 78%,
      transparent
    );
    opacity: 0.45;
    transition: opacity var(--duration-normal) var(--ease-out);
  }

  @media (hover: hover) {
    .proof__item:hover .proof__figure {
      transform: translateY(calc(var(--space-1) * -1));
      border-color: color-mix(
        in oklab,
        var(--jp-accent-edge) 34%,
        var(--jp-edge-color)
      );
    }
    .proof__item:hover .proof__figure::after {
      opacity: 1;
    }
  }

  .proof__quote {
    position: relative;
    z-index: 1;
    margin: 0;
    /* The lead exists to hold the ornamental mark below. The four looks that
       remove the mark set it to `0px` in the same block, so no look pays for a
       gap it draws nothing in. */
    padding-top: var(--proof-quote-lead);
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-normal));
    font-size: var(--proof-quote-size);
    line-height: var(--leading-snug);
    letter-spacing: var(--jp-display-tracking);
    color: var(--color-heading);
    text-wrap: pretty;
  }

  /* Oversized decorative quotation mark, behind the text. Purely ornamental (it
     is a duplicate of the opening quote character the blockquote already
     carries), so the 3:1 graphic floor does not apply to it — but it reads
     `--jp-accent-mark`, never `--jp-accent-fill`, so it does not vanish at
     `accent: text` / `accent: edge` (pilot lesson 4). */
  .proof__quote::before {
    content: '\201C';
    display: var(--proof-mark-display);
    position: absolute;
    top: calc(var(--space-2) * -1);
    left: calc(var(--space-2) * -1);
    z-index: -1;
    font-family: var(--font-heading);
    font-size: var(--text-5xl);
    line-height: var(--leading-none);
    color: color-mix(in oklab, var(--jp-accent-mark) 24%, transparent);
    pointer-events: none;
  }

  .proof__cite {
    margin-top: auto;
    padding-top: calc(var(--space-4) * var(--jp-rhythm));
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    text-align: left;
  }

  /* ── the avatar ────────────────────────────────────────────────────────
     ONE treatment, on the `accent` axis. This replaces three
     `nth-child(3n + …)` gradient recipes that the audit named as "a 3-column
     assumption encoded in a selector" — and which the auto-fit grid above makes
     meaningless anyway, since the column count is no longer three. They also
     read `--color-brand-*` directly, so the `accent` axis could not reach them.

     THE INK IS PINNED TO THE PLATE, NOT TO THE THEME. The letter used to be
     `--color-text-inverse`, which flips with the theme while the brand plate
     underneath does not — measured 3.82:1 on `studio-alpha` in dark against a
     4.5 floor. `--jp-accent-on-fill` is auto-contrasted against
     `--jp-accent-fill` by construction, so the pair holds at both poles. */
  .proof__avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-11);
    height: var(--space-11);
    border-radius: var(--proof-round);
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-normal));
    font-size: var(--text-lg);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
    box-shadow: inset 0 0 0 var(--border-width)
      color-mix(in oklab, var(--color-heading) 18%, transparent);
  }

  /* `accent: text` and `accent: edge` make `--jp-accent-fill` transparent, so
     there is no plate for `--jp-accent-on-fill` to sit on. Ring + ladder ink. */
  .proof[data-plated='no'] .proof__avatar {
    background: transparent;
    color: var(--color-heading);
    box-shadow: inset 0 0 0 var(--border-width-thick) var(--jp-accent-mark);
  }

  .proof__id {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    line-height: var(--leading-snug);
  }

  /* THE BYLINE RUNG, on the `type` axis and reachable by a look's own label
     vocabulary. It was a flat `--text-sm` in both elements while
     `--jp-heading-size` travelled `--text-xl` → `--text-4xl` across the four
     `type` values, so at `restrained` the byline sat within a few px of the
     heading and at `expressive` it had disappeared under it — the same defect
     the shared `--jp-eyebrow-size` seam was added to fix for the eyebrow. */
  .proof__author {
    font-family: var(--proof-meta-font);
    font-weight: var(--font-semibold);
    font-size: var(--proof-meta-size);
    color: var(--color-text);
  }

  .proof__context {
    font-family: var(--proof-meta-font);
    font-size: var(--proof-meta-size);
    color: var(--color-text-secondary);
  }

  /* ── the aggregate trust cue ──────────────────────────────────────────── */
  .proof__trust {
    display: flex;
    align-items: center;
    justify-content: var(--jp-align);
    gap: var(--space-3);
    flex-wrap: wrap;
    margin: var(--proof-block-gap) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .proof__stack {
    display: inline-flex;
  }

  /* THE SECTION'S ONE NUMERAL — "2,400 and counting" is what a creator types
     here. It had no rule of its own and simply inherited `--text-sm` from
     `.proof__trust`, which is why `full-send`'s "big numerals" and the two mono
     families' "mono numerals" had nowhere to land. Both defaults are the
     inherited values, so nothing moves until a look asks. */
  .proof__count {
    font-family: var(--proof-count-font);
    font-size: var(--proof-count-size);
  }

  /* `--jp-accent-mark`, never `--jp-accent-fill`: the latter is `transparent` on
     two of five accent values, which is exactly how the pilot's trust dot
     disappeared (pilot lesson 4). One treatment rather than three, for the same
     reason as the avatar. */
  .proof__dot {
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--proof-round);
    background: var(--jp-accent-mark);
    box-shadow:
      inset 0 0 0 var(--border-width)
        color-mix(in oklab, var(--color-heading) 18%, transparent),
      0 0 0 var(--border-width-thick) var(--color-background);
  }

  .proof__dot + .proof__dot {
    margin-left: calc(var(--space-2) * -1);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     COMPOSITIONS

     Ported from the since-deleted `render-edit/journey-sections/_proof.css` where an
     implementation already existed (contract A12): `stack` from
     `.jp-proof--stack` (:45-46) and `spotlight` from `.jp-proof--spotlight`
     (:47-52). `wall`, `marquee` and `pull` are new (research §3).

     Each composition sets ARRANGEMENT only. Everything that varies alignment,
     measure, surface, accent, type-scale or motion is an axis and is already
     handled above — which is why these blocks are short.
     ═══════════════════════════════════════════════════════════════════════ */

  /* `stack` — one column at the measure. */
  .proof[data-proof='stack'] .proof__grid {
    grid-template-columns: 1fr;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  /* `spotlight` — one quote at the display step. The canvas hid cards 2+ in CSS;
     rendering only the first is cheaper and stops the page serving quotes that
     nobody can read. */
  .proof[data-proof='spotlight'] .proof__grid {
    grid-template-columns: 1fr;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  .proof[data-proof='spotlight'] .proof__quote {
    font-size: var(--jp-display);
    line-height: var(--jp-display-leading);
  }

  /* Here the quote IS the section's column, so it follows `align` — matching the
     canvas partial's `.jp-proof--spotlight` (:49-52). */
  .proof[data-proof='spotlight'] .proof__figure,
  .proof[data-proof='pull'] .proof__figure {
    text-align: var(--jp-text-align);
  }

  .proof[data-proof='spotlight'] .proof__cite,
  .proof[data-proof='pull'] .proof__cite {
    justify-content: var(--jp-align);
  }

  /* At display scale the ornamental mark should scale with the quote rather than
     sit at a fixed step, so it is expressed in the quote's own `em`. */
  .proof[data-proof='spotlight'] .proof__quote::before,
  .proof[data-proof='pull'] .proof__quote::before {
    font-size: 1em;
  }

  /* `pull` — an editorial pull-quote inside the page measure, NO card. */
  .proof[data-proof='pull'] .proof__grid {
    grid-template-columns: 1fr;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  .proof[data-proof='pull'] .proof__figure {
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: none;
    overflow: visible;
    gap: calc(var(--space-5) * var(--jp-rhythm));
  }

  .proof[data-proof='pull'] .proof__figure::after {
    display: none;
  }

  .proof[data-proof='pull'] .proof__quote {
    padding-top: 0;
    font-size: var(--jp-display);
    line-height: var(--jp-display-leading);
    letter-spacing: var(--jp-display-tracking);
  }

  /* A rule instead of a plate is what makes it read as editorial rather than as
     an unstyled card. `--jp-accent-edge` is the axis's border role. */
  .proof[data-proof='pull'] .proof__cite {
    padding-top: calc(var(--space-4) * var(--jp-rhythm));
    border-top: var(--border-width) solid var(--jp-accent-edge);
  }

  @media (hover: hover) {
    .proof[data-proof='pull'] .proof__item:hover .proof__figure {
      transform: none;
    }
  }

  /* `wall` — a dense masonry of many short quotes. CSS columns rather than grid:
     a wall wants uneven quote lengths packed tightly, which is exactly what
     column flow does and what a grid row cannot. */
  .proof[data-proof='wall'] .proof__grid {
    display: block;
    columns: 17rem auto;
    column-gap: var(--jp-sec-gap);
  }

  .proof[data-proof='wall'] .proof__item {
    display: block;
    /* Stop a card being split across two columns mid-quote. */
    break-inside: avoid;
    margin-block-end: var(--jp-sec-gap);
  }

  .proof[data-proof='wall'] .proof__quote {
    padding-top: calc(var(--space-6) * var(--jp-rhythm));
  }

  /* `marquee` — a continuously scrolling ticker.

     THE STATIC LIST IS THE BASELINE AND THE TICKER IS THE ENHANCEMENT, which is
     the inverse of how a marquee is usually written and is the whole reason this
     block needs no duplicated reduced-motion override. A stopped ticker is not a
     static fallback: the track is one long row inside a clipped strip, so
     stopping it parks most of the quotes outside the box where nobody can reach
     them (measured — two of three, before this was inverted). Starting from the
     wrapped grid means every path that is not "animation is welcome" — no CSS,
     SSR, `prefers-reduced-motion: reduce`, and the creator choosing
     `motion: none` — lands on a layout that shows every quote.

     Three conditions must ALL hold for the ticker: the composition is `marquee`,
     the viewer has not asked for reduced motion, and the `motion` axis is not
     `none`. The axis is read in markup (`data-motion`) because a Svelte-scoped
     style block cannot reach the ancestor `data-jp-motion` attribute.

     NOTE none of the comments in this file spell a literal opening style tag,
     and that is deliberate. `vitePreprocess` locates the style block by scanning
     the raw file, so a SECOND spelling of that tag anywhere in prose — an HTML
     comment, a JSDoc, a CSS comment — makes it pair the wrong opener with the
     real closing tag and hand postcss a stylesheet that begins mid-sentence. The
     error then reads `[postcss] …:1:3 Unknown word <whatever>` and points at line
     1 of the extracted CSS, nowhere near the comment that caused it. Measured
     here twice. `HeroSection.svelte:18` currently carries ONE such spelling, so
     it compiles — it is one prose edit away from the same 20 minutes. */
  /* The positioning context for `.proof__pause`. Bare — the clipping, the flex
     row and the edge mask all stay on `.proof__marquee` inside the
     no-preference query, so nothing here can fade or clip the control. */
  .proof__ticker {
    position: relative;
  }

  .proof__marquee {
    display: block;
  }

  .proof__track {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jp-sec-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .proof__track--clone {
    display: none;
  }

  .proof[data-proof='marquee'] .proof__item {
    display: flex;
    flex: 1 1 17rem;
  }

  @media (prefers-reduced-motion: no-preference) {
    /* The clone track makes the loop seamless: two identical tracks translate by
       exactly their own width plus the gap, so the second arrives where the
       first began. The clone is `aria-hidden` so assistive tech reads each quote
       once. */
    .proof[data-motion='on'] .proof__marquee {
      display: flex;
      gap: var(--jp-sec-gap);
      overflow: hidden;
      /* Edge-to-edge inside the section, so it bleeds back over the inline
         padding the section box applied. */
      margin-inline: calc(var(--jp-sec-pad-inline) * -1);
      padding-inline: var(--jp-sec-pad-inline);
      mask-image: linear-gradient(
        to right,
        transparent,
        black var(--space-10),
        black calc(100% - var(--space-10)),
        transparent
      );
    }

    .proof[data-motion='on'] .proof__track {
      flex: none;
      flex-wrap: nowrap;
      /* Derived from the `motion` axis rather than picked: a ticker's speed is
         its motion character. 52 is solved backwards from Candlelit, whose
         `motion: drift` (`--duration-slowest`, 800ms) lands on ~42s for one
         cycle — slow enough to read a quote as it passes. `fade` gives 26s and
         `rise`/`stagger` 15.6s, so a brisker page gets a brisker ticker. */
      animation: proof-marquee calc(var(--jp-reveal-duration) * 52) linear
        infinite;
    }

    .proof[data-motion='on'] .proof__track--clone {
      display: flex;
    }

    /* SCOPED TO `marquee`, and the scoping is load-bearing. Without the
       `[data-proof='marquee']` half this fixed width applies to every
       composition, which pinned the grid's cards to 320px inside their 369px
       columns — measured, and invisible unless you look at the numbers. */
    .proof[data-proof='marquee'][data-motion='on'] .proof__item {
      flex: none;
      width: 20rem;
    }

    /* PAUSE (WCAG 2.2.2). Continuous motion lasting more than five seconds needs
       a mechanism to stop it, and the THIRD selector is the only one that is a
       mechanism for every input mode.

       CORRECTION TO THIS RULE'S OWN COMMENT. It used to read "a pointer or
       keyboard user landing anywhere in the strip is the cheapest honest one",
       and that was half false: `:focus-within` can never match, because nothing
       inside the strip is focusable (the quotes are
       `<figure>`/`<blockquote>`/`<figcaption>`; the clone track is
       `aria-hidden`). Coverage was pointer-only — no keyboard user and no touch
       user could stop it. `:hover` and `:focus-within` are KEPT because they are
       free and correct where they apply; `[data-paused]` is the mechanism that
       actually discharges 2.2.2, driven by `.proof__pause`. */
    .proof__marquee:hover .proof__track,
    .proof__marquee:focus-within .proof__track,
    .proof__marquee[data-paused='true'] .proof__track {
      animation-play-state: paused;
    }
  }

  /* THE PAUSE PILL, outside the reduced-motion query on purpose: the BUTTON is
     gated in markup on `ticking`, so if it is in the DOM at all it has an
     animation to stop, and its own appearance must not depend on a media query.

     Positioned against `.proof__ticker`, NOT against the strip: the edge fade is
     a `mask-image` on `.proof__marquee`, a mask applies to every descendant, and
     the pill sits within the 2.5rem fade zone at the trailing edge — inside the
     strip it would be faded to near-transparent by the gradient. So the wrapper
     owns the positioning context and the strip owns the mask. It also lands inside
     the section's padded column while the strip bleeds past it, which reads better
     than a pill hanging over the bleed. */
  .proof__pause {
    position: absolute;
    inset-block-start: var(--space-3);
    inset-inline-end: var(--space-3);
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    /* A2's 44px FLOOR, and this was BELOW it on every look including Candlelit.
       `--space-10` is `calc(var(--space-unit) * 10)` = 40px at a density of 1,
       and `--tap-target-min` is `max(2.75rem, var(--space-11))` = 44px. So the
       only control in this section was a 40px target — and at a sub-1 brand
       density scale it shrank further, while `--tap-target-min`'s `max()` floor
       does not. Measured against the token, not judged: 40 < 44.

       This is the one declaration in this pass that changes what Candlelit
       renders, and it is a WCAG floor rather than a look, so it is corrected
       rather than scoped. The pill grows by 4px; nothing else about it moves.
       Reported in `candlelitTouched`. */
    width: var(--tap-target-min);
    height: var(--tap-target-min);
    border: var(--border-width) var(--border-style) var(--color-border);
    /* `--proof-round` so `plain-facts` can square it and `syllabus` can take it
       to `--radius-sm`, while `open-air`'s "pill controls" keeps the default. */
    border-radius: var(--proof-round);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-shadow);
  }

  .proof__pause:hover {
    box-shadow: var(--shadow-md);
  }

  /* `edge: none` and `edge: soft` remove borders from this section; they must
     never remove a focus ring (contract R14). */
  .proof__pause:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* `IconBase` paints `fill: none; stroke: currentColor`, which renders the pause
     bars as two hairlines at 16px. Solid reads as a glyph — the same correction
     `ContentMarquee` makes. */
  .proof__pause :global(svg) {
    fill: currentColor;
    stroke: none;
  }

  @keyframes proof-marquee {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(calc(-100% - var(--jp-sec-gap)));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE EIGHT LOOKS

     Everything above this line is the SECTION: six compositions and nine axes
     read as magnitudes. Everything below is the design LANGUAGE — the
     selector-level facts a magnitude cannot carry, keyed on the axis values
     mirrored into markup on `.proof` (see `look` in the script).

     HOW EACH KEY WAS CHOSEN, because only 38 distinct axis values exist across
     the eight looks and TWENTY of them are shared. A bare rule on a shared value
     restyles every look listed against it, so each block below is keyed on a
     value that belongs to ONE look, or on a compound whose intersection is one
     look. Candlelit is uniquely identified by only four of its nine —
     `surface: media`, `edge: none`, `media: bleed`, `accent: glow` — and its
     other five (`type: monumental`, `align: center`, `density: airy`,
     `width: text`, `motion: drift`) are shared. NONE of those five is keyed on
     here, bare or compounded, and none of Candlelit's own four appears in any
     selector below. Candlelit therefore matches nothing here and resolves the
     role table's defaults, every one of which reproduces the base commit.

     `open-air` gets the most care of the seven: it shares FOUR axes with
     Candlelit (align, density, width, motion), so it is keyed only on
     `edge: soft`, which is its own and nobody else's.

     WHAT THIS PASS MEASURED FIRST. Before it, this file carried ZERO per-look
     selectors: all eight looks drew the same translucent gradient card, the same
     `--radius-card` corner, the same ornamental `--text-5xl` quotation mark and
     the same ember candle-catch hairline, differing only in the numbers the axes
     fed them. So seven of the eight documented tells were not merely weak — they
     were absent, and Candlelit's two ornaments were being drawn on all eight.
     ═══════════════════════════════════════════════════════════════════════ */

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
     Tell: THREE type sizes, ONE hairline, no accent colour, and more empty
     space than content.

     KEY: `accent: none` and `density: vast`, each of which is this look's alone.
     Candlelit is `accent: glow` and `density: airy`.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so every rule here but one
     REMOVES. Measured on the base, the section drew FIVE type sizes
     (`--jp-heading-size`, `--jp-body-size`, `--text-sm`, the avatar's
     `--text-lg`, the mark's `--text-5xl`) and SIX hairlines per three-quote
     render (a card border, a candle-catch line per card, an avatar ring, and
     three dot rings) — against a tell that names three and one. */
  .proof[data-accent='none'] {
    /* NO CARD. `surface: bare` paints no section plate, so a bordered,
       shadowed, gradient-filled box per quote was the loudest thing on an
       otherwise empty page. The quote becomes type on paper. */
    --proof-card-pad: 0px;
    --proof-card-radius: var(--radius-none);
    --proof-card-border: 0 none;
    --proof-card-shadow: none;
    --proof-card-bg: none;
    --proof-catch-display: none;
    /* THE FOURTH AND FIFTH TYPE SIZES GO. The ornament is `--text-5xl` — larger
       than the heading at three of the four `type` values — and the lead that
       held it goes with it, because a gap under nothing is not empty space, it
       is a mistake. */
    --proof-mark-display: none;
    --proof-quote-lead: 0px;
  }

  /* THREE TYPE SIZES, as arithmetic rather than as an adjective — the only form
     of this tell that can be checked. What remains after the two removals above
     and the avatar below is exactly `--jp-heading-size` (heading),
     `--jp-body-size` (quote) and `--text-sm` (eyebrow, byline, trust line).
     Three, counted.

     The avatar and the dot stack are both `aria-hidden` DECORATION, so removing
     them costs no meaning — and they are what carried this look's accent
     colour: `accent: none` resolves `--jp-accent-fill` to `--jp-ink-4` and
     `--jp-accent-mark` to `--jp-heading`, both real inks, so five overlapping
     `--space-7` plates and a 44px lettered disc were the most saturated marks
     on the page in the look whose tell is "no accent colour". */
  .proof[data-accent='none'] .proof__avatar,
  .proof[data-accent='none'] .proof__stack {
    display: none;
  }

  /* Weight comes with size, because "three sizes" is a hierarchy claim: a
     semibold byline at the same size as a normal eyebrow is a fourth level by
     another means. Name and context stay distinguishable on VALUE
     (`--color-text` against `--color-text-secondary`), which is the family's own
     way of separating them. */
  .proof[data-accent='none'] .proof__author {
    font-weight: var(--font-normal);
  }

  /* THE ONE HAIRLINE. A pseudo-element, so there is no markup change and nothing
     enters the inline-edit seam's `textContent`. `--space-16` rather than the
     measure: a short rule reads as a mark, a full-measure rule reads as an
     underlined heading. `margin-inline: var(--jp-measure-margin)` is `auto` at
     this look's `align: center`, so it centres under the head and would sit hard
     left if a creator ever moved the axis. */
  .proof[data-accent='none'] .proof__head::after {
    content: '';
    display: block;
    width: var(--space-16);
    height: var(--border-width);
    margin-block-start: var(--jp-sec-gap);
    margin-inline: var(--jp-measure-margin);
    background: var(--color-border);
  }

  /* MORE EMPTY SPACE THAN CONTENT, on a doubling scale rather than three picked
     numbers: 2.5 · 1.5 of the section gap, which at `vast` is already 1.6× the
     regular rhythm and still multiplies the org's own `--brand-density-scale`
     through `--space-unit`. */
  .proof[data-density='vast'] {
    --proof-block-gap: calc(var(--jp-sec-gap) * 2.5);
  }

  .proof[data-density='vast'] .proof__grid {
    gap: calc(var(--jp-sec-gap) * 1.5);
  }

  /* "Slow fade only. No transform." `motion: fade` already zeroes
     `--jp-reveal-distance`, so the reveal is a pure opacity ramp — and the one
     transform this section sets outside the reveal is the card's hover lift, so
     it goes too. Keyed on `accent: none` and not on the motion value, because
     `data-motion` on this root is the ticker gate rather than the axis (see
     `look` in the script). */
  @media (hover: hover) {
    .proof[data-accent='none'] .proof__item:hover .proof__figure {
      transform: none;
    }
  }

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `accent: text` ──────
     Tell: the eyebrow and the body share a LEFT EDGE, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY — `long-read` has no axis value of its own.
     `surface: bare` is shared with `quiet-studio` and `accent: text` with
     `open-air`, but `quiet-studio` is `accent: none` and `open-air` is
     `surface: tint`, so the PAIR is `long-read` alone. Candlelit is
     `surface: media` and `accent: glow`, so it matches neither half.

     MEASURED ON THE BASE: the shared left edge was BROKEN, and by this file's
     own card. `align: start` sets `--jp-measure-margin: 0px` and the eyebrow and
     heading do sit on it — but the quote is inside a figure with
     `calc(var(--space-6) * var(--jp-rhythm))` of padding, so the body text
     started 24px inboard of the label above it, and the ornamental mark hung a
     further `--space-2` outside on the other side of the edge. The head hairline
     was found nowhere. "Hairline horizontal rules only. No box borders
     anywhere." */
  .proof[data-surface='bare'][data-accent='text'] {
    --proof-card-pad: 0px;
    --proof-card-radius: var(--radius-none);
    --proof-card-border: 0 none;
    --proof-card-shadow: none;
    --proof-card-bg: none;
    --proof-catch-display: none;
    --proof-mark-display: none;
    --proof-quote-lead: 0px;
    --proof-head-rule: var(--border-width);
    --proof-head-gap: calc(var(--jp-sec-gap) / 3);
  }

  /* A RULE INSTEAD OF A PLATE is what makes a quote read as editorial rather
     than as an unstyled card — the argument `.proof[data-proof='pull']` already
     makes for the pull-quote composition, generalised to the LOOK, because the
     byline rule is the family's shape and not one arrangement's.
     `--color-border-subtle` rather than `--jp-accent-edge`: a horizontal rule
     under every byline is structure, and this family spends its accent on TEXT
     ("accent: text"), never on furniture. */
  .proof[data-surface='bare'][data-accent='text'] .proof__cite {
    padding-top: calc(var(--jp-sec-gap) / 2);
    border-top: var(--border-width) solid var(--color-border-subtle);
  }

  /* No plate, so nothing to lift. */
  @media (hover: hover) {
    .proof[data-surface='bare'][data-accent='text']
      .proof__item:hover
      .proof__figure {
      transform: none;
    }
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ────────────────────────
     Tell: NO BORDER ANYWHERE, pill controls, and a shadow you have to look for.

     KEYED ONLY ON `edge: soft`, and the discipline is the point. This look
     shares FOUR axes with Candlelit — `align: center`, `density: airy`,
     `width: text`, `motion: drift` — and a bare rule on any of them would
     restyle the one preset that already works. `edge: soft` is open-air's and
     nobody else's; Candlelit is `edge: none`.

     MEASURED ON THE BASE: the diffuse shadow is genuinely already here —
     `--jp-edge-shadow` is `--shadow-lg` at this value (a 14px-blur, 4%-alpha
     drop, i.e. "large, very diffuse, very low opacity") and the card reads it.
     "NO BORDER ANYWHERE" was not. `--jp-edge-width` is `0px` here so the card's
     own border already paints nothing, but FOUR borders were spelled locally
     where the `edge` axis cannot reach them at any value: the candle-catch
     hairline, the avatar's inset ring, each dot's inset ring, and the pause
     pill's `--color-border`. */
  .proof[data-edge='soft'] {
    /* The family's own panel radius, and the largest this token set defines —
       there is no `--radius-2xl`/`--radius-3xl` to reach for. */
    --proof-card-radius: var(--radius-xl);
    /* An opaque plate rather than the 90%/70% translucent gradient: a shadow you
       have to look for cannot be seen at all under a card you can see through. */
    --proof-card-bg: var(--color-surface);
    --proof-catch-display: none;
  }

  .proof[data-edge='soft'] .proof__avatar {
    box-shadow: none;
  }

  /* The dot keeps only the `--color-background` spacer ring, which is a GAP
     between overlapping plates rather than a border on either of them. */
  .proof[data-edge='soft'] .proof__dot {
    box-shadow: 0 0 0 var(--border-width-thick) var(--color-background);
  }

  /* `border-color: transparent`, not `border: 0` — the pill keeps its box so the
     control's geometry and its 44px target do not shift between looks. */
  .proof[data-edge='soft'] .proof__pause {
    border-color: transparent;
  }

  .proof[data-edge='soft'] .proof__cite {
    border-top: 0;
  }

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     RADIUS 0 EVERYWHERE.

     KEY: `edge: offset`, which is this look's alone. Candlelit is `edge: none`.

     MEASURED ON THE BASE: the first half of the tell already lands and is worth
     saying so — `--jp-edge-width` is `--border-width-thick` and
     `--jp-edge-shadow` is `var(--space-1) var(--space-1) 0 0 var(--jp-line-strong)`
     at this value, and the card reads both, so the 2px border and the hard
     un-blurred drop are real. "Radius 0 everywhere" was true NOWHERE: the
     section shell was `--radius-card` (its `surface: panel` value), the card was
     `--radius-card`, and the avatar, the dots and the pause pill were all
     `--radius-full`. Mono labels were found nowhere in the section. */
  .proof[data-edge='offset'] {
    /* RADIUS 0, ABSOLUTELY — the tell's own adverb. The SHELL has to be squared
       off too, not just its furniture: `--jp-sec-radius` is `--radius-card`
       under `surface: panel`, which is this look's surface. */
    border-radius: var(--radius-none);
    --proof-card-radius: var(--radius-none);
    --proof-round: var(--radius-none);
    /* A flat panel, not a gradient. The family paints "flat fills, no
       gradients"; and a hard un-blurred drop under a translucent card reads as
       a printing error rather than as a plate. */
    --proof-card-bg: var(--color-surface);
    /* Brutalism has no ornament. Both of these are places where the correct edit
       is a removal, and the lead they occupied goes with them. */
    --proof-catch-display: none;
    --proof-mark-display: none;
    --proof-quote-lead: 0px;
    /* MONO LABELS. `--text-xs` with the byline in mono is the family's
       "utilitarian monospace metadata" rung. */
    --proof-meta-font: var(--font-mono);
    --proof-meta-size: var(--text-xs);
    --proof-count-font: var(--font-mono);
    /* The eyebrow's tracking through the shared seam
       (`journey-sections-shared.css` declares it as
       `var(--jp-eyebrow-tracking, var(--tracking-wider))` precisely so a section
       can widen it and keep the rest of the recipe). */
    --jp-eyebrow-tracking: var(--tracking-widest);
  }

  /* TABULAR NUMERALS so a count does not shuffle its digits between renders. */
  .proof[data-edge='offset'] .proof__count {
    font-variant-numeric: tabular-nums;
  }

  /* `motion: none` is this look's motion value, and a 200ms colour fade on a
     brutalist panel is a fast animation rather than the instant state change the
     family's motion row asks for. `--duration-normal` is not an axis token, so
     `motion: none` could not reach this transition; the look switches it off. */
  .proof[data-edge='offset'] .proof__figure {
    transition: none;
  }

  /* THE ACCENT SPENT AS THE FAMILY SPENDS IT: "solid rectangles of it, text
     reversed out". COMPOUNDED with `accent: fill` rather than left on
     `edge: offset` alone, because `--jp-accent-fill` is `transparent` at
     `accent: text` and `accent: edge` — a creator who picked either with this
     edge would get `--jp-accent-on-fill` ink on the section's own background,
     which is the auto-contrasted pair broken in half. `plain-facts` IS
     `accent: fill`, so the look itself always matches.

     `display: inline-block` because `.proof__eyebrow` is a `<p>`: a block would
     stretch the slab across the whole column instead of shrink-wrapping the
     label. */
  .proof[data-edge='offset'][data-accent='fill'] .proof__eyebrow {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* THE CARD PRESSES INTO ITS OWN OFFSET SHADOW. The translate is exactly the
     shadow's own offset and the shadow goes, so the plate lands where its drop
     was — the family's one honest interaction. It replaces the shared hover
     lift, which is why `transform: none` is spelled: a `translate` and a
     `transform` are separate properties and both would otherwise apply. */
  @media (hover: hover) {
    .proof[data-edge='offset'] .proof__item:hover .proof__figure {
      transform: none;
      translate: var(--space-1) var(--space-1);
      box-shadow: none;
    }
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a HAIRLINE GRID, mono numerals, and a LEFT-BORDER ACCENT STRIPE
     rather than a filled badge.

     KEY: `accent: edge` and `type: restrained`, each of which is this look's
     alone. Candlelit is `accent: glow` and `type: monumental`.

     MEASURED ON THE BASE: the stripe was found nowhere, and the thing the tell
     names IN OPPOSITION to it was the section's most prominent mark — a 44px
     lettered plate per quote. At this accent value `--jp-accent-fill` is
     `transparent`, so `[data-plated='no']` already turned that plate into a
     RING; a ring is still a badge, and the tell asks for neither. Mono numerals
     were found nowhere. */
  .proof[data-accent='edge'] {
    /* A RULED TABLE, not a deck of cards: no plate, no corner, no elevation. */
    --proof-card-radius: var(--radius-none);
    --proof-card-border: 0 none;
    --proof-card-shadow: none;
    --proof-card-bg: none;
    --proof-card-pad: calc(var(--space-4) * var(--jp-rhythm));
    --proof-catch-display: none;
    --proof-mark-display: none;
    --proof-quote-lead: 0px;
    /* "Corner radius `--radius-sm`" and "hairline on everything" are the
       family's own two values; the dots and the pause pill take the first. */
    --proof-round: var(--radius-sm);
    --proof-count-font: var(--font-mono);
    /* The hairline under the section head, so the block reads as a table with a
       header row. */
    --proof-head-rule: var(--border-width);
    --proof-head-gap: calc(var(--jp-sec-gap) / 3);
    --jp-eyebrow-tracking: var(--tracking-widest);
  }

  /* `row-gap`, NOT `gap`. The rows must close up so consecutive hairlines read
     as one ruled list, but the column gap has to survive: at
     `@container (max-width: 48rem)` the `grid` and `wall` compositions become a
     horizontal snap-row whose spacing IS that gap, and a blanket `gap: 0` would
     silently butt every quote against the next on every phone. */
  .proof[data-accent='edge'] .proof__grid {
    row-gap: 0;
  }

  /* THE LEFT-BORDER ACCENT STRIPE. The tell states it in opposition to "a filled
     badge", so it is a stripe on every row and there is no badge.

     `--jp-accent-mark`, NOT `--jp-accent-edge`, and the measurement is already
     recorded in this tree: `--jp-accent-edge` fails the 3:1 graphic floor at
     every accent value on a dark brand and measures 2.04:1 at THIS one, while
     `--jp-accent-mark` measures 5.00 dark / 10.47 light. A stripe that carries
     the tell has to be seen. Read directly, with no mix carried onto it (A37). */
  .proof[data-accent='edge'] .proof__figure {
    border-block-end: var(--border-width) solid var(--color-border-subtle);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  .proof[data-accent='edge'] .proof__avatar {
    display: none;
  }

  .proof[data-accent='edge'] .proof__count {
    font-variant-numeric: tabular-nums;
  }

  /* `motion: none` — a hairline table does not lift under the pointer. */
  @media (hover: hover) {
    .proof[data-accent='edge'] .proof__item:hover .proof__figure {
      transform: none;
    }
  }

  /* `type: restrained` is `syllabus`'s type value and nobody else's, so the
     dense-dashboard reading rhythm lands here: the byline a full step under the
     body — "many small steps, fine-grained hierarchy". `monumental` is
     deliberately ABSENT from this file: it is Candlelit's own type value, shared
     with `quiet-studio` and `plain-facts`, and both of those take their byline
     rung from a value that is theirs alone. A bare `type: monumental` rule is
     the precise shape that would have restyled the one preset that works. */
  .proof[data-type='restrained'] {
    --proof-meta-size: var(--text-xs);
  }

  /* `type: expressive` is `open-air` + `full-send`, and neither is Candlelit.
     The byline moves WITH the heading rather than sitting at a flat `--text-sm`
     while `--jp-heading-size` climbs to `--text-3xl` above it. */
  .proof[data-type='expressive'] {
    --proof-meta-size: var(--text-base);
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` ───────────────────────────
     Tell: WHOLE INVERTED BANDS, pill CTAs at `--radius-full`, spring easing, and
     BIG NUMERALS.

     KEY: `edge: heavy`, which is this look's alone (as are `surface: invert` and
     `motion: stagger` — one key is used throughout rather than three spellings
     of the same look). Candlelit is `edge: none`.

     MEASURED ON THE BASE: "whole inverted bands" was BROKEN BY THIS FILE.
     `surface: invert` re-points the ink ladder, and `--color-surface` /
     `--color-surface-secondary` resolve through it to `--jp-ink-2` / `--jp-ink-3`
     — so the card's gradient painted a lighter panel per quote ON TOP of the
     inverted band, cutting the band into three. Big numerals were found nowhere:
     the trust count had no rule of its own and inherited `--text-sm`, making the
     section's one number its quietest element. */
  .proof[data-edge='heavy'] {
    /* THE BAND STAYS WHOLE. `edge: heavy` gives 2px in `--jp-accent-edge`, so
       the quote is carried by an accent outline on the band itself rather than
       by a plate that interrupts it. */
    --proof-card-bg: none;
    --proof-card-radius: var(--radius-xl);
    --proof-catch-display: none;
    /* BIG NUMERALS — the heading rung, in the heading face. */
    --proof-count-font: var(--font-heading);
    --proof-count-size: var(--jp-heading-size);
  }

  .proof[data-edge='heavy'] .proof__count {
    font-weight: var(--heading-weight, var(--font-semibold));
    line-height: var(--leading-none);
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
  }

  /* SPRING EASING, MADE VISIBLE — and read off the motion axis rather than
     spelled. `--jp-reveal-ease` is `--ease-spring` at this look's
     `motion: stagger`, and the reveal already rides it, but the one place a
     viewer can FEEL a curve is the thing they are pointing at. */
  .proof[data-edge='heavy'] .proof__figure {
    transition-timing-function: var(--jp-reveal-ease);
  }

  /* The lift OVERSHOOTS on that curve. It only ever GROWS the card — a hover
     that shrank the box would take a scroll-snap child under its own measured
     84% at the mobile width, and the reduced-motion block at the foot undoes
     both halves. */
  @media (hover: hover) {
    .proof[data-edge='heavy'] .proof__item:hover .proof__figure {
      transform: translateY(calc(var(--space-2) * -1)) scale(1.015);
    }
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small neutral shadow; ONE FILLED
     ACCENT element per section.

     ANOTHER COMPOUND BY NECESSITY: `signal` shares all nine of its axis values.
     `edge: hairline` is also `quiet-studio`, `long-read` and `syllabus`, and
     `accent: fill` is also `plain-facts` and `full-send` — but those two are
     `edge: offset` and `edge: heavy`, and the three other hairline looks are
     `accent: none` / `text` / `edge`. So the PAIR is `signal` alone, and
     Candlelit (`edge: none`, `accent: glow`) matches neither half. This is the
     same key `GuideSection.svelte` uses for this look, deliberately — one
     spelling of `signal` across the tree rather than two.

     MEASURED ON THE BASE: the geometry half of this tell is already right and
     that is worth saying rather than re-asserting — `--radius-card`,
     `var(--border-width) solid var(--jp-line)` and `--shadow-xs` (a 1px,
     10%-alpha drop, i.e. the "small NEUTRAL shadow" the tell names) all resolve
     here from the axes. This look is the platform default and the base was
     written for it. What was wrong was the CARD SURFACE and the ACCENT COUNT: a
     90%/70% translucent gradient over a panel that is itself a tinted ink reads
     as muddy rather than crisp, and the section drew ONE filled accent per QUOTE
     plus five accent dots — so "one filled accent per section" was off by
     however many testimonials a creator had typed. */
  .proof[data-edge='hairline'][data-accent='fill'] {
    /* Opaque, so the hairline and the 1px drop define the card instead of a
       see-through wash over `--jp-ink-2`. */
    --proof-card-bg: var(--color-surface);
    --proof-catch-display: none;
  }

  /* THE AVATAR DEMOTES TO A PRODUCT-CARD AVATAR — a neutral plate with the ring
     it already had. Both tokens are ladder rungs, so the letter stays
     auto-contrasted at both poles; this is not a hand-picked pair. */
  .proof[data-edge='hairline'][data-accent='fill'] .proof__avatar {
    background: var(--color-surface-secondary);
    color: var(--color-heading);
  }

  .proof[data-edge='hairline'][data-accent='fill'] .proof__dot {
    background: var(--color-surface-secondary);
  }

  /* …AND THE ONE FILLED ACCENT LANDS ONCE, on the trust line, which is the
     single per-section element in this component (the quotes are a list; the
     trust line is not). `--jp-accent-fill` with `--jp-accent-on-fill` is the
     auto-contrasted pair by construction, so the label holds at both poles and
     at every brand.

     NOT A BUTTON, and the difference is stated rather than fudged: this section
     has no call to action, so the tell's literal "filled accent BUTTON" has
     nothing to attach to here — `render/CtaLink.svelte` is the only styler of
     `.cta` in the whole section tree and a section that painted the pay button's
     colours would break the one place that contrast is guaranteed
     (`journey-design.test.ts`, `Codex-kdsuo`). This is the filled accent MARK,
     once per section, which is the half of the tell this section can carry. */
  .proof[data-edge='hairline'][data-accent='fill'] .proof__count {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--jp-accent-fill);
    color: var(--jp-accent-on-fill);
  }

  /* ── mobile: swipeable snap-row that bleeds to the section edges ──
     A CONTAINER query, not a viewport media query (contract A14): the builder
     canvas renders this section inside a device frame narrower than the window,
     where a viewport query reads the wrong number. `.jp-sec` is the container. */
  @container (max-width: 48rem) {
    .proof[data-proof='grid'] .proof__grid,
    .proof[data-proof='wall'] .proof__grid {
      display: flex;
      columns: auto;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      scroll-padding-inline: var(--jp-sec-pad-inline);
      margin-inline: calc(var(--jp-sec-pad-inline) * -1);
      padding-inline: var(--jp-sec-pad-inline);
      padding-bottom: var(--space-2);
      scrollbar-width: none;
    }

    .proof[data-proof='grid'] .proof__grid::-webkit-scrollbar,
    .proof[data-proof='wall'] .proof__grid::-webkit-scrollbar {
      display: none;
    }

    .proof[data-proof='grid'] .proof__item,
    .proof[data-proof='wall'] .proof__item {
      display: flex;
      flex: 0 0 84%;
      margin-block-end: 0;
      scroll-snap-align: center;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     REDUCED MOTION

     `journey-sections-shared.css` already kills every `animation` inside
     `.jp-sec` and `journey-design.css` neutralises `--jp-reveal-distance`. What
     is left is this section's own obligation: a STOPPED marquee is not a static
     fallback, because the track is a single overflowing row whose later quotes
     are parked outside the clipped strip. So the strip stops clipping, the track
     wraps into a normal grid, and the clone leaves the flow entirely — nobody
     reads the same quote twice and nothing is unreachable.
     ═══════════════════════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .proof__figure,
    .proof__figure::after {
      transition: none;
    }

    .proof__item:hover .proof__figure {
      transform: none;
    }

    /* THE TWO PER-LOOK HOVER STATES THE DESIGN-LANGUAGE PASS ADDED. Both are
       transforms OUTSIDE a keyframe, which is the one thing
       `journey-sections-shared.css`'s `animation: none !important` guard cannot
       reach — and both out-specify the `.proof__item:hover .proof__figure` rule
       above (0,3,0 against 0,2,0), so neither is covered by it.

       `plain-facts` needs BOTH properties named: it moves on `translate`, which
       is a separate property from `transform` and would survive a
       `transform: none` on its own. Listed explicitly rather than as a wildcard,
       so the next look that adds a hover transform has to come here and say so.

       The three looks that hover-lift NOTHING (`quiet-studio`, `long-read`,
       `syllabus`) need no entry: their own rules already resolve to
       `transform: none` at every motion preference, which is what `motion: fade`
       and `motion: none` mean. */
    .proof[data-edge='heavy'] .proof__item:hover .proof__figure {
      transform: none;
    }

    .proof[data-edge='offset'] .proof__item:hover .proof__figure {
      transform: none;
      translate: none;
    }

    /* NOTHING TO UNDO FOR THE MARQUEE. The static wrapped list is the baseline
       and the ticker only exists inside
       `@media (prefers-reduced-motion: no-preference)`, so this query never sees
       an animation to stop, a clone to hide or a transform to neutralise. That
       is deliberate: an override-based fallback has to remember every property
       the ticker set, and the one it forgot was the flex constraint that let the
       track wrap at all. */
  }
</style>
