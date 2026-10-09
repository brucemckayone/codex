/**
 * The catalogue, the registry and the Style tables must cover all 14 section
 * types exactly — later WPs replace a block's files and rely on these
 * aggregators already knowing their type.
 */
import { describe, expect, it } from 'vitest';
import * as Icons from '$lib/components/ui/Icon';
import { BLOCKS } from '../registry';
import { DEFINITIONS, fieldOf, GROUP_ORDER } from './catalog';
import {
  COLOUR_SCHEME_IDS,
  isLayoutOf,
  PAGE_STYLE_IDS,
  SECTION_LAYOUTS,
  SECTION_TYPE_IDS,
} from './ids';
import { STYLES } from './styles';

describe('DEFINITIONS', () => {
  it('has exactly one definition per section type', () => {
    expect(Object.keys(DEFINITIONS).sort()).toEqual(
      [...SECTION_TYPE_IDS].sort()
    );
  });

  it.each(
    SECTION_TYPE_IDS
  )('%s: layouts equal the contract list, in order', (type) => {
    const definition = DEFINITIONS[type];
    expect(definition.type).toBe(type);
    expect(definition.layouts.map((l) => l.id)).toEqual([
      ...SECTION_LAYOUTS[type],
    ]);
    for (const layout of definition.layouts) {
      expect(layout.label.length).toBeGreaterThan(0);
      expect(layout.description.length).toBeGreaterThan(0);
    }
  });

  it.each(
    SECTION_TYPE_IDS
  )('%s: plain labels, a real group and a real icon', (type) => {
    const definition = DEFINITIONS[type];
    expect(definition.label).toMatch(/^[A-Z]/);
    expect(definition.description.length).toBeGreaterThan(10);
    expect(GROUP_ORDER.map((g) => g.id)).toContain(definition.group);
    expect(Icons).toHaveProperty(definition.icon);
    const jargon =
      /surface|density|composition|monumental|accent glow|variant/i;
    for (const text of [definition.label, definition.description]) {
      expect(text).not.toMatch(jargon);
    }
  });

  it.each(
    SECTION_TYPE_IDS
  )('%s: fields have unique keys and sentence-case labels', (type) => {
    const keys = DEFINITIONS[type].fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of DEFINITIONS[type].fields) {
      // Sentence case: a capital first letter and no Title Case after it.
      expect(field.label).toMatch(/^[A-Z]/);
      expect(field.label).not.toMatch(/ [A-Z]/);
      if (field.layouts) {
        for (const layout of field.layouts)
          expect(isLayoutOf(type, layout)).toBe(true);
      }
      expect(fieldOf(type, field.key)).toBe(field);
    }
  });

  it.each(
    SECTION_TYPE_IDS
  )('%s: the sample survives its own tolerant reader', (type) => {
    const { sample, coerce } = DEFINITIONS[type];
    expect(coerce(sample)).toEqual(sample);
  });

  it.each(
    SECTION_TYPE_IDS
  )('%s: the reader drops unknown keys and wrong types', (type) => {
    const coerced = DEFINITIONS[type].coerce({
      heading: 42,
      body: ['not', 'a', 'string'],
      notAField: 'x',
      eyebrow: '   ',
    });
    expect(coerced).toEqual({});
  });
});

describe('BLOCKS (the component registry)', () => {
  it('has a component for every section type', () => {
    expect(Object.keys(BLOCKS).sort()).toEqual([...SECTION_TYPE_IDS].sort());
    for (const type of SECTION_TYPE_IDS)
      expect(typeof BLOCKS[type]).toBe('function');
  });
});

describe('STYLES', () => {
  it.each(
    PAGE_STYLE_IDS
  )('%s: every default is a real layout and scheme', (style) => {
    for (const type of SECTION_TYPE_IDS) {
      expect(isLayoutOf(type, STYLES[style].layouts[type])).toBe(true);
      expect(COLOUR_SCHEME_IDS).toContain(STYLES[style].schemes[type]);
    }
  });

  it.each(
    PAGE_STYLE_IDS
  )('%s: its order holds every type once; its starter follows it', (style) => {
    const { order, starter } = STYLES[style];
    expect([...order].sort()).toEqual([...SECTION_TYPE_IDS].sort());
    expect(starter[0]).toBe('hero');
    const positions = starter.map((type) => order.indexOf(type));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it.each(
    PAGE_STYLE_IDS
  )('%s: a brand band never touches a contrast band', (style) => {
    // With a very dark brand the two are near-identical and would smear into
    // one block, so the rhythm keeps a page-colour band between them.
    const schemes = STYLES[style].order.map(
      (type) => STYLES[style].schemes[type]
    );
    for (let i = 1; i < schemes.length; i++) {
      const pair = new Set([schemes[i - 1], schemes[i]]);
      expect(pair.has('brand') && pair.has('contrast')).toBe(false);
    }
  });

  it('keeps Bold the flagship: the headline hero and a brand-coloured opening', () => {
    expect(STYLES.bold.layouts.hero).toBe('statement');
    expect(STYLES.bold.schemes.hero).toBe('brand');
    expect(STYLES.cinematic.layouts.hero).toBe('cover');
  });
});
