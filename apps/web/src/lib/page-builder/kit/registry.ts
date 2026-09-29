/**
 * Every section type's component (contract amendment A2) — the Svelte half of
 * the catalogue; `model/catalog.ts` holds the definitions.
 *
 * An AGGREGATOR ONLY: a later WP replaces the files inside its own
 * `blocks/<type>/` folder and never edits this one. Each block takes the
 * untyped `BlockProps` and coerces through its own definition, so the map
 * needs no per-type casts and a block is safe however it is mounted.
 */
import type { Component } from 'svelte';
import BenefitsBlock from './blocks/benefits/BenefitsBlock.svelte';
import CtaBlock from './blocks/cta/CtaBlock.svelte';
import CurriculumBlock from './blocks/curriculum/CurriculumBlock.svelte';
import FaqBlock from './blocks/faq/FaqBlock.svelte';
import GalleryBlock from './blocks/gallery/GalleryBlock.svelte';
import HeroBlock from './blocks/hero/HeroBlock.svelte';
import InstructorBlock from './blocks/instructor/InstructorBlock.svelte';
import PreviewBlock from './blocks/preview/PreviewBlock.svelte';
import PricingBlock from './blocks/pricing/PricingBlock.svelte';
import ProblemBlock from './blocks/problem/ProblemBlock.svelte';
import StatsBlock from './blocks/stats/StatsBlock.svelte';
import StoryBlock from './blocks/story/StoryBlock.svelte';
import TestimonialsBlock from './blocks/testimonials/TestimonialsBlock.svelte';
import TextBlock from './blocks/text/TextBlock.svelte';
import TransformationBlock from './blocks/transformation/TransformationBlock.svelte';
import VideoBlock from './blocks/video/VideoBlock.svelte';
import { DEFINITIONS } from './model/catalog';
import type { SectionTypeId } from './model/ids';
import type { BlockDefinition, BlockProps } from './model/types';

export type KitBlockComponent = Component<BlockProps>;

export const BLOCKS: Readonly<Record<SectionTypeId, KitBlockComponent>> = {
  hero: HeroBlock,
  video: VideoBlock,
  problem: ProblemBlock,
  transformation: TransformationBlock,
  benefits: BenefitsBlock,
  curriculum: CurriculumBlock,
  preview: PreviewBlock,
  instructor: InstructorBlock,
  testimonials: TestimonialsBlock,
  faq: FaqBlock,
  pricing: PricingBlock,
  cta: CtaBlock,
  stats: StatsBlock,
  text: TextBlock,
  story: StoryBlock,
  gallery: GalleryBlock,
};

export interface KitBlock {
  definition: BlockDefinition;
  component: KitBlockComponent;
}

export function blockFor(type: SectionTypeId): KitBlock {
  return { definition: DEFINITIONS[type], component: BLOCKS[type] };
}
