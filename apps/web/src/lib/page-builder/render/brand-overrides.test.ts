/**
 * Per-page brand-override serialiser (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the D6 "inherit + override" mapping: the 8 core `--brand-*` inputs, the
 * dark colour `-dark` variants, the canonical `--brand-`/`--color-` prefix split
 * for tokenOverrides, null-skipping, font quoting, and the empty → undefined
 * contract (so `JourneyRenderer` renders a plain wrapper with no overrides).
 */
import { describe, expect, it } from 'vitest';
import type { BrandTokenOverrides } from '$lib/page-builder';
import {
  brandOverrideLogo,
  brandOverridesToCssVars,
  brandOverridesToStyleAttr,
} from './brand-overrides';

describe('brandOverridesToCssVars', () => {
  it('returns an empty map for null/undefined/empty overrides', () => {
    expect(brandOverridesToCssVars(null)).toEqual({});
    expect(brandOverridesToCssVars(undefined)).toEqual({});
    expect(brandOverridesToCssVars({})).toEqual({});
  });

  it('maps the core colour inputs to their raw --brand-* names', () => {
    const vars = brandOverridesToCssVars({
      primaryColor: '#3355ff',
      secondaryColor: '#112233',
      accentColor: '#ff8800',
      backgroundColor: '#0b0b0b',
    });
    expect(vars['--brand-color']).toBe('#3355ff');
    expect(vars['--brand-secondary']).toBe('#112233');
    expect(vars['--brand-accent']).toBe('#ff8800');
    expect(vars['--brand-bg']).toBe('#0b0b0b');
  });

  it('maps numeric radius + density inputs', () => {
    const vars = brandOverridesToCssVars({ radius: 0.75, density: 1.1 });
    expect(vars['--brand-radius']).toBe('0.75');
    expect(vars['--brand-density']).toBe('1.1');
  });

  it('quotes font families that contain whitespace, leaves single tokens raw', () => {
    const vars = brandOverridesToCssVars({
      fontHeading: 'Playfair Display',
      fontBody: 'Inter',
    });
    expect(vars['--brand-font-heading']).toBe('"Playfair Display"');
    expect(vars['--brand-font-body']).toBe('Inter');
  });

  it('emits dark colour variants under the -dark suffix', () => {
    const vars = brandOverridesToCssVars({
      darkOverrides: { primaryColor: '#88aaff', backgroundColor: '#000000' },
    });
    expect(vars['--brand-color-dark']).toBe('#88aaff');
    expect(vars['--brand-bg-dark']).toBe('#000000');
  });

  it('applies the canonical --brand-/--color- prefix split for tokenOverrides and skips null values', () => {
    const vars = brandOverridesToCssVars({
      tokenOverrides: {
        // In BRAND_PREFIX_KEYS → --brand- prefix.
        'heading-color': '#eeeeee',
        // Not a brand-prefix key → --color- direct token replacement.
        surface: '#141414',
        // null = auto-derive → skipped entirely.
        'text-scale': null,
      },
    });
    expect(vars['--brand-heading-color']).toBe('#eeeeee');
    expect(vars['--color-surface']).toBe('#141414');
    expect(vars).not.toHaveProperty('--brand-text-scale');
  });

  it('suffixes darkTokenOverrides with -dark', () => {
    const vars = brandOverridesToCssVars({
      darkTokenOverrides: { 'heading-color': '#ffffff' },
    });
    expect(vars['--brand-heading-color-dark']).toBe('#ffffff');
  });

  it('ignores blank/non-string colour inputs', () => {
    const vars = brandOverridesToCssVars({
      primaryColor: '   ',
    } as BrandTokenOverrides);
    expect(vars).not.toHaveProperty('--brand-color');
  });
});

describe('brandOverridesToStyleAttr', () => {
  it('returns undefined when nothing is overridden (plain wrapper path)', () => {
    expect(brandOverridesToStyleAttr(null)).toBeUndefined();
    expect(brandOverridesToStyleAttr({})).toBeUndefined();
  });

  it('serialises to a semicolon-joined declaration string', () => {
    const style = brandOverridesToStyleAttr({
      primaryColor: '#3355ff',
      radius: 0.5,
    });
    expect(style).toContain('--brand-color: #3355ff');
    expect(style).toContain('--brand-radius: 0.5');
    expect(style).toMatch(/;\s/); // multiple declarations joined by "; "
  });
});

describe('brandOverrideLogo', () => {
  it('returns the logo url when set, undefined otherwise', () => {
    expect(brandOverrideLogo({ logoUrl: 'https://cdn/logo.svg' })).toBe(
      'https://cdn/logo.svg'
    );
    expect(brandOverrideLogo({ logoUrl: '  ' })).toBeUndefined();
    expect(brandOverrideLogo(null)).toBeUndefined();
    expect(brandOverrideLogo({})).toBeUndefined();
  });
});
