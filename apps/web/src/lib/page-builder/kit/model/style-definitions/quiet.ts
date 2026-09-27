import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * PROVISIONAL (03 §12 R0): a working stand-in until Quiet's Style WP (S1)
 * designs it. Every section on the page background — Quiet has no bands; its
 * one accent is the secondary colour, used for markers, links and the ask.
 */
export const QUIET: StyleDefinition = {
  id: 'quiet',
  label: 'Quiet',
  description:
    'Lots of space and a single accent colour. Made for reading slowly.',
  layouts: {
    hero: 'centered',
    video: 'theatre',
    problem: 'statement',
    story: 'chapters',
    transformation: 'statement',
    benefits: 'checklist',
    curriculum: 'accordion',
    preview: 'feature',
    gallery: 'grid',
    instructor: 'quote',
    testimonials: 'quote',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'compact',
    stats: 'row',
    text: 'statement',
  },
  schemes: {
    hero: 'base',
    video: 'base',
    problem: 'base',
    story: 'base',
    text: 'base',
    transformation: 'base',
    benefits: 'base',
    curriculum: 'base',
    preview: 'base',
    gallery: 'base',
    instructor: 'base',
    testimonials: 'base',
    stats: 'base',
    pricing: 'base',
    faq: 'base',
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
    'text',
    'transformation',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
};
