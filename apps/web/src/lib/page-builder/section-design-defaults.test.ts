/**
 * Per-section-type design defaults — the house RHYTHM.
 *
 * WHAT THESE TESTS ARE FOR, precisely. The nine axes are `z.enum(...).catch(
 * undefined)` at the save boundary and `resolveAxis` drops an illegal value
 * silently at the render boundary — deliberately, so a future client's unknown
 * value cannot reach an attribute that matches no CSS rule. The consequence is
 * that a TYPO IN THIS TABLE WOULD DEGRADE INVISIBLY: `density: 'huge'` would be
 * dropped on the way in and again on the way out, and the section would render at
 * the inherited density with no error anywhere. The `Record<CourseSectionType,
 * SectionDesign>` annotation makes that a compile error today; these tests make
 * it a RUNTIME failure too, because a single `as` cast added to that file later
 * would silence the first check on its own.
 *
 * The second thing pinned here is the redundancy strip. "Inherited" is
 * represented by the ABSENCE of a key — the store's `setSectionDesignAxis`
 * documents it, the save round-trip depends on it, and the inspector paints an
 * "Inherited" pill from it. A written key whose value equals the inherited value
 * would make that pill lie, so a bag that carries one is a defect, not a
 * harmless duplicate.
 */

import type { CourseSectionType, SectionDesign } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import {
  resolveDesign,
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_DEFAULTS,
  SECTION_DESIGN_VALUES,
} from './section-catalog';
import {
  SECTION_DESIGN_BY_TYPE,
  sectionDesignForType,
} from './section-design-defaults';

/** The types whose components actually resolve the `--jp-media-*` family. */
const MEDIA_CONSUMING_TYPES: readonly CourseSectionType[] = [
  'hero',
  'introVideo',
  'reel',
  'guide',
];

const TABLE_ENTRIES = Object.entries(SECTION_DESIGN_BY_TYPE) as [
  CourseSectionType,
  SectionDesign,
][];

describe('SECTION_DESIGN_BY_TYPE — the table itself', () => {
  it('covers every catalogue type, and only catalogue types', () => {
    const catalogue = SECTION_CATALOG.map((def) => def.type).sort();
    expect(Object.keys(SECTION_DESIGN_BY_TYPE).sort()).toEqual(catalogue);
  });

  it('holds ONLY legal enum values — the check the silent `.catch(undefined)` cannot make', () => {
    for (const [type, bag] of TABLE_ENTRIES) {
      for (const [axis, value] of Object.entries(bag)) {
        // A key outside the nine axes would emit no attribute at all.
        expect(
          SECTION_DESIGN_AXES as readonly string[],
          `${type}.${axis} is not one of the nine axes`
        ).toContain(axis);
        expect(
          SECTION_DESIGN_VALUES[
            axis as keyof typeof SECTION_DESIGN_VALUES
          ] as readonly string[],
          `${type}.${axis} = ${String(value)} is not a legal value for that axis`
        ).toContain(value);
      }
    }
  });

  it('names no axis twice and leaves no axis undefined', () => {
    for (const [type, bag] of TABLE_ENTRIES) {
      for (const [axis, value] of Object.entries(bag)) {
        expect(value, `${type}.${axis} is undefined`).not.toBeUndefined();
      }
    }
  });

  it('states `media` on exactly the four types that resolve it, and on no other', () => {
    // `Codex-wqxv4`: a control that cannot change what renders is a mistake this
    // programme has already paid for. `FeelSection.svelte`'s header states the
    // rule for the rest — "`media` is DELIBERATELY unconsumed … there is no
    // image, no video and no aspect ratio for `--jp-media-*` to shape".
    const withMedia = TABLE_ENTRIES.filter(([, bag]) => 'media' in bag).map(
      ([type]) => type
    );
    expect(withMedia.sort()).toEqual([...MEDIA_CONSUMING_TYPES].sort());
  });

  it('gives the page a rhythm rather than one repeated setting', () => {
    // The defect, restated as an assertion: every section of a real page emitted
    // BYTE-IDENTICAL axis values, so nine axes expressed one setting each.
    const density = new Set(TABLE_ENTRIES.map(([, bag]) => bag.density));
    const surface = new Set(TABLE_ENTRIES.map(([, bag]) => bag.surface));
    const width = new Set(TABLE_ENTRIES.map(([, bag]) => bag.width));
    expect(density.size).toBeGreaterThanOrEqual(3);
    expect(surface.size).toBeGreaterThanOrEqual(4);
    expect(width.size).toBeGreaterThanOrEqual(3);
  });

  it('reserves `monumental` for the two ENDS, so the ends read as arrival and departure', () => {
    const monumental = TABLE_ENTRIES.filter(
      ([, bag]) => bag.type === 'monumental'
    ).map(([type]) => type);
    expect(monumental.sort()).toEqual(['hero', 'invite']);
  });

  it('never puts `surface: media` on a type with no media', () => {
    // Measured on the flat page bag and it looked wrong on the page: `ache` and
    // `map` were media-backed sections that have never had media.
    for (const [type, bag] of TABLE_ENTRIES) {
      if (bag.surface !== 'media') continue;
      expect(
        MEDIA_CONSUMING_TYPES,
        `${type} is media-surfaced but resolves no media`
      ).toContain(type);
    }
  });
});

