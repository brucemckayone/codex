/**
 * Page-builder SECTION MODEL — the section catalogue (Codex-2pryk.2.1 · WP-0,
 * extended for WP-5 with per-type VARIANTS + default composition + seed copy).
 *
 * The "section-model" half of the WP-0 page-builder document model (HARDENING §G
 * item a): the analogue of the brand studio's `rail/rail-model.ts` (catalogue,
 * ordering, search). This is the pure, framework-free spine — section-type
 * metadata + the search matcher + the default-template factory + the per-type
 * VARIANT set and seed content. The WP-5 editor rail renders FROM it; the WP-3
 * public renderer maps each {@link PageSection}'s `type` → a Svelte component and
 * switches on {@link PageSection.variant}.
 *
 * INERT + public-bundle safe: types + pure helpers only, no component imports —
 * so it lives under `$lib/page-builder` (scanned by the CE-4 import-boundary gate)
 * and never pulls the heavy editor UI (`$lib/components/page-builder`) into the
 * public chunk.
 *
 * The catalogue is the DEFAULT course-page template's section set (SPEC §4.1). A
 * future page type registers its own catalogue; the union {@link CourseSectionType}
 * constrains only what THIS template ships — the renderer skips unknown types.
 *
 * The seed copy is ported from the finished prototype
 * (`docs/design/course-journeys/prototype/builder.html`), mapped onto the app's
 * more granular semantic types (the prototype's one `prose` renderer backs
 * `ache`/`turn`/`feel`; `curriculum`→`map`; `film`→`introVideo`; `invitation`→`invite`).
 *
 * The COMPOSITION SET is no longer the prototype's. It is the finalised set from
 * `docs/design/journey-sections/00-design-language-research.md` §3, declared once
 * for all eleven types so the seven component work packages never contend on this
 * file, with {@link LEGACY_SECTION_VARIANTS} carrying every retired id forward.
 * Each type now declares its own set: the prototype shared one `prose` and one
 * `video` variant list across four types, but the research gives `ache`, `turn`
 * and `feel` genuinely different arrangements (an ache is a list of pains, a turn
 * is an arc, a feel is an inclusions ledger), so the shared constants are gone.
 */
import type {
  CourseSectionType,
  PageSection,
  ResolvedSectionDesign,
  SectionDesign,
  SectionProps,
} from '@codex/shared-types';
// The per-type RHYTHM table. The dependency is ONE-DIRECTIONAL: that file imports
// only types, never this module, so `createSection` can reach it with no cycle and
// the house rhythm stays a diff in ONE table rather than logic threaded through
// this catalogue.
import { sectionDesignForType } from './section-design-defaults';

// ── Variant definition ───────────────────────────────────────────────────────

/**
 * One composition ("option") of a section type — the layout the renderer draws
 * when {@link PageSection.variant} matches {@link SectionVariant.id}. `thumb` keys
 * a schematic thumbnail the visual variant-picker draws (see the editor's
 * `VariantPicker.svelte`).
 */
export interface SectionVariant {
  readonly id: string;
  readonly label: string;
  /** One-line description shown under the variant label in the picker. */
  readonly hint: string;
  /** Schematic-thumbnail key (a tiny abstract of the layout). */
  readonly thumb: string;
  /**
   * DECLARED BUT NOT BUILT — the reason, shown to the creator, and the picker
   * renders the option disabled.
   *
   * WHY THIS FIELD EXISTS (Codex-wqxv4). `reel: strip` was declared here, hinted
   * "A row of clip thumbnails; one plays inline", and DESCOPED in the renderer:
   * `ReelSection.svelte`'s own `COMPOSITIONS` array excludes it and clamps to
   * `theatre`. So the renderer knew and the picker did not — a creator could
   * choose a composition, watch its layout card take the selected state, save,
   * and get `theatre` on the published page. That is the failure mode
   * `journey-design.test.ts` opens by naming ("a value selectable in the builder
   * that matches no CSS rule renders with the axis default, and the creator sees
   * a control that appears to do nothing"), and it is worse here, because the
   * picker showed the choice as taken.
   *
   * NOT deleted, deliberately: the composition is DESCOPED, not retired, and the
   * distinction is already load-bearing in this file. A retired id belongs in
   * {@link LEGACY_SECTION_VARIANTS} and maps FORWARD onto a built composition; a
   * descoped one has never been selectable and has nothing to map from. Deleting
   * it would also lose the design and the reason it is blocked — the history
   * `ReelSection`'s header deliberately preserves.
   *
   * The string is authored English, like `label`, `hint` and `summary` beside it,
   * because this module is the CE-4-scanned PUBLIC_LIB_ROOT and stays free of the
   * app's i18n runtime. Same i18n debt as its three neighbours, and no new one.
   *
   * `resolveVariant` deliberately does NOT skip an unavailable id: the renderers
   * already clamp to their own `COMPOSITIONS`, so the resolved value and the
   * painted layout stay whatever they were, and the picker is where the lie was.
   * The conformance test in `section-catalog.test.ts` derives the expected set
   * from the renderers, so a NEW unbuilt composition fails there rather than
   * shipping as a dead control — and marking a BUILT composition unavailable
   * fails too.
   */
  readonly unavailable?: string;
}

// ── Section definition ───────────────────────────────────────────────────────

export interface SectionDefinition {
  readonly type: CourseSectionType;
  readonly label: string;
  /** One-line description shown in the add-section picker. */
  readonly summary: string;
  /**
   * ADVISORY FALLBACK GLYPH — no longer what the studio draws (Codex-1khpv).
   *
   * The rail and the add-section picker now render a design-system icon from
   * `$lib/components/page-builder/section-icons.ts`, keyed on `type`. The map
   * lives THERE and not here for the reason this file's header gives: this module
   * is the CE-4-scanned PUBLIC_LIB_ROOT and the public journey renderer imports it
   * for `resolveVariant`/`resolveDesign`, so typing this field as a `Component`
   * would ship eleven Svelte components into every visitor's chunk to draw
   * studio-only UI. `$lib/config/rail-icons.ts` splits the nav rail the same way.
   *
   * The string survives because `SectionEditor`'s inspector header still reads it.
   * While it does, it MUST NOT carry an emoji presentation: `guide` was `'☺'`
   * U+263A, the one value of the eleven Unicode classes as emoji-capable, so on
   * Apple platforms it rendered as a colour smiley among monochrome strokes. A
   * test in `section-catalog.test.ts` pins that.
   */
  readonly icon: string;
  /** Extra search terms beyond the label (synonyms). */
  readonly keywords: readonly string[];
  /**
   * The compositions this type offers. May be empty (a type with a single fixed
   * layout) — the editor shows the variant picker only when there are ≥2.
   */
  readonly variants: readonly SectionVariant[];
  /** The composition a fresh/duplicated section starts in. */
  readonly defaultVariant: string;
  /** Seed copy for a freshly-added section (generic placeholder copy). */
  readonly defaultProps: SectionProps;
}

