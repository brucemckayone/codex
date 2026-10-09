/**
 * Every section type's definition, by type (contract amendment A2).
 *
 * An AGGREGATOR ONLY: each definition lives in its own
 * `blocks/<type>/definition.ts`, and a later WP changes a block by editing
 * that file, never this one. Pure TS so the studio and the tests can read the
 * catalogue without loading a single Svelte component (`registry.ts` is the
 * component half).
 */
import { benefitsDefinition } from '../blocks/benefits/definition';
import { ctaDefinition } from '../blocks/cta/definition';
import { curriculumDefinition } from '../blocks/curriculum/definition';
import { faqDefinition } from '../blocks/faq/definition';
import { galleryDefinition } from '../blocks/gallery/definition';
import { heroDefinition } from '../blocks/hero/definition';
import { instructorDefinition } from '../blocks/instructor/definition';
import { previewDefinition } from '../blocks/preview/definition';
import { pricingDefinition } from '../blocks/pricing/definition';
import { problemDefinition } from '../blocks/problem/definition';
import { statsDefinition } from '../blocks/stats/definition';
import { storyDefinition } from '../blocks/story/definition';
import { testimonialsDefinition } from '../blocks/testimonials/definition';
import { textDefinition } from '../blocks/text/definition';
import { transformationDefinition } from '../blocks/transformation/definition';
import { videoDefinition } from '../blocks/video/definition';
import type { SectionTypeId } from './ids';
import type { BlockDefinition, BlockField, BlockGroup } from './types';

export const DEFINITIONS: Readonly<Record<SectionTypeId, BlockDefinition>> = {
  hero: heroDefinition,
  video: videoDefinition,
  problem: problemDefinition,
  transformation: transformationDefinition,
  benefits: benefitsDefinition,
  curriculum: curriculumDefinition,
  preview: previewDefinition,
  instructor: instructorDefinition,
  testimonials: testimonialsDefinition,
  faq: faqDefinition,
  pricing: pricingDefinition,
  cta: ctaDefinition,
  stats: statsDefinition,
  text: textDefinition,
  story: storyDefinition,
  gallery: galleryDefinition,
};

/** Gallery groups, in the order the add-section gallery shows them. */
export const GROUP_ORDER: readonly { id: BlockGroup; label: string }[] = [
  { id: 'opening', label: 'Opening' },
  { id: 'story', label: 'Your story' },
  { id: 'proof', label: 'Proof' },
  { id: 'offer', label: 'The offer' },
  { id: 'details', label: 'Details' },
];

/** A field of a type, by key — the inspector and the inline-edit names use it. */
export function fieldOf(
  type: SectionTypeId,
  key: string
): BlockField | undefined {
  return DEFINITIONS[type].fields.find((field) => field.key === key);
}
