/**
 * BrandStudioRail behaviour tests (Codex-cijzb · WP-1.5 + rail-UX overhaul).
 *
 * Proves the rail's OWN navigation surface — the master/detail model: a BROWSE
 * list of grouped control rows + search, and a FOCUS view where a chosen control
 * owns the full height with a Back affordance and (for colours) the contextual
 * editing-theme + contrast bar. The REUSED brand-editor leaf components are
 * mocked to an inert stub (they have their own suites, and their real deps —
 * Melt, the logo remote form, OKLCH canvas — don't need to load to test the
 * rail's navigation logic).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// Paraglide messages — deterministic strings, no generated-module dependency.
vi.mock('$paraglide/messages', () => ({
  branding_title: () => 'Branding',
  branding_description: () => 'Theme your whole space.',
  branding_save: () => 'Save changes',
}));

// Reused leaf/level components → inert stub (see StubField.test.svelte). Each
// factory inlines the import so it is safe under vi.mock hoisting (a shared
// const would be referenced before initialization).
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorColors.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorHeaderLayout.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorHeroText.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorLogo.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorShape.svelte',
  () => import('./rail/StubField.test.svelte')
);
vi.mock(
  '$lib/components/brand-editor/levels/BrandEditorTypography.svelte',
  () => import('./rail/StubField.test.svelte')
);

import BrandStudioRail from './BrandStudioRail.svelte';

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

function mountRail() {
  return mount(BrandStudioRail, {
    target: document.body,
    props: { saving: false, isDirty: false, onsave: () => {} },
  });
}

function typeSearch(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    '.brand-rail__search-input'
  );
  if (!input) throw new Error('search input not found');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  return input;
}

/** Labels of the currently-visible browse control rows, in order. */
function visibleRowLabels(): string[] {
  return Array.from(document.querySelectorAll('.rail-row__label')).map(
    (el) => el.textContent?.trim() ?? ''
  );
}

/** Open a control's focus view by its row label. */
function openRow(label: string) {
  const row = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.rail-row')
  ).find(
    (r) => r.querySelector('.rail-row__label')?.textContent?.trim() === label
  );
  if (!row) throw new Error(`control row not found: ${label}`);
  row.click();
  flushSync();
}

describe('BrandStudioRail', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved());
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    document.body.innerHTML = '';
  });

  test('browse renders the three difficulty-dial groups', () => {
    component = mountRail();
    const groups = document.querySelectorAll('.brand-rail__group');
    expect(groups).toHaveLength(3);
    const labels = Array.from(
      document.querySelectorAll('.brand-rail__group-label')
    ).map((g) => g.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(labels.some((l) => l.includes('Foundations'))).toBe(true);
    expect(labels.some((l) => l.includes('Identity'))).toBe(true);
    expect(labels.some((l) => l.includes('Hero'))).toBe(true);
  });

  test('browse lists all seven control rows in order', () => {
    component = mountRail();
    expect(visibleRowLabels()).toEqual([
      'Colours',
      'Shape & density',
      'Typography',
      'Logo',
      'Hero text',
      'Layout & visibility',
      'Effects',
    ]);
  });

  test('clicking a control row opens its full-height focus', () => {
    component = mountRail();
    openRow('Typography');

    expect(document.querySelector('.brand-rail__focus-body')).toBeTruthy();
    expect(
      document.querySelector('.brand-rail__focus-h')?.textContent?.trim()
    ).toBe('Typography');
    // The browse list is unmounted — only one view is present at a time.
    expect(document.querySelector('.brand-rail__browse')).toBeNull();
  });

  test('Back returns from a focus to the browse list', () => {
    component = mountRail();
    openRow('Logo');
    expect(document.querySelector('.brand-rail__focus-body')).toBeTruthy();

    document.querySelector<HTMLButtonElement>('.brand-rail__back')?.click();
    flushSync();

    expect(document.querySelector('.brand-rail__browse')).toBeTruthy();
    expect(document.querySelector('.brand-rail__focus-body')).toBeNull();
  });

  test('the colour focus shows its Affects line + the editing-theme/contrast context bar', () => {
    component = mountRail();
    openRow('Colours');

    const affects =
      document.querySelector('.brand-rail__affects')?.textContent ?? '';
    expect(affects).toContain('Buttons');
    expect(affects).toContain('Hero');

    // The editing-theme + contrast bar is CONTEXTUAL — colour focus only.
    expect(
      document.querySelector('.brand-rail__context .contrast')
    ).toBeTruthy();
  });

  test('a non-colour focus does NOT render the contrast context bar', () => {
    component = mountRail();
    openRow('Shape & density');
    expect(document.querySelector('.brand-rail__context')).toBeNull();
  });

  test('search filters the browse rows to matches', () => {
    component = mountRail();
    typeSearch('shader');
    // Only hero-effects ("Effects") carries the "shader" keyword.
    expect(visibleRowLabels()).toEqual(['Effects']);
  });

  test('a non-matching query shows the empty state', () => {
    component = mountRail();
    typeSearch('zzzznope');
    expect(document.querySelector('.brand-rail__no-results')).toBeTruthy();
    expect(visibleRowLabels()).toEqual([]);
  });

  test('search "hero text" narrows to the hero-text row, excluding hero-layout', () => {
    component = mountRail();
    typeSearch('hero text');
    const rows = visibleRowLabels();
    expect(rows).toContain('Hero text');
    expect(rows).not.toContain('Layout & visibility');
  });

  test('Enter in search opens the first match’s focus', () => {
    component = mountRail();
    const input = typeSearch('logo');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    flushSync();

    // "logo" resolves to the Logo control → its focus opens directly.
    expect(document.querySelector('.brand-rail__focus-body')).toBeTruthy();
    expect(
      document.querySelector('.brand-rail__focus-h')?.textContent?.trim()
    ).toBe('Logo');
  });
});
