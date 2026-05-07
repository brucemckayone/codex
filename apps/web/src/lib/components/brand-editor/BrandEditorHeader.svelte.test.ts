import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { brandEditor } from '$lib/brand-editor';
import type { BrandEditorState } from '$lib/brand-editor/types';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandEditorHeader from './BrandEditorHeader.svelte';

/**
 * BrandEditorHeader renders the title + breadcrumb back-button + theme toggle
 * + minimize / close actions for the floating brand editor panel. The title
 * label and back-button visibility come from the module-level `brandEditor`
 * store, so each test seeds the store via `brandEditor.open()` then resets
 * with `brandEditor.close()` afterwards.
 */

const ORG_ID = '00000000-0000-4000-8000-000000000000';

function makeSaved(): BrandEditorState {
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
  };
}

describe('BrandEditorHeader', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    // Open the store so currentLevel/editingTheme are populated. Default
    // level after open() is 'home' (no parent → no back button rendered).
    brandEditor.open(ORG_ID, makeSaved());
    brandEditor.setEditingTheme('light');
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
    brandEditor.close();
  });

  test('renders the editor-header container with the current level title', () => {
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    const root = document.body.querySelector('.editor-header');
    expect(root).toBeTruthy();

    const title = root?.querySelector('.editor-header__title');
    expect(title?.textContent).toBe('Brand Editor');
  });

  test('hides the back button at home level (no parent), shows it on a deeper level', () => {
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    // home → parent is null → no back button.
    expect(
      document.body.querySelector('button[aria-label="Go back"]')
    ).toBeNull();

    // Navigate to a level with a parent and re-mount so the conditional
    // re-evaluates against the new derived currentLevel.
    unmount(component);
    document.body.innerHTML = '';
    brandEditor.navigateTo('colors');

    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    const backBtn = document.body.querySelector('button[aria-label="Go back"]');
    expect(backBtn).toBeTruthy();

    const title = document.body.querySelector('.editor-header__title');
    expect(title?.textContent).toBe('Colors');
  });

  test('clicking the back button calls navigateBack on the store', () => {
    brandEditor.navigateTo('colors');
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    expect(brandEditor.level).toBe('colors');

    const backBtn = document.body.querySelector(
      'button[aria-label="Go back"]'
    ) as HTMLButtonElement;
    expect(backBtn).toBeTruthy();
    backBtn.click();
    flushSync();

    // colors.parent === 'home' — store should have stepped back.
    expect(brandEditor.level).toBe('home');
  });

  test('theme toggle reflects editingTheme and toggles to the opposite theme on click', () => {
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    const toggle = document.body.querySelector(
      'button[aria-label="Switch editing theme"]'
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    // editingTheme === 'light' → label says "Light", title hints "Edit dark theme".
    expect(toggle.textContent).toContain('Light');
    expect(toggle.getAttribute('title')).toBe('Edit dark theme');

    toggle.click();
    flushSync();

    // Store flipped to dark.
    expect(brandEditor.editingTheme).toBe('dark');

    // Re-mount so the template picks up the new derived state.
    unmount(component);
    document.body.innerHTML = '';
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    const toggleAfter = document.body.querySelector(
      'button[aria-label="Switch editing theme"]'
    ) as HTMLButtonElement;
    expect(toggleAfter.textContent).toContain('Dark');
    expect(toggleAfter.getAttribute('title')).toBe('Edit light theme');
  });

  test('minimize button calls brandEditor.minimize', () => {
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    expect(brandEditor.panel).toBe('open');

    const minimizeBtn = document.body.querySelector(
      'button[aria-label="Minimize editor"]'
    ) as HTMLButtonElement;
    expect(minimizeBtn).toBeTruthy();
    minimizeBtn.click();
    flushSync();

    expect(brandEditor.panel).toBe('minimized');
  });

  test('close button invokes the onclose callback prop', () => {
    const onclose = vi.fn();
    component = mount(BrandEditorHeader, {
      target: document.body,
      props: { onclose },
    });

    const closeBtn = document.body.querySelector(
      'button[aria-label="Close editor"]'
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    flushSync();

    expect(onclose).toHaveBeenCalledTimes(1);
  });

  test('close button is a safe no-op when onclose is omitted', () => {
    component = mount(BrandEditorHeader, { target: document.body, props: {} });

    const closeBtn = document.body.querySelector(
      'button[aria-label="Close editor"]'
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    // Optional-chained call (`onclose?.()`) — clicking with no handler must not throw.
    expect(() => {
      closeBtn.click();
      flushSync();
    }).not.toThrow();
  });
});
