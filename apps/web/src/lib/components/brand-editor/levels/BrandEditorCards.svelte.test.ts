/**
 * The rail's Cards control (Codex-7104r) writes the org's card style and the
 * chosen style's dials into tokenOverrides through the real store:
 *   - a style other than Today sets 'card-style'; Today deletes it;
 *   - a dial writes 'card-dial-<style>-<dial>' as an option id or a number,
 *     and moving it back to its default deletes the key;
 *   - a range dial cannot go below the gallery's AA floor;
 *   - Reset clears only the chosen style's dials;
 *   - every other override is kept, and the dark theme being edited never
 *     routes a choice into darkTokenOverrides.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import BrandEditorCards from './BrandEditorCards.svelte';

// The picker's sample card reads the org's newest public item; a test has no
// server, so the query answers with nothing and the built-in sample shows.
vi.mock('$lib/remote/content.remote', () => ({
  getPublicContent: () => Promise.resolve({ items: [] }),
}));

const ORG_ID = 'org-cards';

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
  component = mount(BrandEditorCards, { target: document.body });
  flushSync();
}

const radio = (style: string) => {
  const el = document.querySelector<HTMLButtonElement>(
    `[role="radio"][data-style="${style}"]`
  );
  if (!el) throw new Error(`no ${style} option`);
  return el;
};
const checked = () =>
  [...document.querySelectorAll('[role="radio"]')]
    .filter((r) => r.getAttribute('aria-checked') === 'true')
    .map((r) => r.getAttribute('data-style'));
const overrides = () => brandEditor.pending?.tokenOverrides ?? {};
const slider = (label: string) => {
  const field = [...document.querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label)
  );
  const input = field?.htmlFor ? document.getElementById(field.htmlFor) : null;
  if (!(input instanceof HTMLInputElement))
    throw new Error(`no ${label} slider`);
  return input;
};
const slide = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};

afterEach(() => {
  if (component) unmount(component);
  component = null;
  brandEditor.setEditingTheme('light');
  brandEditor.close();
  // An unsaved draft is kept in sessionStorage and recovered by the next
  // open() for the same org, so a choice would leak into the next test.
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('BrandEditorCards: the style', () => {
  test('offers all twenty styles as one radiogroup, Today checked by default', () => {
    render();
    const radios = document.querySelectorAll(
      '[role="radiogroup"] [role="radio"]'
    );
    expect(radios).toHaveLength(20);
    expect(checked()).toEqual(['today']);
    expect(radio('today').tabIndex).toBe(0);
    expect(radio('glass-sheet').tabIndex).toBe(-1);
    // Today has no dials, so there is nothing to tune.
    expect(document.body.textContent).not.toContain('Tune ');
  });

  test('checks the saved style; an unknown one reads as Today', () => {
    render({ 'card-style': 'cinema' });
    expect(checked()).toEqual(['cinema']);
    unmount(component as ReturnType<typeof mount>);
    brandEditor.close();
    sessionStorage.clear();
    render({ 'card-style': 'neon' });
    expect(checked()).toEqual(['today']);
  });

  test('choosing a style writes the key and keeps every other override', () => {
    render({ 'hero-hide-stats': '1' });
    radio('glass-sheet').click();
    flushSync();
    expect(overrides()).toEqual({
      'hero-hide-stats': '1',
      'card-style': 'glass-sheet',
    });
    expect(checked()).toEqual(['glass-sheet']);
    expect(document.body.textContent).toContain('Tune Glass sheet');
    expect(brandEditor.isDirty).toBe(true);
  });

  test('choosing Today deletes the key', () => {
    render({ 'card-style': 'soft', 'hero-hide-stats': '1' });
    radio('today').click();
    flushSync();
    expect(overrides()).toEqual({ 'hero-hide-stats': '1' });
  });

  test('while the dark theme is edited the choice still lands in tokenOverrides', () => {
    render();
    brandEditor.setEditingTheme('dark');
    radio('frost').click();
    flushSync();
    expect(overrides()['card-style']).toBe('frost');
    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  test('arrow keys, Home and End select on move and carry focus', () => {
    render();
    const press = (from: string, key: string) => {
      radio(from).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
      flushSync();
    };
    radio('today').focus();
    press('today', 'ArrowRight');
    expect(overrides()['card-style']).toBe('glass-sheet');
    expect(document.activeElement).toBe(radio('glass-sheet'));
    press('glass-sheet', 'End');
    expect(overrides()['card-style']).toBe('hard-shadow');
    press('hard-shadow', 'ArrowDown'); // wraps to Today, which deletes the key
    expect(overrides()).not.toHaveProperty('card-style');
    expect(document.activeElement).toBe(radio('today'));
    press('today', 'Home');
    expect(radio('today').tabIndex).toBe(0);
  });

  test('each option draws an inert sample card in its own style', () => {
    render();
    const previews = document.querySelectorAll('.cards-editor__preview');
    expect(previews).toHaveLength(20);
    for (const preview of previews)
      expect(preview.hasAttribute('inert')).toBe(true);
    expect(
      document.querySelector(
        '.cards-editor__preview [data-card-style="glass-sheet"]'
      )
    ).not.toBeNull();
  });
});

describe('BrandEditorCards: the dials', () => {
  test('a range dial writes a number, never below the AA floor, and its default deletes the key', () => {
    render({ 'card-style': 'glass-sheet' });
    const glass = slider('Glass strength');
    expect(glass.min).toBe('74');
    // The floor says why it stops there.
    expect(document.body.textContent).toContain('It stops at 74%');
    slide(glass, '82');
    expect(overrides()['card-dial-glass-sheet-glass-opacity']).toBe('82');
    slide(glass, '74');
    expect(overrides()).not.toHaveProperty(
      'card-dial-glass-sheet-glass-opacity'
    );
  });

  test('a segmented dial writes an option id; the default option deletes it', () => {
    render({ 'card-style': 'glass-sheet' });
    const square = document.querySelector<HTMLInputElement>(
      'input[type="radio"][value="1x1"]'
    );
    if (!square) throw new Error('no 1:1 option');
    square.click();
    flushSync();
    expect(overrides()['card-dial-glass-sheet-cover-ratio']).toBe('1x1');
    const wide = document.querySelector<HTMLInputElement>(
      'input[type="radio"][value="16x9"]'
    );
    wide?.click();
    flushSync();
    expect(overrides()).not.toHaveProperty('card-dial-glass-sheet-cover-ratio');
  });

  test('a token-stop dial writes the stop id', () => {
    render({ 'card-style': 'floating-sheet' });
    slide(slider('Float from the edge'), '1');
    expect(overrides()['card-dial-floating-sheet-inset']).toBe('1-5');
  });

  test('Reset clears only the chosen style’s dials', () => {
    render({
      'card-style': 'glass-sheet',
      'card-dial-glass-sheet-glass-opacity': '90',
      'card-dial-glass-sheet-cover-ratio': '4x5',
      'card-dial-cinema-scrim-depth': '90',
      'hero-hide-stats': '1',
    });
    const reset = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Reset'
    );
    expect(reset?.disabled).toBe(false);
    reset?.click();
    flushSync();
    expect(overrides()).toEqual({
      'card-style': 'glass-sheet',
      'card-dial-cinema-scrim-depth': '90',
      'hero-hide-stats': '1',
    });
    expect(reset?.disabled).toBe(true);
  });
});
