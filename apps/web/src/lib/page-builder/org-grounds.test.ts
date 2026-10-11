import { describe, expect, it } from 'vitest';
import { orgShader } from './org-grounds';

describe('orgShader — the org has a moving background (03 X50)', () => {
  const saved = (tokenOverrides: string | null) => ({
    brandFineTune: { tokenOverrides },
  });

  it('reads the saved preset, as the org layout does', () => {
    expect(orgShader(saved('{"shader-preset":"glow"}'), null)).toBe(true);
    expect(orgShader(saved('{"shader-preset":"none"}'), null)).toBe(false);
    expect(orgShader(saved('{"shader-preset":""}'), null)).toBe(false);
    expect(orgShader(saved('{"heading-weight":"400"}'), null)).toBe(false);
    expect(orgShader(saved(null), null)).toBe(false);
    expect(orgShader(saved('not json'), null)).toBe(false);
    expect(orgShader(null, null)).toBe(false);
  });

  it('takes the brand editor’s pending preset while it is open', () => {
    const org = saved('{"shader-preset":"glow"}');
    expect(
      orgShader(org, { tokenOverrides: { 'shader-preset': 'none' } })
    ).toBe(false);
    expect(
      orgShader(saved(null), { tokenOverrides: { 'shader-preset': 'nebula' } })
    ).toBe(true);
    expect(orgShader(org, { tokenOverrides: {} })).toBe(false);
  });
});
