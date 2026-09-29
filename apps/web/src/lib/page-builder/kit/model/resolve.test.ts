import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS, SECTION_LAYOUTS, SECTION_TYPE_IDS } from './ids';
import {
  featuredScheme,
  resolveLayout,
  resolveScheme,
  resolveSections,
  resolveSpacing,
  resolveStyle,
} from './resolve';
import { STYLES } from './styles';
import type { KitPage, KitSection } from './types';

function section(
  overrides: Partial<KitSection> & Pick<KitSection, 'id' | 'type'>
): KitSection {
  return { enabled: true, props: {}, ...overrides };
}

describe('resolveStyle', () => {
  it('defaults to Bold and ignores ids that are not Styles', () => {
    expect(resolveStyle(undefined)).toBe('bold');
    expect(resolveStyle({})).toBe('bold');
    expect(resolveStyle({ style: 'candlelit' as never })).toBe('bold');
    expect(resolveStyle({ style: 'soft' })).toBe('soft');
  });
});

describe('resolveLayout — section → Style → first layout', () => {
  it('keeps a layout the creator picked when it is valid for the type', () => {
    expect(resolveLayout('hero', 'cover', 'bold')).toBe('cover');
  });

  it('falls back to the Style default for an absent or foreign layout', () => {
    expect(resolveLayout('hero', undefined, 'clean')).toBe('split');
    // `grid` is a real layout, but not a hero one.
    expect(resolveLayout('hero', 'grid', 'soft')).toBe('centered');
  });

  it('gives every type in every Style a layout of that type', () => {
    for (const style of PAGE_STYLE_IDS) {
      for (const type of SECTION_TYPE_IDS) {
        expect(SECTION_LAYOUTS[type]).toContain(
          resolveLayout(type, null, style)
        );
      }
    }
  });
});

describe('resolveScheme and resolveSpacing', () => {
  it('prefers the section, then the Style', () => {
    expect(resolveScheme('pricing', { scheme: 'accent' }, 'bold')).toBe(
      'accent'
    );
    expect(resolveScheme('pricing', {}, 'bold')).toBe(
      STYLES.bold.schemes.pricing
    );
    expect(resolveScheme('hero', { scheme: 'neon' as never }, 'bold')).toBe(
      'brand'
    );
  });

  it('defaults spacing to regular', () => {
    expect(resolveSpacing(undefined)).toBe('regular');
    expect(resolveSpacing({ spacing: 'vast' as never })).toBe('regular');
    expect(resolveSpacing({ spacing: 'compact' })).toBe('compact');
  });

  it('sits a compact layout in a compact band unless its author chose otherwise', () => {
    expect(resolveSpacing(undefined, 'compact')).toBe('compact');
    expect(resolveSpacing({ spacing: 'spacious' }, 'compact')).toBe('spacious');
    expect(resolveSpacing({ spacing: 'regular' }, 'compact')).toBe('regular');
    expect(resolveSpacing(undefined, 'band')).toBe('regular');
  });
});

describe('resolveSections', () => {
  const page: KitPage = {
    design: { style: 'clean' },
    sections: [
      section({ id: 'a', type: 'hero' }),
      section({ id: 'hidden', type: 'faq', enabled: false }),
      section({
        id: 'b',
        type: 'faq',
        variant: 'columns',
        design: { scheme: 'contrast' },
      }),
      section({ id: 'c', type: 'faq' }),
      section({ id: 'd', type: 'hero' }),
      section({ id: 'legacy', type: 'invite' as never }),
    ],
  };

  it('renders only enabled sections of known types, in order', () => {
    expect(resolveSections(page).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('numbers anchors among rendered sections only', () => {
    expect(resolveSections(page).map((s) => s.anchor)).toEqual([
      'hero',
      'faq',
      'faq-2',
      'hero-2',
    ]);
    expect(resolveSections(page).map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('gives the page exactly one h1 — the first visible hero', () => {
    expect(resolveSections(page).map((s) => s.headingLevel)).toEqual([
      1, 2, 2, 2,
    ]);
  });

  it('resolves each unset choice from the Style and keeps each set one', () => {
    const [hero, picked, unset] = resolveSections(page);
    expect(hero).toMatchObject({
      layout: 'split',
      scheme: 'base',
      spacing: 'regular',
    });
    expect(picked).toMatchObject({ layout: 'columns', scheme: 'contrast' });
    expect(unset).toMatchObject({
      layout: STYLES.clean.layouts.faq,
      scheme: STYLES.clean.schemes.faq,
    });
  });

  it('re-composes every unset choice when the Style changes', () => {
    const bold = resolveSections({ ...page, design: { style: 'bold' } });
    expect(bold[0]).toMatchObject({ layout: 'statement', scheme: 'brand' });
    expect(bold[1]).toMatchObject({ layout: 'columns', scheme: 'contrast' });
  });

  describe('keeps coloured bands apart', () => {
    // Bold defaults both `problem` and `transformation` to `contrast`, and
    // both `hero` and `cta` to `brand`.
    const bold = (sections: KitSection[]): KitPage => ({
      design: { style: 'bold' },
      sections,
    });

    it('a Style default that would repeat the band above steps back to base', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'p', type: 'problem' }),
          section({ id: 't', type: 'transformation' }),
          section({ id: 'h', type: 'hero' }),
          section({ id: 'c', type: 'cta' }),
        ])
      ).map((s) => s.scheme);
      expect(STYLES.bold.schemes.problem).toBe('contrast');
      expect(STYLES.bold.schemes.transformation).toBe('contrast');
      expect(schemes).toEqual(['contrast', 'base', 'brand', 'base']);
    });

    it('never overrides a scheme the creator chose, even a repeat', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'p', type: 'problem' }),
          section({
            id: 't',
            type: 'transformation',
            design: { scheme: 'contrast' },
          }),
        ])
      ).map((s) => s.scheme);
      expect(schemes).toEqual(['contrast', 'contrast']);
    });

    it('leaves base after base alone — plain sections flow together', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'a', type: 'text' }),
          section({ id: 'b', type: 'benefits' }),
        ])
      ).map((s) => s.scheme);
      expect(schemes).toEqual(['base', 'base']);
    });

    it('a hidden section between two bands does not keep them apart', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'p', type: 'problem' }),
          section({ id: 'x', type: 'text', enabled: false }),
          section({ id: 't', type: 'transformation' }),
        ])
      ).map((s) => s.scheme);
      expect(schemes).toEqual(['contrast', 'base']);
    });
  });
});

describe('featuredScheme', () => {
  it('maps every section scheme to a scheme in every Style', () => {
    for (const style of PAGE_STYLE_IDS) {
      for (const scheme of [
        'base',
        'soft',
        'contrast',
        'brand',
        'accent',
      ] as const) {
        expect(['base', 'soft', 'contrast', 'brand', 'accent']).toContain(
          featuredScheme(style, scheme)
        );
      }
    }
  });

  it('never features a card in the scheme it sits on', () => {
    for (const style of PAGE_STYLE_IDS) {
      for (const scheme of [
        'base',
        'soft',
        'contrast',
        'brand',
        'accent',
      ] as const) {
        expect(featuredScheme(style, scheme)).not.toBe(scheme);
      }
    }
  });
});
