import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import CategorySelect from './CategorySelect.svelte';

/**
 * CategorySelect unit tests.
 *
 * CategorySelect is the presentational half of the content-form category
 * multiselect — pure props + callbacks, no remote imports — so it renders in
 * jsdom and its option rendering, toggle intents, hidden-field serialization,
 * and create-on-the-fly affordance are falsifiable in isolation.
 */

const options = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Interviews' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Essays' },
];

function noop() {}

describe('CategorySelect', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders a chip per available option', () => {
    component = mount(CategorySelect, {
      target: document.body,
      props: { options, selected: [], onToggle: noop, onCreate: noop },
    });

    expect(document.querySelectorAll('.option-chip').length).toBe(2);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Interviews');
    expect(text).toContain('Essays');
  });

  test('serializes the selected ids into the hidden categoryIds input', () => {
    component = mount(CategorySelect, {
      target: document.body,
      props: {
        options,
        selected: [options[0].id],
        onToggle: noop,
        onCreate: noop,
      },
    });

    const hidden = document.querySelector<HTMLInputElement>(
      'input[name="categoryIds"]'
    );
    expect(hidden).toBeTruthy();
    expect(hidden?.value).toBe(JSON.stringify([options[0].id]));
  });

  test('marks the selected option as pressed', () => {
    component = mount(CategorySelect, {
      target: document.body,
      props: {
        options,
        selected: [options[1].id],
        onToggle: noop,
        onCreate: noop,
      },
    });

    const chip = document.querySelector<HTMLButtonElement>(
      `[data-category-id="${options[1].id}"]`
    );
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    expect(chip?.hasAttribute('data-selected')).toBe(true);

    const unselected = document.querySelector<HTMLButtonElement>(
      `[data-category-id="${options[0].id}"]`
    );
    expect(unselected?.getAttribute('aria-pressed')).toBe('false');
  });

  test('invokes onToggle with the clicked option id', () => {
    const onToggle = vi.fn();
    component = mount(CategorySelect, {
      target: document.body,
      props: { options, selected: [], onToggle, onCreate: noop },
    });

    document
      .querySelector<HTMLButtonElement>(`[data-category-id="${options[0].id}"]`)
      ?.click();
    flushSync();

    expect(onToggle).toHaveBeenCalledWith(options[0].id);
  });

  test('create-on-the-fly invokes onCreate with the trimmed name and clears the field', () => {
    const onCreate = vi.fn();
    component = mount(CategorySelect, {
      target: document.body,
      props: { options, selected: [], onToggle: noop, onCreate },
    });

    const input = document.querySelector<HTMLInputElement>('.create-input');
    expect(input).toBeTruthy();
    if (!input) return;
    input.value = '  Documentaries  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    document.querySelector<HTMLButtonElement>('.create-button')?.click();
    flushSync();

    expect(onCreate).toHaveBeenCalledWith('Documentaries');
    expect(input.value).toBe('');
  });

  test('disables the Add button until a name is entered', () => {
    component = mount(CategorySelect, {
      target: document.body,
      props: { options, selected: [], onToggle: noop, onCreate: noop },
    });

    const addButton =
      document.querySelector<HTMLButtonElement>('.create-button');
    expect(addButton?.disabled).toBe(true);
  });

  test('renders the empty hint and no chips when there are no options', () => {
    component = mount(CategorySelect, {
      target: document.body,
      props: { options: [], selected: [], onToggle: noop, onCreate: noop },
    });

    expect(document.body.textContent).toContain('No topics yet');
    expect(document.querySelectorAll('.option-chip').length).toBe(0);
  });
});
