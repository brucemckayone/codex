import { describe, expect, it } from 'vitest';
import { parseDarkColorOverrides } from './parse-dark-overrides';

describe('parseDarkColorOverrides', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(parseDarkColorOverrides(null)).toBeNull();
    expect(parseDarkColorOverrides(undefined)).toBeNull();
    expect(parseDarkColorOverrides('')).toBeNull();
  });

  it('returns null for malformed JSON (no throw)', () => {
    expect(parseDarkColorOverrides('{not json')).toBeNull();
    expect(parseDarkColorOverrides('undefined')).toBeNull();
  });

  it('returns null for valid JSON that is not an object', () => {
    expect(parseDarkColorOverrides('null')).toBeNull();
    expect(parseDarkColorOverrides('"just a string"')).toBeNull();
    expect(parseDarkColorOverrides('42')).toBeNull();
    expect(parseDarkColorOverrides('[1,2,3]')).not.toBeNull(); // arrays are objects — accepted
  });

  it('returns the parsed object for valid partial overrides', () => {
    const result = parseDarkColorOverrides(
      '{"primaryColor":"#00ff00","backgroundColor":"#111111"}'
    );
    expect(result).toEqual({
      primaryColor: '#00ff00',
      backgroundColor: '#111111',
    });
  });

  it('accepts null for secondary/accent/background (explicit absence)', () => {
    const result = parseDarkColorOverrides(
      '{"primaryColor":"#ff0000","secondaryColor":null}'
    );
    expect(result?.primaryColor).toBe('#ff0000');
    expect(result?.secondaryColor).toBeNull();
  });

  it('preserves extra fields (forward-compat for wwedk)', () => {
    // Once wwedk lands, darkModeOverrides may grow to include more keys.
    // The parser should not strip unknown fields — callers read only
    // the four color fields they need.
    const result = parseDarkColorOverrides(
      '{"primaryColor":"#fff","futureField":"value"}'
    );
    expect(result).toMatchObject({
      primaryColor: '#fff',
      futureField: 'value',
    });
  });
});
