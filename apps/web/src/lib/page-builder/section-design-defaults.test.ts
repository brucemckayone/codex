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

  it('states `media` ONLY on types that resolve it — never on one that cannot', () => {
    // `Codex-wqxv4`: a control that cannot change what renders is a mistake this
    // programme has already paid for. `FeelSection.svelte`'s header states the
    // rule for the rest — "`media` is DELIBERATELY unconsumed … there is no
    // image, no video and no aspect ratio for `--jp-media-*` to shape".
    //
    // THIS IS A SUBSET ASSERTION, and it used to demand EQUALITY. That was the
    // same wqxv4 mistake pointing the other way: the four media-consuming types
    // were the only ones that could express the axis, so pinning all four made
    // the PAGE LOOK's `media` control unable to change a single pixel. Quiet
    // Studio's `media: inset` is THE MAT — its one exclusive axis value and its
    // whole signature — and it could never paint.
    //
    // So the invariant is one-directional: a `media` key on a type that reads no
    // `--jp-media-*` is still a bug, but a media-consuming type is free to
    // inherit the page look instead of overriding it.
    const withMedia = TABLE_ENTRIES.filter(([, bag]) => 'media' in bag).map(
      ([type]) => type
    );
    const illegal = withMedia.filter(
      (t) => !(MEDIA_CONSUMING_TYPES as readonly string[]).includes(t)
    );
    expect(illegal, 'media pinned on a type that consumes none').toEqual([]);
  });

  it('leaves `guide` the ONLY media pin, and for a stated reason', () => {
    // hero / introVideo / reel all pinned `bleed`, which is what Candlelit's own
    // page look supplies — a restatement, so dropping it changes nothing there
    // and frees the axis for the other seven looks. `guide` is different: its
    // `frame` is a deliberate DEFENCE against a `bleed` page look ("the value
    // guide's plate WANTS"), so it stays. If a future change removes it, that is
    // a decision about Candlelit's guide section and should be made knowingly.
    const withMedia = TABLE_ENTRIES.filter(([, bag]) => 'media' in bag).map(
      ([type]) => type
    );
    expect(withMedia).toEqual(['guide']);
    expect(SECTION_DESIGN_BY_TYPE.guide.media).toBe('frame');
  });

  it('gives the page a rhythm rather than one repeated setting', () => {
    // The defect, restated as an assertion: every section of a real page emitted
    // BYTE-IDENTICAL axis values, so nine axes expressed one setting each.
    //
    // STATED VALUES ONLY, and the filter is load-bearing. hero / introVideo /
    // reel no longer pin `surface`, so a `Set` over the raw column counts their
    // `undefined` as a member — and this assertion would then be satisfiable by
    // ABSENCE, which is the opposite of the variety it exists to measure.
    const stated = (axis: keyof SectionDesign) =>
      new Set(
        TABLE_ENTRIES.map(([, bag]) => bag[axis]).filter(
          (value) => value !== undefined
        )
      );
    expect(stated('density').size).toBeGreaterThanOrEqual(3);
    expect(stated('surface').size).toBeGreaterThanOrEqual(4);
    expect(stated('width').size).toBeGreaterThanOrEqual(3);
  });

  it('reserves `monumental` for the two ENDS, so the ends read as arrival and departure', () => {
    const monumental = TABLE_ENTRIES.filter(
      ([, bag]) => bag.type === 'monumental'
    ).map(([type]) => type);
    expect(monumental.sort()).toEqual(['hero', 'invite']);
  });

  it('never states `surface: media` — the reference look supplies that ground', () => {
    // This used to read "never on a type with no media", which was the FLAT PAGE
    // BAG's absurdity (`ache` and `map` media-backed with no media to back them).
    // The rule is now stronger, because `media` turned out to be wrong on the
    // three types that DO consume it as well: it is Candlelit's own page value,
    // so pinning it bought Candlelit nothing and fixed every other look's ground
    // at Candlelit's on the three sections that carry a page's images. The header
    // records the measurement and the brief that mandates the eight surfaces.
    //
    // Re-adding one is a decision, not a tidy-up, which is why this fails on it.
    const withSurface = TABLE_ENTRIES.filter(
      ([, bag]) => bag.surface !== undefined
    ).map(([type, bag]) => [type, bag.surface] as const);
    expect(
      withSurface.filter(([, surface]) => surface === 'media').map(([t]) => t),
      'a row restating the reference look’s own ground'
    ).toEqual([]);
    // ANTI-VACUITY: the assertion above must be reading a populated column, or
    // deleting the whole `surface` column would satisfy it.
    expect(withSurface.map(([type]) => type).sort()).toEqual([
      'ache',
      'faq',
      'feel',
      'guide',
      'invite',
      'map',
      'proof',
      'turn',
    ]);
    expect(new Set(withSurface.map(([, surface]) => surface)).size).toBe(4);
  });

  it('leaves the reference look’s media-surfaced sections byte-identical', () => {
    // THE SAFETY ARGUMENT FOR THE `surface` UN-PINNING, asserted rather than
    // argued. Under a look whose surface IS `media`, `sectionDesignForType`
    // dropped the key as redundant before the change — so removing it cannot
    // alter what those three sections STORE, and the attribute they RESOLVE is
    // the look's own `media` either way. `look-reach.test.ts` owns the
    // preset-side half (Candlelit declares no signature at all); this half needs
    // no import from the editor layer, which A20 forbids here.
    const look = resolveDesign(null, { design: { surface: 'media' } });
    for (const type of ['hero', 'introVideo', 'reel'] as const) {
      const bag = sectionDesignForType(type, look);
      expect(bag?.surface, `${type} must store no surface`).toBeUndefined();
      expect(
        resolveDesign({ type, design: bag }, { design: look }).surface,
        `${type} must still resolve the look’s ground`
      ).toBe('media');
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
    // …and no `surface`, because the hero states none: the page look's ground is
    // the whole point of the un-pinning, so there is nothing here to diff.
    expect(bag?.surface).toBeUndefined();
    expect(bag?.type).toBe('monumental');
    expect(bag?.accent).toBe('glow');
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
