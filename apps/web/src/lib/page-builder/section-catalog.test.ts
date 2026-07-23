import { describe, expect, it } from 'vitest';
import {
  createDefaultSections,
  defaultSectionOrder,
  findSectionDefinition,
  firstSectionMatch,
  listSectionDefinitions,
  SECTION_CATALOG,
  sectionMatchesQuery,
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

describe('createDefaultSections', () => {
  it('builds one enabled section per catalogue entry, in order, with empty props', () => {
    let n = 0;
    const sections = createDefaultSections(() => `sec-${n++}`);
    expect(sections.map((s) => s.type)).toEqual(EXPECTED_ORDER);
    expect(sections.every((s) => s.enabled)).toBe(true);
    expect(sections.every((s) => Object.keys(s.props).length === 0)).toBe(true);
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
