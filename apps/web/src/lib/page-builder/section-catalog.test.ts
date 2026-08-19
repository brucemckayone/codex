import { describe, expect, it } from 'vitest';
import {
  createDefaultSections,
  createSection,
  defaultSectionOrder,
  findSectionDefinition,
  firstSectionMatch,
  listSectionDefinitions,
  resolveDesign,
  resolveVariant,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_DEFAULTS,
  SECTION_DESIGN_VALUES,
  sectionMatchesQuery,
  variantsForType,
} from './section-catalog';

const EXPECTED_ORDER = [
  'hero',
  'introVideo',
  'ache',
  'turn',
  'reel',
  'map',
  'feel',
  'proof',
  'guide',
  'faq',
  'invite',
];

describe('SECTION_CATALOG', () => {
  it('ships the course template section set in order (SPEC §4.1)', () => {
    expect(SECTION_CATALOG.map((d) => d.type)).toEqual(EXPECTED_ORDER);
  });

  it('has a unique type per definition', () => {
    const types = SECTION_CATALOG.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('every definition carries a label, summary, icon and keywords', () => {
    for (const def of SECTION_CATALOG) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.summary.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('listSectionDefinitions / defaultSectionOrder', () => {
  it('lists every definition in ship order', () => {
    expect(listSectionDefinitions()).toBe(SECTION_CATALOG);
  });

  it('defaultSectionOrder mirrors the catalogue order', () => {
    expect(defaultSectionOrder()).toEqual(EXPECTED_ORDER);
  });
});

describe('findSectionDefinition', () => {
  it('finds a known section type', () => {
    expect(findSectionDefinition('invite')?.label).toBe('The invite');
  });

  it('returns null for an unknown / widened type', () => {
    expect(findSectionDefinition('retreat-schedule')).toBeNull();
  });
});

describe('sectionMatchesQuery', () => {
  const hero = SECTION_CATALOG[0];

  it('matches every section on an empty / whitespace query', () => {
    expect(sectionMatchesQuery(hero, '')).toBe(true);
    expect(sectionMatchesQuery(hero, '   ')).toBe(true);
  });

  it('matches on the label (case-insensitive substring)', () => {
    expect(sectionMatchesQuery(hero, 'HER')).toBe(true);
  });

  it('matches on a keyword synonym', () => {
    // 'invite' carries the 'pricing' keyword.
    const invite = findSectionDefinition('invite');
    expect(invite && sectionMatchesQuery(invite, 'pricing')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(sectionMatchesQuery(hero, 'zzzznope')).toBe(false);
  });
});

describe('firstSectionMatch', () => {
  it('returns null for an empty query', () => {
    expect(firstSectionMatch('')).toBeNull();
  });

  it('returns the first matching section in ship order', () => {
    // Both 'hero' and 'invite' carry the 'cta' keyword; hero is first.
    expect(firstSectionMatch('cta')?.type).toBe('hero');
  });

  it('returns null when nothing matches', () => {
    expect(firstSectionMatch('zzzznope')).toBeNull();
  });
});

describe('variants', () => {
  it('every definition lists variants with a defaultVariant present in the set', () => {
    for (const def of SECTION_CATALOG) {
      expect(def.variants.length).toBeGreaterThan(0);
      expect(def.variants.some((v) => v.id === def.defaultVariant)).toBe(true);
    }
  });

  it('variantsForType returns the type set and empty for an unknown type', () => {
    expect(variantsForType('hero').length).toBeGreaterThanOrEqual(2);
    expect(variantsForType('retreat-x')).toEqual([]);
  });

  it('resolveVariant falls back to the default for an unset/unknown variant', () => {
    expect(resolveVariant({ type: 'hero', variant: undefined })).toBe(
      'centered'
    );
    expect(resolveVariant({ type: 'hero', variant: 'bogus' })).toBe('centered');
    expect(resolveVariant({ type: 'hero', variant: 'split' })).toBe('split');
  });

  it('createSection seeds id, default variant, name and a cloned props bag', () => {
    const s = createSection('faq', () => 'sec-x');
    expect(s).toMatchObject({
      id: 'sec-x',
      type: 'faq',
      enabled: true,
      variant: 'accordion',
    });
    expect(s.props.heading).toBeDefined();
    // props are a distinct clone — mutating must not leak into the catalogue.
    s.props.heading = 'mutated';
    expect(createSection('faq', () => 'sec-y').props.heading).not.toBe(
      'mutated'
    );
  });

  it('createSection yields an empty, variant-less section for an unknown type', () => {
    const s = createSection('retreat-x', () => 'sec-z');
    expect(s.variant).toBeUndefined();
    expect(s.props).toEqual({});
  });
});

describe('createDefaultSections', () => {
  it('builds one enabled section per catalogue entry, in order, seeded with its default variant + copy', () => {
    let n = 0;
    const sections = createDefaultSections(() => `sec-${n++}`);
    expect(sections.map((s) => s.type)).toEqual(EXPECTED_ORDER);
    expect(sections.every((s) => s.enabled)).toBe(true);
    // Seeded so a brand-new page renders populated, not blank.
    expect(sections.every((s) => Object.keys(s.props).length > 0)).toBe(true);
    expect(
      sections.every(
        (s) => typeof s.variant === 'string' && s.variant.length > 0
      )
    ).toBe(true);
    expect(sections[0].variant).toBe('centered');
    expect(sections[0].props.headline).toBeDefined();
  });

  it('uses the injected id factory', () => {
    let n = 0;
    const sections = createDefaultSections(() => `sec-${n++}`);
    expect(sections[0].id).toBe('sec-0');
    expect(sections.at(-1)?.id).toBe(`sec-${EXPECTED_ORDER.length - 1}`);
  });

  it('mints unique ids by default (crypto.randomUUID)', () => {
    const ids = createDefaultSections().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── Design axes (docs/design/journey-sections/02-axis-contract.md) ───────────

describe('SECTION_DESIGN_* vocabulary', () => {
  it('declares exactly the nine axes, and a default + value list for each', () => {
    expect([...SECTION_DESIGN_AXES]).toEqual([
      'width',
      'density',
      'surface',
      'edge',
      'align',
      'type',
      'accent',
      'motion',
      'media',
    ]);
    for (const axis of SECTION_DESIGN_AXES) {
      expect(SECTION_DESIGN_VALUES[axis].length).toBeGreaterThan(1);
      expect(SECTION_DESIGN_DEFAULTS[axis]).toBeDefined();
    }
  });

  it('every axis DEFAULT is one of that axis’ legal values', () => {
    // Guards the failure that would be invisible otherwise: a typo'd default
    // emits an attribute matching no CSS rule on EVERY section of every page.
    for (const axis of SECTION_DESIGN_AXES) {
      expect(SECTION_DESIGN_VALUES[axis]).toContain(
        SECTION_DESIGN_DEFAULTS[axis]
      );
    }
  });

  it('lists no duplicate values within an axis', () => {
    for (const axis of SECTION_DESIGN_AXES) {
      const values = SECTION_DESIGN_VALUES[axis];
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe('resolveDesign', () => {
  it('is TOTAL — every axis is present even with nothing set anywhere', () => {
    // The renderer emits one attribute per axis; a missing value would emit an
    // EMPTY attribute that matches no rule.
    const design = resolveDesign({}, null);
    expect(Object.keys(design).sort()).toEqual([...SECTION_DESIGN_AXES].sort());
    expect(design).toEqual(SECTION_DESIGN_DEFAULTS);
  });

  it('falls back to the axis defaults for a section with no design bag', () => {
    expect(resolveDesign({ design: undefined }, {})).toEqual(
      SECTION_DESIGN_DEFAULTS
    );
    expect(resolveDesign(null, null)).toEqual(SECTION_DESIGN_DEFAULTS);
  });

  it('applies the PAGE-level look to every axis the page names', () => {
    const design = resolveDesign(
      {},
      { design: { width: 'narrow', motion: 'drift', accent: 'glow' } }
    );
    expect(design.width).toBe('narrow');
    expect(design.motion).toBe('drift');
    expect(design.accent).toBe('glow');
    // Axes the page said nothing about still take the default.
    expect(design.density).toBe(SECTION_DESIGN_DEFAULTS.density);
  });

  it('lets a section override the page PER AXIS, not all-or-nothing', () => {
    // The modelling that matters: a `vast` hero above a `compact` FAQ is good
    // design, so a section stating one axis must not discard the page's others.
    const design = resolveDesign(
      { design: { density: 'vast' } },
      { design: { width: 'wide', density: 'compact', motion: 'none' } }
    );
    expect(design.density).toBe('vast');
    expect(design.width).toBe('wide');
    expect(design.motion).toBe('none');
  });

  it('drops an UNKNOWN axis value back to the default instead of passing it through', () => {
    // Forward-compatibility, exactly as an unknown `variant` degrades: a future
    // client's new value must render as the default, never reach the DOM as an
    // attribute that matches no CSS rule.
    const design = resolveDesign({
      design: {
        // @ts-expect-error — deliberately not a declared value
        width: 'ultra-wide',
        // @ts-expect-error — deliberately not a declared value
        motion: 'explode',
      },
    });
    expect(design.width).toBe(SECTION_DESIGN_DEFAULTS.width);
    expect(design.motion).toBe(SECTION_DESIGN_DEFAULTS.motion);
  });

  it('skips a garbage section value and still honours the page for that axis', () => {
    const design = resolveDesign(
      // @ts-expect-error — jsonb round-trips arbitrary shapes
      { design: { width: 42, align: null, surface: {} } },
      { design: { width: 'full', align: 'start', surface: 'panel' } }
    );
    expect(design.width).toBe('full');
    expect(design.align).toBe('start');
    expect(design.surface).toBe('panel');
  });

  it('accepts every declared value of every axis unchanged', () => {
    for (const axis of SECTION_DESIGN_AXES) {
      for (const value of SECTION_DESIGN_VALUES[axis]) {
        const design = resolveDesign({ design: { [axis]: value } });
        expect(design[axis]).toBe(value);
      }
    }
  });
});