// ── The composition set ─────────────────────────────────────────────────────
//
// FINALISED IN ONE PLACE, ON PURPOSE (F-C). Seven component work packages run in
// parallel over this catalogue; if each added its own type's compositions, every
// one of them would conflict here. So the complete id set for all eleven types
// lands in a single commit BEFORE those work packages start, and none of them
// edits this file again — they implement what is already declared.
//
// The set comes from `docs/design/journey-sections/00-design-language-research.md`
// §3. Its central finding: a large share of the original 37 variants were AXIS
// VALUES WEARING COMPOSITION NAMES. `hero: minimal` was `stage` at
// `density: compact` + `accent: none` + `motion: none`; `prose: centered` and
// `prose: wide` differed only in `align` and `width`. Those ids are retired into
// {@link LEGACY_SECTION_VARIANTS}, which is what keeps a published page looking
// the same — the same appearance, now reachable in combination with everything
// else rather than only as one fixed look.
//
// A composition is an ARRANGEMENT — which boxes exist and where. Anything that
// varies alignment, measure, surface, accent, motion or media treatment is an
// axis (see `SECTION_DESIGN_AXES` below) and deliberately does NOT appear here.
//
// `thumb` keys a schematic the editor's `VariantPicker.svelte` draws. Existing
// keys are reused wherever one honestly describes the arrangement; nine keys are
// new (`poster`, `frame`, `bleed`, `checklist`, `beforeafter`, `numbered`,
// `waveform`, `table`, `timeline`) and the picker cannot draw them yet — it has a
// generic `{:else}` fallback, so an undrawn key degrades to a plain line rather
// than throwing.
//
// Labels and hints stay INLINE ENGLISH by contract (A20): this module is pure,
// framework-free and public-bundle-safe, and importing paraglide here would pull
// message code into the public chunk. Keying the catalogue is its own refactor.

/**
 * The default course-page template catalogue, in the template's ship order
 * (SPEC §4.1): hero → introVideo → ache → turn → reel → map → feel → proof →
 * guide → faq → invite.
 */
