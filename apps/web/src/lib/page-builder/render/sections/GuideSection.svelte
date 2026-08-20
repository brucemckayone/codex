<!--
  @component GuideSection

  The maker's bio (SPEC §4.1 `guide`) — "made by someone who had to find the
  ground first". Portrait / guide-clip plate, role, heading, name, bio, an
  optional pull-quote climax, a credential list and a letter signature.

  ── THE AXES THIS SECTION CONSUMES: ALL NINE ────────────────────────────────
  `width` `density` `surface` `edge` `align` `type` `accent` `motion` `media`.
  Every layout / rhythm / type-scale / edge / surface / motion / media decision
  reads a `--jp-*` property that `render/SectionRenderer.svelte` resolves onto the
  `.jp-sec` wrapper as a `data-jp-*` attribute. COLOUR STAYS `--color-*`
  (contract A11); the one exception is the `--jp-accent-*` family.

  `media` APPLIES here, unlike `map`/`turn`/`ache`/`feel`/`faq`/`invite`. The
  citation is `components/page-builder/design-vocabulary.ts:320`
  (`MEDIA_AWARE_SECTION_TYPES = ['hero', 'introVideo', 'reel', 'guide',
  'proof']`), which `design-vocabulary.test.ts:156` asserts is exactly the set the
  design panel offers the control on — a better citation than research §2.2 alone
  because it is the thing that fails if someone later disagrees. The section has
  three real media references (`guidePortraitUrl`, `guideClip`, `signatureUrl`,
  all on `SellPreview`), so `--jp-media-*` has something to shape and no consumer
  had to be invented (contract A50).

  Note a hidden control is not a lost value: a stored `media` override on a type
  the panel hides it for still resolves and still emits its attribute. This header
  claims only which axes this component READS.

  ── FIVE COMPOSITIONS ───────────────────────────────────────────────────────
  `portrait` (default) · `column` · `quote` · `credentials` · `letter`.

  `column` absorbs the retired `centered` variant (it was `align` + `width` on top
  of "no media" — see `LEGACY_SECTION_VARIANTS.guide` in `section-catalog.ts`),
  and `portrait` / `quote` are ported from the canvas partial
  `render-edit/journey-sections/_guide.css` (contract A12). `credentials` and
  `letter` are new.

  COMPOSITIONS CARRY ARRANGEMENT, NEVER TYPE SCALE. The section `<h2>` is
  `--jp-heading-size` via `.jp-sec__heading--sub`, never `--jp-display`
  (contract A36 / A55 — the base commit shipped `--text-3xl` here, not
  `--text-display`, so this is A36's ordinary case and not `invite`'s exception).
  The bio is `--jp-body-size`, the rung contract A44 promoted for exactly this
  ("guide bios are exactly this scale"); it is read, never re-derived.

  ── TWO RENDERINGS, PROGRESSIVELY ENHANCED ──────────────────────────────────
  • BASELINE (SSR, no-JS, reduced-motion): the fully-composed section — plate,
    copy, quote, facts and signature all visible. This is what the server emits,
    so the section is never blank and never depends on JS. Renders nothing only
    when neither a bio nor a name/heading is set.
  • ENHANCED (browser + motion OK): the shared `reveal` action arms the hidden
    state from JS and the blocks arrive on the `motion` axis's timing; the ember
    breathes inside the plate under `surface: media`.

  The static composition is the baseline and the motion is layered on top of it,
  never the other way round (contract A40): the hidden states apply ONLY under
  `.reveal--armed`, which the action adds from JS and withholds entirely under
  `prefers-reduced-motion`.
