import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSections,
  createSection,
  defaultSectionOrder,
  findSectionDefinition,
  firstSectionMatch,
  LEGACY_SECTION_VARIANTS,
  legacySectionVariant,
  listSectionDefinitions,
  migrateSectionVariant,
  migrateSectionVariants,
  resolveDesign,
  resolveVariant,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_DEFAULTS,
  SECTION_DESIGN_VALUES,
  sectionMatchesQuery,
  seededSections,
  variantsForType,
} from './section-catalog';
import { SECTION_DESIGN_BY_TYPE } from './section-design-defaults';

/** This file's own directory — the section renderers sit under `render/sections`. */
const HERE_DIR = dirname(fileURLToPath(import.meta.url));

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

  it('no `icon` glyph can render as colour emoji, and none is a Braille codepoint', () => {
    // `icon` is now only the ADVISORY FALLBACK (the rail and the picker draw a
    // design-system icon keyed on `type` — see
    // `$lib/components/page-builder/section-icons.ts`). While the string exists,
    // `SectionEditor`'s inspector header still shows it, so it must not carry an
    // emoji presentation.
    //
    // `guide` was `'☺'` U+263A. Checked against Node's Unicode property escapes,
    // it is the ONLY one of the eleven Unicode classes as emoji-capable — ✦ U+2726
    // and ❝ U+275D are not in the emoji data at all, so neither can take an emoji
    // form and neither was ever the defect. One value, not eight.
    //
    // The Braille half is separate and was not in the bead: `⠿` U+283F (Braille
    // Pattern Dots-123456) was the rail's drag grip. It is not in this list, but
    // the same class of value must not arrive here either.
    for (const def of SECTION_CATALOG) {
      expect(
        /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(def.icon),
        `${def.type}.icon '${def.icon}' can render as colour emoji`
      ).toBe(false);
      expect(
        /[\u2800-\u28ff]/u.test(def.icon),
        `${def.type}.icon '${def.icon}' is a Braille codepoint`
      ).toBe(false);
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
    expect(resolveVariant({ type: 'hero', variant: undefined })).toBe('stage');
    expect(resolveVariant({ type: 'hero', variant: 'bogus' })).toBe('stage');
    expect(resolveVariant({ type: 'hero', variant: 'split-media' })).toBe(
      'split-media'
    );
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
    // …and no rhythm, because the renderer skips the type entirely.
    expect(s.design).toBeUndefined();
  });

  // ── The RHYTHM a new section arrives with ──────────────────────────────────
  //
  // Measured before this change: every section of every published page emitted
  // BYTE-IDENTICAL axis values, and zero of the 28 stored sections carried a
  // `design` key. The mechanism was complete — store writer, inspector control,
  // schema and renderer all present since F-B2 — and nothing ever wrote the
  // exception `setSectionDesignAxis`'s own comment asks for. So the fix is the
  // DEFAULT, and this is where it enters the model.

  it('createSection writes the type’s rhythm bag', () => {
    const faq = createSection('faq', () => 'sec-faq');
    expect(faq.design).toBeDefined();
    // The axes where FAQ differs from the axis defaults, and only those.
    expect(faq.design).toEqual({
      density: 'compact',
      align: 'start',
      type: 'restrained',
      accent: 'none',
      motion: 'fade',
    });
  });

  it('createSection writes NO key the section would inherit anyway', () => {
    // The page look IS the hero's rhythm, so the hero is not an exception to it
    // and must store nothing: absence is how "inherited" is represented, and the
    // inspector paints its "Inherited" pill from exactly that absence.
    const hero = createSection(
      'hero',
      () => 'sec-hero',
      SECTION_DESIGN_BY_TYPE.hero
    );
    expect(hero.design).toBeUndefined();
  });

  it('createSection stores only the axes that differ from the page look', () => {
    // The look every seeded page actually carries (measured live).
    const pageLook = {
      width: 'narrow',
      density: 'airy',
      surface: 'media',
      edge: 'none',
      align: 'center',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'bleed',
    } as const;
    const hero = createSection('hero', () => 'sec-hero', pageLook);
    // Against that look the hero differs on two axes only — and those two are
    // what stop it reading like the sections beneath it.
    expect(hero.design).toEqual({ width: 'full', density: 'vast' });
  });

  it('createSection never writes `media` on a type that resolves none', () => {
    // Only Hero / IntroVideo / Reel / Guide read the `--jp-media-*` family.
    // `Codex-wqxv4`: a stored value that cannot change what renders is a
    // decorative control, and this programme has paid for one already.
    for (const type of [
      'ache',
      'turn',
      'map',
      'feel',
      'proof',
      'faq',
      'invite',
    ]) {
      const section = createSection(type, () => `sec-${type}`);
      expect(section.design, type).toBeDefined();
      expect(section.design?.media, type).toBeUndefined();
    }
  });

  it('createSection returns a bag no other section shares by reference', () => {
    const a = createSection('faq', () => 'a');
    const b = createSection('faq', () => 'b');
    expect(a.design).not.toBe(b.design);
    expect(a.design).not.toBe(SECTION_DESIGN_BY_TYPE.faq);
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
    expect(sections[0].variant).toBe('stage');
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

  it('gives a brand-new page a RHYTHM, not one setting repeated eleven times', () => {
    // This is the assertion form of the defect. Before the change every section
    // of every published page emitted the same nine values; the page read flat
    // because nothing varied. A default set must now vary.
    const sections = createDefaultSections(() => crypto.randomUUID());
    const densities = new Set(sections.map((s) => s.design?.density));
    const surfaces = new Set(sections.map((s) => s.design?.surface));
    expect(densities.size).toBeGreaterThanOrEqual(3);
    expect(surfaces.size).toBeGreaterThanOrEqual(4);
    // Every section carries a bag of its own — none is left to inherit the flat
    // page look wholesale.
    expect(sections.every((s) => s.design !== undefined)).toBe(true);
  });

  it('forwards the page look, so a default set stores exceptions only', () => {
    const sections = createDefaultSections(
      () => crypto.randomUUID(),
      SECTION_DESIGN_BY_TYPE.hero
    );
    const hero = sections.find((s) => s.type === 'hero');
    const faq = sections.find((s) => s.type === 'faq');
    // The hero matches that look exactly, so it is not an exception to it…
    expect(hero?.design).toBeUndefined();
    // …and the FAQ still is.
    expect(faq?.design?.density).toBe('compact');
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

// ── The variant collapse (research §3 · guard bead Codex-qcgo3) ──────────────
//
// Every assertion here is a PROPERTY, never a count. "37 variants" was true for
// exactly as long as it took to write this file down; a total is a test that
// fails on the next legitimate change and teaches nothing when it does.

describe('composition set', () => {
  it('declares a unique, fully described variant id per type', () => {
    for (const def of SECTION_CATALOG) {
      const ids = def.variants.map((v) => v.id);
      expect(new Set(ids).size, `duplicate variant id in ${def.type}`).toBe(
        ids.length
      );
      for (const variant of def.variants) {
        expect(variant.id, `${def.type} variant id`).toMatch(
          /^[a-z][a-z0-9-]*$/
        );
        expect(
          variant.label.length,
          `${def.type}/${variant.id} label`
        ).toBeGreaterThan(0);
        expect(
          variant.hint.length,
          `${def.type}/${variant.id} hint`
        ).toBeGreaterThan(0);
        expect(
          variant.thumb.length,
          `${def.type}/${variant.id} thumb`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every type's defaultVariant names a variant that type declares", () => {
    for (const def of SECTION_CATALOG) {
      expect(
        def.variants.some((v) => v.id === def.defaultVariant),
        `${def.type} defaultVariant "${def.defaultVariant}" is not declared`
      ).toBe(true);
    }
  });
});

describe('LEGACY_SECTION_VARIANTS', () => {
  it('only maps ids that are genuinely retired, onto ids that exist', () => {
    for (const [type, retired] of Object.entries(LEGACY_SECTION_VARIANTS)) {
      const def = findSectionDefinition(type);
      expect(def, `forward map for unknown type ${type}`).not.toBeNull();
      const declared = new Set((def?.variants ?? []).map((v) => v.id));
      for (const [from, to] of Object.entries(retired)) {
        // A retired id must NOT also be declared — otherwise the map is dead
        // code that `resolveVariant` never reaches, and the migration would
        // rewrite a variant that is still current.
        expect(
          declared.has(from),
          `${type}/${from} is retired AND declared`
        ).toBe(false);
        expect(
          declared.has(to.variant),
          `${type}/${from} maps to undeclared "${to.variant}"`
        ).toBe(true);
      }
    }
  });

  it('encodes only LEGAL axis values, so a migrated section never gains a dead attribute', () => {
    for (const [type, retired] of Object.entries(LEGACY_SECTION_VARIANTS)) {
      for (const [from, to] of Object.entries(retired)) {
        for (const [axis, value] of Object.entries(to.design)) {
          expect(
            SECTION_DESIGN_AXES as readonly string[],
            `${type}/${from} names unknown axis ${axis}`
          ).toContain(axis);
          expect(
            SECTION_DESIGN_VALUES[
              axis as keyof typeof SECTION_DESIGN_VALUES
            ] as readonly string[],
            `${type}/${from} sets illegal ${axis}: ${value}`
          ).toContain(value);
        }
      }
    }
  });

  it('legacySectionVariant is total — unknown type, unknown id, and nullish all yield null', () => {
    expect(legacySectionVariant('hero', 'centered')).not.toBeNull();
    expect(legacySectionVariant('hero', 'stage')).toBeNull();
    expect(legacySectionVariant('retreat-x', 'centered')).toBeNull();
    expect(legacySectionVariant(undefined, 'centered')).toBeNull();
    expect(legacySectionVariant('hero', undefined)).toBeNull();
    expect(legacySectionVariant('hero', null)).toBeNull();
  });

  it('resolveVariant carries every retired id to its replacement COMPOSITION', () => {
    for (const [type, retired] of Object.entries(LEGACY_SECTION_VARIANTS)) {
      for (const [from, to] of Object.entries(retired)) {
        expect(resolveVariant({ type, variant: from }), `${type}/${from}`).toBe(
          to.variant
        );
      }
    }
  });

  it('resolveDesign applies a retired id’s axes so appearance is unchanged', () => {
    // `hero: minimal` was `stage` + compact + no accent + no motion.
    const resolved = resolveDesign({
      type: 'hero',
      variant: 'minimal',
      design: undefined,
    });
    expect(resolved.density).toBe('compact');
    expect(resolved.accent).toBe('none');
    expect(resolved.motion).toBe('none');
  });

  it('a retired id’s axes BEAT the page but LOSE to the section’s own', () => {
    const page = {
      design: { align: 'start' as const, density: 'vast' as const },
    };

    // Beats the page: `centered` must still render centred on a start-aligned page.
    expect(
      resolveDesign({ type: 'ache', variant: 'centered' }, page).align
    ).toBe('center');

    // Loses to the section: a creator who set `align: start` on that section keeps it.
    expect(
      resolveDesign(
        { type: 'ache', variant: 'centered', design: { align: 'start' } },
        page
      ).align
    ).toBe('start');

    // An axis the retired id says nothing about still inherits from the page.
    expect(
      resolveDesign({ type: 'ache', variant: 'centered' }, page).density
    ).toBe('vast');
  });

  it('resolveDesign is unaffected for a current variant, and for a section with no type', () => {
    expect(resolveDesign({ type: 'hero', variant: 'stage' })).toEqual(
      SECTION_DESIGN_DEFAULTS
    );
    expect(resolveDesign({ design: { width: 'wide' } }).width).toBe('wide');
  });
});

describe('migrateSectionVariant', () => {
  it('rewrites the variant and merges the axes the retired id encoded', () => {
    const migrated = migrateSectionVariant({
      type: 'ache',
      variant: 'wide',
      props: {},
    } as never) as { variant: string; design: Record<string, string> };
    expect(migrated.variant).toBe('column');
    expect(migrated.design).toEqual({ align: 'start', width: 'text' });
  });

  it('never overwrites an axis the section already states', () => {
    const migrated = migrateSectionVariant({
      type: 'ache',
      variant: 'wide',
      design: { width: 'full' },
    });
    expect(migrated.design).toEqual({ align: 'start', width: 'full' });
  });

  it('is a NO-OP (same reference) for a current id, an unknown id and an unknown type', () => {
    const current = { type: 'ache', variant: 'column' };
    const unknownId = { type: 'ache', variant: 'default' };
    const unknownType = { type: 'retreat-x', variant: 'centered' };
    expect(migrateSectionVariant(current)).toBe(current);
    expect(migrateSectionVariant(unknownId)).toBe(unknownId);
    expect(migrateSectionVariant(unknownType)).toBe(unknownType);
  });

  it('is IDEMPOTENT — migrating a migrated section changes nothing further', () => {
    const once = migrateSectionVariant({ type: 'hero', variant: 'minimal' });
    const twice = migrateSectionVariant(once);
    expect(twice).toBe(once);
  });

  it('migrateSectionVariants returns the SAME array when nothing needed migrating', () => {
    const clean = [
      { type: 'hero', variant: 'stage' },
      { type: 'faq', variant: 'accordion' },
    ];
    expect(migrateSectionVariants(clean)).toBe(clean);

    const dirty = [{ type: 'map', variant: 'descent' }];
    const migrated = migrateSectionVariants(dirty);
    expect(migrated).not.toBe(dirty);
    expect(migrated[0].variant).toBe('spine');
    expect(dirty[0].variant).toBe('descent'); // input untouched
  });
});

describe('the variant ids real pages actually store', () => {
  // Read out of the dev database on the branch that introduced the collapse —
  // every distinct `sections[].variant` across `landing_pages`, including the
  // golden page `pricing-smoke-test`. None of these may resolve to a composition
  // its type does not declare, because that is a published page silently
  // changing layout.
  const STORED: readonly [string, string][] = [
    ['hero', 'split'],
    ['hero', ''],
    ['introVideo', 'cinema'],
    ['ache', 'default'],
    ['ache', 'statement'],
    ['turn', 'centered'],
    ['reel', 'cinema'],
    ['map', 'descent'],
    ['feel', 'centered'],
    ['proof', 'grid'],
    ['faq', 'accordion'],
    ['invite', 'card'],
  ];

  it('resolves every stored id to a composition its type declares', () => {
    for (const [type, variant] of STORED) {
      const resolved = resolveVariant({ type, variant });
      const declared = (findSectionDefinition(type)?.variants ?? []).map(
        (v) => v.id
      );
      expect(declared, `${type}/"${variant}" → ${resolved}`).toContain(
        resolved
      );
    }
  });

  it('keeps the golden page on the SAME compositions it renders today', () => {
    expect(resolveVariant({ type: 'hero', variant: 'split' })).toBe(
      'split-media'
    );
    expect(resolveVariant({ type: 'introVideo', variant: 'cinema' })).toBe(
      'theatre'
    );
    expect(resolveVariant({ type: 'turn', variant: 'centered' })).toBe(
      'column'
    );
    expect(resolveVariant({ type: 'reel', variant: 'cinema' })).toBe('theatre');
    expect(resolveVariant({ type: 'map', variant: 'descent' })).toBe('spine');
    expect(resolveVariant({ type: 'feel', variant: 'centered' })).toBe(
      'column'
    );
    // Untouched by the collapse — still their own compositions.
    expect(resolveVariant({ type: 'ache', variant: 'statement' })).toBe(
      'statement'
    );
    expect(resolveVariant({ type: 'proof', variant: 'grid' })).toBe('grid');
    expect(resolveVariant({ type: 'faq', variant: 'accordion' })).toBe(
      'accordion'
    );
    expect(resolveVariant({ type: 'invite', variant: 'card' })).toBe('card');
  });

  it('an id that never existed still falls to the type default', () => {
    // `ache: 'default'` and `map: 'descent'` WERE stored by the portals seed
    // generator; migration 0091 normalised all 7 seeded pages to legal catalogue
    // ids (ache=column, hero=stage, map=spine, invite=pool) and the generator was
    // fixed, so no live row holds either value today.
    //
    // The fallback still has to hold, and this assertion still has to stand: a
    // restore of a soft-deleted page, a payload from an older client, or a
    // hand-edited row can put an unrecognised id back, and the alternative to
    // falling through is a page that renders nothing.
    expect(resolveVariant({ type: 'ache', variant: 'default' })).toBe('column');
    expect(resolveVariant({ type: 'map', variant: 'descent' })).toBe('spine');
  });
});

// ── Unauthored (seed) copy detection — Codex-maf0y ───────────────────────────
//
// `addSection(type)` seeds every new section from the catalogue's `defaultProps`
// and Save persists it, with no check anywhere between there and a PUBLISHED
// public sales page. A creator who adds a Proof section, never opens it, and
// publishes ships three invented testimonials and "2,400 and counting" — a
// specific factual claim about their business that they never made.
//
// The seed copy stays (an empty block is near-invisible in the inline canvas, so
// a creator cannot see or click the section they just added). The check moves to
// publish time, as a non-blocking warning, and `seededSections` is its pure half.

describe('seededSections', () => {
  it('reports every seeded key of a freshly-added section', () => {
    const faq = createSection('faq', () => 'sec-faq');
    expect(seededSections([faq])).toEqual([
      {
        id: 'sec-faq',
        type: 'faq',
        label: 'FAQ',
        // In `defaultProps` declaration order, so a message reads the way the
        // rail does.
        keys: ['heading', 'q1', 'a1', 'q2', 'a2', 'q3', 'a3'],
      },
    ]);
  });

  it('drops a key the creator has actually edited', () => {
    const faq = createSection('faq', () => 'sec-faq');
    faq.props.q1 = 'Do I need any experience?';
    const [found] = seededSections([faq]);
    expect(found.keys).not.toContain('q1');
    // …and reports the rest, so one edited field does not clear the warning.
    expect(found.keys).toContain('a1');
  });

  it('ignores a key whose SEED IS EMPTY — an empty field is not a placeholder', () => {
    // This is why the check is not `props === defaultProps`. `hero.accent`,
    // `hero.quiet` and `hero.trust` seed `''`; a section left at `''` has had
    // nothing put in its mouth.
    const hero = createSection('hero', () => 'sec-hero');
    const [found] = seededSections([hero]);
    expect(found.keys).not.toContain('accent');
    expect(found.keys).not.toContain('quiet');
    expect(found.keys).not.toContain('trust');
    expect(found.keys).toContain('headline');
  });

  it('reports nothing for a fully-authored section', () => {
    const ache = createSection('ache', () => 'sec-ache');
    for (const key of Object.keys(ache.props)) {
      ache.props[key] = `authored ${key}`;
    }
    expect(seededSections([ache])).toEqual([]);
  });

  it('reports nothing for an unknown/widened type — there is no seed to have leaked', () => {
    expect(
      seededSections([
        { id: 'x', type: 'retreat-schedule', props: { heading: 'anything' } },
      ])
    ).toEqual([]);
  });

  it('names EVERY section of a default page, so the publish warning is honest', () => {
    // The whole default template is placeholder copy on the day it is created.
    const sections = createDefaultSections(() => crypto.randomUUID());
    const found = seededSections(sections);
    expect(found.map((f) => f.type)).toEqual(EXPECTED_ORDER);
    expect(found.every((f) => f.keys.length > 0)).toBe(true);
    // The labels are what a creator is shown; they must be the catalogue's.
    expect(found.map((f) => f.label)).toEqual(
      SECTION_CATALOG.map((d) => d.label)
    );
  });

  it('is a warning input, not a gate — it never mutates the sections it reads', () => {
    const faq = createSection('faq', () => 'sec-faq');
    const before = JSON.stringify(faq);
    seededSections([faq]);
    expect(JSON.stringify(faq)).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The catalogue against the RENDERERS — no offered composition may be unbuilt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE DEFECT THIS CATCHES, and it was live (Codex-wqxv4). `reel: strip` was
 * offered in the catalogue, hinted "A row of clip thumbnails; one plays inline",
 * and absent from `ReelSection.svelte`'s own `COMPOSITIONS` array — which clamps
 * anything it does not know to `theatre`. `ReelSection`'s header said so in
 * capitals ("`strip` STAYS DESCOPED per contract A27") and the picker offered it
 * anyway. So a creator could pick a composition, watch the layout card take the
 * selected state, save, and get a different layout on the published page.
 *
 * The renderer clamp meant nothing CRASHED, which is precisely why it survived:
 * there was no error to find, only a control that quietly did nothing.
 *
 * WHY THE EXPECTED SET IS DERIVED FROM THE RENDERERS rather than restated here:
 * a hand-written list is the thing that went stale. Each section component owns
 * exactly one `const COMPOSITIONS = [...]`, it is the array the component
 * actually branches on, and it is the only honest source for "what can be
 * painted". Parsing it is deliberate coupling.
 *
 * BOTH DIRECTIONS FAIL, and they are different bugs:
 *   offered-but-unbuilt   a dead control — the defect above;
 *   built-but-unoffered   a composition no creator can reach, i.e. dead CSS and
 *                         a layout that only a hand-edited database row selects.
 */
describe('every offered composition is one a renderer can actually paint', () => {
  const RENDER_DIR = join(HERE_DIR, 'render/sections');

  /** `<Type>Section.svelte` for a catalogue type — the file naming convention. */
  const componentFor = (type: string): string =>
    `${type.charAt(0).toUpperCase()}${type.slice(1)}Section.svelte`;

  /** The ids in a component's own `COMPOSITIONS` array. */
  const builtCompositions = (type: string): string[] => {
    const src = readFileSync(join(RENDER_DIR, componentFor(type)), 'utf8');
    const decl = /const COMPOSITIONS(?::[^=]*)? = (\[[^\]]*\])/.exec(src);
    expect(
      decl,
      `${componentFor(type)} declares no COMPOSITIONS`
    ).not.toBeNull();
    return [...(decl?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  };

  it('finds a COMPOSITIONS array in all eleven section components', () => {
    // Guards the guard: a renamed constant or a moved directory would make every
    // assertion below vacuous, and the failure it protects against is silent.
    expect(SECTION_CATALOG).toHaveLength(11);
    for (const def of SECTION_CATALOG) {
      expect(
        builtCompositions(def.type).length,
        `${def.type} built compositions`
      ).toBeGreaterThan(0);
    }
  });

  it('offers exactly the compositions its renderer builds, plus marked ones', () => {
    const mismatches: string[] = [];
    for (const def of SECTION_CATALOG) {
      const built = new Set(builtCompositions(def.type));
      for (const variant of def.variants) {
        const isBuilt = built.has(variant.id);
        if (!isBuilt && !variant.unavailable) {
          mismatches.push(
            `${def.type}/${variant.id} is OFFERED but ${componentFor(def.type)} cannot paint it — ` +
              'mark it `unavailable` with the reason, or build it'
          );
        }
        if (isBuilt && variant.unavailable) {
          mismatches.push(
            `${def.type}/${variant.id} is marked unavailable but ${componentFor(def.type)} DOES paint it — ` +
              'delete the marker'
          );
        }
      }
      for (const id of built) {
        if (!def.variants.some((v) => v.id === id)) {
          mismatches.push(
            `${def.type}/${id} is BUILT but not offered — no creator can select it`
          );
        }
      }
    }
    expect(
      mismatches,
      mismatches.length ? `\n  ${mismatches.join('\n  ')}` : ''
    ).toEqual([]);
  });

  it('marks reel/strip unavailable rather than deleting it (A27)', () => {
    // The composition is DESCOPED, not retired, and the difference matters: a
    // retired id belongs in `LEGACY_SECTION_VARIANTS` and maps forward onto a
    // built composition, while a descoped one has never been selectable and has
    // nothing to map from. Keeping it holds the design and the reason it is
    // blocked; `ReelSection`'s header holds the rest.
    const strip = findSectionDefinition('reel')?.variants.find(
      (v) => v.id === 'strip'
    );
    expect(strip, 'reel/strip must stay declared').toBeDefined();
    expect(strip?.unavailable).toBeTruthy();
    // The reason is shown to the creator in the picker, so it has to say
    // something — not just be present.
    expect(strip?.unavailable?.length ?? 0).toBeGreaterThan(20);
    // And it must NOT be reachable through the retirement map, which would make
    // a stored `strip` silently become a different composition.
    expect(LEGACY_SECTION_VARIANTS.reel?.strip).toBeUndefined();
  });

  it('never marks a type default unavailable', () => {
    // A fresh or duplicated section starts in `defaultVariant`, so an unavailable
    // default would make every new section of that type start in a composition
    // the creator cannot re-select once they leave it.
    for (const def of SECTION_CATALOG) {
      const fallback = def.variants.find((v) => v.id === def.defaultVariant);
      expect(
        fallback?.unavailable,
        `${def.type} defaultVariant`
      ).toBeUndefined();
    }
  });

  it('leaves at least two selectable compositions on every type', () => {
    // The editor shows the picker only when a type offers >= 2 variants, so a
    // type whose second option is unavailable would render a picker with one
    // usable card.
    for (const def of SECTION_CATALOG) {
      const usable = def.variants.filter((v) => !v.unavailable);
      expect(
        usable.length,
        `${def.type} selectable compositions`
      ).toBeGreaterThan(1);
    }
  });
});
