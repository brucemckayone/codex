import { describe, expect, it } from 'vitest';
import { DEFINITIONS } from './catalog';
import { isLayoutOf, isSectionTypeId, PAGE_STYLE_IDS } from './ids';
import { RECIPE_IDS, RECIPES, recipeSections } from './recipes';
import { resolveSections } from './resolve';

const course = {
  courseTitle: 'Steady Ground',
  courseLede: 'Calmer mornings in six weeks.',
};

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe('RECIPES — the starting pages a new page can begin with (03 §8)', () => {
  it('are the contract’s five, in its order, with its sections', () => {
    expect([...RECIPE_IDS]).toEqual([
      'full',
      'short',
      'journey',
      'video',
      'show',
    ]);
    const table = RECIPE_IDS.map((id) => [
      id,
      RECIPES[id].label,
      RECIPES[id].sections.map((s) =>
        s.layout ? `${s.type}:${s.layout}` : s.type
      ),
    ]);
    expect(table).toEqual([
      [
        'full',
        'The full story',
        [
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
      ],
      [
        'short',
        'Short and direct',
        ['hero', 'benefits', 'testimonials', 'pricing', 'faq', 'cta'],
      ],
      [
        'journey',
        'The journey',
        [
          'hero',
          'story:scroll',
          'curriculum:map',
          'instructor',
          'testimonials',
          'pricing',
          'cta',
        ],
      ],
      [
        'video',
        'Video first',
        ['hero:cover', 'video', 'benefits', 'testimonials', 'pricing', 'cta'],
      ],
      [
        'show',
        'Show the work',
        ['hero', 'gallery', 'text', 'testimonials', 'pricing', 'cta'],
      ],
    ]);
  });

  it.each(
    RECIPE_IDS
  )('%s names real types, each layout it pins is one its type has', (id) => {
    const recipe = RECIPES[id];
    expect(recipe.id).toBe(id);
    expect(recipe.description.trim()).not.toBe('');
    for (const { type, layout } of recipe.sections) {
      expect(isSectionTypeId(type), type).toBe(true);
      if (layout !== undefined)
        expect(isLayoutOf(type, layout), `${type}:${layout}`).toBe(true);
    }
  });

  it.each(
    RECIPE_IDS
  )('%s starts with a hero and holds each type at most as often as it may', (id) => {
    const types = RECIPES[id].sections.map((s) => s.type);
    expect(types[0]).toBe('hero');
    for (const type of new Set(types)) {
      const max = DEFINITIONS[type].max;
      if (max !== undefined) {
        expect(types.filter((t) => t === type).length).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('recipeSections — a recipe filled for this course', () => {
  it('gives each section its type’s starter words and pins only the recipe’s layouts', () => {
    const sections = recipeSections('journey', course, counter());
    expect(sections.map((s) => s.id)).toEqual(
      sections.map((_, i) => `id-${i + 1}`)
    );
    for (const section of sections) {
      expect(section.enabled).toBe(true);
      expect(section.props).toEqual(DEFINITIONS[section.type].starter(course));
      expect(section.design).toBeUndefined();
    }
    expect(sections.map((s) => s.variant)).toEqual([
      undefined,
      'scroll',
      'map',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(sections[0].props.heading).toBe('Steady Ground');
  });

  it.each(
    PAGE_STYLE_IDS
  )('keeps its pinned layouts in %s and resolves every section', (style) => {
    for (const id of RECIPE_IDS) {
      const resolved = resolveSections({
        design: { style },
        sections: recipeSections(id, course),
      });
      expect(resolved.map((s) => s.type)).toEqual(
        RECIPES[id].sections.map((s) => s.type)
      );
      RECIPES[id].sections.forEach(({ layout }, i) => {
        if (layout) expect(resolved[i].layout).toBe(layout);
      });
    }
  });
});
