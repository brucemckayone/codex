/**
 * The rail's Topics picker (Codex-8swlj.2) writes the landing's topic-selector
 * style into tokenOverrides['topics-style'] through the real store: a style
 * other than One bar sets the key, One bar deletes it (the default stays
 * implicit), every other override is kept, and the dark theme being edited
 * never routes the choice into darkTokenOverrides.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import { brandEditor } from '$lib/brand-editor';
import BrandEditorTopics from './BrandEditorTopics.svelte';

const ORG_ID = 'org-topics';

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
  component = mount(BrandEditorTopics, { target: document.body });
  flushSync();
}

const card = (style: string) => {
  const el = document.querySelector<HTMLButtonElement>(
    `[role="radio"][data-style="${style}"]`
  );
  if (!el) throw new Error(`no ${style} card`);
  return el;
};
const checked = () =>
  [...document.querySelectorAll('[role="radio"]')]
    .filter((r) => r.getAttribute('aria-checked') === 'true')
    .map((r) => r.getAttribute('data-style'));
const stored = () => brandEditor.pending?.tokenOverrides?.['topics-style'];

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

describe('BrandEditorTopics', () => {
  test('offers the three styles as one radiogroup, One bar checked by default', () => {
    render();
    const group = document.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(
      [...document.querySelectorAll('.topics-editor__card-label')].map((l) =>
        l.textContent?.trim()
      )
    ).toEqual(['One bar', 'Windows', 'Channels']);
    expect(checked()).toEqual(['bar']);
    // Roving tab stop: only the checked card is tabbable.
    expect(card('bar').tabIndex).toBe(0);
    expect(card('windows').tabIndex).toBe(-1);
  });

  test('checks the saved style', () => {
    render({ 'topics-style': 'channels' });
    expect(checked()).toEqual(['channels']);
  });

  test('an unknown saved style shows One bar checked', () => {
    render({ 'topics-style': 'grid' });
    expect(checked()).toEqual(['bar']);
  });

  test('choosing Windows writes the key and keeps every other override', () => {
    render({ 'hero-hide-stats': '1' });
    card('windows').click();
    flushSync();
    expect(brandEditor.pending?.tokenOverrides).toEqual({
      'hero-hide-stats': '1',
      'topics-style': 'windows',
    });
    expect(checked()).toEqual(['windows']);
    expect(brandEditor.isDirty).toBe(true);
  });

  test('choosing One bar deletes the key', () => {
    render({ 'topics-style': 'windows', 'hero-hide-stats': '1' });
    card('bar').click();
    flushSync();
    expect(brandEditor.pending?.tokenOverrides).toEqual({
      'hero-hide-stats': '1',
    });
    expect(checked()).toEqual(['bar']);
  });

  test('One bar also clears a stale unknown value', () => {
    render({ 'topics-style': 'grid' });
    card('bar').click();
    flushSync();
    expect(brandEditor.pending?.tokenOverrides).not.toHaveProperty(
      'topics-style'
    );
  });

  test('while the dark theme is edited the choice still lands in tokenOverrides', () => {
    render();
    brandEditor.setEditingTheme('dark');
    card('channels').click();
    flushSync();
    expect(stored()).toBe('channels');
    expect(brandEditor.pending?.darkTokenOverrides).toBeNull();
  });

  test('arrow keys, Home and End select on move and carry focus', () => {
    render();
    const press = (from: string, key: string) => {
      card(from).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
      flushSync();
    };
    card('bar').focus();

    press('bar', 'ArrowRight');
    expect(stored()).toBe('windows');
    expect(document.activeElement).toBe(card('windows'));

    press('windows', 'End');
    expect(stored()).toBe('channels');

    press('channels', 'ArrowDown'); // wraps
    expect(stored()).toBeUndefined();
    expect(document.activeElement).toBe(card('bar'));

    press('bar', 'ArrowLeft'); // wraps back
    expect(stored()).toBe('channels');

    press('channels', 'Home');
    expect(stored()).toBeUndefined();
    expect(card('bar').tabIndex).toBe(0);
  });
});
