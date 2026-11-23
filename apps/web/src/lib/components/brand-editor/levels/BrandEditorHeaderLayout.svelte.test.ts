/**
 * Layout & visibility shows only what the org's hero draws (the owner's,
 * 2026-11-23): the Arrangement picker, the Content pills switch and Logo size
 * belong to the classic hero, so a purpose-led hero (the Showreel and every
 * other composition) is offered only the switches it honours.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import BrandEditorHeaderLayout from './BrandEditorHeaderLayout.svelte';

const ORG_ID = 'org-header-layout';

function brand(
  tokenOverrides: Record<string, string | null>
): BrandEditorState {
  return {
    primaryColor: '#CB213C',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: '#0F0000',
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    tokenOverrides,
  };
}

let component: ReturnType<typeof mount> | null = null;
function render(tokenOverrides: Record<string, string | null> = {}) {
  brandEditor.open(ORG_ID, brand(tokenOverrides));
  component = mount(BrandEditorHeaderLayout, { target: document.body });
  flushSync();
}

const sections = () =>
  [...document.querySelectorAll('.layout-editor__section-label')].map((s) =>
    s.textContent?.trim()
  );
const toggles = () =>
  [...document.querySelectorAll('.layout-editor__toggle-label')].map((t) =>
    t.textContent?.trim()
  );

afterEach(() => {
  if (component) unmount(component);
  component = null;
  brandEditor.close();
  document.body.innerHTML = '';
});

describe('BrandEditorHeaderLayout', () => {
  test('the classic hero keeps every control', () => {
    render();
    expect(sections()).toEqual(['Arrangement', 'Show / Hide', 'Logo Size']);
    expect(toggles()).toEqual([
      'Title',
      'Logo',
      'Description',
      'Content pills',
      'Stats',
    ]);
  });

  test('a purpose-led hero is offered only the switches it honours', () => {
    render({ 'hero-opt-purpose': 'consume', 'hero-opt-comp': 'showreel' });
    expect(sections()).toEqual(['Show / Hide']);
    expect(toggles()).toEqual(['Title', 'Logo', 'Description', 'Stats']);
  });

  test('a stored value the hero ignores is kept, not cleared', () => {
    render({
      'hero-opt-purpose': 'consume',
      'hero-logo-scale': '2',
      'hero-hide-pills': '1',
    });
    expect(brandEditor.pending?.tokenOverrides?.['hero-logo-scale']).toBe('2');
    expect(brandEditor.pending?.tokenOverrides?.['hero-hide-pills']).toBe('1');
  });
});