export const SECTION_CATALOG: readonly SectionDefinition[] = [
  {
    type: 'hero',
    label: 'Hero',
    summary: 'The opening headline, kicker and primary call-to-action.',
    icon: '◇',
    keywords: ['hero', 'headline', 'title', 'opening', 'banner', 'cta'],
    variants: [
      {
        id: 'stage',
        label: 'Stage',
        hint: 'Headline stack over an atmosphere layer',
        thumb: 'center',
      },
      {
        id: 'split-media',
        label: 'Split · media',
        hint: 'Copy column beside a media panel',
        thumb: 'split',
      },
      {
        id: 'full-bleed',
        label: 'Full bleed',
        hint: 'Media fills the section; copy sits over a scrim',
        thumb: 'media',
      },
      {
        id: 'oversized',
        label: 'Oversized',
        hint: 'The headline is the hero — no media, one meta row',
        thumb: 'statement',
      },
      {
        id: 'banner',
        label: 'Banner',
        hint: 'One short row: eyebrow, headline, inline CTA',
        thumb: 'banner',
      },
      {
        id: 'poster',
        label: 'Poster',
        hint: 'A framed plate with the copy set beneath it',
        thumb: 'poster',
      },
    ],
    defaultVariant: 'stage',
    defaultProps: {
      eyebrow: 'Your eyebrow',
      headline: 'A headline that names the promise',
      accent: '',
      sub: 'A sub-line that expands on it in a sentence or two.',
      felt: '',
      button: 'Get started',
      quiet: '',
      trust: '',
      bg: 'ember',
    },
  },
  {
    type: 'introVideo',
    label: 'Intro video',
    summary: 'A short sell/intro video that sets the tone.',
    icon: '▷',
    keywords: ['intro', 'video', 'trailer', 'preview', 'media', 'sell', 'film'],
    variants: [
      {
        id: 'theatre',
        label: 'Theatre',
        hint: 'Framed player with corner brackets and a meta row',
        thumb: 'frame',
      },
      {
        id: 'plain',
        label: 'Plain',
        hint: 'Bare player with a caption line',
        thumb: 'media',
      },
      {
        id: 'split',
        label: 'Split',
        hint: 'Copy column beside the player',
        thumb: 'split',
      },
      {
        id: 'bleed',
        label: 'Bleed',
        hint: 'Player edge to edge — no frame, no brackets',
        thumb: 'bleed',
      },
      {
        id: 'card',
        label: 'Card',
        hint: 'Player in a panel with stacked title and duration rows',
        thumb: 'card',
      },
    ],
    defaultVariant: 'theatre',
    defaultProps: {
      kicker: 'The film',
      heading: 'Meet the work',
      sub: 'A short introduction in their own words.',
      clip: 'Intro film',
      duration: '1:00',
    },
  },
  {
    type: 'ache',
    label: 'The ache',
    summary: 'Name the problem or longing the journey speaks to.',
    icon: '◍',
    keywords: [
      'ache',
      'problem',
      'pain',
      'longing',
      'why',
      'struggle',
      'prose',
      'text',
    ],
    variants: [
      {
        id: 'column',
        label: 'Column',
        hint: 'Kicker, heading and body in one measure',
        thumb: 'center',
      },
      {
        id: 'statement',
        label: 'Statement',
        hint: 'An oversized heading carries the section',
        thumb: 'statement',
      },
      {
        id: 'paired',
        label: 'Paired',
        hint: 'Heading in one column, body in the other',
        thumb: 'twocol',
      },
      {
        id: 'list',
        label: 'List',
        hint: 'Three to five named pains, each its own row',
        thumb: 'rows',
      },
      {
        id: 'quote',
        label: 'Quote',
        hint: 'The ache in the reader’s own voice, as a pull-quote',
        thumb: 'quote',
      },
      {
        id: 'checklist',
        label: 'Checklist',
        hint: '“This is you if…” as ticked rows',
        thumb: 'checklist',
      },
    ],
    defaultVariant: 'column',
    defaultProps: {
      kicker: 'If this is you',
      heading: 'Name the ache.',
      body: 'Describe the problem or longing this journey speaks to — in their words, not yours.',
    },
  },
  {
    type: 'turn',
    label: 'The turn',
    summary: 'The shift on offer — from where they are to where they could be.',
    icon: '↺',
    keywords: [
      'turn',
      'shift',
      'change',
      'promise',
      'transformation',
      'prose',
      'text',
    ],
    variants: [
      {
        id: 'statement',
        label: 'Statement',
        hint: 'The pivot as one oversized line',
        thumb: 'statement',
      },
      {
        id: 'column',
        label: 'Column',
        hint: 'Kicker, heading and body in one measure',
        thumb: 'center',
      },
      {
        id: 'paired',
        label: 'Paired',
        hint: 'Statement one side, lede the other',
        thumb: 'twocol',
      },
      {
        id: 'arc',
        label: 'Arc',
        hint: 'The stages as a roman-numeralled list',
        thumb: 'spine',
      },
      {
        id: 'before-after',
        label: 'Before / after',
        hint: 'Two panels: from, and to',
        thumb: 'beforeafter',
      },
      {
        id: 'numbered',
        label: 'Numbered',
        hint: 'The promise as three numbered beats',
        thumb: 'numbered',
      },
    ],
    defaultVariant: 'statement',
    defaultProps: {
      kicker: 'What changes',
      heading: 'The shift on offer.',
      body: 'Not insight — practice. Name the change this journey makes possible.',
    },
  },
  {
    type: 'reel',
    label: 'Reel',
    summary: 'A montage of moments / practices from inside the journey.',
    icon: '▤',
    keywords: ['reel', 'montage', 'gallery', 'highlights', 'moments', 'video'],
    variants: [
      {
        id: 'theatre',
        label: 'Theatre',
        hint: 'Framed clip with transport and meta',
        thumb: 'frame',
      },
      {
        id: 'plain',
        label: 'Plain',
        hint: 'Clip with a caption only',
        thumb: 'media',
      },
      {
        id: 'split',
        label: 'Split',
        hint: 'Copy beside the clip',
        thumb: 'split',
      },
      {
        id: 'strip',
        label: 'Strip',
        hint: 'A row of clip thumbnails; one plays inline',
        thumb: 'grid',
        // DESCOPED per contract A27, and `ReelSection.svelte`'s header carries
        // the original reasoning: it needs 3-5 clips against a single
        // `previewVideoMediaId`, an array-cardinality problem rather than a
        // missing slot. Migration 0086 added `courses.hero_media_id` and
        // `courses.signature_media_id`, both scalar `uuid`, so the clip count
        // available here is still exactly one. A synthetic gradient plate
        // standing in for the absent clips is specifically NOT the answer —
        // A27 names that as the mistake `hero.split` already makes.
        //
        // THE BLOCKER IS NOT A COLUMN, AND IT IS NOT CARDINALITY — TRACED, and
        // recorded here because "an array-cardinality problem" has twice been
        // read as "this needs a schema decision: a join table, or a jsonb
        // column". It needs NEITHER, and that is worth knowing before anyone
        // scopes a migration for it.
        //
        // `props` is ALREADY the jsonb column, and it already round-trips an
        // array with the type intact (`pageSectionSchema.props` is a passthrough
        // record under a 16KB byte cap). So STORING `clips: string[]` is free.
        // What cannot be done is RESOLVING one. A media id becomes a playable
        // URL in exactly one place — `CourseJourneyService.getCourseSellPreview`
        // — which SELECTs six FIXED scalar `courses` columns and projects seven
        // NAMED slots (`intro`, `reel`, `heroClip`, …). Its two inputs are a
        // `media_items.hlsPreviewKey` row and `R2_PUBLIC_URL_BASE`, worker env
        // handed in by the route; neither is reachable from a section's props,
        // and the route is keyed on `:courseId` alone. Every playable media in
        // all eleven sections therefore arrives as `sellPreview.<named slot>`,
        // never out of `props` — which is what `section-fields.ts`'s `mediaSlot`
        // comment means by "a picker that wrote into `props` could never affect
        // what renders", the decorative-control defect Codex-eqh0z fixed.
        //
        // So the work is a PROJECTION, not a migration: `CourseSellPreview` and
        // its `render/types.ts` mirror need a shape that can carry N clips
        // resolved from the page's own sections, and `getCourseSellPreview` needs
        // the page (it is given only a course id today). Three packages, no DDL.
        //
        // AND WHOEVER BUILDS IT MUST CARRY THE ORG SCOPE ACROSS. Media ids are
        // scoped by `assertMediaItemsInOrg`, whose own comment claims it "cannot
        // be bypassed — the panel, the section inspector and any future picker
        // all funnel through this one write". Props do NOT funnel through it:
        // `saveJourneyPage` writes `sections` straight through and never calls
        // it. Ids held in `props` are an unscoped media reference, so the
        // resolver — not the editor — has to re-check ownership.
        unavailable:
          'Not built yet — needs three to five clips, and a journey supplies one',
      },
      {
        id: 'waveform',
        label: 'Waveform',
        hint: 'Audio-first — the equaliser and playhead are the section',
        thumb: 'waveform',
      },
    ],
    defaultVariant: 'theatre',
    defaultProps: {
      kicker: 'In motion',
      heading: 'See it in motion',
      sub: 'A real practice, unhurried — exactly as you would meet it.',
      clip: 'Practice preview',
      duration: '0:30',
    },
  },
  {
    type: 'map',
    label: 'The map',
    summary: 'The descent map — the journey stages laid out (no progress).',
    icon: '⊞',
    keywords: ['map', 'stages', 'curriculum', 'path', 'descent', 'outline'],
    variants: [
      {
        id: 'spine',
        label: 'Descent spine',
        hint: 'Vertical spine with gate nodes and practice cards',
        thumb: 'spine',
      },
      {
        id: 'rows',
        label: 'Rows',
        hint: 'Compact one-line stage rows',
        thumb: 'rows',
      },
      {
        id: 'cards',
        label: 'Stage cards',
        hint: 'A card per stage in an auto-fit grid',
        thumb: 'grid',
      },
      {
        id: 'table',
        label: 'Table',
        hint: 'Stage, lessons, minutes, access — for buyers who scan',
        thumb: 'table',
      },
      {
        id: 'timeline',
        label: 'Timeline',
        hint: 'A horizontal scroll track, one panel per stage',
        thumb: 'timeline',
      },
      {
        id: 'numbered-prose',
        label: 'Numbered prose',
        hint: 'Stages as numbered paragraphs, no chrome at all',
        thumb: 'numbered',
      },
    ],
    defaultVariant: 'spine',
    defaultProps: {
      eyebrow: 'The whole path',
      heading: "Everything you'll walk.",
      sub: 'Gated depths with a pool of practices in each — settle one ground before the next opens.',
      note: 'One door is already ajar.',
    },
  },
  {
    type: 'feel',
    label: 'How it feels',
    summary: 'The felt-sense of the work — and the free-taste door.',
    icon: '≈',
    keywords: [
      'feel',
      'taste',
      'free',
      'sample',
      'experience',
      'sense',
      'prose',
    ],
    variants: [
      {
        id: 'paired',
        label: 'Paired',
        hint: 'Feeling copy one side, what’s inside the other',
        thumb: 'twocol',
      },
      {
        id: 'column',
        label: 'Column',
        hint: 'Feeling copy, then what’s inside, in one measure',
        thumb: 'center',
      },
      {
        id: 'statement',
        label: 'Statement',
        hint: 'An oversized feeling line; inclusions run on quietly',
        thumb: 'statement',
      },
      {
        id: 'grid',
        label: 'Grid',
        hint: 'What’s inside as an even card grid',
        thumb: 'grid',
      },
      {
        id: 'ledger',
        label: 'Ledger',
        hint: 'What’s inside as a hairline-ruled label and detail list',
        thumb: 'rows',
      },
      {
        id: 'stack',
        label: 'Stack',
        hint: 'Alternating full-width bands, one per inclusion',
        thumb: 'stack',
      },
    ],
    defaultVariant: 'paired',
    defaultProps: {
      kicker: 'What to expect',
      heading: 'How it feels.',
      body: 'No performance, no getting it right. Just you, a quiet room, and a pace the body sets.',
    },
  },
  {
    type: 'proof',
    label: 'Proof',
    summary: 'Testimonials and social proof from past members.',
    icon: '❝',
    keywords: ['proof', 'testimonial', 'reviews', 'quotes', 'social proof'],
    variants: [
      {
        id: 'grid',
        label: 'Card grid',
        hint: 'Three-up auto-fit cards',
        thumb: 'grid',
      },
      {
        id: 'stack',
        label: 'Stacked',
        hint: 'One column, full measure',
        thumb: 'stack',
      },
      {
        id: 'spotlight',
        label: 'Spotlight',
        hint: 'One quote at large scale',
        thumb: 'center',
      },
      {
        id: 'wall',
        label: 'Wall',
        hint: 'Dense masonry of many short quotes',
        thumb: 'boxes',
      },
      {
        id: 'marquee',
        label: 'Marquee',
        hint: 'A continuously scrolling quote ticker',
        thumb: 'banner',
      },
      {
        id: 'pull',
        label: 'Pull-quote',
        hint: 'One quote set editorially in the measure, no card',
        thumb: 'quote',
      },
    ],
    defaultVariant: 'grid',
    defaultProps: {
      eyebrow: 'From the circle',
      heading: 'What people say.',
      q1: 'A short, specific testimonial in their words.',
      n1: 'First L.',
      c1: 'member',
      q2: 'Another testimonial that speaks to a different fear.',
      n2: 'Second L.',
      c2: 'new member',
      q3: 'A third that names a concrete result.',
      n3: 'Third L.',
      c3: 'months in',
      trust: '2,400 and counting',
    },
  },
  {
    type: 'guide',
    label: 'Your guide',
    summary: 'The guide bio, portrait and guide video.',
    // Was '☺' U+263A — the one catalogue glyph Unicode classes as emoji-capable,
    // so Apple platforms drew it in colour. U+25C9 carries no emoji presentation.
    icon: '◉',
    keywords: ['guide', 'teacher', 'about', 'bio', 'host', 'facilitator'],
    variants: [
      {
        id: 'portrait',
        label: 'Portrait',
        hint: 'Portrait plate beside the bio',
        thumb: 'split',
      },
      {
        id: 'column',
        label: 'Column',
        hint: 'Bio only, no media',
        thumb: 'center',
      },
      {
        id: 'quote',
        label: 'Quote-led',
        hint: 'A big pull-quote leads; bio and attribution beneath',
        thumb: 'quote',
      },
      {
        id: 'credentials',
        label: 'Credentials',
        hint: 'Portrait plus a hairline-ruled fact list',
        thumb: 'rows',
      },
      {
        id: 'letter',
        label: 'Letter',
        hint: 'A signed personal letter — signature, no portrait frame',
        thumb: 'left',
      },
    ],
    defaultVariant: 'portrait',
    defaultProps: {
      role: 'Your guide',
      heading: 'Who holds this',
      body: 'A short bio that establishes credibility and warmth.',
      quote: '',
      clip: 'Meet your guide',
      duration: '2:00',
    },
  },
  {
    type: 'faq',
    label: 'FAQ',
    summary: 'Common questions, answered.',
    icon: '?',
    keywords: ['faq', 'questions', 'answers', 'help', 'objections'],
    variants: [
      {
        id: 'accordion',
        label: 'Accordion',
        hint: 'Click to expand, one at a time',
        thumb: 'accordion',
      },
      {
        id: 'open',
        label: 'All open',
        hint: 'Every answer shown',
        thumb: 'rows',
      },
      {
        id: 'boxed',
        label: 'Boxed',
        hint: 'Each entry in its own panel',
        thumb: 'boxes',
      },
      {
        id: 'paired',
        label: 'Paired',
        hint: 'Two-column question and answer rows, hairline-ruled',
        thumb: 'twocol',
      },
      {
        id: 'grouped',
        label: 'Grouped',
        hint: 'Categorised accordions with a heading per cluster',
        thumb: 'stack',
      },
    ],
    defaultVariant: 'accordion',
    defaultProps: {
      heading: 'The honest answers',
      q1: 'A common question?',
      a1: 'A clear, reassuring answer.',
      q2: 'Another question?',
      a2: 'Another answer.',
      q3: 'One more?',
      a3: 'One more answer.',
    },
  },
  {
    type: 'invite',
    label: 'The invite',
    summary: 'The offer and pricing — the primary conversion moment.',
    icon: '✦',
    keywords: ['invite', 'offer', 'pricing', 'join', 'buy', 'checkout', 'cta'],
    // EVERY invite composition takes its prices from `JourneySalesContext.offer`
    // and NOTHING else, and must degrade to a price-less CTA when `offer` is null
    // (the read is `.catch()`-guarded because the page is SEO-critical). No
    // composition may reintroduce an authored price string — that is what let a
    // page advertise £12 a month for a £15 tier, and it is why there is no
    // `price` field or seed value below. Currency is GBP (£).
    variants: [
      {
        id: 'pool',
        label: 'Descent close',
        hint: 'The cinematic close: ember pool, one path, atmosphere',
        thumb: 'center',
      },
      {
        id: 'banner',
        label: 'Banner',
        hint: 'A compact horizontal offer strip',
        thumb: 'banner',
      },
      {
        id: 'card',
        label: 'Card',
        hint: 'One quiet card, no atmosphere',
        thumb: 'card',
      },
      {
        id: 'tiers',
        label: 'Tiers',
        hint: 'Two or three plan columns with a recommended flag',
        thumb: 'grid',
      },
      {
        id: 'table',
        label: 'Comparison table',
        hint: 'A feature matrix across the available paths',
        thumb: 'table',
      },
      {
        id: 'sticky',
        label: 'Sticky bar',
        hint: 'A persistent bottom bar plus a short in-flow section',
        thumb: 'stack',
      },
    ],
    defaultVariant: 'pool',
    defaultProps: {
      eyebrow: 'Begin',
      heading: 'The ground',
      accent: 'is waiting.',
      sub: 'One key opens everything that grows from here.',
      button: 'Get started',
      risk: 'Start free · cancel anytime',
    },
  },
];

