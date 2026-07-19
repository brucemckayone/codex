/**
 * Rail navigation-model tests (Codex-cijzb · WP-1.5).
 *
 * Exercises the pure spine: group structure, search matching + jump, the
 * "Affects:" surface map, and the change-ledger diff. No DOM.
 */
import { describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import {
  controlMatchesQuery,
  diffBrandState,
  FIELD_LABELS,
  findControlGroup,
  firstControlMatch,
  flattenControls,
  isFieldDirty,
  RAIL_GROUPS,
  type RailControlId,
  type RailControlMeta,
} from './rail-model';

/** Resolve a control by id or throw — keeps tests free of non-null assertions. */
function control(id: RailControlId): RailControlMeta {
  const found = flattenControls().find((c) => c.id === id);
  if (!found) throw new Error(`missing rail control: ${id}`);
  return found;
}

function makeState(
  overrides: Partial<BrandEditorState> = {}
): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides: {},
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    ...overrides,
  };
}

describe('RAIL_GROUPS structure', () => {
  test('has exactly the three difficulty-dial groups in order', () => {
    expect(RAIL_GROUPS.map((g) => g.id)).toEqual([
      'foundations',
      'identity',
      'hero',
    ]);
  });

  test('every control carries a label, keywords, and non-empty affects', () => {
    for (const control of flattenControls()) {
      expect(control.label.length).toBeGreaterThan(0);
      expect(control.keywords.length).toBeGreaterThan(0);
      expect(control.affects.length).toBeGreaterThan(0);
    }
  });

  test('maps controls to the expected groups', () => {
    expect(findControlGroup('colours')).toBe('foundations');
    expect(findControlGroup('shape')).toBe('foundations');
    expect(findControlGroup('typography')).toBe('identity');
    expect(findControlGroup('logo')).toBe('identity');
    expect(findControlGroup('hero-layout')).toBe('hero');
    expect(findControlGroup('hero-effects')).toBe('hero');
  });
});

describe('Affects map is honest', () => {
  test('brand colours reach buttons, links and hero', () => {
    const colours = flattenControls().find((c) => c.id === 'colours');
    expect(colours?.affects).toEqual(
      expect.arrayContaining(['Buttons', 'Links', 'Hero'])
    );
  });

  test('typography reaches titles + cards (WP-0.1 heading reach)', () => {
    const typography = flattenControls().find((c) => c.id === 'typography');
    expect(typography?.affects).toEqual(
      expect.arrayContaining(['Titles', 'Cards', 'Headings'])
    );
  });
});

describe('controlMatchesQuery', () => {
  const accent = control('colours');
  const shader = control('hero-effects');

  test('empty query matches everything', () => {
    expect(controlMatchesQuery(accent, '')).toBe(true);
    expect(controlMatchesQuery(accent, '   ')).toBe(true);
  });

  test('matches on a keyword, case-insensitively', () => {
    expect(controlMatchesQuery(accent, 'ACCENT')).toBe(true);
    expect(controlMatchesQuery(shader, 'shader')).toBe(true);
  });

  test('matches on an affects surface', () => {
    expect(controlMatchesQuery(accent, 'links')).toBe(true);
  });

  test('non-matching query is rejected', () => {
    expect(controlMatchesQuery(shader, 'radius')).toBe(false);
  });
});

describe('firstControlMatch (search jump target)', () => {
  test('returns the first matching control + its group', () => {
    const match = firstControlMatch('font');
    expect(match?.control.id).toBe('typography');
    expect(match?.groupId).toBe('identity');
  });

  test('null for an empty query', () => {
    expect(firstControlMatch('')).toBeNull();
  });

  test('null when nothing matches', () => {
    expect(firstControlMatch('xyzzy-nope')).toBeNull();
  });
});

describe('diffBrandState + isFieldDirty (change ledger)', () => {
  test('no changes when saved === pending', () => {
    const saved = makeState();
    const pending = makeState();
    expect(diffBrandState(saved, pending)).toEqual([]);
  });

  test('lists only the changed fields with their labels', () => {
    const saved = makeState();
    const pending = makeState({ primaryColor: '#FF0000', radius: 1 });
    const changes = diffBrandState(saved, pending);
    expect(changes.map((c) => c.field).sort()).toEqual([
      'primaryColor',
      'radius',
    ]);
    expect(changes.find((c) => c.field === 'primaryColor')?.label).toBe(
      FIELD_LABELS.primaryColor
    );
  });

  test('detects deep changes inside object-valued fields', () => {
    const saved = makeState({ tokenOverrides: {} });
    const pending = makeState({ tokenOverrides: { 'shader-preset': 'flow' } });
    const changes = diffBrandState(saved, pending);
    expect(changes.map((c) => c.field)).toContain('tokenOverrides');
  });

  test('isFieldDirty targets a single field', () => {
    const saved = makeState();
    const pending = makeState({ fontHeading: 'Inter' });
    expect(isFieldDirty(saved, pending, 'fontHeading')).toBe(true);
    expect(isFieldDirty(saved, pending, 'primaryColor')).toBe(false);
  });

  test('null saved/pending yields no changes', () => {
    expect(diffBrandState(null, makeState())).toEqual([]);
    expect(isFieldDirty(null, makeState(), 'radius')).toBe(false);
  });
});
