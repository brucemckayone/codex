/**
 * BrandEditorHeroText behaviour tests (Codex-cijzb · WP-1.6).
 *
 * Proves the rail's hero-text control:
 *   - seeds the CURRENT org name + subheading into the reused
 *     `updateOrganizationForm` so the inputs render pre-populated;
 *   - fires `onsaved` after a SUCCESSFUL save so the route can reload the
 *     preview iframe (org name/description are not brand tokens → a structural
 *     reload, not the WP-1.4 colour bridge);
 *   - SURFACES a failed persist and does NOT fire the reload (the persist path
 *     must be able to fail loudly, never silently swallow).
 *
 * The remote form is mocked to a reactive $state-backed double so the submit
 * lifecycle can be driven deterministically (the real form needs `$app/server`,
 * which jsdom has not got).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$paraglide/messages', () => ({
  branding_hero_name_label: () => 'Organization name',
  branding_hero_subheading_label: () => 'Hero subheading',
  branding_hero_subheading_placeholder: () => 'A short tagline',
}));

vi.mock(
  '$lib/remote/org.remote',
  () => import('./__fixtures__/update-org-form.mock.svelte')
);

import {
  fieldSets,
  reset,
  setPending,
  setResult,
} from './__fixtures__/update-org-form.mock.svelte';
import BrandEditorHeroText from './BrandEditorHeroText.svelte';

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

describe('BrandEditorHeroText', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    reset();
    brandEditor.close();
    brandEditor.open(ORG_ID, makeSaved());
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    brandEditor.close();
    reset();
    document.body.innerHTML = '';
  });

  test('seeds the current org name + subheading into the form', () => {
    component = mount(BrandEditorHeroText, {
      target: document.body,
      props: { name: 'Acme Studio', description: 'Old tagline' },
    });
    flushSync();

    expect(fieldSets.name).toContain('Acme Studio');
    expect(fieldSets.description).toContain('Old tagline');
  });

  test('seeds an empty string when the description is null', () => {
    component = mount(BrandEditorHeroText, {
      target: document.body,
      props: { name: 'Acme Studio', description: null },
    });
    flushSync();

    expect(fieldSets.description).toContain('');
  });

  test('fires onsaved after a successful save (→ preview reload)', () => {
    const onsaved = vi.fn();
    component = mount(BrandEditorHeroText, {
      target: document.body,
      props: { name: 'Acme Studio', description: 'Old tagline', onsaved },
    });
    flushSync();

    // A stale prior result must not have fired it on mount.
    expect(onsaved).not.toHaveBeenCalled();

    // Simulate the form settling on a successful save.
    setPending(0);
    setResult({ success: true, data: { name: 'Acme Studio' } });
    flushSync();

    expect(onsaved).toHaveBeenCalledTimes(1);
  });

  test('surfaces a failed save and does NOT fire the reload', () => {
    const onsaved = vi.fn();
    component = mount(BrandEditorHeroText, {
      target: document.body,
      props: { name: '', description: 'Old tagline', onsaved },
    });
    flushSync();

    setPending(0);
    setResult({ success: false, error: 'Organization name is required' });
    flushSync();

    // Error is rendered (not swallowed)…
    const alert = [...document.querySelectorAll('[role="alert"]')].find((el) =>
      el.textContent?.includes('Organization name is required')
    );
    expect(alert).toBeTruthy();
    // …and the preview is NOT reloaded on a failed persist.
    expect(onsaved).not.toHaveBeenCalled();
  });
});
