/**
 * Safe section-prop coercion (Codex-2pryk.3.1 · WP-3).
 *
 * `PageSection.props` is untrusted org-authored jsonb. These guards must degrade
 * a malformed/absent field to a fallback (undefined / dropped entry) rather than
 * surface a non-string into the render, so an unconfigured or corrupt section
 * never throws during SSR.
 */
import { describe, expect, it } from 'vitest';
import {
  asBool,
  asObjectArray,
  asString,
  asStringArray,
  fieldBool,
  fieldString,
} from './coerce';

describe('asString', () => {
  it('returns a trimmed non-empty string, else undefined', () => {
    expect(asString({ x: '  hi  ' }, 'x')).toBe('hi');
    expect(asString({ x: '' }, 'x')).toBeUndefined();
    expect(asString({ x: '   ' }, 'x')).toBeUndefined();
    expect(asString({ x: 42 }, 'x')).toBeUndefined();
    expect(asString({}, 'x')).toBeUndefined();
  });
});

describe('asStringArray', () => {
  it('keeps only non-empty strings, trims, drops non-strings', () => {
    expect(asStringArray({ x: ['a', ' b ', 3, '', null] }, 'x')).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns undefined for non-arrays or all-empty arrays', () => {
    expect(asStringArray({ x: 'a' }, 'x')).toBeUndefined();
    expect(asStringArray({ x: ['', '  '] }, 'x')).toBeUndefined();
    expect(asStringArray({}, 'x')).toBeUndefined();
  });
});

describe('asObjectArray', () => {
  it('maps plain objects, dropping entries the mapper rejects and non-objects', () => {
    const items = asObjectArray<{ q: string }>(
      { x: [{ q: 'one' }, { nope: 1 }, 'str', null, { q: '  two  ' }] },
      'x',
      (entry) => {
        const q = fieldString(entry, 'q');
        return q ? { q } : null;
      }
    );
    expect(items).toEqual([{ q: 'one' }, { q: 'two' }]);
  });

  it('returns undefined when nothing survives', () => {
    expect(
      asObjectArray({ x: [{ nope: 1 }] }, 'x', () => null)
    ).toBeUndefined();
    expect(asObjectArray({ x: 'not-array' }, 'x', () => ({}))).toBeUndefined();
  });
});

describe('asBool / fieldBool', () => {
  it('asBool honours booleans and the fallback', () => {
    expect(asBool({ x: true }, 'x')).toBe(true);
    expect(asBool({ x: 'true' }, 'x')).toBe(false);
    expect(asBool({}, 'x', true)).toBe(true);
  });

  it('fieldBool is strict-true only', () => {
    expect(fieldBool({ x: true }, 'x')).toBe(true);
    expect(fieldBool({ x: 'true' }, 'x')).toBe(false);
    expect(fieldBool({}, 'x')).toBe(false);
  });
});
