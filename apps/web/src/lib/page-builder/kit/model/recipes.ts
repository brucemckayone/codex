/**
 * Starting pages (03-expressive-contract §8): the ordered sections a new page
 * can begin with.
 *
 * A recipe names section TYPES, and a layout only where its point depends on
 * one — the journey's scroll story and map, the video page's full-screen
 * hero. Every other layout, and every colour, resolves from the page's Style
 * (`resolve.ts`), so a recipe is Style-agnostic: one list reads as eight
 * different pages. Each section's words are its type's own starter for this
 * course (`template.ts`), never a placeholder.
 */
import type { LayoutId, SectionTypeId } from './ids';
import { starterSection } from './template';
import type { KitSection, TemplateContext } from './types';

/** One section of a recipe: its type, and its layout where the recipe pins one. */
type RecipeSection = {
  [T in SectionTypeId]: { type: T; layout?: LayoutId<T> };
}[SectionTypeId];

/** In the order the empty page offers them. */
export const RECIPE_IDS = [
  'full',
  'short',
  'journey',
  'video',
  'show',
] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export interface Recipe {
  id: RecipeId;
  label: string;
  /** One plain sentence for the empty page. */
  description: string;
  sections: readonly RecipeSection[];
}

export const RECIPES: Readonly<Record<RecipeId, Recipe>> = {
  full: {
    id: 'full',
    label: 'The full story',
    description:
      'Every part of the case for your course, from the problem it solves to the questions people ask.',
    sections: [
      { type: 'hero' },
      { type: 'problem' },
      { type: 'transformation' },
      { type: 'benefits' },
      { type: 'curriculum' },
      { type: 'instructor' },
      { type: 'testimonials' },
      { type: 'pricing' },
      { type: 'faq' },
      { type: 'cta' },
    ],
  },
  short: {
    id: 'short',
    label: 'Short and direct',
    description:
      'Just the essentials: what is included, what people say and the price.',
    sections: [
      { type: 'hero' },
      { type: 'benefits' },
      { type: 'testimonials' },
      { type: 'pricing' },
      { type: 'faq' },
      { type: 'cta' },
    ],
  },
  journey: {
    id: 'journey',
    label: 'The journey',
    description:
      'Your course told as a journey: a story whose picture changes as visitors read, then a map of every stage.',
    sections: [
      { type: 'hero' },
      { type: 'story', layout: 'scroll' },
      { type: 'curriculum', layout: 'map' },
      { type: 'instructor' },
      { type: 'testimonials' },
      { type: 'pricing' },
      { type: 'cta' },
    ],
  },
  video: {
    id: 'video',
    label: 'Video first',
    description:
      'Opens on a full-screen image and your video, then gives the reasons to join.',
    sections: [
      { type: 'hero', layout: 'cover' },
      { type: 'video' },
      { type: 'benefits' },
      { type: 'testimonials' },
      { type: 'pricing' },
      { type: 'cta' },
    ],
  },
  show: {
    id: 'show',
    label: 'Show the work',
    description:
      'Lets your own pictures do the talking, with a few words beside them.',
    sections: [
      { type: 'hero' },
      { type: 'gallery' },
      { type: 'text' },
      { type: 'testimonials' },
      { type: 'pricing' },
      { type: 'cta' },
    ],
  },
};

/**
 * A recipe's sections for this course: each type's starter words, and its
 * layout only where the recipe pins one — stored as the section's `variant`,
 * so changing Style re-composes everything else but never that.
 */
export function recipeSections(
  id: RecipeId,
  context: TemplateContext,
  makeId?: () => string
): KitSection[] {
  return RECIPES[id].sections.map(({ type, layout }) => {
    const section = starterSection(type, context, makeId);
    return layout ? { ...section, variant: layout } : section;
  });
}
