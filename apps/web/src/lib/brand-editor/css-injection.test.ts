import { afterEach, describe, expect, it } from 'vitest';
import {
  darkTokenOverridesToCssVars,
  injectBrandVars,
  previewFont,
  revertFontPreview,
  tokenOverridesToCssVars,
} from './css-injection';
import type { BrandEditorState } from './types';

/**
 * Unit tests for the token-overrides → CSS-vars mapping used by both
 * injectBrandVars (live preview) and the SSR injection path. Both share the
 * same prefix logic and the same filter for attribute-only keys, so testing
 * the pure helper covers the behaviour for both.
 *
 * Codex-rwci4: hero-hide-* keys drive data-hero-hide-* ATTRIBUTES on the
 * org layout (set in _org/[slug]/+layout.svelte). They have no CSS
 * custom-property consumer, so emitting --color-hero-hide-* would just
 * pollute the inline style. The helper must skip them.
 */
describe('tokenOverridesToCssVars', () => {
  it('emits --brand-* prefix for keys in BRAND_PREFIX_KEYS', () => {
    const result = tokenOverridesToCssVars({
      'shader-preset': 'ether',
      'glass-tint': '#abc',
    });

    expect(result['--brand-shader-preset']).toBe('ether');
    expect(result['--brand-glass-tint']).toBe('#abc');
  });

  it('emits --color-* prefix for keys outside BRAND_PREFIX_KEYS', () => {
    const result = tokenOverridesToCssVars({
      'surface-secondary': '#fafafa',
    });

    expect(result['--color-surface-secondary']).toBe('#fafafa');
  });

  it('skips hero-hide-* keys (attribute-only, no CSS consumer)', () => {
    const result = tokenOverridesToCssVars({
      'hero-hide-title': '1',
      'hero-hide-logo': '1',
      'hero-hide-description': '1',
      'hero-hide-pills': '1',
      'hero-hide-stats': '1',
    });

    expect(result['--color-hero-hide-title']).toBeUndefined();
    expect(result['--color-hero-hide-logo']).toBeUndefined();
    expect(result['--color-hero-hide-description']).toBeUndefined();
    expect(result['--color-hero-hide-pills']).toBeUndefined();
    expect(result['--color-hero-hide-stats']).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('mixed input: emits brand/color tokens, skips hero-hide-*', () => {
    const result = tokenOverridesToCssVars({
      'shader-preset': 'ether',
      'hero-hide-stats': '1',
      'glass-tint': '#abc',
    });

    expect(result['--brand-shader-preset']).toBe('ether');
    expect(result['--brand-glass-tint']).toBe('#abc');
    expect(result['--color-hero-hide-stats']).toBeUndefined();
    // Only the two non-skipped keys are emitted.
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('skips null and undefined values', () => {
    const result = tokenOverridesToCssVars({
      'shader-preset': null,
      'glass-tint': undefined,
      'shader-intensity': '0.8',
    });

    expect(result['--brand-shader-preset']).toBeUndefined();
    expect(result['--brand-glass-tint']).toBeUndefined();
    expect(result['--brand-shader-intensity']).toBe('0.8');
  });
});

/**
 * Codex-wwedk: dark-theme tokenOverrides emit alongside their light
 * counterparts as `${prop}-dark`. CSS gates in org-brand.css read them
 * via fallback chains so an absent dark value gracefully inherits light.
 */
describe('darkTokenOverridesToCssVars', () => {
  it('suffixes --brand-* keys with -dark for BRAND_PREFIX_KEYS', () => {
    const result = darkTokenOverridesToCssVars({
      'shader-preset': 'ink',
      'glass-tint': '#000000',
    });

    expect(result['--brand-shader-preset-dark']).toBe('ink');
    expect(result['--brand-glass-tint-dark']).toBe('#000000');
    // Light keys MUST NOT be emitted.
    expect(result['--brand-shader-preset']).toBeUndefined();
    expect(result['--brand-glass-tint']).toBeUndefined();
  });

  it('suffixes --color-* keys with -dark for non-BRAND_PREFIX_KEYS', () => {
    const result = darkTokenOverridesToCssVars({
      'surface-secondary': '#0a0a0a',
    });

    expect(result['--color-surface-secondary-dark']).toBe('#0a0a0a');
    expect(result['--color-surface-secondary']).toBeUndefined();
  });

  it('skips hero-hide-* keys (attribute-only, no CSS consumer)', () => {
    const result = darkTokenOverridesToCssVars({
      'hero-hide-title': '1',
      'hero-hide-stats': '1',
    });

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('skips null and undefined values', () => {
    const result = darkTokenOverridesToCssVars({
      'shader-preset': null,
      'glass-tint': undefined,
      'shader-intensity': '0.5',
    });

    expect(result['--brand-shader-preset-dark']).toBeUndefined();
    expect(result['--brand-glass-tint-dark']).toBeUndefined();
    expect(result['--brand-shader-intensity-dark']).toBe('0.5');
  });

  it('emits a parallel set when paired with light overrides', () => {
    const light = tokenOverridesToCssVars({ 'shader-preset': 'ether' });
    const dark = darkTokenOverridesToCssVars({ 'shader-preset': 'ink' });

    // Both are emitted independently — together the org layout exposes
    // `--brand-shader-preset` (light) AND `--brand-shader-preset-dark`,
    // and the dark CSS gate uses the dark variant.
    expect(light['--brand-shader-preset']).toBe('ether');
    expect(dark['--brand-shader-preset-dark']).toBe('ink');
  });
});

/**
 * Codex-eb00a.7: the emitted --brand-font-body/-heading value must be the BARE
 * family name. org-brand.css redeclares `--font-sans` as
 * `var(--brand-font-body, 'Inter'), 'Inter-fallback', …`, so appending
 * `var(--font-sans)` here forms a --brand-font-body ↔ --font-sans cycle that
 * invalidates both → `font-family: var(--font-sans)` falls back to the inherited
 * font and the brand font never applies. These guard every emitter that could
 * reintroduce the cycle (save injection + live preview).
 */
describe('brand fonts do not self-reference --font-sans (no CSS var cycle)', () => {
  const baseState: BrandEditorState = {
    primaryColor: '#3355ff',
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
  };

  function makeOrgLayout(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'org-layout';
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    for (const el of document.querySelectorAll('.org-layout')) el.remove();
  });

  it('injectBrandVars emits bare family names (save path)', () => {
    const el = makeOrgLayout();
    injectBrandVars({ ...baseState, fontBody: 'Lora', fontHeading: 'Poppins' });

    expect(el.style.getPropertyValue('--brand-font-body')).toBe("'Lora'");
    expect(el.style.getPropertyValue('--brand-font-heading')).toBe("'Poppins'");
    expect(el.style.getPropertyValue('--brand-font-body')).not.toContain(
      'var(--font-sans)'
    );
  });

  it('previewFont emits a bare family name (hover-preview path)', () => {
    const el = makeOrgLayout();
    previewFont('body', 'Playfair Display');

    expect(el.style.getPropertyValue('--brand-font-body')).toBe(
      "'Playfair Display'"
    );
    expect(el.style.getPropertyValue('--brand-font-body')).not.toContain(
      'var(--font-sans)'
    );
  });

  it('revertFontPreview restores a bare family name', () => {
    const el = makeOrgLayout();
    revertFontPreview('heading', 'Space Grotesk');

    expect(el.style.getPropertyValue('--brand-font-heading')).toBe(
      "'Space Grotesk'"
    );
    expect(el.style.getPropertyValue('--brand-font-heading')).not.toContain(
      'var(--font-sans)'
    );
  });
});
