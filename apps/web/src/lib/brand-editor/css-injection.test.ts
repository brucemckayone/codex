import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTokenOverrides,
  darkTokenOverridesToCssVars,
  injectBrandVars,
  previewFont,
  revertFontPreview,
  tokenOverridesToCssVars,
} from './css-injection';
import { groundLuminance } from './ground';
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

  // The retired 'On Brand' key (Codex-mik4h): every label is chosen from its
  // own fill, so a saved value must not repaint them inline.
  it('ignores a saved text-on-brand, light and dark', () => {
    expect(
      tokenOverridesToCssVars({
        'text-on-brand': '#ffd700',
        'text-secondary': '#555555',
      })
    ).toEqual({ '--color-text-secondary': '#555555' });
    expect(darkTokenOverridesToCssVars({ 'text-on-brand': '#ffd700' })).toEqual(
      {}
    );
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

  // Codex-rsk0y: dark font-family values MUST be single-quoted. A bare name
  // with a numeric token (e.g. "Source Sans 3") is an INVALID unquoted CSS
  // identifier, so `font-family: Source Sans 3` is dropped and the browser
  // silently falls back to the light font. The light path already quotes via
  // CSS_VAR_MAPPINGS; the dark path must match.
  it('quotes dark font-family emit (numeric family name)', () => {
    const result = darkTokenOverridesToCssVars({
      'font-body': 'Source Sans 3',
    });

    expect(result['--brand-font-body-dark']).toBe(
      "'Source Sans 3', 'Source Sans 3-fallback'"
    );
  });

  it('quotes both dark font override keys', () => {
    const result = darkTokenOverridesToCssVars({
      'font-body': 'Source Sans 3',
      'font-heading': 'DM Sans',
    });

    expect(result['--brand-font-body-dark']).toBe(
      "'Source Sans 3', 'Source Sans 3-fallback'"
    );
    expect(result['--brand-font-heading-dark']).toBe(
      "'DM Sans', 'DM Sans-fallback'"
    );
  });

  it('does NOT quote non-font dark overrides (guard against over-quoting)', () => {
    const result = darkTokenOverridesToCssVars({
      'shader-preset': 'ink',
      'surface-secondary': '#0a0a0a',
    });

    // Presets and colours stay raw — only font families are quoted.
    expect(result['--brand-shader-preset-dark']).toBe('ink');
    expect(result['--color-surface-secondary-dark']).toBe('#0a0a0a');
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

    expect(el.style.getPropertyValue('--brand-font-body')).toBe(
      "'Lora', 'Lora-fallback'"
    );
    expect(el.style.getPropertyValue('--brand-font-heading')).toBe(
      "'Poppins', 'Poppins-fallback'"
    );
    expect(el.style.getPropertyValue('--brand-font-body')).not.toContain(
      'var(--font-sans)'
    );
  });

  it('injectBrandVars quotes a numeric light family name (Source Sans 3)', () => {
    const el = makeOrgLayout();
    injectBrandVars({ ...baseState, fontBody: 'Source Sans 3' });

    // A numeric token is invalid unquoted; the single-quoted form is required.
    expect(el.style.getPropertyValue('--brand-font-body')).toBe(
      "'Source Sans 3', 'Source Sans 3-fallback'"
    );
  });

  it('previewFont emits a bare family name (hover-preview path)', () => {
    const el = makeOrgLayout();
    previewFont('body', 'Playfair Display');

    expect(el.style.getPropertyValue('--brand-font-body')).toBe(
      "'Playfair Display', 'Playfair Display-fallback'"
    );
    expect(el.style.getPropertyValue('--brand-font-body')).not.toContain(
      'var(--font-sans)'
    );
  });

  it('revertFontPreview restores a bare family name', () => {
    const el = makeOrgLayout();
    revertFontPreview('heading', 'Space Grotesk');

    expect(el.style.getPropertyValue('--brand-font-heading')).toBe(
      "'Space Grotesk', 'Space Grotesk-fallback'"
    );
    expect(el.style.getPropertyValue('--brand-font-heading')).not.toContain(
      'var(--font-sans)'
    );
  });
});

/**
 * The org layout binds its brand inputs with `style:`, which Svelte re-sets
 * only when a value changes, and clears the token overrides right after
 * hydration. An input the clear removes stays gone until reload: the ground
 * numbers did, so every org page nudged against the platform's (Codex-mik4h).
 */
