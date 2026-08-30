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
        <!-- Two tracks so the loop is seamless. The clone is `aria-hidden` and
             removed entirely under reduced motion, so assistive tech and
             reduced-motion users never meet duplicated quotes. -->
        <div class="proof__marquee">
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
      {:else}
        <ul class="proof__grid">
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

  .proof__head {
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
    margin-block-end: var(--proof-block-gap);
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
    padding: calc(var(--space-6) * var(--jp-rhythm));
    border-radius: var(--radius-card);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-surface-secondary) 90%, transparent),
      color-mix(in oklab, var(--color-surface) 70%, transparent)
    );
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

  /* Candle-catch hairline along the top edge — brightens on hover. */
  .proof__figure::after {
    content: '';
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
    padding-top: calc(var(--space-8) * var(--jp-rhythm));
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
    border-radius: var(--radius-full);
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

  .proof__author {
    font-weight: var(--font-semibold);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .proof__context {
    font-size: var(--text-sm);
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

  /* `--jp-accent-mark`, never `--jp-accent-fill`: the latter is `transparent` on
     two of five accent values, which is exactly how the pilot's trust dot
     disappeared (pilot lesson 4). One treatment rather than three, for the same
     reason as the avatar. */
  .proof__dot {
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--radius-full);
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

    /* PAUSE ON HOVER AND FOCUS (WCAG 2.2.2): continuous motion lasting more than
       five seconds needs a mechanism to stop it, and a pointer or keyboard user
       landing anywhere in the strip is the cheapest honest one. */
    .proof__marquee:hover .proof__track,
    .proof__marquee:focus-within .proof__track {
      animation-play-state: paused;
    }
  }

  @keyframes proof-marquee {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(calc(-100% - var(--jp-sec-gap)));
    }
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

    /* NOTHING TO UNDO FOR THE MARQUEE. The static wrapped list is the baseline
       and the ticker only exists inside
       `@media (prefers-reduced-motion: no-preference)`, so this query never sees
       an animation to stop, a clone to hide or a transform to neutralise. That
       is deliberate: an override-based fallback has to remember every property
       the ticker set, and the one it forgot was the flex constraint that let the
       track wrap at all. */
  }
</style>
