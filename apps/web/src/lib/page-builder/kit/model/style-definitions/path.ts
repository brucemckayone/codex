import { STORY_ORDER, type StyleDefinition } from '../style-definition';

/**
 * Path (03 §4.1): the course as a route. One line in the second brand colour
 * runs down the page from the hero (the start) to the closing ask (the
 * arrival), with a stop at every section, and draws itself as the visitor
 * scrolls. The course itself is the journey map (`curriculum` `map`), and the
 * story is told as moments along the way (`story` `scroll`).
 *
 * The ground and a tint of it take turns so each stop reads as a new stretch
 * of the route; two dark stretches (the film, the voices of people who walked
 * it) and the arrival in the brand's own colour. The starter alternates the
 * same way, and a brand band never meets a contrast band.
 */
export const PATH: StyleDefinition = {
  id: 'path',
  label: 'Path',
  description:
    'Your course as a route. A line draws itself down the page and leads visitors stop by stop.',
  layouts: {
    hero: 'statement',
    video: 'split',
    problem: 'list',
    story: 'scroll',
    transformation: 'steps',
    benefits: 'grid',
    curriculum: 'map',
    preview: 'feature',
    gallery: 'strip',
    instructor: 'split',
    testimonials: 'featured',
    faq: 'accordion',
    pricing: 'cards',
    cta: 'band',
    stats: 'row',
    text: 'columns',
  },
  schemes: {
    hero: 'base',
    video: 'contrast',
    problem: 'soft',
    story: 'base',
    text: 'soft',
    transformation: 'base',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    gallery: 'soft',
    instructor: 'base',
    testimonials: 'contrast',
    stats: 'soft',
    pricing: 'base',
    faq: 'soft',
    cta: 'brand',
  },
  // The recommended way in is the other ground, ringed in the route's colour
  // (style-path.css); on a coloured band it is the plain ground.
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
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
  // A humanist pair, the faces of wayfinding signs (03 §4.1).
  fonts: { heading: 'Lato', body: 'Source Sans 3' },
};
