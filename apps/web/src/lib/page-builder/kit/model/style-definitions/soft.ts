import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * Soft (03 §4.1): rounded, tinted, calm. The page is one flowing surface —
 * tint (`soft`) and page (`base`) take turns, each band curving into the one
 * above with the primary's shapes drifting behind it. The rhythm alternates
 * in the starter page as well as the full one, so a new page never runs
 * three plain bands in a row. A one-colour Style: the primary tints the
 * page, fills the ONE card a section may carry (the "after", the lead voice,
 * the recommended offer) and closes the page. Never the second colour by
 * default — a brand's secondary may be a neutral (studio-alpha's is grey),
 * and a grey pebble on a warm tint reads as switched off. Never beside a
 * contrast band.
 */
export const SOFT: StyleDefinition = {
  id: 'soft',
  label: 'Soft',
  description: 'Rounded shapes and gentle tints. Calm, warm and welcoming.',
  layouts: {
    hero: 'centered',
    video: 'theatre',
    problem: 'split',
    story: 'strip',
    transformation: 'columns',
    benefits: 'grid',
    curriculum: 'cards',
    preview: 'split',
    gallery: 'mosaic',
    instructor: 'centered',
    testimonials: 'featured',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'band',
    stats: 'grid',
    text: 'centered',
  },
  schemes: {
    hero: 'soft',
    video: 'base',
    problem: 'base',
    story: 'soft',
    text: 'base',
    transformation: 'soft',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    gallery: 'soft',
    instructor: 'base',
    testimonials: 'soft',
    stats: 'base',
    pricing: 'base',
    faq: 'soft',
    cta: 'brand',
  },
  // The one filled card is a pebble of the primary on page and tint alike; on
  // a dark band it is the light tint, inside a colour field the page, and
  // inside a Moving background the tint.
  featured: {
    base: 'brand',
    soft: 'brand',
    contrast: 'soft',
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
  fonts: { heading: 'Nunito', body: 'Outfit' },
};
