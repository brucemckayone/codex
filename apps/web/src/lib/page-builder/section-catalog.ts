/**
 * Page-builder SECTION MODEL — the section catalogue (Codex-2pryk.2.1 · WP-0).
 *
 * The "section-model" half of the WP-0 page-builder document model (HARDENING §G
 * item a): the analogue of the brand studio's `rail/rail-model.ts` (catalogue,
 * ordering, search). This is the pure, framework-free spine — section-type
 * metadata + the search matcher + the default-template factory. The WP-5 editor
 * rail renders FROM it; the WP-3 public renderer maps each {@link PageSection}'s
 * `type` → a Svelte component.
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
 * Icons/labels here are advisory stand-ins; the WP-5 editor rebinds them to real
 * design-system icons (see the design-system skill).
 */
import type { CourseSectionType, PageSection } from '@codex/shared-types';

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
}

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
  },
  {
    type: 'introVideo',
    label: 'Intro video',
    summary: 'A short sell/intro video that sets the tone.',
    icon: '▷',
    keywords: ['intro', 'video', 'trailer', 'preview', 'media', 'sell'],
  },
  {
    type: 'ache',
    label: 'The ache',
    summary: 'Name the problem or longing the journey speaks to.',
    icon: '◍',
    keywords: ['ache', 'problem', 'pain', 'longing', 'why', 'struggle'],
  },
  {
    type: 'turn',
    label: 'The turn',
    summary: 'The shift on offer — from where they are to where they could be.',
    icon: '↺',
    keywords: ['turn', 'shift', 'change', 'promise', 'transformation'],
  },
  {
    type: 'reel',
    label: 'Reel',
    summary: 'A montage of moments / practices from inside the journey.',
    icon: '▤',
    keywords: ['reel', 'montage', 'gallery', 'highlights', 'moments'],
  },
  {
    type: 'map',
    label: 'The map',
    summary: 'The descent map — the journey stages laid out (no progress).',
    icon: '⊞',
    keywords: ['map', 'stages', 'curriculum', 'path', 'descent', 'outline'],
  },
  {
    type: 'feel',
    label: 'How it feels',
    summary: 'The felt-sense of the work — and the free-taste door.',
    icon: '≈',
    keywords: ['feel', 'taste', 'free', 'sample', 'experience', 'sense'],
  },
  {
    type: 'proof',
    label: 'Proof',
    summary: 'Testimonials and social proof from past members.',
    icon: '❝',
    keywords: ['proof', 'testimonial', 'reviews', 'quotes', 'social proof'],
  },
  {
    type: 'guide',
    label: 'Your guide',
    summary: 'The guide bio, portrait and guide video.',
    icon: '☺',
    keywords: ['guide', 'teacher', 'about', 'bio', 'host', 'facilitator'],
  },
  {
    type: 'faq',
    label: 'FAQ',
    summary: 'Common questions, answered.',
    icon: '?',
    keywords: ['faq', 'questions', 'answers', 'help', 'objections'],
  },
  {
    type: 'invite',
    label: 'The invite',
    summary: 'The offer and pricing — the primary conversion moment.',
    icon: '✦',
    keywords: ['invite', 'offer', 'pricing', 'join', 'buy', 'checkout', 'cta'],
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

// ── Default template factory ─────────────────────────────────────────────────

/**
 * Build the default set of enabled {@link PageSection}s for a new course page
 * (SPEC §4.1 — "the course template ships a default set"). Sections are in
 * template ship order, enabled, with empty props (the WP-5 editor fills copy).
 *
 * `makeId` is injectable so tests get deterministic ids; it defaults to
 * `crypto.randomUUID` (available in the SvelteKit + Node runtimes).
 */
export function createDefaultSections(
  makeId: () => string = () => crypto.randomUUID()
): PageSection[] {
  return SECTION_CATALOG.map((def) => ({
    id: makeId(),
    type: def.type,
    enabled: true,
    props: {},
  }));
}
