import type { StyleDefinition } from '../style-definition';

/**
 * Cinematic (03 §4.1): dark and immersive — a film in scenes. It opens and
 * closes on title cards over the org's OWN moving background (`atmosphere`,
 * drawn as a panel so the shader shows at full strength round the words, or
 * the brand glow where there is no shader); between them the page is one
 * continuous dark room, the lifted tint (`soft`) marking each change of
 * scene. Dark in both themes, so never a `brand`, `accent` or `contrast`
 * band: the colour lives in the moving light and the call to action. The
 * story is a scroll with a sticky picture that changes as its moments pass.
 */
export const CINEMATIC: StyleDefinition = {
  id: 'cinematic',
  label: 'Cinematic',
  description:
    'Dark and immersive, with full-width pictures and your brand’s moving light behind the opening and the close.',
  layouts: {
    hero: 'cover',
    video: 'theatre',
    problem: 'statement',
    story: 'scroll',
    transformation: 'statement',
    benefits: 'split',
    curriculum: 'timeline',
    preview: 'feature',
    gallery: 'strip',
    instructor: 'quote',
    testimonials: 'quote',
    faq: 'accordion',
    pricing: 'focus',
    cta: 'band',
    stats: 'row',
    text: 'statement',
  },
  schemes: {
    hero: 'atmosphere',
    video: 'soft',
    problem: 'base',
    story: 'base',
    text: 'base',
    transformation: 'soft',
    benefits: 'base',
    curriculum: 'soft',
    preview: 'base',
    gallery: 'soft',
    instructor: 'soft',
    testimonials: 'base',
    stats: 'soft',
    pricing: 'base',
    faq: 'soft',
    cta: 'atmosphere',
  },
  // The one filled card is the lifted tint in the room, the room in the tint,
  // and the tint again inside a Moving background.
  featured: {
    base: 'soft',
    soft: 'base',
    contrast: 'brand',
    brand: 'base',
    accent: 'base',
    atmosphere: 'soft',
  },
  order: [
    'hero',
    'video',
    'problem',
    'story',
    'transformation',
    'preview',
    'gallery',
    'text',
    'curriculum',
    'benefits',
    'instructor',
    'testimonials',
    'stats',
    'pricing',
    'faq',
    'cta',
  ],
  starter: [
    'hero',
    'video',
    'problem',
    'transformation',
    'curriculum',
    'instructor',
    'testimonials',
    'pricing',
    'faq',
    'cta',
  ],
  fonts: { heading: 'Unbounded', body: 'Sora' },
  // Sharp: the org's own moving background as designed, round a smoked card
  // (blurred, a shader like Bloom's field of lights turns to mud).
  atmosphere: 'sharp',
  // A dark page's bar: its tint, not the light contrast pole.
  sticky: 'soft',
};
