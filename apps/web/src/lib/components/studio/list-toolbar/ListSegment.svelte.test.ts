/**
 * ListSegment's keyboard, the WAI-ARIA APG radio group's: the
 * group is one tab stop, the checked option (else the first), and the arrow
 * keys move to the next or previous option and choose it, wrapping. Without
 * it a Showreel group of nine fields was about forty tab stops.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ListSegment from './ListSegment.svelte';

type Value = 'a' | 'b' | 'c';
const OPTIONS = [
  { value: 'a' as const, label: () => 'Alpha' },
  { value: 'b' as const, label: () => 'Beta' },
  { value: 'c' as const, label: () => 'Gamma' },
];

let component: ReturnType<typeof mount> | null = null;

/** A segment that keeps what it is told, as its callers do. */
function render(initial: Value | '') {
  const props = $state({
    label: 'Letter',
    value: initial as Value,
    options: OPTIONS,
    onSelect: (value: Value) => {
      props.value = value;
    },
  });
  component = mount(ListSegment, { target: document.body, props });
  flushSync();
  return props;
}

const radios = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
];
const tabStops = () =>
  radios()
    .filter((radio) => radio.tabIndex === 0)
    .map((radio) => radio.textContent?.trim());

function press(key: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true })
  );
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('ListSegment: one tab stop', () => {
  test('the checked option is the only one in the tab order', () => {
    render('b');
    expect(tabStops()).toEqual(['Beta']);
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  test('with nothing checked, the first option is', () => {
    render('');
    expect(tabStops()).toEqual(['Alpha']);
  });
});

describe('ListSegment: the arrow keys', () => {
  test('Right and Down move to the next option and choose it, wrapping', () => {
    const props = render('b');
    radios()[1].focus();
    press('ArrowRight');
    expect(props.value).toBe('c');
    expect(document.activeElement?.textContent?.trim()).toBe('Gamma');
    expect(tabStops()).toEqual(['Gamma']);
    press('ArrowDown');
    expect(props.value).toBe('a');
    expect(document.activeElement?.textContent?.trim()).toBe('Alpha');
  });

  test('Left and Up move to the previous one, wrapping', () => {
    const props = render('a');
    radios()[0].focus();
    press('ArrowLeft');
    expect(props.value).toBe('c');
    press('ArrowUp');
    expect(props.value).toBe('b');
    expect(document.activeElement?.textContent?.trim()).toBe('Beta');
  });

  test('with the group itself focused, Right and Left move from the tab stop, not the first', () => {
    const props = render('b');
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]');
    group?.focus();
    press('ArrowRight');
    expect(props.value).toBe('c');
    expect(document.activeElement?.textContent?.trim()).toBe('Gamma');
    group?.focus();
    press('ArrowLeft');
    expect(props.value).toBe('b');
    expect(document.activeElement?.textContent?.trim()).toBe('Beta');
  });

  test('with nothing checked and the group focused, Right moves on from the first', () => {
    const props = render('');
    document.querySelector<HTMLElement>('[role="radiogroup"]')?.focus();
    press('ArrowRight');
    expect(props.value).toBe('b');
  });

  test('another key does nothing', () => {
    const props = render('a');
    radios()[0].focus();
    press('Tab');
    press('x');
    expect(props.value).toBe('a');
  });
});
