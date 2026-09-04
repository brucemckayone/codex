/**
 * BrandMixer keyboard + a11y behaviour.
 *
 * The mixer is three composite widgets, and a chip row that only answers to
 * clicks is a keyboard trap in the control that changes most. These tests are
 * the reason the roving-tabindex implementation can be refactored safely: they
 * assert the BEHAVIOUR (tab order, arrow movement, wrap, Home/End, selection
 * following focus) rather than the markup that currently produces it.
 *
 * Written after a peer review reported `a11y_interactive_supports_focus` on the
 * three group containers and inferred that "the group never receives focus and
 * arrow keys never reach the radios". The warning was real; that consequence
 * was not — focus lives on the radios by design and keydown bubbles. Rather
 * than argue it, these tests measure it.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PresetAxisPoint } from '$lib/brand-editor';
import { ATMOSPHERE_AXES, FORM_AXES, TYPE_AXES } from '$lib/brand-editor';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandMixer from './BrandMixer.svelte';

const START: PresetAxisPoint = {
  type: 'neutral',
  form: 'crisp',
  atmosphere: 'still',
};

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(axes: PresetAxisPoint = START) {
  const onchange = vi.fn();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = mount(BrandMixer, { target, props: { axes, onchange } });
  cleanup = () => {
    unmount(component);
    target.remove();
  };
  flushSync();
  return { onchange };
}

/** The radiogroup whose accessible name matches `label`. */
function group(label: string): HTMLElement {
  const groups = [...document.querySelectorAll('[role="radiogroup"]')];
  const found = groups.find((g) => {
    const id = g.getAttribute('aria-labelledby');
    return id
      ? document.getElementById(id)?.textContent?.includes(label)
      : false;
  });
  if (!found) throw new Error(`no radiogroup labelled ${label}`);
  return found as HTMLElement;
}

function radios(label: string): HTMLElement[] {
  return [...group(label).querySelectorAll('[role="radio"]')] as HTMLElement[];
}

describe('structure', () => {
  test('renders one radiogroup per axis, each with an accessible name', () => {
    render();
    const groups = [...document.querySelectorAll('[role="radiogroup"]')];
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      const id = g.getAttribute('aria-labelledby');
      expect(id, 'every group needs aria-labelledby').toBeTruthy();
      expect(
        document.getElementById(id as string)?.textContent?.trim()
      ).not.toBe('');
    }
  });

  test('offers every axis option as a radio', () => {
    render();
    expect(radios('Typography')).toHaveLength(Object.keys(TYPE_AXES).length);
    expect(radios('Shape')).toHaveLength(Object.keys(FORM_AXES).length);
    expect(radios('Atmosphere')).toHaveLength(
      Object.keys(ATMOSPHERE_AXES).length
    );
  });

  test('marks exactly one radio checked per group', () => {
    render();
    for (const label of ['Typography', 'Shape', 'Atmosphere']) {
      const checked = radios(label).filter(
        (r) => r.getAttribute('aria-checked') === 'true'
      );
      expect(checked, label).toHaveLength(1);
    }
  });
});

describe('tab order (roving tabindex)', () => {
  test('exposes exactly one tab stop per group, on the checked radio', () => {
    // This is the property the peer review doubted: a composite widget puts
    // focus on its CHILDREN, so the group itself need not be tabbable — but
    // exactly one child must be, or the whole row drops out of the tab order.
    render();
    for (const label of ['Typography', 'Shape', 'Atmosphere']) {
      const items = radios(label);
      const tabbable = items.filter((r) => r.getAttribute('tabindex') === '0');
      expect(tabbable, `${label}: expected 1 tab stop`).toHaveLength(1);
      expect(tabbable[0].getAttribute('aria-checked')).toBe('true');
      const rest = items.filter((r) => r !== tabbable[0]);
      for (const r of rest) {
        expect(r.getAttribute('tabindex'), label).toBe('-1');
      }
    }
  });
});

