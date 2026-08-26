/**
 * Brand Studio mode resolution (Codex-cijzb · WP-1.7).
 *
 * Pure heuristics only — the localStorage glue is a thin browser wrapper around
 * these. Verifies the default (Guided for unbranded, Advanced otherwise) and
 * that a remembered explicit choice wins.
 */
import { describe, expect, it } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import {
  isUnbrandedState,
  modeStorageKey,
  parseMode,
  resolveInitialMode,
} from './brand-studio-mode';

function state(overrides: Partial<BrandEditorState> = {}): BrandEditorState {
  return {
    primaryColor: '#C24129',
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

describe('isUnbrandedState', () => {
  it('is true for a fresh org (only the fallback primary)', () => {
    expect(isUnbrandedState(state())).toBe(true);
  });

  it('treats a logo alone as still-unbranded (a logo is not a palette)', () => {
    expect(isUnbrandedState(state({ logoUrl: 'https://cdn/logo.png' }))).toBe(
      true
    );
  });

  it('is false once any secondary/accent/background colour is set', () => {
    expect(isUnbrandedState(state({ secondaryColor: '#123456' }))).toBe(false);
    expect(isUnbrandedState(state({ backgroundColor: '#000000' }))).toBe(false);
  });

  it('is false once a custom font is chosen', () => {
    expect(isUnbrandedState(state({ fontHeading: 'Inter' }))).toBe(false);
  });

  it('is false once token overrides exist', () => {
    expect(
      isUnbrandedState(state({ tokenOverrides: { 'shader-preset': 'silk' } }))
    ).toBe(false);
  });

  it('is false once dark overrides exist', () => {
    expect(
      isUnbrandedState(state({ darkOverrides: { primaryColor: '#111111' } }))
    ).toBe(false);
  });
});

describe('resolveInitialMode', () => {
  it('defaults to guided for an unbranded org', () => {
    expect(resolveInitialMode({ storedMode: null, isUnbranded: true })).toBe(
      'guided'
    );
  });

  it('defaults to advanced for a branded org', () => {
    expect(resolveInitialMode({ storedMode: null, isUnbranded: false })).toBe(
      'advanced'
    );
  });

  it('lets a remembered choice win over the branded-ness default', () => {
    expect(
      resolveInitialMode({ storedMode: 'advanced', isUnbranded: true })
    ).toBe('advanced');
    expect(
      resolveInitialMode({ storedMode: 'guided', isUnbranded: false })
    ).toBe('guided');
  });

  it('ignores an invalid stored value and uses the default', () => {
    expect(
      resolveInitialMode({ storedMode: 'nonsense', isUnbranded: true })
    ).toBe('guided');
  });
});

describe('parseMode / modeStorageKey', () => {
  it('narrows only the valid modes', () => {
    expect(parseMode('guided')).toBe('guided');
    expect(parseMode('advanced')).toBe('advanced');
    expect(parseMode('x')).toBeNull();
    expect(parseMode(null)).toBeNull();
    expect(parseMode(undefined)).toBeNull();
  });

  it('namespaces the storage key per org', () => {
    expect(modeStorageKey('org-1')).toBe('codex:brand-studio-mode:org-1');
    expect(modeStorageKey('org-2')).not.toBe(modeStorageKey('org-1'));
  });
});
