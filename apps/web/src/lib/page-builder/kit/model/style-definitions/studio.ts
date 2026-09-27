import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * PROVISIONAL (03 §12 R0): a working stand-in until Studio's Style WP (S2)
 * designs it. The paper, the hand-drawn marks and the font suggestion arrive
 * then; the ground stays the brand's own background, never a stock cream.
 */
export const STUDIO: StyleDefinition = {
  id: 'studio',
  label: 'Studio',
  description:
    'Handmade and warm. Paper texture, hand-drawn marks and photos set at a tilt.',
  layouts: {
    hero: 'split',
    video: 'split',
    problem: 'split',
    story: 'strip',
    transformation: 'columns',
    benefits: 'grid',
    curriculum: 'cards',
    preview: 'split',
    gallery: 'mosaic',
    instructor: 'split',
    testimonials: 'grid',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'split',
    stats: 'grid',
    text: 'columns',
  },
  schemes: {
    hero: 'soft',
    video: 'base',
    problem: 'soft',
    story: 'base',
    text: 'base',
    transformation: 'soft',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    gallery: 'base',
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
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'base',
  },
  order: STORY_ORDER,
  starter: [
    'hero',
    'problem',
    'story',
    'benefits',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};
