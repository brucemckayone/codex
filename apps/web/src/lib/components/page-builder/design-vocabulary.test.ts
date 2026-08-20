/**
 * Design-panel vocabulary tests (journey sections · F-B2).
 *
 * Three classes of drift this file exists to catch, all of which are silent
 * without it:
 *
 * 1. **A label map that does not cover its axis.** A missing key renders the raw
 *    enum member to a creator; an EXTRA key is a value that is selectable in the
 *    editor and matches no rule in `journey-design.css`, so the section renders
 *    at its default and the control looks broken. Both directions are asserted
 *    against `SECTION_DESIGN_VALUES`, which stays the single source of truth.
 * 2. **A preset that is not a complete, legal look.** Nine axes, every value drawn
 *    from the axis enum.
 * 3. **Signal drifting from what page creation writes.** `CourseJourneyService`
 *    holds its own copy of these nine values (a package cannot import from
 *    `apps/web`), and the whole point of A21 is that a new page's stored bundle
 *    IS a preset the picker can highlight. The literal below is pinned to
 *    research §4.8, so changing either side without the other fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  SECTION_CATALOG,
  SECTION_DESIGN_AXES,
  SECTION_DESIGN_VALUES,
} from '$lib/page-builder';
import {
  AXIS_HINTS,
  AXIS_LABELS,
  AXIS_VALUE_LABELS,
  axesForSectionType,
  axisOptions,
  DEFAULT_PRESET_ID,
  findDesignPreset,
  MEDIA_AWARE_SECTION_TYPES,
  SECTION_DESIGN_PRESETS,
} from './design-vocabulary';

describe('design vocabulary — labels', () => {
  it('labels and hints every axis', () => {
    for (const axis of SECTION_DESIGN_AXES) {
      expect(AXIS_LABELS[axis], `no label for ${axis}`).toBeTruthy();
      expect(AXIS_HINTS[axis], `no hint for ${axis}`).toBeTruthy();
    }
  });

  it('label maps cover each axis EXACTLY — no missing, no extra values', () => {
    for (const axis of SECTION_DESIGN_AXES) {
      const declared = [...SECTION_DESIGN_VALUES[axis]].sort();
      const labelled = Object.keys(AXIS_VALUE_LABELS[axis]).sort();
      expect(labelled, `label keys for ${axis}`).toEqual(declared);
    }
  });

  it('axisOptions pairs every legal value with a non-empty label', () => {
    for (const axis of SECTION_DESIGN_AXES) {
      const options = axisOptions(axis);
      expect(options).toHaveLength(SECTION_DESIGN_VALUES[axis].length);
      for (const option of options) {
        expect(option.label).toBeTruthy();
        expect(option.label).not.toBe(option.value.toUpperCase());
      }
    }
  });
});

describe('design vocabulary — presets', () => {
  it('ships the eight presets with unique ids and names', () => {
    expect(SECTION_DESIGN_PRESETS).toHaveLength(8);
    const ids = SECTION_DESIGN_PRESETS.map((p) => p.id);
    const names = SECTION_DESIGN_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(8);
    expect(new Set(names).size).toBe(8);
  });

  it('every preset states all nine axes with a LEGAL value', () => {
    for (const preset of SECTION_DESIGN_PRESETS) {
      for (const axis of SECTION_DESIGN_AXES) {
        const value = preset.design[axis];
        expect(value, `${preset.id} is missing ${axis}`).toBeDefined();
        expect(
          SECTION_DESIGN_VALUES[axis] as readonly string[],
          `${preset.id}.${axis} = ${String(value)} is not a legal value`
        ).toContain(value);
      }
    }
  });

  it('every preset carries a creator-facing name and description', () => {
    for (const preset of SECTION_DESIGN_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(2);
      expect(preset.description.length).toBeGreaterThan(10);
    }
  });

  it('Signal matches the bundle page creation writes (research §4.8 · A21)', () => {
    // Pinned literal. `CourseJourneyService.NEW_PAGE_DESIGN` holds the same nine
    // values; if either moves without the other, a brand-new page stores a bundle
    // the picker cannot highlight — the exact "control looks dead" failure A21
    // exists to prevent.
    const signal = SECTION_DESIGN_PRESETS.find(
      (p) => p.id === DEFAULT_PRESET_ID
    );
    expect(signal?.design).toEqual({
      width: 'wide',
      density: 'regular',
      surface: 'panel',
      edge: 'hairline',
      align: 'start',
      type: 'balanced',
      accent: 'fill',
      motion: 'rise',
      media: 'frame',
    });
  });

  it('Candlelit matches the bundle migration 0084 backfilled (research §4.1 · A3)', () => {
    // The same pinning argument for the OTHER stored bundle: 695 pre-existing
    // pages hold these nine values, and if this preset drifts they all silently
    // become "Custom" in the picker.
    const candlelit = SECTION_DESIGN_PRESETS.find((p) => p.id === 'candlelit');
    expect(candlelit?.design).toEqual({
      width: 'text',
      density: 'airy',
      surface: 'media',
      edge: 'none',
      align: 'center',
      type: 'monumental',
      accent: 'glow',
      motion: 'drift',
      media: 'bleed',
    });
  });
});

describe('findDesignPreset', () => {
  it('identifies an exact nine-axis match', () => {
    for (const preset of SECTION_DESIGN_PRESETS) {
      expect(findDesignPreset(preset.design)?.id).toBe(preset.id);
    }
  });

  it('is null for an undefined, empty or partial bundle', () => {
    expect(findDesignPreset(undefined)).toBeNull();
    expect(findDesignPreset({})).toBeNull();
    expect(findDesignPreset({ width: 'wide' })).toBeNull();
  });

  it('is null when one axis differs — a near-match is a DIFFERENT look', () => {
    const signal = SECTION_DESIGN_PRESETS.find((p) => p.id === 'signal');
    if (!signal) throw new Error('signal preset missing');
    expect(findDesignPreset({ ...signal.design, motion: 'drift' })).toBeNull();
  });
});

describe('axesForSectionType', () => {
  it('offers media ONLY on the types where it means something', () => {
    for (const definition of SECTION_CATALOG) {
      const axes = axesForSectionType(definition.type);
      const offersMedia = axes.includes('media');
      expect(offersMedia, `${definition.type} media control`).toBe(
        MEDIA_AWARE_SECTION_TYPES.includes(definition.type)
      );
    }
  });

  it('offers the other eight axes on every type', () => {
    for (const definition of SECTION_CATALOG) {
      const axes = axesForSectionType(definition.type);
      for (const axis of SECTION_DESIGN_AXES) {
        if (axis === 'media') continue;
        expect(axes, `${definition.type} is missing ${axis}`).toContain(axis);
      }
    }
  });

  it('every media-aware type is a real catalogue type', () => {
    const types = SECTION_CATALOG.map((d) => d.type);
    for (const type of MEDIA_AWARE_SECTION_TYPES) {
      expect(types, `${type} is not in the catalogue`).toContain(type);
    }
  });
});
