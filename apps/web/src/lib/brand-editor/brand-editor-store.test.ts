/**
 * Brand Editor Store — per-theme tokenOverride routing (Codex-wwedk)
 *
 * Verifies that setThemeTokenOverride routes writes to the correct bucket
 * based on editingTheme, and that getThemeTokenOverride falls back to the
 * light value when the dark map has no entry — mirroring the visitor-facing
 * CSS fallback chain.
 *
 * The store is a Svelte 5 module-level $state singleton, so each test resets
 * via close() then re-opens with a known saved state.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { brandEditor } from './brand-editor-store.svelte';
import type { BrandEditorState } from './types';

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

describe('brandEditor.setThemeTokenOverride (Codex-wwedk)', () => {
  beforeEach(() => {
    // Reset store between tests — close then re-open with fresh state.
    brandEditor.close();
  });

  it('routes writes to tokenOverrides when editingTheme is light', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.setEditingTheme('light');

    brandEditor.setThemeTokenOverride('shader-preset', 'flow');

    expect(brandEditor.pending?.tokenOverrides['shader-preset']).toBe('flow');
    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  it('routes writes to darkTokenOverrides when editingTheme is dark', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('dark');

    brandEditor.setThemeTokenOverride('shader-preset', 'ink');

    // Light value untouched.
    expect(brandEditor.pending?.tokenOverrides['shader-preset']).toBe('flow');
    // Dark bucket carries the new value.
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'shader-preset': 'ink',
    });
  });

  it('removes the dark override when value matches the light value', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: { 'shader-preset': 'ink' },
      })
    );
    brandEditor.setEditingTheme('dark');

    // Setting dark = light value clears the dark override (auto-derive).
    brandEditor.setThemeTokenOverride('shader-preset', 'flow');

    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  it('removes the dark override when value is null', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: {
          'shader-preset': 'ink',
          'glass-tint': '#000000',
        },
      })
    );
    brandEditor.setEditingTheme('dark');

    brandEditor.setThemeTokenOverride('shader-preset', null);

    // shader-preset removed, glass-tint preserved.
    expect(brandEditor.pending?.darkTokenOverrides).toEqual({
      'glass-tint': '#000000',
    });
  });

  it('clears tokenOverrides[key] when value is null in light editing', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('light');

    brandEditor.setThemeTokenOverride('shader-preset', null);

    expect(
      brandEditor.pending?.tokenOverrides['shader-preset']
    ).toBeUndefined();
  });
});

describe('brandEditor.getThemeTokenOverride (Codex-wwedk)', () => {
  beforeEach(() => {
    brandEditor.close();
  });

  it('returns the light value when editing light', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('light');

    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('flow');
  });

  it('returns the dark value when editing dark and key is set', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({
        tokenOverrides: { 'shader-preset': 'flow' },
        darkTokenOverrides: { 'shader-preset': 'ink' },
      })
    );
    brandEditor.setEditingTheme('dark');

    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('ink');
  });

  it('falls back to light when editing dark and key is not in dark map', () => {
    brandEditor.open(
      ORG_ID,
      makeSaved({ tokenOverrides: { 'shader-preset': 'flow' } })
    );
    brandEditor.setEditingTheme('dark');

    // No dark entry — must fall back to light value (matches CSS fallback).
    expect(brandEditor.getThemeTokenOverride('shader-preset')).toBe('flow');
  });

  it('returns undefined when key absent in both light and dark', () => {
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.setEditingTheme('dark');

    expect(
      brandEditor.getThemeTokenOverride('nonexistent-key')
    ).toBeUndefined();
  });
});
