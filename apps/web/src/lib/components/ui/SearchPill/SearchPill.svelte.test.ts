/**
 * SearchPill unit tests.
 *
 * The reason this file exists: the explore search box could not be typed into.
 * SearchPill has two commit modes and the SUBMIT-ONLY one (Explore passes
 * `onSubmit` with no `onChange`) discarded every keystroke. `handleInput` set
 * `local`, hit `if (!onChange) return` leaving `timer === null`, and the
 * external-reset `$effect` — which READ `local`, so a local write re-entered it
 * — saw `value !== local` with no pending timer and reset `local` straight back
 * to the committed value. Typing "fire" left the input empty and Enter committed
 * nothing; the filter only worked by hand-editing the URL.
 *
 * Falsifiability: `keeps each keystroke` and `commits on Enter` both fail if the
 * reset effect goes back to comparing `value !== local`, and
 * `external reset still wins` fails if the reset is removed altogether — so the
 * fix cannot be undone in either direction without a red test.
 *
 * Covered:
 *   • submit-only: typing is retained, Enter commits, clear commits.
 *   • submit-only: an EXTERNAL value change still overwrites the local mirror
 *     (the behaviour the broken condition was trying to provide).
 *   • live mode: unchanged — a debounced flush is not clobbered by a prop echo.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import SearchPillHarness from './SearchPillHarness.test.svelte';

type Harness = {
  getCommitted: () => string;
  setCommitted: (next: string) => void;
};

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function input(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(
    '.search-pill__input'
  );
  if (!el) throw new Error('search input not rendered');
  return el;
}

/** Type one character the way a browser does: set value, then fire `input`. */
function typeChar(char: string) {
  const el = input();
  el.value = `${el.value}${char}`;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function typeText(text: string) {
  for (const char of text) typeChar(char);
}

describe('SearchPill — submit-only mode (no onChange)', () => {
  test('keeps each keystroke in the input instead of reverting it', () => {
    component = mount(SearchPillHarness, {
      target: document.body,
      props: {},
    });
    flushSync();

    typeText('fire');

    // Before the fix this was '' — every keystroke was reverted by the
    // external-reset effect.
    expect(input().value).toBe('fire');
  });

  test('does not commit to the parent until submit', () => {
    const harness = mount(SearchPillHarness, {
      target: document.body,
      props: {},
    }) as unknown as Harness;
    component = harness as unknown as ReturnType<typeof mount>;
    flushSync();

    typeText('fire');

    expect(harness.getCommitted()).toBe('');
  });

  test('commits the typed value on Enter (form submit)', () => {
    const onSubmitSpy = vi.fn();
    const harness = mount(SearchPillHarness, {
      target: document.body,
      props: { onSubmitSpy },
    }) as unknown as Harness;
    component = harness as unknown as ReturnType<typeof mount>;
    flushSync();

    typeText('fire');

    const form = document.body.querySelector('form.search-pill');
    if (!form) throw new Error('submit-only mode should render a <form>');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    flushSync();

    expect(onSubmitSpy).toHaveBeenCalledWith('fire');
    expect(harness.getCommitted()).toBe('fire');
    expect(input().value).toBe('fire');
  });

  test('clear button empties the input and commits the clear', () => {
    const onSubmitSpy = vi.fn();
    const harness = mount(SearchPillHarness, {
      target: document.body,
      props: { initial: 'fire', onSubmitSpy },
    }) as unknown as Harness;
    component = harness as unknown as ReturnType<typeof mount>;
    flushSync();

    const clearBtn = document.body.querySelector<HTMLButtonElement>(
      '.search-pill__clear'
    );
    if (!clearBtn)
      throw new Error('clear button should render for a non-empty value');
    clearBtn.click();
    flushSync();

    expect(onSubmitSpy).toHaveBeenCalledWith('');
    expect(harness.getCommitted()).toBe('');
    expect(input().value).toBe('');
  });

  test('an EXTERNAL value change still overwrites the local mirror', () => {
    // This is what the broken condition was reaching for, and it must survive
    // the fix: a parent "Clear all" / back-navigation resets the box.
    const harness = mount(SearchPillHarness, {
      target: document.body,
      props: { initial: 'fire' },
    }) as unknown as Harness;
    component = harness as unknown as ReturnType<typeof mount>;
    flushSync();
    expect(input().value).toBe('fire');

    // Uncommitted local edit, then an external reset arrives.
    typeText('s');
    expect(input().value).toBe('fires');

    harness.setCommitted('');
    flushSync();

    expect(input().value).toBe('');
  });
});

describe('SearchPill — live mode (onChange) is unchanged', () => {
  test('debounced flush reaches the parent and is not clobbered', () => {
    vi.useFakeTimers();
    const onChangeSpy = vi.fn();
    const harness = mount(SearchPillHarness, {
      target: document.body,
      props: { live: true, debounce: 250, onChangeSpy },
    }) as unknown as Harness;
    component = harness as unknown as ReturnType<typeof mount>;
    flushSync();

    typeText('fi');
    // Nothing committed yet — the debounce timer is pending.
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(input().value).toBe('fi');

    vi.advanceTimersByTime(250);
    flushSync();

    expect(onChangeSpy).toHaveBeenCalledWith('fi');
    expect(harness.getCommitted()).toBe('fi');
    expect(input().value).toBe('fi');
  });
});
