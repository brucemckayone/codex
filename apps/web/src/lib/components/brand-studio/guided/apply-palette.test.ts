/**
 * Guided → store wiring (Codex-cijzb · WP-1.7).
 *
 * The three Guided quick-starts all mutate the SAME module-level `brandEditor`
 * store, so their edits live-preview and carry into the Advanced rail. These
 * tests exercise that contract against the real store:
 *   - seed/logo palette → `applyFullPalette` populates all four colour fields.
 *   - preset → `applyPreset` sets the palette AND spread-merges token overrides
 *     (guards the Codex-oqv3r regression the reuse mandate calls out).
 *   - handoff → an edit made "in Guided" is visible through the store view the
 *     Advanced rail reads (same singleton — nothing is transferred).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { BRAND_PRESETS, brandEditor } from '$lib/brand-editor';
import { generateFullPalettes } from '$lib/brand-editor/palette-generator';
import { applyFullPalette } from './apply-palette';

const ORG_ID = '00000000-0000-4000-8000-000000000000';

function makeSaved(
  overrides: Partial<BrandEditorState> = {}
): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
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
    ...overrides,
  };
}

describe('Guided → store wiring (WP-1.7)', () => {
  beforeEach(() => {
    // Reset the module-level singleton between tests.
    brandEditor.close();
  });

  it('seed/logo path: applyFullPalette writes the complete palette to pending', () => {
    brandEditor.open(ORG_ID, makeSaved());

    const palettes = generateFullPalettes('#0EA5E9');
    const palette = palettes[1]; // a "…Soft" variant — carries a background too
    expect(palette).toBeDefined();
    expect(palette.background).not.toBeNull();

    applyFullPalette(palette);

    expect(brandEditor.pending?.primaryColor).toBe(palette.primary);
    expect(brandEditor.pending?.secondaryColor).toBe(palette.secondary);
    expect(brandEditor.pending?.accentColor).toBe(palette.accent);
    expect(brandEditor.pending?.backgroundColor).toBe(palette.background);
  });

  it('preset path: applyPreset sets the palette AND spread-merges token overrides (Codex-oqv3r)', () => {
    // A pre-existing fine-tune override the preset does not touch.
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shadow-scale': '1.5' } })
    );
    const preset = BRAND_PRESETS[0];

    brandEditor.applyPreset(preset);

    expect(brandEditor.pending?.primaryColor).toBe(preset.values.primaryColor);
    expect(brandEditor.pending?.secondaryColor).toBe(
      preset.values.secondaryColor
    );
    // The untouched key must survive — a spread-merge, not a wholesale replace.
    expect(brandEditor.pending?.tokenOverrides['shadow-scale']).toBe('1.5');
  });

  it('handoff: an edit made in Guided is visible through the Advanced store view', () => {
    brandEditor.open(ORG_ID, makeSaved());
    const palette = generateFullPalettes('#22C55E')[0];

    applyFullPalette(palette);

    // The Advanced rail reads the same singleton; getSavePayload is its view.
    const payload = brandEditor.getSavePayload();
    expect(payload?.primaryColor).toBe(palette.primary);
    expect(payload?.accentColor).toBe(palette.accent);
    expect(brandEditor.isDirty).toBe(true);
  });
});
