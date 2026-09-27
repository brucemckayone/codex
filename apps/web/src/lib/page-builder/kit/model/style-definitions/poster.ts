import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * PROVISIONAL (03 §12 R0): a working stand-in until Poster's Style WP (S2)
 * designs it. Both brand colours as blocks (`brand` and `accent`, never a
 * `contrast` band, so the brand/contrast invariant holds by construction).
 */
export const POSTER: StyleDefinition = {
  id: 'poster',
  label: 'Poster',
  description:
    'Loud and graphic. Huge type and bold blocks in both of your colours.',
  layouts: {
    hero: 'statement',
    video: 'theatre',
    problem: 'statement',
    story: 'chapters',
    transformation: 'columns',
    benefits: 'grid',
    curriculum: 'cards',
    preview: 'feature',
    gallery: 'mosaic',
    instructor: 'split',
    testimonials: 'featured',
    faq: 'columns',
    pricing: 'focus',
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
    transformation: 'base',
    benefits: 'accent',
    curriculum: 'base',
    preview: 'base',
    gallery: 'base',
    instructor: 'base',
    testimonials: 'brand',
    stats: 'base',
    pricing: 'base',
    faq: 'base',
    cta: 'accent',
  },
  featured: {
    base: 'brand',
    soft: 'brand',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'base',
  },
  order: STORY_ORDER,
  starter: [
    'hero',
    'problem',
    'transformation',
    'benefits',
    'gallery',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};
