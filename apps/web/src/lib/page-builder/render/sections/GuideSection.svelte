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

  ── EIGHT DESIGN LANGUAGES, NOT 38 PERMUTATIONS ─────────────────────────────
  The nine axes reach every MAGNITUDE in this file. They do not, on their own,
  make a look recognisable: a design language is also which elements are boxes,
  which corner is square, which label is monospaced and which rule is drawn at
  all — selector-level decisions that a properties-only axis file cannot carry
  and a Svelte-scoped style block cannot select on, because the `data-jp-*`
  attributes live on the ANCESTOR `.jp-sec`.

  So eight axis values are re-emitted UNMODIFIED as local `data-*` attributes on
  `.guide` (see `look` in the script), and the PER-LOOK COMMITMENTS block at the
  foot of the stylesheet spends them on each family's documented tell
  (`00-design-language-research.md` §1). Read that block's own header before
  adding a rule to it: it carries the selector discipline that keeps `candlelit`
  — the one preset the product owner says already works — out of the blast
  radius, which is not a convention but arithmetic. Candlelit is uniquely
  identified by four of its nine values (`surface: media`, `edge: none`,
  `media: bleed`, `accent: glow`) and shares the other five, so a bare rule on
  `type: monumental`, `align: center`, `density: airy`, `width: text` or
  `motion: drift` restyles it. None of the 52 attribute-constrained selectors
  emitted from this file matches the candlelit bundle; that is checkable by
  evaluating each selector against the bundle, and it was.

  ── FIVE COMPOSITIONS ───────────────────────────────────────────────────────
  `portrait` (default) · `column` · `quote` · `credentials` · `letter`.

  `column` absorbs the retired `centered` variant (it was `align` + `width` on top
  of "no media" — see `LEGACY_SECTION_VARIANTS.guide` in `section-catalog.ts`),
  and `portrait` / `quote` are ported from the since-deleted canvas partial
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
  import * as m from '$paraglide/messages';
  import { reveal } from '../reveal';
  import { safeHref } from '../safe-href';
  import { editFieldAttrs } from '../editable';
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
     * The resolved axes. EIGHT OF THE NINE ARE NOW ALSO MIRRORED INTO MARKUP as
     * plain `data-*` attributes on this section's own root — see `look` below —
     * because a Svelte-scoped style block cannot reach the ancestor
     * `data-jp-*` attribute `SectionFrame` writes on `.jp-sec`. The precedent is
     * `ProofSection.svelte:311` / `InviteSection.svelte:498`, which read
     * `data-jp-motion` in markup for exactly the same reason.
     *
     * Nothing here changes WHAT is rendered. It changes what this section's own
     * CSS is able to select on, which is what a design LANGUAGE needs and a set
     * of magnitudes cannot supply.
     */
    design?: ResolvedSectionDesign;
    editable?: boolean;
    onEdit?: (key: string, value: string) => void;
  }

  const { config, context, variant, design, editable = false, onEdit }: Props =
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
   * `facts` IS READ IN ITS DECLARED SHAPE ONLY — `Array<{label, detail}>`, per
   * `section-fields.ts:384-395`. A string under this key renders NOTHING, and
   * that is deliberate. Do not add a string branch here.
   *
   * A29 HAS SINCE LANDED, and this comment used to say the opposite — re-verified
   * on this base rather than trusted, because the claim it replaces is exactly the
   * kind that ages into a false alarm and then steers work away from a carrier
   * that works. `SECTION_FIELDS.guide` declares `facts` as
   * `control: 'repeater'` with `itemFields: [{label}, {detail}]`
   * (`section-fields.ts:512`); `SectionEditor.svelte:413` now has a real
   * `list | repeater` branch that hands the field to `ArrayField`; and
   * `ArrayField.svelte:178` writes `{...base, [key]: next}` per cell, i.e. the
   * DECLARED object shape, through `setSectionProp`. So a creator can author
   * `{label, detail}` rows today and this list is reachable content, not a
   * markup-complete placeholder.
   *
   * THE STRING BRANCH IS STILL REFUSED, and the reason has moved from "the
   * control cannot do better" to "the DATA may still be wrong". A page authored
   * before the repeater existed can hold a bare string under this key — the
   * `guide` section on `studio-alpha`/`bone-deep` stored
   * `"facts": "20 years teaching — somatics and grief work"` on a `credentials`
   * section — and a control landing does not migrate rows.
   *
   * WHY NOT COERCE THE STRING. It looks like kindness and it is a trap. The field
   * declares TWO sub-fields; a free-typed string carries no information about
   * which one it is, so rendering it as `{label: <the whole string>}` is a guess
   * dressed as data. Ship that and the guess becomes a rendering contract the
   * eventual repeater migration has to preserve — and every creator who sees
   * their text appear writes more of it. Rendering nothing keeps the corrupt
   * value inert and unblessed, so consolidation can migrate or discard it freely.
   * The right fix is the generic array control (A29), which is consolidation's,
   * and `SectionEditor.svelte` is a CLOSED shared file.
   *
   * `asObjectArray` already returns `undefined` for a non-array, so the self-hide
   * is the guard doing its job — no extra code, which is the point.
   *
   * The one fallback kept is the LEGACY `credentials` string array: a different
   * key, and a declared prop on `GuideSectionProps`. Not the A30 trap either —
   * A30 needs a repeater bound to a key the renderer PREFERS over an existing
   * authored vocabulary, and here `credentials` appears in no
   * `SECTION_FIELDS.guide` entry at all, so no creator can ever have stored it.
   * It exists so the declared prop is not orphaned, not because anything can
   * reach it.
   */
  const facts: GuideFact[] | undefined = $derived(
    p.facts ?? p.credentials?.map((label) => ({ label }))
  );

  /**
   * ── THE AXES, MIRRORED ONTO THIS SECTION'S OWN ROOT ────────────────────────
   * `journey-design.css` turns the nine `data-jp-*` attributes on `.jp-sec` into
   * custom properties, and a section can only ever READ those. That stays the
   * default for everything with a magnitude: every size, colour, rhythm, edge
   * and duration below is still a `--jp-*` read.
   *
   * It is NOT sufficient for the eight values here, because a design language is
   * not only a set of magnitudes — it is which elements exist as boxes, which
   * corner is square, which label is monospaced, which rule gets drawn at all.
   * Those are selector-level decisions and a scoped style block cannot reach an
   * ancestor's attribute, so the axis value is re-emitted here UNMODIFIED as a
   * local `data-*` attribute.
   *
   * `width` is deliberately not mirrored: nothing in this file needs to select
   * on it, because `--jp-content-max` / `--jp-measure` already carry it.
   *
   * `undefined` when no `design` arrives, so Svelte omits the attribute and
   * every per-look rule no-ops. That is the honest degradation — a host that
   * resolves no axes gets exactly the markup and CSS this component shipped
   * before the per-look pass, rather than a guessed default look. `SectionFrame`
   * always passes a TOTAL `ResolvedSectionDesign` (`resolveDesign` emits all
   * nine), so both real render paths — the public page and the studio canvas —
   * always have all of them.
   */
  const look = $derived({
    surface: design?.surface,
    edge: design?.edge,
    align: design?.align,
    type: design?.type,
    accent: design?.accent,
    density: design?.density,
    motion: design?.motion,
    media: design?.media,
  });

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
    editFieldAttrs('guide', key, editable, onEdit);
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
          alt={p.name ? m.journey_guide_portrait_alt({ name: p.name }) : ''}
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
              ? m.journey_guide_play_clip({ name: p.name })
              : m.journey_guide_play_clip_generic()}
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

  AUTHORABLE FROM THE BUILDER, as of A29's array control — see the `facts` derived
  in the script for the verification. That matters to the per-look work at the foot
  of the stylesheet, because this list is where four of the eight tells actually
  land: `full-send`'s big numerals, `syllabus`'s left accent stripe, `signal`'s
  rounded cards and `long-read`'s hairline-ruled rows are all `.guide__fact`. It is
  the section's densest run of authorable structure, not a placeholder.

  Still degrades to nothing when unauthored, which is why every look's treatment of
  it is a VALUE in the role table rather than a rule that assumes a row exists.
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
  <div
    class="guide guide--{composition}"
    data-surface={look.surface}
    data-edge={look.edge}
    data-align={look.align}
    data-type={look.type}
    data-accent={look.accent}
    data-density={look.density}
    data-motion={look.motion}
    data-media={look.media}
  >
    <div class="guide__inner" use:reveal={{ disabled: editable }}>
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

    /* ── FIVE LOCAL ROLES, so a look is a VALUE and not a rule ────────────
       The per-look blocks at the foot of this file are keyed on axis values
       (`edge: offset`, `accent: none`, …). Written as paint rules, six of the
       eight looks would re-declare the same five fact-row declarations, which
       is the shape that produced the eight different spellings of
       `clamp(2rem, 6cqw, 4.4rem)` this tree is still cleaning up. Written as
       properties, a look states its VALUES and the paint lives in one place —
       the same discipline `journey-design.css` holds itself to ("every axis
       value sets only custom properties").

       EVERY DEFAULT HERE REPRODUCES THE BASE COMMIT EXACTLY, which is the
       whole point: candlelit resolves none of the per-look selectors, so it
       resolves these defaults, and a default that merely looked reasonable
       would have silently restyled the one preset that already works.
         `--guide-pill-radius`  was `--radius-full` on tag / play / fact
         `--guide-fact-*`       was 1px `--color-border-subtle`, no shadow,
                                `--space-1 --space-3`
         `--guide-label-*`      `inherit` + `--text-sm` is what
                                `.jp-sec__eyebrow` already computes
         `--guide-detail-size`  `1em` is the inherited size, i.e. no change
         `--guide-head-*`       `0px` paints no rule at all
       `0px` and `1em`, never a bare `0` or `1`: these are substituted into
       `border-block-end` and `font-size`, and a UNITLESS zero in a length slot
       is the A63/A64 class of failure that invalidates the whole declaration
       silently. */
    --guide-pill-radius: var(--radius-full);
    --guide-fact-radius: var(--guide-pill-radius);
    --guide-fact-border: var(--border-width) solid var(--color-border-subtle);
    --guide-fact-shadow: none;
    --guide-fact-pad: var(--space-1) var(--space-3);
    --guide-label-font: inherit;
    --guide-label-size: var(--text-sm);
    --guide-detail-size: 1em;
    --guide-head-rule: 0px;
    --guide-head-gap: 0px;
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

    /* A DEFECT ON THE BASE, not a look decision, and it is why `plain-facts`
       looked broken rather than merely plain.

       `showsPlate` is a COMPOSITION test, so `portrait` and `credentials`
       always render the plate element and always claim two columns — while the
       `media` axis takes the plate away underneath them through
       `display: var(--jp-media-display)`. A `display: none` child is not a grid
       ITEM, so the copy column fell into track 1, `minmax(0, 0.82fr)`: 41% of
       the section, with 59% of the row empty beside it.

       `media: none` is `plain-facts`'s own media value and nobody else's, so
       the brutalist preset rendered its entire copy column in a narrow left
       gutter above 620cqw. Candlelit is `media: bleed` and cannot match.

       Keyed on the mirrored axis attribute because a custom property cannot be
       a `grid-template-columns` predicate — `--jp-media-display` says `none`,
       but no selector can ask it. */
    .guide[data-media='none'] .guide__inner {
      grid-template-columns: 1fr;
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
    /* `inset` on all four sides already determines the used width and height of
       an absolutely-positioned box, so explicit `width`/`height` here would be
       redundant — AND they were invalid. `--jp-media-inset` is a UNITLESS `0` at
       `bleed`, `frame` and `mask` (3 of 5 values, including Candlelit), so
       `calc(100% - 2 * var(--jp-media-inset))` reduced to `calc(100% - 2 * 0)`,
       which subtracts a `<number>` from a percentage and is invalid at
       computed-value time — the declaration would fall back to `auto` the moment
       a creator assigned a portrait. Same class as A63/A64; `inset` itself is
       fine because a bare `0` IS a valid length in an ordinary property value,
       and only MATH on it mixes types. */
    inset: var(--jp-media-inset);
    z-index: 0;
    display: block;
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
    border-radius: var(--guide-pill-radius);
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
    border-radius: var(--guide-pill-radius);
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
    font-family: var(--guide-label-font);
    font-size: var(--guide-label-size);
    color: var(--jp-accent-text);
  }

  .guide__heading {
    max-width: 22ch;
    margin-inline: var(--jp-measure-margin);
    /* The head hairline, off by default. `long-read`'s tell is "a hairline
       under every section head" and the measurement found it NOWHERE in the
       tree; `syllabus` wants the same rule so the block reads as a table with a
       header row. Both are `--guide-head-rule` values, not two more rules. */
    padding-block-end: var(--guide-head-gap);
    border-block-end: var(--guide-head-rule) solid var(--color-border-subtle);
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
    padding: var(--guide-fact-pad);
    border-radius: var(--guide-fact-radius);
    border: var(--guide-fact-border);
    /* THE WHOLE VALUE of its own `box-shadow`, never one item of a list —
       three of the values this property takes below are `var(--jp-edge-shadow)`
       and that token is the KEYWORD `none` at `edge: none` and `edge: heavy`.
       `box-shadow`'s grammar is `none | <shadow>#`, so `none` inside a comma
       list invalidates the declaration at computed-value time and paints
       nothing, silently (contract A54/A63 — three rings on every published page
       before it was caught). */
    box-shadow: var(--guide-fact-shadow);
    font-size: max(var(--text-xs), calc(var(--guide-meta) / 1.2));
  }

  .guide__fact dt {
    font-family: var(--guide-label-font);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .guide__fact dd {
    margin: 0;
    font-size: var(--guide-detail-size);
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


  /* ═══ PER-LOOK COMMITMENTS ═══════════════════════════════════════════════
     Everything above is axis-generic: it consumes magnitudes and paints one
     arrangement. What follows commits each design LANGUAGE to its documented
     tell (`00-design-language-research.md` §1), because a tell is a
     SELECTOR-level statement — which elements are boxes, which corner is
     square, which label is monospaced, which rule is drawn — and
     `journey-design.css` deliberately emits nothing but custom properties.

     ── THE SELECTOR DISCIPLINE, stated once so every block can be checked ───
     `candlelit` is the one preset that already works and it must come out of
     this pass byte-identical. It is uniquely identified by FOUR of its nine
     axis values — `surface: media`, `edge: none`, `media: bleed`,
     `accent: glow` — and SHARES the other five: `type: monumental` (with
     quiet-studio, plain-facts), `align: center` (quiet-studio, open-air,
     full-send), `density: airy` (open-air), `width: text` (long-read,
     open-air), `motion: drift` (open-air).

     So NO selector below is keyed on any of those five. Every one of them names
     one of these thirteen, and none matches the candlelit bundle:

       media: none                     → plain-facts  only
       edge: offset                    → plain-facts  only
       accent: edge                    → syllabus     only
       type: restrained                → syllabus     only
       accent: none                    → quiet-studio only
       density: vast                   → quiet-studio only
       motion: fade                    → quiet-studio only
       edge: soft                      → open-air     only
       type: expressive                → open-air + full-send (never candlelit,
                                         which is `monumental`)
       edge: heavy                     → full-send    only
       motion: stagger                 → full-send    only
       surface: bare  + align: start   → long-read    only
       edge: hairline + accent: fill   → signal       only

     The last two are COMPOUNDS by necessity rather than by taste: `long-read`
     and `signal` each share all nine of their axis values with some sibling, so
     neither has a single value to key on. Each compound is justified in its own
     block.

     `open-air` is the dangerous one — it shares FOUR axes with candlelit — so
     every open-air rule here is keyed on `edge: soft`, which candlelit
     (`edge: none`) cannot match. */

  /* ── A LIFTED SURFACE MUST CARRY ITS OWN EDGE ───────────────────────────
     The single highest-leverage line in this pass, and a base defect rather
     than a taste call: `--jp-edge-width` / `--jp-edge-color` /
     `--jp-edge-shadow` had exactly ONE consumer in this component,
     `.guide__plate`. So `surface: panel` painted a background and a
     `--radius-card` corner with no border and no elevation whatsoever, on all
     three panel looks — precisely the "vanishing card" research §5.2 predicts
     for the contemporary family, and the reason `signal`'s "rounded cards with
     hairlines and a small neutral shadow" could not be seen.

     WHY THE SURFACE LIST AND NOT A BARE RULE. Written on `.guide` bare this
     would be free of candlelit risk (at `edge: none` the width is `0px` and the
     shadow is the keyword `none`, so it paints nothing) — but it would draw a
     full hairline BOX around `quiet-studio` and `long-read`, whose tells are
     "one hairline, used perhaps twice" and "no box borders anywhere". Both are
     `surface: bare`, so listing the three LIFTED surfaces excludes them by
     construction. Candlelit is `surface: media` and matches none of the three.

     What each look gets, from its own `edge` value and nothing added:
       plain-facts  panel  + offset   → 2px + a hard un-blurred drop
       syllabus     panel  + hairline → the hairline the "table" reads as
       signal       panel  + hairline → hairline + `--shadow-xs`, neutral
       open-air     tint   + soft     → 0px border, `--shadow-lg`: the shadow
                                        you have to look for, on the whole band
       full-send    invert + heavy    → 2px in the accent, around an inverted
                                        band

     `box-shadow` takes the token as its WHOLE value and the border does plain
     substitution with no math on the width — the two rules contract A54/A63 and
     A64 exist for. Same shape as `.guide__plate` above, which documents both. */
  .guide[data-surface='panel'],
  .guide[data-surface='tint'],
  .guide[data-surface='invert'] {
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
  }

  /* ── 1.2 BRUTALIST · `plain-facts` — `edge: offset` ──────────────────────
     Tell: 2px borders with a hard un-blurred offset shadow, mono labels, and
     radius 0 everywhere.

     MEASURED ON THE BASE: the 2px border was reachable, but the offset shadow
     was found NOWHERE and radius 0 was found NOWHERE. In this file the reason
     is mechanical rather than aesthetic — `--jp-edge-shadow` had exactly ONE
     consumer, `.guide__plate`, and `plain-facts` is `media: none`, so the only
     element that could have drawn the offset was `display: none` in the only
     preset that ships one. It now lands on the copy box and the fact rows,
     which no composition and no media value can remove. */
  .guide[data-edge='offset'] {
    /* RADIUS 0, ABSOLUTELY — the tell's own adverb. The section SHELL has to be
       squared off too, not just its furniture: `--jp-sec-radius` is
       `--radius-card` under `surface: panel`, which is this look's surface. */
    border-radius: var(--radius-none);
    --guide-pill-radius: var(--radius-none);
    --guide-fact-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --guide-fact-shadow: var(--jp-edge-shadow);
    --guide-fact-pad: var(--space-3) var(--space-4);
    --guide-label-font: var(--font-mono);
    --guide-label-size: var(--text-xs);
  }

  /* "Surface: panel — every block is a visible box." The copy column becomes
     that box, so the hard drop has a carrier that always exists. */
  .guide[data-edge='offset'] .guide__body {
    padding: var(--jp-sec-gap);
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    box-shadow: var(--jp-edge-shadow);
    border-radius: var(--radius-none);
  }

  /* The accent spent as the family spends it: "solid rectangles of it, text
     reversed out". COMPOUNDED with `accent: fill` rather than left on
     `edge: offset` alone, because `--jp-accent-fill` is `transparent` at
     `accent: text` and `accent: edge` — a creator who picked those with this
     edge would get `--jp-accent-on-fill` text on the section's own ink, which
     is the two-token contrast pair broken in half. `.guide__body` is a column
     flex box with `align-items: var(--jp-align)`, so the slab shrink-wraps its
     text at both align values with no `width` of its own. */
  .guide[data-edge='offset'][data-accent='fill'] .guide__eyebrow {
    padding: var(--space-1) var(--space-3);
    color: var(--jp-accent-on-fill);
    background: var(--jp-accent-fill);
  }

  /* The pull-quote becomes another hard box, and its 1.6em serif quotation
     ornament GOES. Brutalism has no ornament; this is one of the places where
     the correct edit is a removal. */
  .guide[data-edge='offset'] .guide__quote {
    padding: var(--space-4) var(--space-5);
    border-inline-start: 0;
    border: var(--jp-edge-width) solid var(--jp-edge-color);
    border-radius: var(--radius-none);
    box-shadow: var(--jp-edge-shadow);
  }

  .guide[data-edge='offset'] .guide__quote::before {
    display: none;
  }

  .guide[data-edge='offset'] .guide__quote p {
    font-style: normal;
  }

  /* MONO NUMERALS on the runtime, tabular so digits do not shuffle. */
  .guide[data-edge='offset'] .guide__dur {
    border-radius: var(--radius-none);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .guide[data-edge='offset'] .guide__play {
    box-shadow: var(--jp-edge-shadow);
  }

  /* The control presses INTO its own offset shadow. `motion: none` is this
     look's motion value, so `--jp-reveal-duration` resolves to `0ms` and the
     press is a genuinely INSTANT state change — which is what the family's
     motion row asks for, not a fast animation. The box does not shrink, so
     contract A2's 44px floor is untouched. */
  .guide[data-edge='offset'] .guide__play:hover {
    transform: none;
    translate: var(--space-1) var(--space-1);
    box-shadow: none;
  }

  /* ── 1.5 TECHNICAL · `syllabus` — `accent: edge` · `type: restrained` ────
     Tell: a hairline grid, mono numerals, and a left-border accent stripe
     rather than a filled badge.

     MEASURED ON THE BASE: mono numerals and the left stripe both exist in the
     tree, but neither reached this section — the fact list is a pill CHIP row
     in four of its five compositions, the duration is proportional-figure, and
     the file's only left stripe is the pull-quote's. The `credentials`
     composition already builds the ruled list; the work here is to make every
     composition draw it, because the list is the LOOK's shape and not one
     arrangement's. */
  .guide[data-accent='edge'] {
    --guide-pill-radius: var(--radius-sm);
    --guide-label-font: var(--font-mono);
    /* Hairline under the section head, so the block reads as a table with a
       header row. `--radius-sm` and this rule are the family's own two values
       ("Corner radius `--radius-sm`", "Hairline on everything"). */
    --guide-head-rule: var(--border-width);
    --guide-head-gap: calc(var(--jp-sec-gap) / 3);
  }

  .guide[data-accent='edge'] .guide__facts {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    width: 100%;
    max-width: var(--jp-measure);
    margin-inline: var(--jp-measure-margin);
  }

  /* THE LEFT-BORDER ACCENT STRIPE — the tell states it in opposition to "a
     filled badge", so it is a stripe on every row and there is no badge.

     `--jp-accent-mark`, NOT `--jp-accent-edge`, and the measurement is already
     in this file (see `.guide--credentials .guide__plate`): `--jp-accent-edge`
     fails the 3:1 graphic floor at every accent value on a dark brand and
     measures 2.04:1 at THIS one, while `--jp-accent-mark` measures 5.00 dark /
     10.47 light. A stripe that carries the tell has to be seen. It is read
     directly with no mix carried onto it (contract A37). */
  .guide[data-accent='edge'] .guide__fact {
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-none);
    box-shadow: none;
    border-block-end: var(--border-width) solid var(--color-border-subtle);
    border-inline-start: var(--border-width-thick) solid var(--jp-accent-mark);
  }

  .guide[data-accent='edge'] .guide__fact dd,
  .guide[data-accent='edge'] .guide__dur {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* `type: restrained` is `syllabus`'s type value and nobody else's, so the
     dense-dashboard reading rhythm lands here: the label a full step under the
     body, and the bio at normal rather than relaxed leading — "many small
     steps, fine-grained hierarchy", 70–80ch, 0.75× rhythm. */
  .guide[data-type='restrained'] {
    --guide-label-size: var(--text-xs);
  }

  .guide[data-type='restrained'] .guide__bio p {
    line-height: var(--leading-normal);
  }

  /* ── 1.4 LUXURY-MINIMAL · `quiet-studio` — `accent: none` · `density: vast`
        · `motion: fade` ────────────────────────────────────────────────────
     Tell: three type sizes, ONE hairline, no accent colour, and more empty
     space than content.

     THIS LOOK GETS WORSE IF ANYTHING IS ADDED, so nearly every rule below
     REMOVES something. Measured on the base, the accent leaked in three places
     the `accent` axis had no way to reach: the plate's background is a two-stop
     radial of `--color-brand-primary` / `--color-brand-accent` — RAW brand
     tokens, not axis tokens — the pull-quote carries a 2px accent rule behind a
     1.6em quotation ornament, and the fact rows are bordered pills. */
  .guide[data-accent='none'] {
    --guide-fact-border: 0 none;
    --guide-fact-radius: var(--radius-none);
    --guide-fact-pad: 0px;
  }

  /* NO ACCENT COLOUR. Under `media: inset` — this look's own media value — the
     plate is a 3:2 image on a `--space-12` mount, and the mount is most of what
     the eye reads, so this is the largest accent surface in the section. It
     reads as paper here rather than as ember. */
  .guide[data-accent='none'] .guide__plate {
    background: var(--color-surface);
  }

  /* THE ONE HAIRLINE, and only one: a short rule at the head of the copy
     column. A pseudo-element, so there is no markup change and nothing enters
     the inline-edit seam's `textContent`. `flex: none` because `.guide__body`
     is a flex container, which makes a `::before` a flex ITEM. */
  .guide[data-accent='none'] .guide__body::before {
    content: '';
    flex: none;
    width: var(--space-16);
    height: var(--border-width);
    background: var(--color-border);
  }

  .guide[data-accent='none'] .guide__quote {
    padding-inline-start: 0;
    border-inline-start: 0;
  }

  .guide[data-accent='none'] .guide__quote::before {
    display: none;
  }

  /* THREE TYPE SIZES ON THE WHOLE SECTION — the tell as an arithmetic
     constraint rather than an adjective, which is the only form of it that can
     be checked. The base draws SEVEN: eyebrow, heading, name, bio, quote, fact
     row, sign-off. Collapsing the four metadata rungs onto one and the quote
     onto the body rung leaves exactly `--text-sm`, `--jp-body-size` and
     `--jp-heading-size`. Weight and tracking come with them, because "three
     sizes" is a hierarchy claim and a semibold name at the same size as a
     normal eyebrow is a fourth level by another means. */
  .guide[data-density='vast'] .guide__eyebrow,
  .guide[data-density='vast'] .guide__name,
  .guide[data-density='vast'] .guide__fact,
  .guide[data-density='vast'] .guide__signoff {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    letter-spacing: var(--tracking-wider);
  }

  .guide[data-density='vast'] .guide__quote p {
    font-size: var(--jp-body-size);
    font-style: normal;
    letter-spacing: var(--tracking-normal);
  }

  /* MORE EMPTY SPACE THAN CONTENT, on a doubling scale rather than three
     arbitrary values: 2 · 1 · 0.5 of the section gap, which at `vast` is
     already 1.6× the regular rhythm and still multiplies the org's own
     `--brand-density-scale` through `--space-unit`. */
  .guide[data-density='vast'] .guide__inner {
    gap: calc(var(--jp-sec-gap) * 2);
  }

  .guide[data-density='vast'] .guide__body {
    gap: var(--jp-sec-gap);
  }

  .guide[data-density='vast'] .guide__bio {
    gap: calc(var(--jp-sec-gap) / 2);
  }

  /* "Slow fade only. No transform." `motion: fade` already zeroes
     `--jp-reveal-distance`, so the reveal is a pure opacity ramp — and the one
     transform this section sets outside the reveal is the play control's hover
     scale, so it goes too. */
  .guide[data-motion='fade'] .guide__play:hover {
    transform: none;
  }

  /* ── 1.1 EDITORIAL · `long-read` — `surface: bare` + `align: start` ──────
     Tell: the eyebrow and the body share a left edge, and there is a hairline
     under every section head.

     A COMPOUND BY NECESSITY. `long-read` has no axis value of its own:
     `surface: bare` is shared with `quiet-studio` and `align: start` with
     `plain-facts`, `syllabus` and `signal` — but `quiet-studio` is
     `align: center` and none of the other three is `surface: bare`, so the PAIR
     is `long-read` alone. Candlelit is `surface: media`, so it matches neither
     half, let alone both.

     Measured on the base: the shared left edge already holds — `align: start`
     sets `--jp-measure-margin: 0px` and the eyebrow, heading and bio all sit on
     it — but the HEAD HAIRLINE was not found anywhere in the tree, and the
     pull-quote broke the left edge with a `--space-5` indent behind a 2px
     accent rule. "Hairline horizontal rules only. No box borders anywhere." */
  .guide[data-surface='bare'][data-align='start'] {
    --guide-head-rule: var(--border-width);
    --guide-head-gap: calc(var(--jp-sec-gap) / 3);
    --guide-fact-border: 0 none;
    --guide-fact-radius: var(--radius-none);
    --guide-fact-pad: 0px;
  }

  /* The rule spans the MEASURE, not the 22ch headline cap, so it reads as a
     section rule and not as an underlined heading. `width: 100%` is required
     because `.guide__body` is a column flex box with `align-items: start`,
     which shrink-wraps every child to its text. */
  .guide[data-surface='bare'][data-align='start'] .guide__heading {
    width: 100%;
    max-width: var(--jp-measure);
  }

  /* NO BOX BORDERS ANYWHERE: the pull-quote's rules go horizontal and the
     ornament goes, which returns its text to the shared left edge — the other
     half of this look's tell, broken by the base's own indent. */
  .guide[data-surface='bare'][data-align='start'] .guide__quote {
    width: 100%;
    padding-inline-start: 0;
    padding-block: calc(var(--jp-sec-gap) / 2);
    border-inline-start: 0;
    border-block: var(--border-width) solid var(--color-border-subtle);
  }

  .guide[data-surface='bare'][data-align='start'] .guide__quote::before {
    display: none;
  }

  .guide[data-surface='bare'][data-align='start'] .guide__facts {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    width: 100%;
    max-width: var(--jp-measure);
  }

  .guide[data-surface='bare'][data-align='start'] .guide__fact {
    justify-content: space-between;
    gap: var(--space-4);
    padding-block: calc(var(--jp-sec-gap) / 3);
    border-block-end: var(--border-width) solid var(--color-border-subtle);
  }

  /* ── 1.3 SOFT-ORGANIC · `open-air` — `edge: soft` ───────────────────────
     Tell: no border anywhere, pill controls, and a shadow you have to look for.

     Keyed ONLY on `edge: soft`. This look shares four axes with candlelit
     (`align: center`, `density: airy`, `width: text`, `motion: drift`) and a
     bare rule on any of them would restyle the one preset that works;
     `edge: soft` is open-air's and nobody else's, and candlelit is `edge: none`.

     Measured on the base: the pills are genuinely there. "No border anywhere"
     was not, and the reason is that `.guide__fact`, `.guide__tag` and
     `.guide__dur` each spelled their own `var(--border-width) solid …`, which
     the `edge` axis cannot reach at any value. `--jp-edge-width` is `0px` here
     and the fact row now reads it. */
  .guide[data-edge='soft'] {
    --guide-fact-border: 0 none;
    /* THE SHADOW YOU HAVE TO LOOK FOR. `--jp-edge-shadow` is `--shadow-lg` at
       this value: a 10%/5%-alpha, 14px-blur drop — "large, very diffuse, very
       low opacity". Whole value of its own `box-shadow`, per the note on
       `.guide__fact`. */
    --guide-fact-shadow: var(--jp-edge-shadow);
    --guide-fact-pad: var(--space-2) var(--space-4);
  }

  .guide[data-edge='soft'] .guide__tag,
  .guide[data-edge='soft'] .guide__dur {
    border-color: transparent;
  }

  /* "Accent as tinted background + accent text. NEVER a hard fill." The
     quote's hard 2px rule becomes a soft tinted panel at `--radius-xl`, the
     family's own panel radius.

     The 8% mix sits on `--jp-accent-mark`, which is `--jp-ember-text` at four
     of five accent values and `--jp-heading` at the fifth — never a pre-mixed
     value — so this is NOT contract A37's mix-of-a-mix. `--jp-accent-edge`
     would have been exactly that: it is already a 45% ember mix at
     `accent: glow`, and 8% of it would be ~3.6% ember. */
  .guide[data-edge='soft'] .guide__quote {
    padding: var(--space-6) var(--space-7);
    border-inline-start: 0;
    border-radius: var(--radius-xl);
    background: color-mix(in oklab, var(--jp-accent-mark) 8%, transparent);
    box-shadow: var(--jp-edge-shadow);
  }

  .guide[data-edge='soft'] .guide__quote::before {
    inset-inline-start: var(--space-5);
  }

  /* ── 1.8 PLAYFUL · `full-send` — `edge: heavy` · `motion: stagger` ───────
     Tell: whole inverted bands, pill CTAs at `--radius-full`, spring easing,
     and BIG NUMERALS.

     Measured on the base: big numerals were found NOWHERE in the tree. This
     section's numerals are the fact DETAIL — "2,400" against "Students",
     "since 2009" against "Practising" — and inside a bordered pill at
     `max(--text-xs, --guide-meta / 1.2)` they were the quietest thing in the
     section. They become the loud half of the row and the label demotes to a
     small tracked cap above them.

     `flex-direction: column`, not `column-reverse`: the visual order then still
     matches the `<dl>`'s DOM order, so the row reads term-then-description to a
     screen reader and looks like a stat to everyone else. */
  .guide[data-edge='heavy'] {
    --guide-pill-radius: var(--radius-full);
    --guide-fact-radius: var(--radius-xl);
    --guide-fact-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --guide-fact-pad: var(--space-4) var(--space-6);
    --guide-label-size: var(--text-xs);
    --guide-detail-size: var(--jp-heading-size);
  }

  .guide[data-edge='heavy'] .guide__fact {
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    text-align: center;
  }

  .guide[data-edge='heavy'] .guide__fact dt {
    font-size: var(--guide-label-size);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .guide[data-edge='heavy'] .guide__fact dd {
    font-family: var(--font-heading);
    font-weight: var(--heading-weight, var(--font-semibold));
    line-height: var(--leading-none);
    font-variant-numeric: tabular-nums;
    color: var(--color-heading);
  }

  /* SPRING EASING, made visible. `--jp-reveal-ease` is `--ease-spring` at this
     motion value and the reveal already rides it, but the one place a viewer
     can FEEL an easing curve is the control they are pointing at, so the hover
     overshoots on it. It only ever GROWS the target: a `:active` shrink would
     take the border box under contract A2's 44px floor mid-press, and A2's
     floor is a floor in both directions. */
  .guide[data-motion='stagger'] .guide__play:hover {
    transform: scale(1.18);
  }

  /* ── 1.9 CONTEMPORARY · `signal` — `edge: hairline` + `accent: fill` ─────
     Tell: rounded cards with hairlines and a small neutral shadow; one filled
     accent button per section.

     ANOTHER COMPOUND BY NECESSITY. `signal` shares all nine of its axis
     values: `edge: hairline` is also `quiet-studio`, `long-read` and
     `syllabus`, and `accent: fill` is also `plain-facts` and `full-send` — but
     those two are `edge: offset` and `edge: heavy`, and the three other
     hairline looks are `accent: none` / `text` / `edge`. So the PAIR is
     `signal` alone, and candlelit (`edge: none`, `accent: glow`) matches
     neither half.

     Measured on the base: `--jp-edge-shadow` reached only `.guide__plate`, so
     the fact rows were flat hairline pills with no elevation at all — the
     "vanishing card" research §5.2 predicts for exactly this family. The filled
     accent button is already right: `.guide__play` reads `--jp-accent-fill`,
     and it is the only filled control in the section.

     `--jp-edge-shadow` is `--shadow-xs` here — a 1px, 10%-alpha drop, i.e. the
     "small NEUTRAL shadow" the tell names, not a coloured one. */
  .guide[data-edge='hairline'][data-accent='fill'] {
    --guide-fact-radius: var(--radius-card);
    --guide-fact-border: var(--jp-edge-width) solid var(--jp-edge-color);
    --guide-fact-shadow: var(--jp-edge-shadow);
    --guide-fact-pad: var(--space-3) var(--space-4);
  }

  /* ── THE `type` AXIS AS A RELATIONSHIP, not four font sizes ─────────────
     The base drew the eyebrow at a flat `--text-sm` while `--jp-heading-size`
     travels 20px → 48px across the four values: at `restrained` the label sat
     within 6px of the heading it labels, and at `expressive` it had disappeared
     underneath it. `--guide-label-size` is the axis's third relationship and it
     moves WITH the heading — `--text-xs` at `restrained` (above),
     `--text-sm` at `balanced` (the default), `--text-base` here.

     `monumental` is deliberately absent. It is candlelit's own type value,
     shared with `quiet-studio` and `plain-facts`, and both of those take their
     label rung from a value that is theirs alone (`density: vast`,
     `edge: offset`). A bare `type: monumental` rule here is the precise shape
     that would have restyled the one preset that already works. */
  .guide[data-type='expressive'] {
    --guide-label-size: var(--text-base);
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

    /* The two per-look hover states the design-language pass added. Both are
       transforms OUTSIDE a keyframe, which is the one thing
       `journey-sections-shared.css`'s `animation: none !important` guard cannot
       reach — and both out-specify the `.guide__play:hover` rule above (0,4,0
       against 0,2,0), so neither is covered by it.

       Listed explicitly rather than as a wildcard so the next look that adds a
       hover transform has to come here and say so. */
    .guide[data-motion='stagger'] .guide__play:hover {
      transform: none;
    }

    .guide[data-edge='offset'] .guide__play:hover {
      translate: none;
    }
  }
</style>
