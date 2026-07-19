/**
 * BrandStudioRail behaviour tests (Codex-cijzb · WP-1.5).
 *
 * Proves the rail's OWN navigation surface — grouped collapsible sections,
 * search filter + jump, breadcrumb, and the "Affects:" chips. The REUSED
 * brand-editor leaf components are mocked to an inert stub (they have their own
 * suites, and their real deps — Melt, the logo remote form, OKLCH canvas —
 * don't need to load to test the rail's grouping logic).
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

  test('renders exactly the three difficulty-dial groups', () => {
    component = mountRail();
    const groups = document.querySelectorAll('[data-rail-group]');
    expect(groups).toHaveLength(3);
    const ids = Array.from(groups).map((g) =>
      g.getAttribute('data-rail-group')
    );
    expect(ids).toEqual(['foundations', 'identity', 'hero']);
  });

  test('Foundations starts expanded; other groups start collapsed', () => {
    component = mountRail();
    expect(
      document.getElementById('rail-group-foundations')?.hasAttribute('hidden')
    ).toBe(false);
    expect(
      document.getElementById('rail-group-identity')?.hasAttribute('hidden')
    ).toBe(true);
  });

  test('clicking a group header toggles its region open', () => {
    component = mountRail();
    const header = document.querySelector<HTMLButtonElement>(
      '[data-rail-group-header="identity"]'
    );
    expect(header?.getAttribute('aria-expanded')).toBe('false');

    header?.click();
    flushSync();

    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById('rail-group-identity')?.hasAttribute('hidden')
    ).toBe(false);
  });

  test('renders "Affects:" chips for the colours control', () => {
    component = mountRail();
    const colours = document.getElementById('rail-control-colours');
    const chips = colours?.querySelectorAll('.rail-control__chip') ?? [];
    expect(chips.length).toBeGreaterThan(0);
    const chipText = Array.from(chips).map((c) => c.textContent?.trim());
    expect(chipText).toContain('Buttons');
    expect(chipText).toContain('Hero');
  });

  test('search hides non-matching groups and controls', () => {
    component = mountRail();
    typeSearch('shader');

    // Hero contains the matching "Effects" control → group visible.
    expect(
      document
        .querySelector('[data-rail-group="hero"]')
        ?.classList.contains('rail-group--hidden')
    ).toBe(false);
    // Foundations + Identity have no match → hidden.
    expect(
      document
        .querySelector('[data-rail-group="foundations"]')
        ?.classList.contains('rail-group--hidden')
    ).toBe(true);
    // Within Hero: effects matches, layout does not.
    expect(
      document
        .querySelector('[data-rail-control="hero-effects"]')
        ?.classList.contains('rail-control--hidden')
    ).toBe(false);
    expect(
      document
        .querySelector('[data-rail-control="hero-layout"]')
        ?.classList.contains('rail-control--hidden')
    ).toBe(true);
  });

  test('a non-matching query shows the empty state', () => {
    component = mountRail();
    typeSearch('zzzznope');
    expect(document.querySelector('.brand-rail__no-results')).toBeTruthy();
  });

  test('Enter in search jumps to the first match and updates the breadcrumb', () => {
    component = mountRail();
    const input = typeSearch('logo');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    flushSync();

    // "logo" lives in Identity → it becomes the active breadcrumb group.
    const current = document.querySelector('.brand-rail__crumb--current');
    expect(current?.textContent?.trim()).toBe('Identity');
    expect(
      document.getElementById('rail-group-identity')?.hasAttribute('hidden')
    ).toBe(false);
  });
});
