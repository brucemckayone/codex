import { describe, expect, it } from 'vitest';
import { orgGrounds, orgShader } from './org-grounds';

describe('orgShader — the org has a moving background (03 X50)', () => {
  const saved = (tokenOverrides: string | null) => ({
    brandFineTune: { tokenOverrides },
  });

  it('reads the saved preset, as the org layout does', () => {
    expect(orgShader(saved('{"shader-preset":"ether"}'), null)).toBe(true);
    expect(orgShader(saved('{"shader-preset":"none"}'), null)).toBe(false);
    expect(orgShader(saved('{"shader-preset":""}'), null)).toBe(false);
    expect(orgShader(saved('{"heading-weight":"400"}'), null)).toBe(false);
    expect(orgShader(saved(null), null)).toBe(false);
    expect(orgShader(saved('not json'), null)).toBe(false);
    expect(orgShader(null, null)).toBe(false);
  });

  it('takes the brand editor’s pending preset while it is open', () => {
    const org = saved('{"shader-preset":"ether"}');
    expect(
      orgShader(org, { tokenOverrides: { 'shader-preset': 'none' } })
    ).toBe(false);
    expect(
      orgShader(saved(null), { tokenOverrides: { 'shader-preset': 'aurora' } })
    ).toBe(true);
    expect(orgShader(org, { tokenOverrides: {} })).toBe(false);
  });

  // Codex-1yd58 WP-1c: the id is read as ShaderHero reads it
  // (`resolvePresetId`), so the hero defaults to the moving background exactly
  // where one paints.
  it('counts a cut preset, which paints its survivor, as a shader', () => {
    expect(orgShader(saved('{"shader-preset":"glow"}'), null)).toBe(true);
    expect(
      orgShader(saved(null), { tokenOverrides: { 'shader-preset': 'nebula' } })
    ).toBe(true);
  });

  it('counts an id naming no preset, which paints nothing, as no shader', () => {
    expect(orgShader(saved('{"shader-preset":"bogus"}'), null)).toBe(false);
    expect(orgShader(saved('{"shader-preset":"toString"}'), null)).toBe(false);
    expect(orgShader(saved('{"shader-preset":7}'), null)).toBe(false);
  });
});

// Owner, Codex-mik4h: "Ignore it, like On Brand". The kit reads the grounds
// the org layout paints: a background it cannot measure is not one.
describe('orgGrounds — the backgrounds the org layout paints', () => {
  it('passes a measurable hex as painted, and drops any other form', () => {
    const org = {
      brandColors: { background: ' #F5F0E8 ' },
      brandFineTune: {
        darkModeOverrides: JSON.stringify({ backgroundColor: 'rgb(20,20,20)' }),
      },
    };
    expect(orgGrounds(org, null)).toEqual({
      light: '#F5F0E8',
      dark: undefined,
    });
    expect(
      orgGrounds(org, {
        backgroundColor: 'navy',
        darkOverrides: { backgroundColor: '#101418' },
      })
    ).toEqual({ light: undefined, dark: '#101418' });
  });
});
