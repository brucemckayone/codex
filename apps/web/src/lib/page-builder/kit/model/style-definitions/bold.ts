import { STORY_ORDER, type StyleDefinition } from '../style-definition';

export const BOLD: StyleDefinition = {
  id: 'bold',
  label: 'Bold',
  description:
    'Huge headlines and full-width colour bands. Your words do the selling.',
  layouts: {
    hero: 'statement',
    video: 'theatre',
    problem: 'statement',
    // Each moment a full-bleed slab with its headline over the picture.
    story: 'chapters',
    transformation: 'columns',
    benefits: 'checklist',
    curriculum: 'timeline',
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
  // Slabs, not stripes. The brand colour where the page makes its three
  // loudest claims — the promise, the proof (the numbers), the ask — and its
  // dark inverse at the turns: the problem, the change, the course itself.
  // A brand band never touches a contrast band (with a very dark brand the
  // two would smear into one block), and no default repeats the band above
  // it in the full order, so the page reads exactly as written here: the
  // look inside, right under the course, stays on the ground, its clip a
  // full-bleed picture band of its own.
  schemes: {
    hero: 'brand',
    video: 'base',
    problem: 'contrast',
    story: 'base',
    text: 'base',
    transformation: 'contrast',
    benefits: 'base',
    curriculum: 'contrast',
    preview: 'base',
    gallery: 'base',
    instructor: 'base',
    testimonials: 'base',
    stats: 'brand',
    pricing: 'base',
    faq: 'base',
    cta: 'brand',
  },
  // The one filled card is a slab of the other pole: the inverse on the
  // ground, the ground on the inverse (a brand card there vanishes for a very
  // dark brand — navy on near-black), and a solid inverse over the Moving
  // background.
  featured: {
    base: 'contrast',
    soft: 'contrast',
    contrast: 'base',
    brand: 'base',
    accent: 'base',
    atmosphere: 'contrast',
  },
  order: STORY_ORDER,
  // The numbers are half the signature, so a new page counts something.
  starter: [
    'hero',
    'problem',
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
