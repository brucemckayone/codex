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
 * The variant sets + seed copy are ported from the finished prototype
 * (`docs/design/course-journeys/prototype/builder.html`), mapped onto the app's
 * more granular semantic types (the prototype's one `prose` renderer backs
 * `ache`/`turn`/`feel`; `curriculum`→`map`; `film`→`introVideo`; `invitation`→`invite`).
 */
import type {
  CourseSectionType,
  PageSection,
  SectionProps,
} from '@codex/shared-types';

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
}

// ── Section definition ───────────────────────────────────────────────────────

export interface SectionDefinition {
  readonly type: CourseSectionType;
  readonly label: string;
  /** One-line description shown in the add-section picker. */
  readonly summary: string;
  /** Advisory glyph for the rail header (WP-5 rebinds to a DS icon). */
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

// ── Reusable variant sets ──────────────────────────────────────────────────
// The prototype shares one renderer across several semantic types, so those
// types share a variant set (prose = ache/turn/feel; video = introVideo/reel).

const PROSE_VARIANTS: readonly SectionVariant[] = [
  {
    id: 'centered',
    label: 'Centered',
    hint: 'Narrow, symmetric',
    thumb: 'center',
  },
  {
    id: 'statement',
    label: 'Statement',
    hint: 'Oversized heading',
    thumb: 'statement',
  },
  { id: 'wide', label: 'Wide', hint: 'Left, full measure', thumb: 'left' },
  {
    id: 'twocol',
    label: 'Two column',
    hint: 'Heading | body',
    thumb: 'twocol',
  },
];

const VIDEO_VARIANTS: readonly SectionVariant[] = [
  {
    id: 'cinema',
    label: 'Cinema',
    hint: 'Framed, corners + meta',
    thumb: 'media',
  },
  { id: 'simple', label: 'Simple', hint: 'Clean player', thumb: 'media' },
  { id: 'split', label: 'Split', hint: 'Text beside video', thumb: 'split' },
];

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
        id: 'centered',
        label: 'Centered',
        hint: 'Atmospheric, symmetric',
        thumb: 'center',
      },
      {
        id: 'left',
        label: 'Left-aligned',
        hint: 'Editorial column',
        thumb: 'left',
      },
      {
        id: 'split',
        label: 'Split · media',
        hint: 'Text beside a poster',
        thumb: 'split',
      },
      {
        id: 'minimal',
        label: 'Minimal',
        hint: 'Quiet, no glow',
        thumb: 'minimal',
      },
    ],
    defaultVariant: 'centered',
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
    variants: VIDEO_VARIANTS,
    defaultVariant: 'cinema',
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
    variants: PROSE_VARIANTS,
    defaultVariant: 'centered',
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
    variants: PROSE_VARIANTS,
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
    variants: VIDEO_VARIANTS,
    defaultVariant: 'cinema',
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
        id: 'descent',
        label: 'Descent spine',
        hint: 'Ember spine + gates',
        thumb: 'spine',
      },
      {
        id: 'list',
        label: 'Simple list',
        hint: 'Compact stage rows',
        thumb: 'rows',
      },
      {
        id: 'grid',
        label: 'Stage cards',
        hint: 'A card per stage',
        thumb: 'grid',
      },
    ],
    defaultVariant: 'descent',
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
    variants: PROSE_VARIANTS,
    defaultVariant: 'centered',
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
        hint: 'Three side by side',
        thumb: 'grid',
      },
      {
        id: 'stack',
        label: 'Stacked',
        hint: 'One column, full width',
        thumb: 'stack',
      },
      {
        id: 'spotlight',
        label: 'Spotlight',
        hint: 'One big quote',
        thumb: 'center',
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
    icon: '☺',
    keywords: ['guide', 'teacher', 'about', 'bio', 'host', 'facilitator'],
    variants: [
      {
        id: 'portrait',
        label: 'Portrait',
        hint: 'Poster + copy',
        thumb: 'split',
      },
      {
        id: 'centered',
        label: 'Centered',
        hint: 'Bio, no media',
        thumb: 'center',
      },
      {
        id: 'quote',
        label: 'Quote-led',
        hint: 'Big pull-quote',
        thumb: 'quote',
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
        hint: 'Click to open',
        thumb: 'accordion',
      },
      {
        id: 'open',
        label: 'All open',
        hint: 'Everything shown',
        thumb: 'rows',
      },
      { id: 'boxed', label: 'Boxed', hint: 'Each in a card', thumb: 'boxes' },
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
    variants: [
      {
        id: 'descent',
        label: 'Descent close',
        hint: 'Cinematic, ember pool',
        thumb: 'center',
      },
      {
        id: 'banner',
        label: 'Banner',
        hint: 'Compact horizontal',
        thumb: 'banner',
      },
      {
        id: 'card',
        label: 'Card',
        hint: 'Quiet, no atmosphere',
        thumb: 'card',
      },
    ],
    defaultVariant: 'descent',
    defaultProps: {
      eyebrow: 'Begin',
      heading: 'The ground',
      accent: 'is waiting.',
      sub: 'One key opens everything that grows from here.',
      price: 'Included with membership · £12 a month',
      button: 'Get started',
      risk: 'Start free · cancel anytime',
    },
  },
];

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
 * else the type's `defaultVariant`, else the first offered variant, else `''`.
 * Keeps the renderer forward-compatible with an unknown stored variant.
 */
export function resolveVariant(
  section: Pick<PageSection, 'type' | 'variant'>
): string {
  const def = findSectionDefinition(section.type);
  if (!def) return section.variant ?? '';
  if (section.variant && def.variants.some((v) => v.id === section.variant)) {
    return section.variant;
  }
  return def.defaultVariant || def.variants[0]?.id || '';
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
 */
export function createSection(
  type: string,
  makeId: () => string = () => crypto.randomUUID()
): PageSection {
  const def = findSectionDefinition(type);
  return {
    id: makeId(),
    type,
    enabled: true,
    variant: def?.defaultVariant,
    name: def?.label,
    props: def ? structuredClone(def.defaultProps) : {},
  };
}

/**
 * Build the default set of enabled {@link PageSection}s for a new course page
 * (SPEC §4.1 — "the course template ships a default set"). Sections are in
 * template ship order, enabled, seeded with each type's default variant + copy
 * so a brand-new page renders populated rather than blank.
 *
 * `makeId` is injectable so tests get deterministic ids; it defaults to
 * `crypto.randomUUID` (available in the SvelteKit + Node runtimes).
 */
export function createDefaultSections(
  makeId: () => string = () => crypto.randomUUID()
): PageSection[] {
  return SECTION_CATALOG.map((def) => createSection(def.type, makeId));
}
