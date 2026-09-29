/**
 * The four Styles (contract §4) — what each one picks when a section has not.
 *
 * A Style is a complete design system: its CSS lives in
 * `kit/styles/style-<id>.css`; this module is its DATA half — the default
 * layout and colour scheme of every section type, the scheme a featured card
 * takes inside each section scheme, and the order of its starter page. Changing
 * a page's Style re-composes every unset choice from these tables
 * (`resolve.ts`), which is why they are written as a rhythm down the page and
 * not type by type.
 */
import type {
  ColourSchemeId,
  LayoutId,
  PageStyleId,
  SectionSpacingId,
  SectionTypeId,
} from './ids';

export interface StyleDefinition {
  id: PageStyleId;
  label: string;
  /** One plain sentence for the Style picker. */
  description: string;
  layouts: { readonly [T in SectionTypeId]: LayoutId<T> };
  schemes: Readonly<Record<SectionTypeId, ColourSchemeId>>;
  /**
   * The scheme a featured card (the recommended offer, a highlighted panel)
   * renders in, given the scheme of the section around it. A nested scheme,
   * not a fill colour, so the button inside the card is contrasted against the
   * CARD — a section's button tokens are only valid on the section's own ground.
   */
  featured: Readonly<Record<ColourSchemeId, ColourSchemeId>>;
  /** Every section type, in the order a full page tells the story. */
  order: readonly SectionTypeId[];
  /** The sections a brand-new page starts with (a subset of `order`). */
  starter: readonly SectionTypeId[];
}

/** The sales narrative: promise, pain, shift, proof, offer, objections, ask. */
const STORY_ORDER = [
  'hero',
  'video',
  'problem',
  'text',
  'transformation',
  'benefits',
  'curriculum',
  'preview',
  'instructor',
  'testimonials',
  'stats',
  'pricing',
  'faq',
  'cta',
] as const satisfies readonly SectionTypeId[];