describe('sectionDesignForType — absence means inherited', () => {
  it('drops every axis whose value the section would inherit anyway', () => {
    // A page look that IS the table's hero row: nothing is an exception, so the
    // hero must store no bag at all.
    const bag = sectionDesignForType('hero', SECTION_DESIGN_BY_TYPE.hero);
    expect(bag).toBeUndefined();
  });

  it('keeps only the axes that differ, never a redundant key', () => {
    const inherited: SectionDesign = { density: 'vast', width: 'full' };
    const bag = sectionDesignForType('hero', inherited);
    expect(bag).toBeDefined();
    expect(bag?.density).toBeUndefined();
    expect(bag?.width).toBeUndefined();
    expect(bag?.surface).toBe('media');
    expect(bag?.type).toBe('monumental');
  });

  it('compares against the RESOLVED look, so an axis the page leaves unset still counts', () => {
    // `faq: width 'text'` IS the axis default. On a page with no look of its own
    // the FAQ inherits `text` regardless, so writing the key would be redundant —
    // and it is the resolved baseline, not the (empty) page bag, that reveals it.
    const inherited = resolveDesign(null, { design: undefined });
    expect(inherited.width).toBe(SECTION_DESIGN_DEFAULTS.width);
    const bag = sectionDesignForType('faq', inherited);
    expect(bag?.width).toBeUndefined();
    // …while the axes that DO differ from the defaults survive.
    expect(bag?.density).toBe('compact');
    expect(bag?.align).toBe('start');
    expect(bag?.type).toBe('restrained');
    expect(bag?.accent).toBe('none');
  });

  it('returns undefined — not {} — for an unknown/widened type', () => {
    // The renderer skips an unrecognised type, so there is no rhythm to express,
    // and `{}` is not the same thing as absence to a reader of the stored jsonb.
    expect(sectionDesignForType('retreat-schedule', undefined)).toBeUndefined();
  });

  it('writes the whole rhythm when there is nothing to inherit from', () => {
    const bag = sectionDesignForType('invite');
    expect(bag).toEqual(SECTION_DESIGN_BY_TYPE.invite);
    // …and it is a fresh object, so a caller cannot mutate the shared table.
    expect(bag).not.toBe(SECTION_DESIGN_BY_TYPE.invite);
  });

  it('produces a bag that survives resolveDesign unchanged — every value is understood', () => {
    // The end-to-end version of the enum check: `resolveAxis` substitutes the
    // axis default for a value it does not recognise, so a typo would show up
    // here as a resolved value that is not the one the table asked for.
    for (const [type, bag] of TABLE_ENTRIES) {
      const resolved = resolveDesign({ type, design: bag }, null);
      for (const [axis, value] of Object.entries(bag)) {
        expect(
          resolved[axis as keyof typeof resolved],
          `${type}.${axis} did not survive resolveDesign`
        ).toBe(value);
      }
    }
  });
});