-->
<script lang="ts">
  import { PlayIcon } from '$lib/components/ui/Icon';
  import { IntroVideoModal } from '$lib/components/ui/IntroVideoModal';
  import {
    aliasKeys,
    asObjectArray,
    asParagraphsFrom,
    asString,
    asStringArray,
    asStringFrom,
    fieldString,
  } from '../coerce';
  import { reveal } from '../reveal';
  import { safeHref } from '../safe-href';
  import type { GuideSectionProps, JourneySalesContext } from '../types';
  import type { ResolvedSectionDesign, SectionProps } from '$lib/page-builder';
  import type { HTMLAttributes } from 'svelte/elements';

  /** One row of the `credentials` composition's hairline-ruled fact list. */
  interface GuideFact {
    label?: string;
    detail?: string;
  }

  /**
   * `clip`, `duration` and `facts` are the `OWED_READS.guide` entries
   * (contract A28) — the builder has written them since F-C and nothing read
   * them, so the `credentials` composition had no content and the plate had no
   * caption. Declared HERE rather than on `GuideSectionProps` in
   * `render/types.ts`, which is shared across the component worktrees and is a
   * closed file this round: `IntroVideoSectionProps` needs the same two keys in
   * the sibling worktree, so both edits would land on the same lines.
   * Consolidation should absorb them. Reported in the WT-6 report.
   *
   * Wiring them turns `section-fields.test.ts`'s "every OWED_READS entry is still
   * genuinely unread" assertion red on the `guide: ['clip', 'duration', 'facts']`
   * line, which is that test working as designed (A28).
   */
  interface GuideCopy extends GuideSectionProps {
    clip?: string;
    duration?: string;
    facts?: GuideFact[];
  }

  interface Props {
    config: SectionProps;
    /** The render context — this section reads the STREAMED `sellPreview`. */
    context: JourneySalesContext;
    variant?: string;
    /**
     * Present for the uniform contract and NOT destructured: all nine axes this
     * section consumes land in CSS, because none of them changes what is
     * RENDERED.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, context, variant, editable = false, onEdit }: Props =
    $props();

  /**
   * The builder authors this section as flat `{role, heading, body, quote, clip,
   * duration, facts}` (`section-fields.ts:346`), which maps onto the renderer's
   * `{eyebrow, heading, bio, …}` through the shared alias table. The preference
   * lists come from `aliasKeys`, never from inline literals: a hand-copied list
   * drifts INVISIBLY, because it degrades to a fallback rather than failing.
   *
   * `Codex-tqr51`: before this, `GuideSection` had zero `asStringFrom` and zero
   * `aliasKeys` calls while `coerce.ts:218` already declared
   * `guide: { eyebrow: ['eyebrow', 'role'], bio: ['bio', 'body'] }` — so the
   * bridge existed and this component was the one type that did not consume it.
   * A page storing the builder's `role`/`body` rendered neither.
   *
   * `bio` HAS TO ACCEPT THREE SHAPES, and the order matters. The renderer's own
   * `GuideSectionProps.bio` is declared `string[]`; the builder's `body` control
   * is a TEXTAREA, so it writes one string. So:
   *
   *   1. `asStringArray(config, 'bio')` — the renderer's declared array shape,
   *      first, because the renderer's own key wins its own preference list;
   *   2. `asParagraphsFrom(config, ['bio', 'body'])` — a STRING under either key,
   *      split on newlines into paragraphs.
   *
   * Reading only (2) would have silently dropped the declared array form
   * entirely: `asParagraphsFrom` delegates to `asStringFrom`, which accepts a
   * string and nothing else, so an array-valued `bio` fell straight through to
   * `body`. No page stores one today (there are no `guide` sections at all), which
   * is exactly why it needed a test rather than an inspection.
   */
  const p: GuideCopy = $derived({
    eyebrow: asStringFrom(config, aliasKeys('guide', 'eyebrow')),
    heading: asString(config, 'heading'),
    name: asString(config, 'name'),
    bio:
      asStringArray(config, 'bio') ??
      asParagraphsFrom(config, aliasKeys('guide', 'bio')),
    portraitUrl: asString(config, 'portraitUrl'),
    credentials: asStringArray(config, 'credentials'),
    quote: asString(config, 'quote'),
    clip: asString(config, 'clip'),
    duration: asString(config, 'duration'),
    facts: asObjectArray(config, 'facts', (entry) => {
      const label = fieldString(entry, 'label');
      const detail = fieldString(entry, 'detail');
      return label || detail ? { label, detail } : null;
    }),
  });

  /**
   * `facts` AS THE EDITOR ACTUALLY WRITES IT — a bare STRING.
   *
   * MEASURED, not hypothetical. The `guide` section on `studio-alpha`/`bone-deep`
   * (landing page `4664e6ce…`, added through the real builder UI) stores
   * `"facts": "20 years teaching — somatics and grief work"` on a section whose
   * `variant` is `credentials` — the one composition whose entire purpose is that
   * list.
   *
   * The cause is contract A29: `facts` is declared `control: 'repeater'`, the
   * generic array control is deferred to consolidation, and
   * `SectionEditor.svelte` writes `target.value` — a raw string — for every
   * control except `media`. So `asObjectArray` sees a non-array, returns
   * `undefined`, and a credential the creator actually typed renders as NOTHING.
   * This is the same defect A29 describes for `previewDuration` ("a `text`
   * control writes `"480"` and the section silently falls back to its default"),
   * now with real content already in the database.
   *
   * Degrading it to a single label-only row is a READ-BOUNDARY guard, which is
   * what `coerce.ts` is for — not a second authoring path (A30: there is only
   * ever one writer, and it is the one that produced this string) and not a
   * reshaped field (A29 forbids that, and the field stays a `repeater`). When the
   * real repeater control lands, the array branch above takes over and this one
   * stops matching. Nothing is lost either way.
   */
  const factsFallback: GuideFact[] | undefined = $derived.by(() => {
    if (p.facts) return undefined;
    const raw = config.facts;
    if (typeof raw === 'string' && raw.trim() !== '') {
      return [{ label: raw.trim() }];
    }
    return asStringArray(config, 'facts')?.map((label) => ({ label }));
  });

  /**
   * The fact list, from the authorable `facts` repeater or — failing that —
   * synthesised from the legacy `credentials` string array this component has
   * always read.
   *
   * NOT the A30 trap. A30 forbids adding a repeater bound to a key the renderer
   * PREFERS over an existing authored vocabulary, because the empty repeater then
   * wins and silently destroys content. Here the preference runs the other way
   * and, decisively, `credentials` was never authorable: it appears in no
   * `SECTION_FIELDS.guide` entry, so no creator can have stored it, and there are
   * zero `guide` sections in the database at all. Both halves of A30's precondition
   * are absent. The fallback is kept so the declared `GuideSectionProps.credentials`
   * is not orphaned, not because anything can reach it.
   */
  const facts: GuideFact[] | undefined = $derived(
    p.facts ?? factsFallback ?? p.credentials?.map((label) => ({ label }))
  );

  const COMPOSITIONS = [
    'portrait',
    'column',
    'quote',
    'credentials',
    'letter',
  ];
  const composition = $derived(
    COMPOSITIONS.includes(variant) ? variant : 'portrait'
  );

  /**
   * Which compositions draw the media plate. `column` and `quote` are the
   * no-media arrangements (`.jp-guide--centered .jp-guide__player {display:none}`
   * at `_guide.css:39` is where `column` comes from), and `letter` is explicitly
   * "signature, no portrait frame" per its catalogue hint.
   *
   * `media: none` hides the plate on top of this, through `--jp-media-display` —
   * so the axis can take the plate away from a composition that offers one,
   * without the composition being able to conjure one that does not.
   */
  const showsPlate = $derived(
    composition === 'portrait' || composition === 'credentials'
  );

  /**
   * A single-glyph mark for the plate when no portrait resolves — the guide's
   * initial, evoking a portrait placeholder rather than a void.
   */
  const mark = $derived(
    (p.name ?? p.heading ?? '').trim().charAt(0).toUpperCase() || '·'
  );

  let clipOpen = $state(false);

  /**
   * The plate's duration caption. The AUTHORED `duration` string wins over the
   * clip's real `durationSeconds`, consistent with every other prop's
   * `authored ?? derived` precedence (contract A42, which inverted `proof` for
   * exactly this reason).
   */
  function formatDuration(seconds: number | null | undefined): string | null {
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    ) {
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
   * The alias lists are ordered preference lists, so an edit that always wrote
   * the canonical key would corrupt a page storing the alias. This section is the
   * sharpest case in the tree — BOTH its bridged props are aliased
   * (`eyebrow`→`role`, `bio`→`body`) and `role`/`body` are what the builder
   * writes, so the alias is the COMMON case rather than the edge one. A page
   * storing `role` would end up holding `eyebrow` too, `role` would keep losing
   * the preference list, and the creator's edit would render as nothing while the
   * data silently grew a second copy.
   *
   * The fallback is the key `section-fields.ts` writes, which is what a section
   * holding neither should acquire.
   */
  const readKey = (keys: readonly string[], fallback: string): string => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim() !== '') return key;
      // An ARRAY counts as present, and this half is load-bearing rather than
      // defensive. `bio` is declared `string[]`, so a page storing the array form
      // has its value under `bio` — but the array is not a string, so a
      // string-only check would fall through to the `body` fallback. The edit
      // would then write `body` while the array under `bio` kept winning the
      // preference list: the page would hold BOTH and the creator's edit would
      // render as nothing. That is precisely the A60 failure, reached through a
      // shape rather than through an alias.
      if (Array.isArray(value) && value.length > 0) return key;
    }
    return fallback;
  };

  /**
   * The inline-edit seam for the studio canvas, as a spreadable attribute bag.
   * Empty when `editable` is false, so PUBLIC markup is byte-identical to having
   * no seam at all.
   *
   * DELIBERATELY NOT `render-edit/EditableText.svelte` (pilot lesson 9): it
   * renders an EMPTY element and fills `textContent` from a Svelte action, and
   * actions do not run during SSR — so the public page would serve `<h2></h2>`
   * and paint the text in only after hydration. The canvas never noticed because
   * the studio is `ssr = false`.
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

<!--
  THE MEDIA PLATE. Renders the creator's portrait once the STREAMED sell-preview
  resolves, the guide clip's poster when there is a clip but no portrait, and a
  decorative brand-lit panel before and instead of either.

  The panel doubles as the pending state deliberately: it occupies exactly the
  same box as the image, so a slow media resolution costs no layout shift and
  needs no separate skeleton.

  `guidePortraitUrl` and `guideClip` were WRITE-ONLY codebase-wide until contract
  A15 — the builder's pickers persisted `courses.guide.portraitMediaId` and
  `courses.guideVideoMediaId`, no public read projected them, and this component
  read a `portraitUrl` PROP that no builder field could ever fill. So the
  published guide could only ever render its monogram. `portraitUrl` is still read
  FIRST (a page that somehow holds one keeps working), with the projection behind
  it.
-->
{#snippet plate()}
  <div class="guide__plate jp-reveal" data-jp-step="1">
    {#await context.sellPreview}
      {@render plateAtmosphere()}
    {:then preview}
      {@const portrait = p.portraitUrl ?? preview?.guidePortraitUrl}
      {@const clip = preview?.guideClip}
      {@const poster = portrait ?? clip?.posterUrl}
      {#if poster}
        <img
          class="guide__img"
          src={safeHref(poster)}
          alt={p.name ? `Portrait of ${p.name}` : ''}
          loading="lazy"
          decoding="async"
        />
        <span class="guide__scrim" aria-hidden="true"></span>
        {@render plateAtmosphere()}
      {:else}
        {@render plateAtmosphere()}
        <span class="guide__center" aria-hidden="true">
          <span class="guide__mark">{mark}</span>
        </span>
      {/if}

      <!--
        The plate's captions. `clip` is declared as an "On-frame label" and
        `duration` as "Duration" (`section-fields.ts:379-384`) — frame furniture
        rather than player controls.

        THE DURATION IS GATED ON A REAL CLIP, and the label is not. A caption over
        a portrait is meaningful on its own; a RUNTIME over a portrait is a
        falsehood — it advertises a video the page does not have. That is not
        hypothetical: `section-catalog.ts:606` seeds `duration: '2:00'` into every
        new `guide` section, and the seeded section on `studio-alpha`/`bone-deep`
        carries it today with no `guideVideoMediaId` set. Wiring this OWED_READS
        key is what would make that placeholder VISIBLE, so it is gated at the
        point of the read (see the `Codex-maf0y` note in the WP report).
      -->
      {#if p.clip}
        <span class="guide__tag" aria-hidden="true">{p.clip}</span>
      {/if}
      {#if clip}
        {@const durationLabel =
          p.duration ?? formatDuration(clip.durationSeconds)}
        {#if durationLabel}
          <span class="guide__dur" aria-hidden="true">{durationLabel}</span>
        {/if}
      {/if}

      <!--
        A REAL playback affordance, only when a real clip resolved. The guide
        section had no video affordance at all before this (`render/types.ts:70`
        names it WT-6's work), and shipping a play button that plays nothing is
        the exact mistake `SectionFieldDef.mediaSlot`'s own JSDoc exists to
        prevent — so the button is inside the `{#if clip}`.

        `IntroVideoModal` portals its overlay out to `.org-layout`: `.jp-sec`
        carries `container-type: inline-size`, which makes it a containing block
        for `position: fixed` descendants, so an overlay rendered in place would
        be trapped inside the section.
      -->
      {#if clip}
        <span class="guide__center">
          <button
            type="button"
            class="guide__play"
            onclick={() => (clipOpen = true)}
            aria-label={p.name
              ? `Play the clip from ${p.name}`
              : 'Play the guide clip'}
          >
            <span class="guide__play-icon" aria-hidden="true">
              <PlayIcon />
            </span>
          </button>
        </span>
        <IntroVideoModal
          open={clipOpen}
          src={clip.playlistUrl}
          title={p.name ?? p.heading}
          onclose={() => (clipOpen = false)}
        />
      {/if}
    {:catch}
      {@render plateAtmosphere()}
    {/await}
  </div>
{/snippet}

<!--
  ONE atmosphere wrapper, gated by ONE `--jp-sec-atmos` declaration (pilot
  lesson 3). The ember's opacity is ANIMATED, and a keyframe beats a `calc()` on
  the same element — so the gate goes on the parent, where the two compose
  multiplicatively: the ember keeps breathing under `surface: media` and the whole
  group resolves to zero opacity everywhere else.
-->
{#snippet plateAtmosphere()}
  <span class="guide__atmos" aria-hidden="true">
    <span class="guide__ember"></span>
    <span class="guide__grain"></span>
    <span class="guide__vignette"></span>
    <span class="guide__sheen"></span>
  </span>
{/snippet}

{#snippet eyebrowNode()}
  {#if p.eyebrow}
    <p
      class="jp-sec__eyebrow guide__eyebrow jp-reveal"
      {...editAttrs(readKey(aliasKeys('guide', 'eyebrow'), 'role'))}
    >
      {p.eyebrow}
    </p>
  {/if}
{/snippet}

{#snippet headingNode(step: string)}
  {#if p.heading}
    <h2
      class="jp-sec__heading jp-sec__heading--sub guide__heading jp-reveal"
      data-jp-step={step}
      {...editAttrs('heading')}
    >
      {p.heading}
    </h2>
  {/if}
{/snippet}

{#snippet nameNode()}
  {#if p.name}
    <p class="guide__name jp-reveal" data-jp-step="2" {...editAttrs('name')}>
      {p.name}
    </p>
  {/if}
{/snippet}

{#snippet bioNode()}
  {#if p.bio}
    <div
      class="guide__bio jp-sec__measure jp-reveal"
      data-jp-step="3"
      {...editAttrs(readKey(aliasKeys('guide', 'bio'), 'body'))}
    >
      {#each p.bio as paragraph, i (i)}
        <p>{paragraph}</p>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet quoteNode(step: string)}
  {#if p.quote}
    <blockquote class="guide__quote jp-reveal" data-jp-step={step}>
      <p {...editAttrs('quote')}>{p.quote}</p>
    </blockquote>
  {/if}
{/snippet}

<!--
  THE FACT LIST. A `<dl>`, because each row is genuinely a term and its
  description ("Practising", "since 2009") — and it degrades to a label-only row
  when a creator fills one side, which is the shape the legacy `credentials`
  string array synthesises.

  UNAUTHORABLE FROM THE BUILDER TODAY, and deliberately left that way: `facts` is
  a `repeater`, and contract A29 defers the one generic array control to
  consolidation because `SectionEditor.svelte` writes `target.value` — a raw
  STRING — for every control except `media`. Building a bespoke control here is
  what A29 exists to prevent. The list is markup-complete and degrades to nothing.
-->
{#snippet factList()}
  {#if facts}
    <dl class="guide__facts jp-reveal" data-jp-step="4">
      {#each facts as fact, i (i)}
        <div class="guide__fact">
          {#if fact.label}<dt>{fact.label}</dt>{/if}
          {#if fact.detail}<dd>{fact.detail}</dd>{/if}
        </div>
      {/each}
    </dl>
  {/if}
{/snippet}

<!--
  THE SIGNATURE. `signatureUrl` is a still projected from
  `courses.signatureMediaId` (contract A27, migration 0086), and the image is
  DECORATIVE (`alt=""`): the guide's name renders as text directly beneath it, so
  describing the mark would be a duplicate announcement. When no signature is
  picked the image self-hides and the typeset name carries the sign-off alone.
-->
{#snippet signatureNode()}
  <div class="guide__sign jp-reveal" data-jp-step="4">
    {#await context.sellPreview then preview}
      {#if preview?.signatureUrl}
        <img
          class="guide__sig"
          src={safeHref(preview.signatureUrl)}
          alt=""
          loading="lazy"
          decoding="async"
        />
      {/if}
    {/await}
    {#if p.name}
      <p class="guide__signoff" {...editAttrs('name')}>{p.name}</p>
    {/if}
  </div>
{/snippet}

{#if p.bio || p.name || p.heading}
  <div class="guide guide--{composition}">
    <div class="guide__inner" use:reveal>
      {#if showsPlate}
        {@render plate()}
      {/if}

      <div class="guide__body">
        {#if composition === 'quote'}
          <!-- The pull-quote LEADS: it is this composition's display moment, and
               the heading demotes beneath it. Arrangement, not type scale — both
               sizes still come from the `type` axis. -->
          {@render quoteNode('1')}
          {@render eyebrowNode()}
          {@render headingNode('2')}
          {@render nameNode()}
          {@render bioNode()}
          {@render factList()}
        {:else if composition === 'letter'}
          {@render eyebrowNode()}
          {@render headingNode('1')}
          {@render bioNode()}
          {@render quoteNode('3')}
          {@render factList()}
          {@render signatureNode()}
        {:else}
          {@render eyebrowNode()}
          {@render headingNode('1')}
          {@render nameNode()}
          {@render bioNode()}
          {@render quoteNode('4')}
          {@render factList()}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── THE SECTION SHELL ────────────────────────────────────────────────────
     `--jp-sec-pad-block` / `--jp-sec-pad-inline` / `--jp-sec-gap` are the shared
     spacing aliases from `journey-design.css`, read rather than re-spelled
     (pilot lesson 1) — the eight slightly different `clamp(2rem, 6cqw, 4.4rem)`
     literals in this tree are what happens otherwise.

     They contain `6cqw` and are DECLARED on `.jp-sec`, so they must be consumed
     on a DESCENDANT: an element is not its own query container, so reading them
     on the wrapper itself would silently give page-relative padding. `.guide` is
     that descendant — `SectionRenderer` wraps every section in `.jp-sec`. */
  .guide {
    position: relative;
    padding-block: var(--jp-sec-pad-block);
    padding-inline: var(--jp-sec-pad-inline);
    background: var(--jp-sec-bg);
    border-radius: var(--jp-sec-radius);

    /* ── LOCAL RUNGS, declared once ───────────────────────────────────────
       Two derived scales this section needs and the `type` axis does not name.
       Declared here rather than re-spelled at seven call sites, which is the
       same argument the shared spacing aliases make.

       `--guide-meta` is the small-metadata rung (a name, a fact row): the
       `--jp-body-size` rung contract A44 promoted, one step denser, floored at
       `--text-base` so it can never drop under the body-copy floor. At
       `balanced` the floor wins and it measures exactly the `--text-base` the
       base commit shipped for `.guide__name`.

       `--guide-quote` is the pull-quote rung, which sits ABOVE body and BELOW
       the heading — a place the two-rung `type` axis has no name for.
       `calc(var(--jp-heading-size) / 1.2)` is the shape `TurnSection:593`
       already uses for a sub-heading step, and the 1.2 approximates the base
       commit's own heading:quote ratio (`--text-3xl`:`--text-2xl` = 40:30 at
       1440). Floored at `--text-lg` so `type: restrained` keeps it emphatic.

       NEVER derived from a re-spelled `clamp()` (A44) and never a raw px. */
    --guide-meta: max(var(--text-base), calc(var(--jp-body-size) / 1.2));
    --guide-quote: max(var(--text-lg), calc(var(--jp-heading-size) / 1.2));
  }

  /* `--jp-content-max` caps the section's inner wrapper; `--jp-measure` caps the
     running bio inside it, via the shared `.jp-sec__measure` atom. Two
     properties because they diverge: a `wide` guide is a broad two-column grid
     holding a 78ch bio. */
  .guide__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--jp-sec-gap);
    max-width: var(--jp-content-max);
    margin-inline: auto;
    justify-items: var(--jp-align);
    text-align: var(--jp-text-align);
  }

  /* THE TWO-COLUMN ARRANGEMENT, ported from `_guide.css:25`'s
     `minmax(0, 0.82fr) minmax(0, 1.18fr)`. A CONTAINER query, not a viewport
     media query (contract A14): `.jp-sec` is the container, and the builder
     canvas renders these sections inside a device frame narrower than the
     window, where a viewport query reads the wrong number. The base commit's
     `@media (--breakpoint-md)` was exactly that bug.

     The `620px` is a raw length by necessity, not by omission: custom properties
     are not substituted inside a `@container` / `@media` CONDITION, so a
     `--breakpoint-*` token cannot appear here. The value is the one
     `_guide.css:53` already used for this type's single-column fold. */
  @container (min-width: 620px) {
    .guide--portrait .guide__inner,
    .guide--credentials .guide__inner {
      grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
      align-items: center;
    }
  }

  .guide__body {
    display: flex;
    flex-direction: column;
    gap: calc(var(--jp-sec-gap) / 2);
    align-items: var(--jp-align);
    min-width: 0;
  }

  /* ── THE MEDIA PLATE ──────────────────────────────────────────────────────
     Every geometric decision here is the `media` axis: `bleed` letterboxes it to
     21:9 with a scrim, `frame` gives 16:9 and a radius, `mask` an arched 4:5,
     `inset` a 3:2 with a letterbox pad, and `none` removes it.

     `aspect-ratio` with a definite width is the safe direction (pilot lesson 7's
     blowout was a definite CROSS size fighting the ratio), so the plate takes
     `width: 100%` from its grid column and lets the ratio derive the height.

     `--jp-media-radius` and `--jp-media-mask` do the same job at different
     fidelities, so the mask is applied on top of the radius rather than instead
     of it — at every value but `mask` it resolves to `none` and costs nothing. */
  .guide__plate {
    display: var(--jp-media-display);
    position: relative;
    isolation: isolate;
    width: 100%;
    aspect-ratio: var(--jp-media-aspect);
    padding: var(--jp-media-inset);
    border-radius: var(--jp-media-radius);
    clip-path: var(--jp-media-mask);
    overflow: hidden;
    background:
      radial-gradient(
        46% 58% at 50% 66%,
        color-mix(in oklab, var(--color-brand-primary) 46%, transparent),
        transparent 68%
      ),
      radial-gradient(
        90% 72% at 30% 24%,
        color-mix(
          in oklab,
          var(--color-brand-accent, var(--color-brand-primary)) 22%,
          transparent
        ),
        transparent 66%
      ),
      var(--color-surface);

    /* THE AXIS EDGE, AND NOTHING COMPOSED INTO IT (contract A54).
       `--jp-edge-shadow` is the KEYWORD `none` at `edge: none` (Candlelit, so
       the entire installed base) and at `edge: heavy`, and `box-shadow`'s
       grammar is `none | <shadow>#` — `none` cannot be one item of a comma
       list. Written as `box-shadow: <my ring>, var(--jp-edge-shadow)` the whole
       declaration is invalid at computed-value time and silently falls back to
       the initial `none`; three rings painted nothing on every published page
       before this was caught. The plate's own emphasis therefore lives on
       `outline` (below), never here.

       The border is a plain `var()` substitution, which IS safe — a bare `0` is
       a valid `<line-width>`. Only MATH on the token breaks it, because
       `--jp-edge-width` is a UNITLESS zero at `none`/`soft` and
       `max(<number>, <length>)` is a type error that invalidates the whole
       shorthand. No component math touches that token. */
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
  }

  /* The plate's own brand emphasis, on `outline` with a negative offset so it
     sits INSIDE the box and leaves `box-shadow` to the `edge` axis alone
     (A54's prescribed shape). `--jp-accent-mark` rather than
     `--jp-accent-edge`: the latter fails the 3:1 graphic floor at EVERY accent
     value on a dark brand (measured 1.27 at `glow`, 1.49 / 2.04 / 2.04 at
     `text` / `fill` / `edge`), and `glow` is Candlelit. No hardcoded percentage
     is carried onto it either (A37) — at `glow` it is already a 45% mix, so a
     26% mix of it would be ~12% ember. */
  .guide--credentials .guide__plate {
    outline: var(--border-width) solid var(--jp-accent-mark);
    outline-offset: calc(-1 * var(--border-width));
  }

  .guide__img {
    position: absolute;
    inset: var(--jp-media-inset);
    z-index: 0;
    display: block;
    width: calc(100% - 2 * var(--jp-media-inset));
    height: calc(100% - 2 * var(--jp-media-inset));
    object-fit: cover;
    border-radius: inherit;
  }

  /* The `media` axis's scrim. `bleed` is the ONLY value that ships one, and its
     21:9 aspect and 62% stop are tuned together — changing either requires
     re-measuring the contrast of anything sitting on it (journey-design.css). */
  .guide__scrim {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: var(--jp-media-scrim);
  }

  /* ── ATMOSPHERE ───────────────────────────────────────────────────────────
     ONE gate for the whole group, on the parent (pilot lesson 3). `surface:
     media` is the only value that lights it; everywhere else `--jp-sec-atmos`
     is 0 and the plate is a quiet panel. The ember's keyframe animates its own
     opacity, which is why the gate cannot live on the ember itself. */
  .guide__atmos {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    opacity: var(--jp-sec-atmos);
  }

  .guide__atmos > span {
    position: absolute;
    pointer-events: none;
  }

  /* A soft, tall ember rising from lower-centre — a lit presence, never a void.
     `--jp-accent-glow` is the axis's bloom and resolves to `none` at four of
     five accent values, so it is the WHOLE value of its own `box-shadow`
     (A54 again) rather than one item of a list. */
  .guide__ember {
    left: 50%;
    bottom: 14%;
    width: 58%;
    aspect-ratio: 3 / 4;
    translate: -50% 0;
    filter: blur(var(--blur-xl));
    border-radius: var(--radius-full);
    box-shadow: var(--jp-accent-glow);
    background: radial-gradient(
      50% 50% at 50% 55%,
      color-mix(in oklab, var(--jp-accent-mark) 72%, transparent),
      color-mix(in oklab, var(--jp-accent-mark) 30%, transparent) 55%,
      transparent 72%
    );
    animation: guide-breathe calc(var(--jp-reveal-duration) * 9)
      var(--ease-in-out) infinite;
  }

  @keyframes guide-breathe {
    0%,
    100% {
      opacity: 0.55;
      transform: scale(1);
    }
    50% {
      opacity: 0.9;
      transform: translateY(-2%) scale(1.06);
    }
  }

  /* Fine grain for texture. Inline SVG data URI is CSP-safe (no external
     asset) — this is a CSS background, not the inline `<svg>` element the
     design system forbids. */
  .guide__grain {
    inset: 0;
    opacity: 0.14;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='gn'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23gn)'/%3E%3C/svg%3E");
  }

  /* Inner vignette — darkens the edges so the warm centre reads as depth.
     `--color-background` rather than the base commit's `#000`: a hardcoded black
     inside a `color-mix` is the class of raw value that breaks on a light-brand
     org (contract A18), and `of-blood-and-bones` light is a cream `#F6EFE6`. */
  .guide__vignette {
    inset: 0;
    background: radial-gradient(
      78% 78% at 50% 52%,
      transparent 42%,
      color-mix(in oklab, var(--color-background) 62%, transparent) 100%
    );
  }

  /* Top catch-light sheen. */
  .guide__sheen {
    inset: 0;
    background: linear-gradient(
      180deg,
      color-mix(in oklab, var(--color-heading) 10%, transparent),
      transparent 22%
    );
  }

  /* THE CENTRING LAYER, and why it is a separate element rather than
     `place-items` on the plate. The plate's `display` is the `media` axis's
     (`display: var(--jp-media-display)`, which is `block` at four of five values
     and `none` at the fifth), so it cannot also be a grid — `place-items` on a
     block box does nothing at all. An absolutely-positioned grid layer honours
     the axis's `--jp-media-inset` and centres regardless of what `display`
     resolves to. */
  .guide__center {
    position: absolute;
    inset: var(--jp-media-inset);
    z-index: 3;
    display: grid;
    place-items: center;
  }

  .guide__mark {
    font-family: var(--font-heading);
    font-size: var(--jp-display);
    line-height: var(--jp-display-leading);
    font-weight: var(--font-normal);
    color: color-mix(in oklab, var(--color-heading) 78%, transparent);
  }

  /* ── PLATE FURNITURE ──────────────────────────────────────────────────────
     The on-frame label and duration, ported from `_guide.css:28-30`'s
     `.jp-guide__watch` / `.jp-guide__dur`. Raw `0.62rem` / `0.7rem` / `1rem`
     literals become tokens and the `--guide-meta` rung, so the `type` and
     `density` axes reach them. */
  .guide__tag,
  .guide__dur {
    position: absolute;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-8));
    font-size: max(var(--text-xs), calc(var(--guide-meta) / 1.3));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: color-mix(in oklab, var(--color-background) 62%, transparent);
    border: var(--border-width) solid
      color-mix(in oklab, var(--color-heading) 16%, transparent);
    backdrop-filter: blur(var(--blur-sm));
  }

  .guide__tag {
    top: var(--space-4);
    inset-inline-start: var(--space-4);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .guide__tag::before {
    content: '';
    flex: none;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--jp-accent-mark);
  }

  .guide__dur {
    inset-inline-end: var(--space-4);
    bottom: var(--space-4);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* The play button — a REAL control, so it carries a real tap target and a real
     focus ring. `--tap-target-min` is `max(2.75rem, var(--space-11))`, i.e. 44px,
     and the clamp's lower bound is floored on it so `density: compact` cannot
     take the pointer target under the WCAG 2.5.5 floor (contract A61 measures
     the BORDER box, which is what a pointer hits). */
  .guide__play {
    display: grid;
    place-items: center;
    width: clamp(var(--tap-target-min), 11cqw, var(--space-20));
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
    transition: transform var(--jp-reveal-duration) var(--jp-reveal-ease);
  }

  /* `edge: none` and `edge: soft` remove borders; they must NEVER remove the
     focus ring (rule R14). This is an `outline`, and the `edge` axis only ever
     touches `border` and `box-shadow`, so it cannot reach it. */
  .guide__play:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-1);
  }

  .guide__play:hover {
    transform: scale(1.06);
  }

  .guide__play-icon {
    display: grid;
    place-items: center;
    width: 45%;
    height: 45%;
  }

  /* ── COPY ────────────────────────────────────────────────────────────────
     `.jp-sec__eyebrow` and `.jp-sec__heading--sub` are the shared atoms, so the
     `type` axis owns the heading's size, leading AND tracking (contract A59 —
     porting to the atom moves all three, and a Candlelit check that only diffs
     `font-size` reports a false match). The base commit's local
     `letter-spacing: -0.015em` and `--leading-tight` are therefore replaced by
     `--jp-display-tracking` / `--jp-display-leading`, deliberately. */
  .guide__eyebrow {
    color: var(--jp-accent-text);
  }

  .guide__heading {
    max-width: 22ch;
    margin-inline: var(--jp-measure-margin);
  }

  .guide__name {
    margin: 0;
    font-size: var(--guide-meta);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  /* THE BIO — `--jp-body-size` exactly, the rung A44 promoted to
     `journey-design.css` for this scale ("guide bios are exactly this scale").
     Read, never re-derived from `--jp-heading-size` and never a re-spelled
     clamp. Measures 17 / 17 / 20 / 24px across the four `type` values. */
  .guide__bio {
    display: flex;
    flex-direction: column;
    gap: calc(var(--jp-sec-gap) / 3);
  }

  .guide__bio p {
    margin: 0;
    font-size: var(--jp-body-size);
    line-height: var(--leading-relaxed);
    color: var(--color-text);
  }

  /* ── THE PULL QUOTE ──────────────────────────────────────────────────────
     The rule and the opening glyph are BRAND MARKS THAT MUST BE SEEN, so both
     read `--jp-accent-mark` (5.00 dark / 10.47 light) rather than
     `--jp-accent-edge`, which fails the 3:1 graphic floor at every accent value
     on a dark brand. The base commit's `55%` / `34%` / `40%` mixes of
     `--color-brand-accent` are dropped rather than carried across (A37): the
     axis token IS the strength the axis chose. */
  .guide__quote {
    position: relative;
    margin: 0;
    padding-inline-start: var(--space-5);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
    max-width: var(--jp-measure);
  }

  .guide__quote::before {
    content: '\201C';
    position: absolute;
    inset-inline-start: var(--space-3);
    top: -0.35em;
    font-family: var(--font-heading);
    font-size: calc(var(--guide-quote) * 1.6);
    line-height: 1;
    color: var(--jp-accent-mark);
    pointer-events: none;
  }

  .guide__quote p {
    margin: 0;
    font-family: var(--font-heading);
    font-style: italic;
    font-weight: var(--font-normal);
    font-size: var(--guide-quote);
    line-height: var(--leading-snug);
    letter-spacing: var(--jp-display-tracking);
    color: var(--color-heading);
  }

  /* ── THE FACT LIST ───────────────────────────────────────────────────────
     A chip row by default; the `credentials` composition turns it into the
     hairline-ruled list its catalogue hint names. */
  .guide__facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
  }

  .guide__fact {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: var(--border-width) solid var(--color-border-subtle);
    font-size: max(var(--text-xs), calc(var(--guide-meta) / 1.2));
  }

  .guide__fact dt {
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .guide__fact dd {
    margin: 0;
    color: var(--color-text-secondary);
  }

  /* THE HAIRLINE RULE, on `border-block-end` — its own property, so the `edge`
     axis's width reaches it without any math on the token. `edge: none` and
     `edge: soft` legitimately dissolve it: the rows are a list, not a table, and
     the label/detail pairing carries the structure on its own. */
  .guide--credentials .guide__facts {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    width: 100%;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  .guide--credentials .guide__fact {
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border: 0;
    border-block-end: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: 0;
    font-size: var(--guide-meta);
  }

  .guide--credentials .guide__fact:last-child {
    border-block-end: 0;
  }

  /* ── THE LETTER ──────────────────────────────────────────────────────────
     A letter is read, so it is left-aligned and measure-capped regardless of the
     `align` axis's justification of the section furniture — the one place a
     composition overrides an axis, because a centred letter is not a letter.
     The axis still governs where the BLOCK sits, via `--jp-measure-margin`. */
  .guide--letter .guide__bio p {
    text-align: start;
  }

  .guide--letter .guide__bio {
    gap: calc(var(--jp-sec-gap) / 2);
  }

  .guide__sign {
    display: flex;
    flex-direction: column;
    align-items: var(--jp-align);
    gap: var(--space-2);
    margin-block-start: var(--jp-sec-gap);
  }

  /* The signature mark. Height rides the `type` axis so it stays proportional to
     the letter it signs; `width: auto` keeps the mark's own aspect. */
  .guide__sig {
    display: block;
    height: calc(var(--jp-heading-size) * 1.6);
    width: auto;
    max-width: 100%;
    object-fit: contain;
  }

  .guide__signoff {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--guide-meta);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  /* ── THE QUOTE-LED COMPOSITION ───────────────────────────────────────────
     The quote is this composition's display moment, so it takes the heading's
     rung and the heading drops to the body rung beneath it. HIERARCHY is
     arrangement; the SIZES still come from the `type` axis, which is why neither
     is a literal. Ported from `_guide.css:46-52`, with one deliberate
     divergence recorded in that partial's port map: the canvas HID the bio
     (`.jp-guide--quote .jp-guide__body { display: none }`), while the
     catalogue's own hint for this composition is "A big pull-quote leads; bio
     and attribution beneath". The hint is the specification, so the bio stays. */
  .guide--quote .guide__quote {
    border-inline-start: 0;
    padding-inline-start: 0;
    max-width: none;
  }

  .guide--quote .guide__quote::before {
    inset-inline-start: 0;
    position: relative;
    display: block;
    top: 0;
  }

  .guide--quote .guide__quote p {
    font-size: var(--jp-heading-size);
    line-height: var(--jp-display-leading);
  }

  .guide--quote .guide__heading {
    font-size: var(--jp-body-size);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    max-width: none;
  }

  /* ── REDUCED MOTION — INVIOLABLE ─────────────────────────────────────────
     The eleven per-component copies of this block collapse into
     `journey-sections-shared.css`, which stops every keyframe under `.jp-sec`
     with `!important` (a WCAG obligation, not a preference) — and
     `journey-design.css` neutralises `--jp-reveal-distance`, because a 0.01ms
     transition to a translated end state still MOVES the element.

     What is left here is the two transforms this section sets outside a
     keyframe: the play button's hover scale, and the transition that carries it.
     A53/A40's discipline — the STATIC state is the baseline — is why there is
     nothing else to undo: the plate is composed at rest and the reveal only ever
     applies under `.reveal--armed`, which the action withholds entirely under
     reduced motion. */
  @media (prefers-reduced-motion: reduce) {
    .guide__play {
      transition: none;
    }

    .guide__play:hover {
      transform: none;
    }
  }
</style>