describe('arrow-key navigation', () => {
  test('ArrowRight from the checked radio selects the next option', () => {
    const { onchange } = render();
    const items = radios('Typography');
    const checked = items.findIndex(
      (r) => r.getAttribute('aria-checked') === 'true'
    );

    // Dispatched on the RADIO, not the group — this is what a real keypress
    // does, and it proves the handler is reachable from where focus lives.
    items[checked].focus();
    items[checked].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    flushSync();

    expect(onchange).toHaveBeenCalledTimes(1);
    const next = onchange.mock.calls[0][0] as PresetAxisPoint;
    const ids = Object.keys(TYPE_AXES);
    expect(next.type).toBe(ids[(checked + 1) % ids.length]);
    // The other axes must be untouched — one dial at a time.
    expect(next.form).toBe(START.form);
    expect(next.atmosphere).toBe(START.atmosphere);
  });

  test('ArrowLeft wraps backwards from the first option', () => {
    const first = Object.keys(TYPE_AXES)[0] as PresetAxisPoint['type'];
    const { onchange } = render({ ...START, type: first });
    const items = radios('Typography');
    items[0].focus();
    items[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    );
    flushSync();

    const ids = Object.keys(TYPE_AXES);
    expect((onchange.mock.calls[0][0] as PresetAxisPoint).type).toBe(
      ids[ids.length - 1]
    );
  });

  test('Home and End jump to the ends', () => {
    const { onchange } = render();
    const items = radios('Atmosphere');
    const checked = items.findIndex(
      (r) => r.getAttribute('aria-checked') === 'true'
    );
    const ids = Object.keys(ATMOSPHERE_AXES);

    items[checked].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true })
    );
    flushSync();
    expect((onchange.mock.calls[0][0] as PresetAxisPoint).atmosphere).toBe(
      ids[ids.length - 1]
    );

    items[checked].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
    );
    flushSync();
    expect((onchange.mock.calls[1][0] as PresetAxisPoint).atmosphere).toBe(
      ids[0]
    );
  });

  test('ArrowDown moves within the row, not to the next group', () => {
    // The rows are a grid, so Down reads as "next option" here. If it ever
    // moved between GROUPS the two dials would fight for one keystroke.
    const { onchange } = render();
    const items = radios('Shape');
    const checked = items.findIndex(
      (r) => r.getAttribute('aria-checked') === 'true'
    );
    items[checked].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    flushSync();
    const next = onchange.mock.calls[0][0] as PresetAxisPoint;
    const ids = Object.keys(FORM_AXES);
    expect(next.form).toBe(ids[(checked + 1) % ids.length]);
    expect(next.type).toBe(START.type);
  });

  test('ignores keys it does not own, so typing never hijacks the row', () => {
    const { onchange } = render();
    const items = radios('Typography');
    for (const key of ['a', 'Enter', 'Escape', 'PageDown', 'Shift']) {
      items[0].dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true })
      );
    }
    flushSync();
    expect(onchange).not.toHaveBeenCalled();
  });

  test('moves DOM focus along with selection', () => {
    // Without this the roving tab stop and the focused element drift apart,
    // and the next Tab leaves from a stale position.
    const { onchange } = render();
    const items = radios('Typography');
    const checked = items.findIndex(
      (r) => r.getAttribute('aria-checked') === 'true'
    );
    items[checked].focus();
    items[checked].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    flushSync();

    const ids = Object.keys(TYPE_AXES);
    const nextId = ids[(checked + 1) % ids.length];
    expect(document.activeElement?.getAttribute('data-option-id')).toBe(nextId);
    expect(onchange).toHaveBeenCalled();
  });
});

describe('pointer selection', () => {
  test('clicking a radio reports only that axis', () => {
    const { onchange } = render();
    const items = radios('Atmosphere');
    const target = items[items.length - 1];
    target.click();
    flushSync();

    const next = onchange.mock.calls[0][0] as PresetAxisPoint;
    expect(next.atmosphere).toBe(target.getAttribute('data-option-id'));
    expect(next.type).toBe(START.type);
    expect(next.form).toBe(START.form);
  });
});