const BOLD: StyleDefinition = {
  id: 'bold',
  label: 'Bold',
  description:
    'Huge headlines and full-width colour bands. Your words do the selling.',
  layouts: {
    hero: 'statement',
    video: 'theatre',
    problem: 'statement',
    transformation: 'columns',
    benefits: 'checklist',
    curriculum: 'timeline',
    preview: 'feature',
    instructor: 'split',
    testimonials: 'featured',
    faq: 'columns',
    pricing: 'focus',
    cta: 'band',
    stats: 'row',
    text: 'statement',
  },
  // Brand, base and contrast bands in turn: the page opens and closes on the
  // brand colour, and a brand band never touches a contrast band — with a very
  // dark brand the two are near-identical and would read as one smeared block.
  schemes: {
    hero: 'brand',
    video: 'base',
    problem: 'contrast',
    text: 'base',
    transformation: 'contrast',
    benefits: 'base',
    curriculum: 'base',
    preview: 'contrast',
    instructor: 'base',
    testimonials: 'base',
    stats: 'brand',
    pricing: 'base',
    faq: 'base',
    cta: 'brand',
  },
  featured: {
    base: 'contrast',
    soft: 'contrast',
    contrast: 'brand',
    brand: 'base',
    accent: 'base',
  },
  order: STORY_ORDER,
  starter: [
    'hero',
    'problem',
    'transformation',
    'benefits',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};

const CLEAN: StyleDefinition = {
  id: 'clean',
  label: 'Clean',
  description:
    'Crisp and image-led with plenty of space. Lets your photos breathe.',
  layouts: {
    hero: 'split',
    video: 'split',
    problem: 'list',
    transformation: 'steps',
    benefits: 'grid',
    curriculum: 'accordion',
    preview: 'split',
    instructor: 'split',
    testimonials: 'grid',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'split',
    stats: 'grid',
    text: 'columns',
  },
  // Strict base / tint alternation, closing on one contrast band so the last
  // ask does not read as another content section.
  schemes: {
    hero: 'base',
    video: 'soft',
    problem: 'base',
    text: 'soft',
    transformation: 'base',
    benefits: 'soft',
    curriculum: 'base',
    preview: 'soft',
    instructor: 'base',
    testimonials: 'soft',
    stats: 'base',
    pricing: 'soft',
    faq: 'base',
    cta: 'contrast',
  },
  featured: {
    base: 'contrast',
    soft: 'base',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
  },
  order: STORY_ORDER,
  starter: [
    'hero',
    'transformation',
    'benefits',
    'curriculum',
    'instructor',
    'testimonials',
    'stats',
    'pricing',
    'faq',
    'cta',
  ],
};

const SOFT: StyleDefinition = {
  id: 'soft',
  label: 'Soft',
  description: 'Rounded shapes and gentle tints. Calm, warm and welcoming.',
  layouts: {
    hero: 'centered',
    video: 'theatre',
    problem: 'split',
    transformation: 'columns',
    benefits: 'grid',
    curriculum: 'cards',
    preview: 'split',
    instructor: 'centered',
    testimonials: 'grid',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'band',
    stats: 'grid',
    text: 'centered',
  },
  // Tint first, then page: the tint is Soft's ground and the plain bands are
  // the pauses. It closes warm, on the brand colour.
  schemes: {
    hero: 'soft',
    video: 'base',
    problem: 'soft',
    text: 'base',
    transformation: 'soft',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    instructor: 'soft',
    testimonials: 'base',
    stats: 'soft',
    pricing: 'base',
    faq: 'soft',
    cta: 'brand',
  },
  featured: {
    base: 'soft',
    soft: 'base',
    contrast: 'soft',
    brand: 'base',
    accent: 'base',
  },
  order: STORY_ORDER,
  starter: [
    'hero',
    'problem',
    'transformation',
    'benefits',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};

const CINEMATIC: StyleDefinition = {
  id: 'cinematic',
  label: 'Cinematic',
  description:
    'Dark and immersive, with full-width imagery and a glow of your brand colour.',
  layouts: {
    hero: 'cover',
    video: 'theatre',
    problem: 'statement',
    transformation: 'statement',
    benefits: 'split',
    curriculum: 'timeline',
    preview: 'feature',
    instructor: 'quote',
    testimonials: 'quote',
    faq: 'accordion',
    pricing: 'focus',
    cta: 'band',
    stats: 'row',
    text: 'statement',
  },
  // Cinematic's base is dark in both themes; the lifted tint is its only
  // variation, so the page reads as one continuous dark room.
  schemes: {
    hero: 'base',
    video: 'soft',
    problem: 'base',
    text: 'base',
    transformation: 'soft',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    instructor: 'soft',
    testimonials: 'base',
    stats: 'soft',
    pricing: 'base',
    faq: 'soft',
    cta: 'base',
  },
  featured: {
    base: 'soft',
    soft: 'base',
    contrast: 'brand',
    brand: 'base',
    accent: 'base',
  },
  order: [
    'hero',
    'video',
    'problem',
    'transformation',
    'preview',
    'text',
    'curriculum',
    'benefits',
    'instructor',
    'testimonials',
    'stats',
    'pricing',
    'faq',
    'cta',
  ],
  starter: [
    'hero',
    'video',
    'problem',
    'transformation',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};

export const STYLES: Readonly<Record<PageStyleId, StyleDefinition>> = {
  bold: BOLD,
  clean: CLEAN,
  soft: SOFT,
  cinematic: CINEMATIC,
};

/** Creator-facing names for the five schemes (the inspector's swatches). */
export const SCHEME_OPTIONS: readonly {
  id: ColourSchemeId;
  label: string;
}[] = [
  { id: 'base', label: 'Page background' },
  { id: 'soft', label: 'Soft tint' },
  { id: 'contrast', label: 'High contrast' },
  { id: 'brand', label: 'Brand colour' },
  { id: 'accent', label: 'Second colour' },
];

/** Creator-facing names for the three spacing sizes (S / M / L). */
export const SPACING_OPTIONS: readonly {
  id: SectionSpacingId;
  label: string;
}[] = [
  { id: 'compact', label: 'Small' },
  { id: 'regular', label: 'Medium' },
  { id: 'spacious', label: 'Large' },
];