// ── The variant collapse ────────────────────────────────────────────────────

/**
 * Where one retired variant id goes, and the axes it used to encode.
 *
 * @see LEGACY_SECTION_VARIANTS
 */
export interface LegacySectionVariant {
  /** The declared composition that replaces the retired id. */
  readonly variant: string;
  /**
   * The axis values the retired id encoded in its CSS. Empty for a pure rename.
   * Applied BELOW the section's own `design` and ABOVE the page's, so a stored
   * page keeps its appearance without overwriting a creator's explicit choice.
   */
  readonly design: SectionDesign;
}

/**
 * The FORWARD MAP for every variant id this catalogue used to declare and no
 * longer does — the other half of the collapse (research §3).
 *
 * A retired id was one of two things:
 *
 *  - a RENAME (`map: descent` → `spine`), where the composition survives under a
 *    clearer name and no axis is involved; or
 *  - an AXIS VALUE WEARING A COMPOSITION NAME (`hero: minimal`, `prose: wide`),
 *    where the composition merges into a sibling and the difference becomes axis
 *    values on that section.
 *
 * Both must be expressible, because a published page stores the old id and MUST
 * NOT change appearance. Three things consume this map, and all three are needed:
 *
 *  1. `resolveVariant` — a stored old id still resolves to the right COMPOSITION,
 *     so a row the migration missed (or an older client) renders correctly rather
 *     than silently dropping to the type's default.
 *  2. `resolveDesign` — the axes the old id encoded are resolved for that section,
 *     so `minimal` is still compact and glow-less.
 *  3. The drizzle migration `0085_journey_section_variant_collapse` — rewrites the
 *     stored jsonb so the value is EXPLICIT: inspectable in the builder, editable
 *     by the creator, and diffable. (1) and (2) are the safety net; the migration
 *     is the actual fix.
 *
 * WHY THE MEASURE VALUES LOOK ODD: the retired `wide` prose variant capped its
 * inner column at 62rem and its body at 66ch, and the `width` axis' `text` value
 * is 64rem / `--measure-lede` (64ch) — so `wide` maps forward to `width: 'text'`,
 * not to `width: 'wide'` (80rem / 78ch), which would be visibly wider than what
 * the page renders today. Likewise `centered` was 46rem / 52ch, closest to
 * `narrow` (48rem / 46ch). The names collide; the measurements do not.
 */
