import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * PROVISIONAL (03 §12 R0): a working stand-in until Path's Style WP (S1)
 * designs it. The route, the journey map and the font suggestion arrive then.
 */
export const PATH: StyleDefinition = {
  id: 'path',
  label: 'Path',
  description:
    'Your course as a route. A line leads visitors from one stage to the next.',
  layouts: {
    hero: 'split',
    video: 'split',
    problem: 'list',
    story: 'scroll',
    transformation: 'steps',
    benefits: 'grid',
    curriculum: 'timeline',
    preview: 'split',
    gallery: 'grid',
    instructor: 'split',
    testimonials: 'grid',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'split',
    stats: 'row',
    text: 'columns',
  },
  schemes: {
    hero: 'base',
    video: 'soft',
    problem: 'base',
    story: 'base',
    text: 'soft',
    transformation: 'base',
    benefits: 'soft',
    curriculum: 'base',
    preview: 'soft',
    gallery: 'base',
    instructor: 'base',
    testimonials: 'soft',
    stats: 'base',
    pricing: 'soft',
    faq: 'base',
    cta: 'brand',
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
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};
