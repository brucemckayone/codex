/**
 * The studio's Cmd+K palette (Codex-vlphc.4, review cycle 1: H1, L5, L6).
 *
 * Mounts the real palette; only `$app/navigation` is mocked. jsdom has no
 * layout and never ends a transition, so these read the DOM contract: what
 * opens, which rows are Tab stops, and which row is scrolled to.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));

import CommandPalette from './CommandPalette.svelte';

let component: ReturnType<typeof mount> | null = null;
const realScrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  Element.prototype.scrollIntoView = realScrollIntoView;
});

function cmdK(repeat = false) {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      repeat,
      bubbles: true,
      cancelable: true,
    })
  );
  flushSync();
}

const input = () =>
  document.querySelector<HTMLInputElement>('#command-palette-input');

function openPalette() {
  component = mount(CommandPalette, { target: document.body });
  flushSync();
  cmdK();
}

describe('the studio palette', () => {
  // Motion "none": a closed palette leaves the DOM at once.
  test('a held Cmd+K opens it once, whatever the key repeats', () => {
    openPalette();
    for (let i = 0; i < 3; i++) cmdK(true);

    expect(input()).not.toBeNull();
  });

  test('its rows are not Tab stops, so Enter opens the highlighted one', () => {
    openPalette();

    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.getAttribute('tabindex')).toBe('-1');
    }
  });

  test('the highlighted row is scrolled into view as the arrows move it', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    openPalette();

    input()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    flushSync();

    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrolled.mock.contexts.at(-1)).toBe(
      document.getElementById('cmd-content')
    );
  });
});