export const LEGACY_SECTION_VARIANTS: Readonly<
  Record<string, Readonly<Record<string, LegacySectionVariant>>>
> = {
  hero: {
    // `centered` and `left` were the SAME arrangement at two alignments; the base
    // `.jp-hero` centred and `.jp-hero--left` set `text-align: left` and
    // `justify-items: start`, which is exactly `align`.
    centered: { variant: 'stage', design: { align: 'center' } },
    left: { variant: 'stage', design: { align: 'start' } },
    // `minimal` was a PRESET: shorter min-height (density), the glow dimmed to
    // 0.32 (accent), motes + scroll cue hidden (motion) — research §3's worked
    // example. Note `accent: 'none'` removes the glow rather than dimming it:
    // there is no "dimmed glow" axis value, and none was worth inventing for one
    // retired id. The GLOW is the one place the collapse stays an approximation,
    // and it is recorded here rather than left to be discovered.
    minimal: {
      variant: 'stage',
      // `type: 'expressive'` is here because the WT-3 pilot found a SECOND
      // difference this map originally missed: `.jp-hero--minimal` also shrank the
      // headline by ~23% (`clamp(1.8rem, 6.6cqw, 3.6rem)` against the base
      // `clamp(2rem, 8.4cqw, 4.7rem)`). Without it a page storing `minimal` would
      // render a MONUMENTAL headline where it rendered a small one — the exact
      // silent appearance change this whole map exists to prevent. Latent today
      // (no page stores `minimal`), which is why it was invisible.
      design: {
        density: 'compact',
        accent: 'none',
        motion: 'none',
        type: 'expressive',
      },
    },
    split: { variant: 'split-media', design: {} },
  },
  introVideo: {
    cinema: { variant: 'theatre', design: {} },
    simple: { variant: 'plain', design: {} },
  },
  ache: {
    centered: {
      variant: 'column',
      design: { align: 'center', width: 'narrow' },
    },
    wide: { variant: 'column', design: { align: 'start', width: 'text' } },
    twocol: { variant: 'paired', design: {} },
  },
  turn: {
    centered: {
      variant: 'column',
      design: { align: 'center', width: 'narrow' },
    },
    wide: { variant: 'column', design: { align: 'start', width: 'text' } },
    twocol: { variant: 'paired', design: {} },
  },
  reel: {
    cinema: { variant: 'theatre', design: {} },
    simple: { variant: 'plain', design: {} },
  },
  map: {
    descent: { variant: 'spine', design: {} },
    list: { variant: 'rows', design: {} },
    grid: { variant: 'cards', design: {} },
  },
  feel: {
    centered: {
      variant: 'column',
      design: { align: 'center', width: 'narrow' },
    },
    wide: { variant: 'column', design: { align: 'start', width: 'text' } },
    twocol: { variant: 'paired', design: {} },
  },
  guide: {
    // `.jp-guide--centered` hid the player, collapsed to one column, centred the
    // text and capped at 46rem — the no-media arrangement is `column`, the rest
    // is `align` + `width`.
    centered: {
      variant: 'column',
      design: { align: 'center', width: 'narrow' },
    },
  },
  invite: {
    descent: { variant: 'pool', design: {} },
  },
};