describe('clearTokenOverrides keeps what the org layout binds', () => {
  const layout = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../routes/_org/[slug]/+layout.svelte'
    ),
    'utf8'
  );
  const bound = [...layout.matchAll(/style:(--[\w-]+)=/g)].map(
    ([, prop]) => prop
  );

  it('keeps every bound input, the ground numbers among them, and clears the overrides', () => {
    expect(bound).toEqual(
      expect.arrayContaining([
        '--brand-bg',
        '--brand-bg-dark',
        '--brand-ground-y',
        '--brand-ground-dark-y',
        '--brand-shader-logo-url',
      ])
    );
    const el = document.createElement('div');
    for (const prop of bound) el.style.setProperty(prop, '1');
    el.style.setProperty('--color-interactive', '#2563eb');
    el.style.setProperty('--brand-glass-tint', '#abc');

    clearTokenOverrides(el);

    expect(bound.filter((prop) => !el.style.getPropertyValue(prop))).toEqual(
      []
    );
    expect(el.style.getPropertyValue('--color-interactive')).toBe('');
    expect(el.style.getPropertyValue('--brand-glass-tint')).toBe('');
  });
});

// Owner, Codex-mik4h: "Ignore it, like On Brand". The editor paints only a
// background the nudge can measure, as the layouts do.
describe('injectBrandVars paints only a background it can measure', () => {
  const state: BrandEditorState = {
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

  afterEach(() => {
    for (const el of document.querySelectorAll('.org-layout')) el.remove();
  });

  function layout(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'org-layout';
    document.body.appendChild(el);
    return el;
  }

  it('ignores a light background in a form it cannot measure', () => {
    const el = layout();
    injectBrandVars({ ...state, backgroundColor: 'rgb(30 30 46)' });

    expect(el.hasAttribute('data-org-bg')).toBe(false);
    expect(el.style.getPropertyValue('--brand-bg')).toBe('');
    expect(el.style.getPropertyValue('--brand-ground-y')).toBe('');
    expect(el.style.getPropertyValue('--brand-color')).toBe('#3355ff');
  });

  it('drops a dark background it cannot measure, so dark reads the light one', () => {
    const el = layout();
    injectBrandVars({
      ...state,
      backgroundColor: '#ffffff',
      darkOverrides: { backgroundColor: 'rgb(20 20 20)' },
    });

    expect(el.hasAttribute('data-org-bg')).toBe(true);
    expect(el.style.getPropertyValue('--brand-bg')).toBe('#ffffff');
    expect(el.style.getPropertyValue('--brand-bg-dark')).toBe('');
    // In dark, white binds at the sticky glass over dark content (ground.test.ts).
    expect(el.style.getPropertyValue('--brand-ground-dark-y')).toBe(
      groundLuminance('#ffffff', 'dark')
    );
  });

  // Owner, Codex-mik4h: "Same rule as backgrounds". A dark brand colour the
  // chip bound cannot hold is not painted, so dark reads the light brand.
  it('drops a dark brand colour that is not a hex, so dark reads the light one', () => {
    const el = layout();
    injectBrandVars({
      ...state,
      darkOverrides: {
        primaryColor: 'oklch(0.6 0.4 0)',
        secondaryColor: 'color(display-p3 1 0 0.4)',
        accentColor: ' #aabbcc ',
      },
    });

    expect(el.style.getPropertyValue('--brand-color-dark')).toBe('');
    expect(el.style.getPropertyValue('--brand-secondary-dark')).toBe('');
    expect(el.style.getPropertyValue('--brand-accent-dark')).toBe('#aabbcc');
  });
});

describe('injectBrandVars paints the canonical hex', () => {
  afterEach(() => {
    for (const el of document.querySelectorAll('.org-layout')) el.remove();
  });

  it('trims a padded background and measures the ground from what it paints', () => {
    const el = document.createElement('div');
    el.className = 'org-layout';
    document.body.appendChild(el);
    injectBrandVars({
      primaryColor: '#3355ff',
      secondaryColor: null,
      accentColor: null,
      backgroundColor: '#ffffff',
      fontBody: null,
      fontHeading: null,
      radius: 0.5,
      density: 1,
      logoUrl: null,
      tokenOverrides: {},
      darkOverrides: { backgroundColor: ' #000000 ' },
      darkTokenOverrides: null,
      heroLayout: 'default',
    });

    expect(el.style.getPropertyValue('--brand-bg-dark')).toBe('#000000');
    // Measured from the trimmed black, not borrowed from the light white.
    expect(el.style.getPropertyValue('--brand-ground-dark-y')).toBe(
      groundLuminance('#000000', 'dark')
    );
  });
});
