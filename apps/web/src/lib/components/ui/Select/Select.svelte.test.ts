import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Select from './Select.svelte';

const mockOptions = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

describe('Select', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders trigger button', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.tagName.toLowerCase()).toBe('button');
  });

  test('displays placeholder when no value selected', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        placeholder: 'Choose a fruit...',
      },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger?.textContent).toContain('Choose a fruit...');
  });

  test('uses default placeholder when not specified', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger?.textContent).toContain('Select an option...');
  });

  test('displays selected value label', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        value: 'banana',
      },
    });

    flushSync();

    const valueDisplay = document.body.querySelector('.select-value');
    expect(valueDisplay?.textContent).toBe('Banana');
  });

  test('renders visible label when provided', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        label: 'Select a fruit',
      },
    });

    const label = document.body.querySelector('label');
    expect(label).toBeTruthy();
    expect(label?.textContent).toBe('Select a fruit');
    expect(label?.classList.contains('sr-only')).toBe(false);
  });

  test('renders sr-only label when no visible label provided', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        placeholder: 'Pick one',
      },
    });

    // Find the sr-only label - component renders label with sr-only class
    const labels = document.body.querySelectorAll('label');
    const srOnlyLabel = Array.from(labels).find((l) =>
      l.classList.contains('sr-only')
    );
    expect(srOnlyLabel).toBeTruthy();
    expect(srOnlyLabel?.textContent).toBe('Pick one');
  });

  test('label is associated with trigger via for attribute', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        label: 'Choose option',
        id: 'test-select',
      },
    });

    const trigger = document.body.querySelector('.select-trigger');
    const label = document.body.querySelector('label');

    expect(trigger?.getAttribute('id')).toBe('test-select');
    expect(label?.getAttribute('for')).toBe('test-select');
  });

  test('generates id when not provided', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        label: 'Choose option',
      },
    });

    const trigger = document.body.querySelector('.select-trigger');
    const triggerId = trigger?.getAttribute('id');

    expect(triggerId).toBeTruthy();
    expect(triggerId).toMatch(/^select-[a-z0-9]+$/);
  });

  test('applies custom className to container', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        class: 'custom-select',
      },
    });

    const container = document.body.querySelector('.select-container');
    expect(container?.classList.contains('custom-select')).toBe(true);
  });

  test('trigger has combobox role from melt-ui', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger?.getAttribute('role')).toBe('combobox');
  });

  test('trigger has proper ARIA attributes', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger?.getAttribute('aria-expanded')).toBeTruthy();
    expect(trigger?.hasAttribute('aria-controls')).toBe(true);
  });

  test('menu is not visible when closed', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const menu = document.body.querySelector('.select-content');
    // Menu should not be in DOM when closed (conditional rendering)
    expect(menu).toBeNull();
  });

  test('contains dropdown chevron icon', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: mockOptions },
    });

    const icon = document.body.querySelector('.select-icon');
    expect(icon).toBeTruthy();
    expect(icon?.tagName.toLowerCase()).toBe('svg');
  });

  test('renders with different initial values', () => {
    // Note: Melt-UI uses Svelte actions for event handling which don't fully
    // initialize in Happy-DOM. This test verifies the component renders
    // correctly with different initial values.
    // Interactive selection testing is covered by E2E tests.

    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        value: 'apple',
      },
    });

    flushSync();

    let valueDisplay = document.body.querySelector('.select-value');
    expect(valueDisplay?.textContent).toBe('Apple');

    unmount(component);
    document.body.innerHTML = '';

    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        value: 'cherry',
      },
    });

    flushSync();

    valueDisplay = document.body.querySelector('.select-value');
    expect(valueDisplay?.textContent).toBe('Cherry');
  });

  test('onValueChange callback is wired', () => {
    // The callback is wired through Melt-UI's onSelectedChange option.
    // We verify the callback is accepted without error.
    // Full selection interaction testing is handled by E2E tests.
    const onValueChange = vi.fn();

    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        value: 'banana',
        onValueChange,
      },
    });

    // Component should mount without errors when callback is provided
    expect(document.body.querySelector('.select-trigger')).toBeTruthy();
  });

  test('handles empty options array', () => {
    component = mount(Select, {
      target: document.body,
      props: { options: [] },
    });

    const trigger = document.body.querySelector('.select-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('Select an option...');
  });

  test('handles value not in options', () => {
    component = mount(Select, {
      target: document.body,
      props: {
        options: mockOptions,
        value: 'mango', // Not in options
      },
    });

    flushSync();

    // Should show placeholder since value doesn't match any option
    const valueDisplay = document.body.querySelector('.select-value');
    expect(valueDisplay?.textContent).toContain('Select an option...');
  });
});
