import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * Studio (03 §4.1): handmade and warm. Paper first — the brand's own ground
 * and a tint of it take turns (`base` / `soft`), so the page reads as sheets
 * of one paper, never a stock cream. The second colour gets one field (the
 * numbers, circled by hand) and the closing ask the brand's own. The words
 * sit beside photographs, pinned like prints: `split` and `columns` layouts,
 * the testimonials a `wall`, the gallery a `mosaic`.
 */
export const STUDIO: StyleDefinition = {
  id: 'studio',
  label: 'Studio',
  description:
    'Handmade and warm. Paper texture, hand-drawn marks and photos pinned at a tilt.',
  layouts: {
    hero: 'split',
    video: 'split',
    problem: 'list',
    story: 'strip',
    transformation: 'steps',
    benefits: 'grid',
    curriculum: 'timeline',
    preview: 'split',
    gallery: 'mosaic',
    instructor: 'split',
    testimonials: 'wall',
    faq: 'columns',
    pricing: 'cards',
    cta: 'split',
    stats: 'row',
    text: 'columns',
  },
  // Paper and tinted paper in turn, whichever sections a page keeps: the
  // starter and every recipe alternate without a repeat to step back from.
  schemes: {
    hero: 'base',
    video: 'base',
    problem: 'soft',
    story: 'base',
    text: 'soft',
    transformation: 'base',
    benefits: 'soft',
    curriculum: 'base',
    preview: 'soft',
    gallery: 'base',
    instructor: 'soft',
    testimonials: 'base',
    stats: 'accent',
    pricing: 'soft',
    faq: 'base',
    cta: 'brand',
  },
  // A card is a sheet of the other paper: tinted on the ground, plain on the
  // tint, plain on a colour field.
  featured: {
    base: 'soft',
    soft: 'base',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'soft',
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
  fonts: { heading: 'Bitter', body: 'Figtree' },
};
