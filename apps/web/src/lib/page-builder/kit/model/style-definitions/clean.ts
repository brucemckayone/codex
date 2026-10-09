import { STORY_ORDER, type StyleDefinition } from '../style-definition';

export const CLEAN: StyleDefinition = {
  id: 'clean',
  label: 'Clean',
  description:
    'Crisp and image-led with plenty of space. Lets your photos breathe.',
  // The picture leads wherever there is one: the film and the look inside at
  // their full size, a strip of the story's moments, the work in a grid.
  layouts: {
    hero: 'split',
    video: 'theatre',
    problem: 'list',
    story: 'strip',
    transformation: 'steps',
    benefits: 'grid',
    curriculum: 'accordion',
    preview: 'feature',
    gallery: 'grid',
    instructor: 'split',
    testimonials: 'grid',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'split',
    stats: 'grid',
    text: 'columns',
  },
  // The ground, a whisper of tint for the passages that ask to be read, and
  // the dark inverse as the screening room — the film, the look inside, and
  // the close. Never a brand band: the pictures are the loudest thing here.
  schemes: {
    hero: 'base',
    video: 'contrast',
    problem: 'base',
    story: 'base',
    text: 'soft',
    transformation: 'base',
    benefits: 'soft',
    curriculum: 'base',
    preview: 'contrast',
    gallery: 'base',
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
    atmosphere: 'soft',
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
  // A neutral grotesk pair (03 §4.1), distinct from every other Style's.
  // Plus Jakarta Sans holds a crisp semibold at display size (Manrope's
  // semi-rounded forms read light there); Inter is the plainest reading
  // grotesk — chosen knowing it is the platform default, so for an org on
  // defaults the suggestion changes the heading face, which is the part of
  // the page Clean's crispness rests on.
  fonts: { heading: 'Plus Jakarta Sans', body: 'Inter' },
};
