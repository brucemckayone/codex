import type { StyleDefinition } from '../style-definition';

/**
 * Quiet (03 §4.1): space and one accent. Every section sits on the brand's
 * own ground — no colour bands — parted only by room and a hairline, so the
 * words carry the page. The second colour is the one accent: markers, links
 * and the call to action. The statement comes straight after the hero and
 * reads along with the visitor (`text` `statement`); the layouts are the
 * ones that give a passage room: centred, stated, quoted, one at a time.
 */
export const QUIET: StyleDefinition = {
  id: 'quiet',
  label: 'Quiet',
  description:
    'Lots of space and a single accent colour. Your words brighten as visitors read them.',
  layouts: {
    hero: 'centered',
    video: 'theatre',
    problem: 'statement',
    story: 'scroll',
    transformation: 'statement',
    benefits: 'checklist',
    curriculum: 'accordion',
    preview: 'feature',
    gallery: 'grid',
    instructor: 'quote',
    testimonials: 'quote',
    faq: 'accordion',
    pricing: 'focus',
    cta: 'band',
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
  // One card may lift off the ground: a tint of it. Inside a band a creator
  // chose, the card is the plain ground.
  featured: {
    base: 'soft',
    soft: 'base',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'soft',
  },
  // The statement straight after the promise, then the story in order.
  order: [
    'hero',
    'text',
    'problem',
    'video',
    'story',
    'transformation',
    'benefits',
    'curriculum',
    'preview',
    'gallery',
    'instructor',
    'testimonials',
    'stats',
    'pricing',
    'faq',
    'cta',
  ],
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
  // A light serif heading over a neutral sans (03 §4.1).
  fonts: { heading: 'Spectral', body: 'DM Sans' },
};
