import { describe, expect, it } from 'vitest';
import { tokenOverridesToCssVars } from './css-injection';

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
