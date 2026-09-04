import { beforeEach, describe, expect, it } from 'vitest';
import {
  AA_TEXT_CONTRAST,
  BRAND_PRESETS,
  brandEditor,
  contrast,
} from '$lib/brand-editor';
import { COMPOSED_DESIGN_KEYS } from '$lib/brand-editor/preset-axes';
import { applyMix, currentPalette } from './apply-mix';

/**
 * The Mix tab's claim is specific and worth locking: a look mixed on the
 * admin's OWN palette is as complete and as legible as a shipped preset,
 * because it runs the same `composePreset`. If mixing ever became a partial
 * overlay it would silently reintroduce the cross-preset bleed that composition
 * was built to eliminate — every one of these assertions would still read as
 * plausible while the product regressed.
 */

const ORG_ID = 'org-mix-test';

function openWith(overrides: Record<string, unknown> = {}): void {
  brandEditor.open(ORG_ID, {
    primaryColor: '#1E40AF',
    secondaryColor: '#4B5563',
    accentColor: '#059669',
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    heroLayout: 'default',
    darkOverrides: null,
    ...overrides,
  } as never);
}

beforeEach(() => {
  brandEditor.close();
});

describe('currentPalette', () => {
  it('reads the palette the admin has already chosen', () => {
    openWith({ primaryColor: '#7C3AED', accentColor: '#F59E0B' });
    const palette = currentPalette();
    expect(palette.primary).toBe('#7C3AED');
    expect(palette.accent).toBe('#F59E0B');
    // The primary carries the brand hue; composePreset moves its lightness
    // per theme rather than inventing a heading colour.
    expect(palette.headingIntent).toBe('#7C3AED');
  });

  it('derives a dark primary when the palette has not declared one', () => {
    // A colour picked to read on white, reused verbatim on near-black, is the
    // same defect class as the heading fallback. A mix has no author to ask.
    openWith({ primaryColor: '#1E40AF', darkOverrides: null });
    const palette = currentPalette();
    expect(palette.darkPrimary).not.toBe('#1E40AF');
    expect(contrast(palette.darkPrimary, '#0A0A0A') as number).toBeGreaterThan(
      contrast('#1E40AF', '#0A0A0A') as number
    );
  });

  it('prefers an explicit dark primary over the derived one', () => {
    openWith({
      primaryColor: '#1E40AF',
      darkOverrides: { primaryColor: '#93C5FD' },
    });
    expect(currentPalette().darkPrimary).toBe('#93C5FD');
  });
});

describe('applyMix', () => {
  it('fills every composed design key, exactly as a preset does', () => {
    openWith();
    applyMix({ type: 'editorial', form: 'plush', atmosphere: 'drape' });

    const written = brandEditor.pending?.tokenOverrides ?? {};
    const missing = COMPOSED_DESIGN_KEYS.filter((k) => !(k in written));
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('keeps the admin palette and only moves the axes', () => {
    openWith({ primaryColor: '#0D9488', accentColor: '#F97316' });
    applyMix({ type: 'mono', form: 'precise', atmosphere: 'lattice' });

    expect(brandEditor.pending?.primaryColor).toBe('#0D9488');
    expect(brandEditor.pending?.accentColor).toBe('#F97316');
    // …while the axes did land.
    expect(brandEditor.pending?.fontHeading).toBe('JetBrains Mono');
    expect(brandEditor.pending?.radius).toBe(0);
    expect(brandEditor.pending?.tokenOverrides['shader-preset']).toBe('gyroid');
  });

  it('guarantees AA headings in both themes for any mix', () => {
    // Every axis combination, on a palette chosen to be awkward: a mid-lightness
    // saturated teal is exactly where a single lightness pivot misjudges
    // contrast, so it is the right probe.
    openWith({ primaryColor: '#0D9488', backgroundColor: null });
    const failures: string[] = [];
    for (const type of ['classical', 'poster', 'mono'] as const) {
      for (const form of ['flat', 'plush'] as const) {
        for (const atmosphere of ['still', 'alabaster', 'forge'] as const) {
          applyMix({ type, form, atmosphere });
          const light = brandEditor.pending?.tokenOverrides['heading-color'];
          const dark =
            brandEditor.pending?.darkTokenOverrides?.['heading-color'];
          const lightRatio = light ? contrast(light, '#FFFFFF') : null;
          const darkRatio = dark ? contrast(dark, '#262626') : null;
          if (!lightRatio || lightRatio < AA_TEXT_CONTRAST) {
            failures.push(
              `${type}/${form}/${atmosphere} light: ${light} = ${lightRatio?.toFixed(2)}`
            );
          }
          if (!darkRatio || darkRatio < AA_TEXT_CONTRAST) {
            failures.push(
              `${type}/${form}/${atmosphere} dark: ${dark} = ${darkRatio?.toFixed(2)}`
            );
          }
        }
      }
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });

  it('preserves player fine-tunes the mix never authors', () => {
    // Same spread-merge contract as applyPreset (Codex-oqv3r). `player-*` is
    // the surface composition deliberately leaves to org-brand.css.
    brandEditor.open(ORG_ID, {
      primaryColor: '#1E40AF',
      secondaryColor: null,
      accentColor: null,
      backgroundColor: null,
      fontBody: null,
      fontHeading: null,
      radius: 0.5,
      density: 1,
      heroLayout: 'default',
      darkOverrides: null,
      tokenOverrides: { 'player-text': '#FF00FF' },
    } as never);

    applyMix({ type: 'grotesk', form: 'sharp', atmosphere: 'current' });
    expect(brandEditor.pending?.tokenOverrides['player-text']).toBe('#FF00FF');
  });

  it('reaches the same completeness as the shipped presets', () => {
    // The equivalence is the point: mixing must not be a lesser path.
    openWith();
    applyMix(BRAND_PRESETS[0].axes);
    const mixedKeys = Object.keys(
      brandEditor.pending?.tokenOverrides ?? {}
    ).filter((k) => !k.startsWith('player-'));
    const presetKeys = Object.keys(BRAND_PRESETS[0].tokenOverrides ?? {});
    expect(new Set(mixedKeys)).toEqual(new Set(presetKeys));
  });
});