/**
 * The forward map for a stored variant id, or null when the id is current,
 * unknown, or the type declares no retirements. Total — never throws.
 */
export function legacySectionVariant(
  type: string | undefined,
  variant: string | undefined | null
): LegacySectionVariant | null {
  if (!type || !variant) return null;
  return LEGACY_SECTION_VARIANTS[type]?.[variant] ?? null;
}

/**
 * Migrate ONE section off a retired variant id, in memory — the pure sibling of
 * the `0085` migration, for a draft the builder loads before its row was
 * rewritten (or a draft held only in the client).
 *
 * NON-DESTRUCTIVE by design: an axis the section already states wins over the
 * retired id's value. Overwriting would mean a creator who deliberately set
 * `align: start` on a `centered` section loses that choice to a data migration,
 * and a creator's stored design opinions are their content.
 *
 * IDEMPOTENT: a section already on a current id is returned UNCHANGED (the same
 * object reference), so this is safe to run on every load and safe to run twice.
 */
export function migrateSectionVariant<
  S extends { type?: string; variant?: string; design?: SectionDesign },
>(section: S): S {
  const legacy = legacySectionVariant(section.type, section.variant);
  if (!legacy) return section;
  const design = { ...legacy.design, ...(section.design ?? {}) };
  const next: S = { ...section, variant: legacy.variant };
  if (Object.keys(design).length > 0) next.design = design;
  return next;
}

/**
 * {@link migrateSectionVariant} across a whole section list. Returns the SAME
 * array reference when nothing needed migrating, so a caller can cheaply tell
 * whether a draft is dirty.
 */
export function migrateSectionVariants<
  S extends { type?: string; variant?: string; design?: SectionDesign },
