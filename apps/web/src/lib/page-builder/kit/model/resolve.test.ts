import { describe, expect, it } from 'vitest';
import {
  type ColourSchemeId,
  PAGE_STYLE_IDS,
  type PageDials,
  type PageStyleId,
  SECTION_LAYOUTS,
  SECTION_TYPE_IDS,
} from './ids';
import {
  atmosphereProven,
  continuingSections,
  featuredScheme,
  GROUND_BANDS,
  groundBand,
  HEADED_BY_WORDS,
  resolveGroundBands,
  resolveLayout,
  resolveScheme,
  resolveSections,
  resolveSpacing,
  resolveStyle,
  SIMPLE_SECTIONS,
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

    // With a very dark brand the brand and contrast bands are near-identical
    // and smear into one block. The Style's own `order` is designed apart
    // (catalog.test.ts), but a starter, a creator's reorder or a hidden
    // section between them brings the two together — only the resolver sees
    // the page as it renders.
    it('a Style default that would put contrast straight under brand steps back to base', () => {
      expect(STYLES.bold.schemes.hero).toBe('brand');
      const schemes = resolveSections(
        bold([
          section({ id: 'h', type: 'hero' }),
          section({ id: 'p', type: 'problem' }),
        ])
      ).map((s) => s.scheme);
      expect(schemes).toEqual(['brand', 'base']);
    });

    it('and brand straight under contrast', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'p', type: 'problem' }),
          section({ id: 'c', type: 'cta' }),
        ])
      ).map((s) => s.scheme);
      expect(STYLES.bold.schemes.cta).toBe('brand');
      expect(schemes).toEqual(['contrast', 'base']);
    });

    it('never overrides a brand and contrast pair the creator chose', () => {
      const schemes = resolveSections(
        bold([
          section({ id: 'h', type: 'hero' }),
          section({
            id: 'p',
            type: 'problem',
            design: { scheme: 'contrast' },
          }),
        ])
      ).map((s) => s.scheme);
      expect(schemes).toEqual(['brand', 'contrast']);
    });
  });

  describe('every Style, as a creator first gets it', () => {
    it.each(
      PAGE_STYLE_IDS
    )('%s: its starter and its full page keep coloured bands apart', (style) => {
      for (const [name, types] of [
        ['starter', STYLES[style].starter],
        ['order', STYLES[style].order],
      ] as const) {
        // The bands are the ORDINARY sections: a simple one takes the
        // ground of the band it joins (03 X64), so it is that band, not a
        // second one beside it. Its own joins are proven below.
        const schemes = resolveSections({
          design: { style },
          sections: types.map((type, i) => section({ id: `s${i}`, type })),
        })
          .filter((s) => !SIMPLE_SECTIONS.has(s.type))
          .map((s) => s.scheme);
        for (let i = 1; i < schemes.length; i++) {
          const [above, below] = [schemes[i - 1], schemes[i]];
          const where = `${style} ${name} ${i}: ${above} → ${below}`;
          const pair = new Set([above, below]);
          expect(pair.has('brand') && pair.has('contrast'), where).toBe(false);
          if (below !== 'base') expect(below, where).not.toBe(above);
        }
      }
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

// Codex-61zsk.42: the ground's pole and band, named on the root for
// `styles/schemes.css` (which proves each band's floors).
describe('groundBand — the pole by luminance, then the narrowest band that holds it', () => {
  it('draws the review brands and the seeds in their own bands', () => {
    expect(groundBand('#F3F0E7')).toBe('l90'); // of-blood-and-bones
    expect(groundBand('#E9D8B4')).toBe('l85'); // sand, L 0.887
    expect(groundBand('#F3EEFD')).toBe('l90'); // lilac
    expect(groundBand('#15211C')).toBe('d24'); // night
    expect(groundBand('#17112A')).toBe('d24'); // lilac's dark twin
    expect(groundBand('#fafafa')).toBe('l90'); // the platform's grounds
    expect(groundBand('#171717')).toBe('d24');
  });

  it('switches pole where black and white ink cross (Y 0.1791), not at mid lightness', () => {
    // Greys either side of Y 0.1791: #767676 (Y 0.181) and #757575 (0.178).
    expect(groundBand('#767676')?.[0]).toBe('l');
    expect(groundBand('#757575')?.[0]).toBe('d');
    // A mid-tone past the last band of its pole is drawn on that band.
    expect(groundBand('#767676')).toBe('l65');
    expect(groundBand('#757575')).toBe('d48');
  });

  it('reads #rgb and #rrggbb in any case, and names no band for anything else', () => {
    expect(groundBand('#fff')).toBe('l90');
    expect(groundBand('#000')).toBe('d24');
    expect(groundBand('#15211c')).toBe(groundBand('#15211C'));
    expect(groundBand(' #15211C ')).toBe('d24');
    for (const bad of [null, undefined, '', 'white', '#1234', 'rgb(0 0 0)'])
      expect(groundBand(bad)).toBeUndefined();
  });

  it('lists each pole’s bands narrowest first, every id led by its pole', () => {
    for (const pole of ['light', 'dark'] as const) {
      const edges = GROUND_BANDS.filter((b) => b.pole === pole).map(
        (b) => b.edge
      );
      const sorted = [...edges].sort((a, b) =>
        pole === 'light' ? b - a : a - b
      );
      expect(edges).toEqual(sorted);
    }
    for (const band of GROUND_BANDS)
      expect(band.id[0]).toBe(band.pole === 'light' ? 'l' : 'd');
  });
});

describe('resolveGroundBands — each theme’s ground', () => {
  it('takes the dark twin in dark mode, else the light background (as org-brand.css paints it)', () => {
    expect(resolveGroundBands({ light: '#F3EEFD', dark: '#17112A' })).toEqual({
      light: 'l90',
      dark: 'd24',
    });
    expect(resolveGroundBands({ light: '#15211C' })).toEqual({
      light: 'd24',
      dark: 'd24',
    });
    expect(resolveGroundBands({ light: '#F3F0E7', dark: null })).toEqual({
      light: 'l90',
      dark: 'l90',
    });
  });

  it('lets a page’s own background decide its own theme only (owner, D7)', () => {
    expect(
      resolveGroundBands({ light: '#F3F0E7' }, { light: '#15211C' })
    ).toEqual({ light: 'd24', dark: 'l90' });
    expect(
      resolveGroundBands({ light: '#F3F0E7' }, { dark: '#15211C' })
    ).toEqual({ light: 'l90', dark: 'd24' });
  });

  it('names no band for the platform’s ground', () => {
    expect(resolveGroundBands({})).toEqual({
      light: undefined,
      dark: undefined,
    });
    expect(resolveGroundBands({ light: null, dark: null })).toEqual({
      light: undefined,
      dark: undefined,
    });
  });
});

describe('atmosphereProven — the moving background only on the bands its veil is sized for', () => {
  it('holds on the platform and the bands whose veil still shows the shader (03 X50)', () => {
    expect(atmosphereProven({})).toBe(true);
    expect(atmosphereProven({ light: 'l90', dark: 'd24' })).toBe(true);
    expect(atmosphereProven({ light: 'l90', dark: 'l90' })).toBe(true);
    expect(atmosphereProven({ light: 'l85', dark: 'l85' })).toBe(true);
    expect(atmosphereProven({ light: 'l90', dark: 'd30' })).toBe(true);
    expect(atmosphereProven({ light: 'l80', dark: 'l80' })).toBe(false);
    expect(atmosphereProven({ light: 'l90', dark: 'd36' })).toBe(false);
  });
});

// B2 (owner, D4: "On by default (Recommended)"), narrowed by D16 ("Opening
// only (Recommended)"): with an org shader the page's opening takes the org's
// moving background, and the closing ask keeps its Style's own band.
describe('an org shader — the hero defaults to atmosphere, the closing ask keeps its Style’s (D16)', () => {
  it('changes only the hero’s Style default, in every Style', () => {
    for (const style of PAGE_STYLE_IDS)
      for (const type of SECTION_TYPE_IDS) {
        const plain = STYLES[style].schemes[type] ?? 'base';
        expect(resolveScheme(type, undefined, style), `${style} ${type}`).toBe(
          plain
        );
        expect(
          resolveScheme(type, undefined, style, { orgShader: true }),
          `${style} ${type}`
        ).toBe(type === 'hero' ? 'atmosphere' : plain);
      }
  });

  it('never overrides a scheme the page set, so a closing ask can still take it', () => {
    for (const style of PAGE_STYLE_IDS)
      for (const scheme of ['base', 'brand', 'contrast', 'atmosphere'] as const)
        for (const type of ['hero', 'cta'] as const)
          expect(
            resolveScheme(type, { scheme }, style, { orgShader: true })
          ).toBe(scheme);
  });

  it('draws it, or any scheme the page set to it, as base off the bands it is proven on', () => {
    const off = { light: 'l80', dark: 'd24' } as const;
    const on = { light: 'l85', dark: 'd30' } as const;
    for (const style of PAGE_STYLE_IDS) {
      for (const design of [undefined, { scheme: 'atmosphere' as const }]) {
        expect(
          resolveScheme('hero', design, style, { orgShader: true, grounds: on })
        ).toBe('atmosphere');
        expect(
          resolveScheme('hero', design, style, {
            orgShader: true,
            grounds: off,
          })
        ).toBe('base');
      }
      expect(
        resolveScheme('faq', { scheme: 'brand' }, style, { grounds: off })
      ).toBe('brand');
    }
  });

  it('resolves a whole page with it, and Cinematic as it always was', () => {
    const page = (style: 'quiet' | 'cinematic'): KitPage => ({
      design: { style },
      sections: [
        section({ id: 'h', type: 'hero' }),
        section({ id: 'f', type: 'faq' }),
        section({ id: 'k', type: 'cta' }),
        section({ id: 'k2', type: 'cta', design: { scheme: 'brand' } }),
      ],
    });
    const schemes = (p: KitPage, orgShader?: boolean) =>
      resolveSections(p, { orgShader }).map((s) => s.scheme);
    const faq = STYLES.quiet.schemes.faq;
    const cta = STYLES.quiet.schemes.cta ?? 'base';
    expect(schemes(page('quiet'))).toEqual(['base', faq, cta, 'brand']);
    expect(schemes(page('quiet'), true)).toEqual([
      'atmosphere',
      faq,
      cta,
      'brand',
    ]);
    expect(schemes(page('cinematic'), true)).toEqual(
      schemes(page('cinematic'))
    );
  });
});

describe('continuingSections — no words of its own, on the ground above (03 X58)', () => {
  const base = { scheme: 'base' } as const;
  const pricing = section({
    id: 'pricing',
    type: 'pricing',
    design: base,
    props: { heading: 'Join' },
  });
  const continuing = (sections: KitSection[]) => {
    const page: KitPage = { design: { style: 'studio' }, sections };
    return [...continuingSections(page, resolveSections(page))];
  };

  it('continues untitled questions under the offer on one ground', () => {
    expect(
      continuing([
        pricing,
        section({ id: 'faq', type: 'faq', design: base, props: { items: [] } }),
      ])
    ).toEqual(['faq']);
  });

  it('keeps a section apart once any of its eyebrow, heading or lead is written', () => {
    for (const key of ['eyebrow', 'heading', 'body']) {
      expect(
        continuing([
          pricing,
          section({
            id: 'faq',
            type: 'faq',
            design: base,
            props: { [key]: 'Questions' },
          }),
        ])
      ).toEqual([]);
    }
  });

  it('counts words that are only spaces as none, as the block does', () => {
    expect(
      continuing([
        pricing,
        section({
          id: 'faq',
          type: 'faq',
          design: base,
          props: { heading: '   ' },
        }),
      ])
    ).toEqual(['faq']);
  });

  it('never continues across a change of ground', () => {
    expect(
      continuing([
        pricing,
        section({ id: 'faq', type: 'faq', design: { scheme: 'soft' } }),
      ])
    ).toEqual([]);
  });

  it('never continues on the shader, on a picture or under one', () => {
    const atmosphere = { scheme: 'atmosphere' } as const;
    const picture = { mediaId: 'm1', key: 'k' };
    expect(
      continuing([
        section({
          id: 'a',
          type: 'benefits',
          design: atmosphere,
          props: { heading: 'In it' },
        }),
        section({ id: 'b', type: 'faq', design: atmosphere }),
      ])
    ).toEqual([]);
    expect(
      continuing([
        pricing,
        section({
          id: 'faq',
          type: 'faq',
          design: base,
          props: { background: picture },
        }),
      ])
    ).toEqual([]);
    expect(
      continuing([
        section({
          id: 'pricing',
          type: 'pricing',
          design: base,
          props: { background: picture },
        }),
        section({ id: 'faq', type: 'faq', design: base }),
      ])
    ).toEqual([]);
  });

  it('never continues the opening or the closing ask, which draw their own backdrops', () => {
    expect(
      continuing([
        section({ id: 'hero', type: 'hero', design: base }),
        section({ id: 'benefits', type: 'benefits', design: base }),
        section({ id: 'cta', type: 'cta', design: base }),
        section({ id: 'faq', type: 'faq', design: base }),
      ])
    ).toEqual([]);
  });

  it('only for blocks whose head is their eyebrow, heading and lead', () => {
    // An untitled pricing section still draws its own head (the offers' words).
    expect(
      continuing([
        section({
          id: 'faq',
          type: 'faq',
          design: base,
          props: { heading: 'Questions' },
        }),
        section({ id: 'pricing', type: 'pricing', design: base }),
      ])
    ).toEqual([]);
    expect(HEADED_BY_WORDS.has('pricing')).toBe(false);
  });

  it('reads the section rendered above: a hidden one between is not there', () => {
    expect(
      continuing([
        pricing,
        section({
          id: 'hidden',
          type: 'gallery',
          enabled: false,
          design: { scheme: 'soft' },
        }),
        section({ id: 'faq', type: 'faq', design: base }),
      ])
    ).toEqual(['faq']);
  });

  it('never continues the first section', () => {
    expect(
      continuing([section({ id: 'faq', type: 'faq', design: base })])
    ).toEqual([]);
  });
});

describe("the page's dials (03 X61)", () => {
  /** A Style's whole page, in its own order, at a dial setting. */
  const whole = (style: PageStyleId, dials?: PageDials): KitPage => ({
    design: dials ? { style, dials } : { style },
    sections: STYLES[style].order.map((type) => section({ id: type, type })),
  });
  const schemes = (page: KitPage, orgShader?: boolean) =>
    resolveSections(page, { orgShader }).map((s) => s.scheme);
  /** The page's bands: its ordinary sections. A simple one takes the band it
   *  joins (03 X64), so it is that band, not a second one beside it. */
  const bands = (page: KitPage) =>
    resolveSections(page)
      .filter((s) => !SIMPLE_SECTIONS.has(s.type))
      .map((s) => s.scheme);
  const COLOURED: readonly ColourSchemeId[] = ['contrast', 'brand', 'accent'];

  it('leave a page that sets none exactly as its Style', () => {
    for (const style of PAGE_STYLE_IDS)
      expect(resolveSections(whole(style, {})), style).toEqual(
        resolveSections(whole(style))
      );
  });

  describe('colour', () => {
    it('muted brings every coloured band the Style picks down to the soft tint', () => {
      for (const style of PAGE_STYLE_IDS) {
        const muted = schemes(whole(style, { colour: 'muted' }));
        expect(
          muted.filter((scheme) => COLOURED.includes(scheme)),
          style
        ).toEqual([]);
      }
      expect(schemes(whole('bold', { colour: 'muted' }))).toContain('soft');
    });

    it('vivid takes every soft tint up to the brand colour unless a band stands beside it', () => {
      for (const style of PAGE_STYLE_IDS) {
        const before = bands(whole(style));
        const vivid = bands(whole(style, { colour: 'vivid' }));
        before.forEach((scheme, i) => {
          if (scheme !== 'soft') return;
          const banded = [before[i - 1], before[i + 1]].some(
            (beside) => beside === 'brand' || beside === 'contrast'
          );
          expect(vivid[i], `${style} ${i}`).toBe(banded ? 'soft' : 'brand');
        });
      }
    });

    it("vivid keeps the Style's closing ask in the brand colour", () => {
      // Soft's questions are a soft tint right above its brand ask: taken to
      // the brand colour, they would leave the ask stepped back to the ground.
      expect(STYLES.soft.schemes.faq).toBe('soft');
      expect(STYLES.soft.schemes.cta).toBe('brand');
      const vivid = resolveSections(whole('soft', { colour: 'vivid' }));
      expect(vivid.find((s) => s.type === 'cta')?.scheme).toBe('brand');
      expect(vivid.find((s) => s.type === 'faq')?.scheme).toBe('soft');
    });

    it('vivid looks past a simple section to the band beyond it (03 X64)', () => {
      // A Picture between Soft's questions and its brand ask takes one of
      // their bands, so the questions must still yield to the ask: taken to
      // the brand colour, they would leave the ask stepped back.
      const order = STYLES.soft.order;
      expect(order.indexOf('cta') - order.indexOf('faq')).toBe(1);
      const vivid = resolveSections({
        design: { style: 'soft', dials: { colour: 'vivid' } },
        sections: order.flatMap((type) =>
          type === 'cta'
            ? [
                section({ id: 'picture', type: 'picture' }),
                section({ id: type, type }),
              ]
            : [section({ id: type, type })]
        ),
      });
      expect(vivid.find((s) => s.type === 'faq')?.scheme).toBe('soft');
      expect(vivid.find((s) => s.type === 'cta')?.scheme).toBe('brand');
    });

    it('vivid finds nothing before the first section, not the last band on the page', () => {
      const sections = [
        section({ id: 'faq', type: 'faq' }),
        section({ id: 'text', type: 'text' }),
        section({ id: 'cta', type: 'cta' }),
      ];
      // The premise: a soft tint first, the ground, the brand ask last.
      expect(schemes({ design: { style: 'soft' }, sections })).toEqual([
        'soft',
        'base',
        'brand',
      ]);
      expect(
        schemes({
          design: { style: 'soft', dials: { colour: 'vivid' } },
          sections,
        })[0]
      ).toBe('brand');
    });

    it('keeps the ground the ground, and leaves Quiet, which draws no bands, as it is', () => {
      for (const style of PAGE_STYLE_IDS) {
        const before = schemes(whole(style));
        for (const colour of ['muted', 'vivid'] as const) {
          const after = schemes(whole(style, { colour }));
          before.forEach((scheme, i) => {
            if (scheme === 'base')
              expect(after[i], `${style} ${colour} ${i}`).toBe('base');
          });
        }
      }
      for (const colour of ['muted', 'vivid'] as const)
        expect(schemes(whole('quiet', { colour }))).toEqual(
          schemes(whole('quiet'))
        );
    });

    it("moves only the Style's choice: the creator's scheme and the org's moving background stay", () => {
      const page = (colour: 'muted' | 'vivid'): KitPage => ({
        design: { style: 'clean', dials: { colour } },
        sections: [
          section({ id: 'h', type: 'hero' }),
          section({ id: 'v', type: 'video', design: { scheme: 'contrast' } }),
          section({ id: 't', type: 'text', design: { scheme: 'soft' } }),
        ],
      });
      expect(schemes(page('muted'), true)).toEqual([
        'atmosphere',
        'contrast',
        'soft',
      ]);
      expect(schemes(page('vivid'), true)).toEqual([
        'atmosphere',
        'contrast',
        'soft',
      ]);
    });

    it('never puts a band beside its twin, or the brand colour beside contrast, in any Style', () => {
      for (const style of PAGE_STYLE_IDS)
        for (const colour of [undefined, 'muted', 'vivid'] as const) {
          const drawn = bands(whole(style, colour ? { colour } : undefined));
          drawn.slice(1).forEach((scheme, i) => {
            const above = drawn[i];
            const label = `${style} ${colour ?? 'style'} ${i + 1}`;
            if (scheme !== 'base') expect(scheme, label).not.toBe(above);
            expect([scheme, above].sort().join(), label).not.toBe(
              'brand,contrast'
            );
          });
        }
    });

    it('applies the same rungs to one section on its own', () => {
      expect(resolveScheme('cta', undefined, 'soft', {}, 'muted')).toBe('soft');
      expect(resolveScheme('faq', undefined, 'soft', {}, 'vivid')).toBe(
        'brand'
      );
      expect(
        resolveScheme('cta', { scheme: 'brand' }, 'soft', {}, 'muted')
      ).toBe('brand');
      expect(
        resolveScheme('hero', undefined, 'soft', { orgShader: true }, 'vivid')
      ).toBe('atmosphere');
    });
  });

  describe('spacing', () => {
    it('sets the rhythm of every section that picks none', () => {
      for (const spacing of ['compact', 'spacious'] as const) {
        const drawn = resolveSections(whole('bold', { spacing }));
        expect(new Set(drawn.map((s) => s.spacing))).toEqual(
          new Set([spacing])
        );
      }
      expect(resolveSpacing(undefined, 'band', 'spacious')).toBe('spacious');
    });

    it("keeps a section's own spacing, and a compact layout's", () => {
      expect(resolveSpacing({ spacing: 'regular' }, 'band', 'spacious')).toBe(
        'regular'
      );
      expect(resolveSpacing(undefined, 'compact', 'spacious')).toBe('compact');
      expect(
        resolveSpacing({ spacing: 'spacious' }, 'compact', 'compact')
      ).toBe('spacious');
    });
  });
});
