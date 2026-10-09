import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * Poster (03 §4.1): loud and graphic. The page is a run of printed sheets —
 * fields of BOTH brand colours (`brand` and `accent` take turns) with paper
 * (`base`) between them, the cuts angled, the type in capitals crowding each
 * sheet. Never a `contrast` band, so a very dark brand can never smear into
 * its own inverse, and the brand/contrast invariant holds by construction.
 * Long reading (the guide, the course, the questions) sits on paper; the
 * short, loud sections take the colour.
 */
export const POSTER: StyleDefinition = {
  id: 'poster',
  label: 'Poster',
  description:
    'Loud and graphic. Huge capitals, blocks of both your colours and a moving strip of praise.',
  layouts: {
    hero: 'poster',
    video: 'theatre',
    problem: 'statement',
    story: 'chapters',
    transformation: 'toggle',
    benefits: 'bento',
    curriculum: 'cards',
    preview: 'feature',
    gallery: 'strip',
    instructor: 'split',
    testimonials: 'marquee',
    faq: 'accordion',
    pricing: 'band',
    cta: 'band',
    stats: 'row',
    text: 'statement',
  },
  schemes: {
    hero: 'brand',
    video: 'base',
    problem: 'accent',
    story: 'base',
    text: 'base',
    transformation: 'brand',
    benefits: 'base',
    curriculum: 'accent',
    preview: 'base',
    gallery: 'base',
    instructor: 'base',
    testimonials: 'accent',
    stats: 'brand',
    pricing: 'base',
    faq: 'base',
    cta: 'brand',
  },
  // On paper the one filled card is a block of the brand colour; inside a
  // colour field it is paper. Never brand-in-accent: a brand with no second
  // colour gets a hue-shifted twin of the same lightness, and the card would
  // barely part from its band.
  featured: {
    base: 'brand',
    soft: 'brand',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'soft',
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
  fonts: { heading: 'Anton', body: 'Roboto' },
  // A sharp shader behind a pasted-up panel (`--lp-atmosphere-veil: panel`).
  atmosphere: 'sharp',
};