>(sections: readonly S[]): readonly S[] {
  let changed = false;
  const next = sections.map((section) => {
    const migrated = migrateSectionVariant(section);
    if (migrated !== section) changed = true;
    return migrated;
  });
  return changed ? next : sections;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/** Every section definition, in template ship order. */
export function listSectionDefinitions(): readonly SectionDefinition[] {
  return SECTION_CATALOG;
}

/**
 * The definition for a section type, or null when the type is not in this
 * template's catalogue (a widened/unknown {@link PageSection.type}).
 */
export function findSectionDefinition(type: string): SectionDefinition | null {
  return SECTION_CATALOG.find((def) => def.type === type) ?? null;
}

/** Section types in template ship order (the default arrangement). */
export function defaultSectionOrder(): readonly CourseSectionType[] {
  return SECTION_CATALOG.map((def) => def.type);
}

/** The variants a section type offers (empty for an unknown type). */
export function variantsForType(type: string): readonly SectionVariant[] {
  return findSectionDefinition(type)?.variants ?? [];
}

/**
 * The composition a section renders in: its own `variant` when set and valid,
 * else the composition a RETIRED id maps forward to, else the type's
 * `defaultVariant`, else the first offered variant, else `''`.
 * Keeps the renderer forward-compatible with an unknown stored variant.
 *
 * The retirement step is what makes the variant collapse safe to land ahead of
 * the data migration: five of the six seeded pages store `hero: split`, and the
 * golden page stores six retired ids between them. Without this lookup every one
 * of them would fall through to the type's DEFAULT composition — a silent
 * appearance change on published pages, in the window between this commit and
 * the migration running on a given environment. The axis half of the same
 * collapse is applied by {@link resolveDesign}.
 */
export function resolveVariant(
  section: Pick<PageSection, 'type' | 'variant'>
): string {
  const def = findSectionDefinition(section.type);
  if (!def) return section.variant ?? '';
  if (section.variant && def.variants.some((v) => v.id === section.variant)) {
    return section.variant;
  }
  const legacy = legacySectionVariant(section.type, section.variant);
  if (legacy) return legacy.variant;
  return def.defaultVariant || def.variants[0]?.id || '';
}

// ── Design axes ──────────────────────────────────────────────────────────────
//
// The DESIGN-LANGUAGE layer, orthogonal to the variant layer above (see
// `docs/design/journey-sections/02-axis-contract.md`). A variant says WHICH boxes
// a section draws; an axis says HOW — how wide, how dense, how loud. They compose,
// so nine axes multiply every composition of every type rather than adding to the
// variant namespace.
//
// Lives here, next to `resolveVariant`, for the same reason: `$lib/page-builder`
// is the CE-4-scanned PUBLIC_LIB_ROOT, so this must stay pure, framework-free and
// DOM-free. `SECTION_DESIGN_VALUES` and `SECTION_DESIGN_DEFAULTS` are exported so
// the renderer, the builder's design panel and the tests all read ONE source of
// truth for the enums — a second hand-written list is how an axis value ends up
// selectable in the editor and unstyled on the page.

/**
 * The nine axes, in the order the renderer emits their `data-jp-*` attributes.
 * Attribute order is cosmetic; a stable order keeps the served HTML diffable.
 */
export const SECTION_DESIGN_AXES = [
  'width',
  'density',
  'surface',
  'edge',
  'align',
  'type',
  'accent',
  'motion',
  'media',
] as const;

/** One axis name. */
export type SectionDesignAxis = (typeof SECTION_DESIGN_AXES)[number];

/**
 * Every legal value per axis (research §2.2) — the closed enum made available at
 * RUNTIME, which is what lets {@link resolveDesign} drop an unknown stored value
 * instead of forwarding it into an attribute that matches no CSS rule.
 */
export const SECTION_DESIGN_VALUES: {
  readonly [A in SectionDesignAxis]: readonly NonNullable<SectionDesign[A]>[];
} = {
  width: ['narrow', 'text', 'wide', 'full'],
  density: ['compact', 'regular', 'airy', 'vast'],
  surface: ['bare', 'tint', 'panel', 'invert', 'media'],
  edge: ['none', 'hairline', 'soft', 'heavy', 'offset'],
  align: ['start', 'center'],
  type: ['restrained', 'balanced', 'expressive', 'monumental'],
  accent: ['text', 'fill', 'edge', 'glow', 'none'],
  motion: ['none', 'fade', 'rise', 'stagger', 'drift'],
  media: ['bleed', 'frame', 'mask', 'inset', 'none'],
};

/**
 * The axis DEFAULTS (research §2.2) — what a section renders as when neither it
 * nor its page states an opinion.
 *
 * These describe a SENSIBLE NEUTRAL page, deliberately NOT today's cinematic
 * look: a creator with no design opinion should not inherit a niche aesthetic.
 * That makes the Candlelit backfill in F-B's migration load-bearing — every
 * PRE-EXISTING page is written an explicit Candlelit bundle in the same step that
 * adds the column, so these defaults only ever apply to pages created afterwards
 * (amendment A3).
 */
export const SECTION_DESIGN_DEFAULTS: ResolvedSectionDesign = {
  width: 'text',
  density: 'regular',
  surface: 'bare',
  edge: 'hairline',
  align: 'center',
  type: 'balanced',
  accent: 'fill',
  motion: 'rise',
  media: 'frame',
};

/** Anything that can carry design opinions: a section, or a page draft. */
type DesignSource = { design?: SectionDesign } | null | undefined;

/**
 * Resolve ONE axis: the first source that names a LEGAL value wins; an unknown
 * value is skipped as if unset (never forwarded, never an error), and the axis
 * default is the floor.
 */
function resolveAxis<A extends SectionDesignAxis>(
  axis: A,
  sources: readonly DesignSource[]
): NonNullable<SectionDesign[A]> {
  const legal: readonly unknown[] = SECTION_DESIGN_VALUES[axis];
  for (const source of sources) {
    const value = source?.design?.[axis];
    if (value !== undefined && legal.includes(value)) {
      return value as NonNullable<SectionDesign[A]>;
    }
  }
  return SECTION_DESIGN_DEFAULTS[axis];
}

/**
 * The design language a section renders in — the axis sibling of
 * {@link resolveVariant}.
 *
 * Resolution is PER AXIS, first hit wins: `section.design[axis]` →
 * `page.design[axis]` → the axis default. Per-axis (rather than
 * all-or-nothing) inheritance is the point — a real page wants a `vast` hero
 * above a `compact` FAQ, and that is good design, not incoherence.
 *
 * ALWAYS TOTAL: every axis is present in the result, because the renderer emits
 * one attribute per axis and an unset value would emit an empty attribute.
 * Unknown/garbage values fall back to the default rather than being passed
 * through, which is what keeps a future client's new axis value from rendering
 * as an unstyled no-op that looks like a broken control.
 *
 * THE RETIRED-VARIANT SOURCE sits between the two, and the position is the whole
 * point (see {@link LEGACY_SECTION_VARIANTS}). A section still storing
 * `hero: minimal` must render compact and glow-less even on a page whose own
 * bundle says `density: airy` — that is what "the migration does not change a
 * published page" means. But it must NOT beat an axis the creator set on that
 * section, so it loses to `section.design`. Hence: section → retired variant →
 * page → default.
 *
 * @param section the section instance, or null to resolve the page's own look
 * @param page the page draft carrying the page-level defaults (`coursePage.page`)
 */
export function resolveDesign(
  section:
    | (Pick<PageSection, 'design'> &
        Partial<Pick<PageSection, 'type' | 'variant'>>)
    | null
    | undefined,
  page?: DesignSource
): ResolvedSectionDesign {
  const legacy = legacySectionVariant(section?.type, section?.variant);
  const sources: readonly DesignSource[] = [section, legacy, page];
  return {
    width: resolveAxis('width', sources),
    density: resolveAxis('density', sources),
    surface: resolveAxis('surface', sources),
    edge: resolveAxis('edge', sources),
    align: resolveAxis('align', sources),
    type: resolveAxis('type', sources),
    accent: resolveAxis('accent', sources),
    motion: resolveAxis('motion', sources),
    media: resolveAxis('media', sources),
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Does a section match the search query? An empty/whitespace query matches every
 * section (search inactive). Matches the label or any keyword — substring,
 * case-insensitive. Mirrors `rail-model.ts` `controlMatchesQuery`.
 */
export function sectionMatchesQuery(
  def: SectionDefinition,
  query: string
): boolean {
  const q = normalise(query);
  if (q === '') return true;
  const haystack = [def.label, ...def.keywords].map(normalise);
  return haystack.some((entry) => entry.includes(q));
}

/**
 * The first section (in ship order) matching a non-empty query — the jump target
 * for the add-picker. Returns null when the query is empty or nothing matches.
 */
export function firstSectionMatch(query: string): SectionDefinition | null {
  if (normalise(query) === '') return null;
  return SECTION_CATALOG.find((def) => sectionMatchesQuery(def, query)) ?? null;
}

// ── Section factory ───────────────────────────────────────────────────────────

/**
 * Build one {@link PageSection} of `type`, seeded with the catalogue's default
 * variant + a clone of its default copy so the section renders populated the
 * moment it is added (the prototype's `DEFAULTS` behaviour). An unknown type
 * yields an empty, variant-less section (the renderer skips it).
 *
 * AND WITH A RHYTHM. A new section also arrives carrying the house per-type axis
 * bag from {@link SECTION_DESIGN_BY_TYPE} — every axis where that type's rhythm
 * differs from what the section would otherwise inherit, and nothing else. That
 * is the whole of the fix for a page whose every section emitted byte-identical
 * axis values; see `section-design-defaults.ts` for the measurement and the
 * reasoning. It is a DEFAULT the creator can clear per axis in the inspector,
 * never a lock — and no stored page is touched, because this runs at creation.
 *
 * `pageDesign` is the page's own look (`pending.design`), and passing it is what
 * keeps the stored bag HONEST: an axis whose rhythm value equals the inherited
 * value is dropped, so the inspector's "Inherited" pill still tells the truth.
 * Omit it only where there is no page context (an unknown type, or a caller
 * building a section outside a draft).
 */
export function createSection(
  type: string,
  makeId: () => string = () => crypto.randomUUID(),
  pageDesign?: SectionDesign | null
): PageSection {
  const def = findSectionDefinition(type);
  const section: PageSection = {
    id: makeId(),
    type,
    enabled: true,
    variant: def?.defaultVariant,
    name: def?.label,
    props: def ? structuredClone(def.defaultProps) : {},
  };
  // The baseline is the RESOLVED look — page bag, then any retired-variant axes,
  // then the axis defaults — computed by the one resolver the renderer uses, so
  // "redundant" here means exactly what "Inherited" means in the inspector.
  const inherited = resolveDesign(
    { type, variant: section.variant },
    { design: pageDesign ?? undefined }
  );
  const design = sectionDesignForType(type, inherited);
  // Assigned only when non-empty: absence is how "inherited" is represented, and
  // a `design: {}` would round-trip through the save as a key that says nothing.
  if (design) section.design = design;
  return section;
}

/**
 * Build the default set of enabled {@link PageSection}s for a new course page
 * (SPEC §4.1 — "the course template ships a default set"). Sections are in
 * template ship order, enabled, seeded with each type's default variant + copy
 * so a brand-new page renders populated rather than blank.
 *
 * `makeId` is injectable so tests get deterministic ids; it defaults to
 * `crypto.randomUUID` (available in the SvelteKit + Node runtimes).
 *
 * `pageDesign` is forwarded to {@link createSection}, so a default set arrives
 * with the house rhythm already on it — which is the amendment-A21 requirement
 * that page creation write an EXPLICIT design rather than relying on implicit
 * axis defaults, satisfied per section instead of once per page.
 */
export function createDefaultSections(
  makeId: () => string = () => crypto.randomUUID(),
  pageDesign?: SectionDesign | null
): PageSection[] {
  return SECTION_CATALOG.map((def) =>
    createSection(def.type, makeId, pageDesign)
  );
}

// ── Unauthored (seed) copy detection ─────────────────────────────────────────

/** One section still holding catalogue seed copy, and which keys. */
export interface SeededSection {
  readonly id: string;
  readonly type: string;
  /** The catalogue label, for a message a creator can act on ("Proof, FAQ"). */
  readonly label: string;
  /** The prop keys whose value is still the catalogue's, in declaration order. */
  readonly keys: readonly string[];
}

/**
 * The sections of a draft that still hold the CATALOGUE'S OWN COPY, verbatim
 * (Codex-maf0y).
 *
 * THE LEAK. `addSection(type)` seeds every new section from
 * `def.defaultProps` — "A headline that names the promise", "A common question?",
 * "First L.", "2,400 and counting" — and Save persists it. Nothing anywhere
 * compares a section's props back against that seed, so a creator who adds a
 * Proof section, never opens it, and publishes ships three invented testimonials
 * and an invented "2,400 and counting" to a public sales page. That last one is
 * not merely unpolished: it is a specific factual claim about the creator's
 * business that the creator never made.
 *
 * WHY THIS AND NOT EMPTY DEFAULTS. Seeding nothing was considered and rejected in
 * the bead: an empty block is near-invisible in the inline canvas, so a creator
 * cannot see the section they just added, let alone click into it. The seed copy
 * is good AUTHORING SCAFFOLDING and a bad PUBLISH payload — so the seed stays and
 * the check moves to publish time.
 *
 * PURE, AND ADVISORY. It returns data; it decides nothing. The publish path turns
 * this into ONE confirm naming the sections and proceeds on accept — a
 * non-blocking warning, never a block, because "this copy is identical to the
 * catalogue's" is a strong hint and not a certainty (a creator may legitimately
 * want "Who holds this" as their guide heading).
 *
 * WHAT COUNTS, precisely:
 *  - only keys the type's `defaultProps` actually seeds — an authored key the
 *    catalogue knows nothing about is never suspect;
 *  - only NON-EMPTY STRING seeds. `hero.accent`, `hero.quiet`, `hero.trust` and
 *    `guide.quote` seed `''`; a section left at `''` has had nothing put in its
 *    mouth, so it is not a placeholder leak. This is why the check is not simply
 *    "props equals defaultProps".
 *  - a strict `===` against the seed. One character of editing clears the key.
 *
 * An unknown/widened section type reports nothing: there is no catalogue seed to
 * have leaked.
 */
export function seededSections(
  sections: readonly Pick<PageSection, 'id' | 'type' | 'props'>[]
): readonly SeededSection[] {
  const found: SeededSection[] = [];
  for (const section of sections) {
    const def = findSectionDefinition(section.type);
    if (!def) continue;
    const keys = Object.keys(def.defaultProps).filter((key) => {
      const seed = def.defaultProps[key];
      if (typeof seed !== 'string' || seed.trim() === '') return false;
      return section.props?.[key] === seed;
    });
    if (keys.length > 0) {
      found.push({
        id: section.id,
        type: section.type,
        label: def.label,
        keys,
      });
    }
  }
  return found;
}
