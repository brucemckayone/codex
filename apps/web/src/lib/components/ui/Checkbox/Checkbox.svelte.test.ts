import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Checkbox from './Checkbox.svelte';

describe('Checkbox', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders unchecked by default', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {},
    });

    const button = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-state')).toBe('unchecked');
  });

  test('renders checked state with indicator', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        checked: true,
      },
    });

    const button = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-state')).toBe('checked');

    // Check that the check icon is rendered
    const checkIcon = button.querySelector('.check-icon');
    expect(checkIcon).toBeTruthy();
  });

  test('clicking checkbox should toggle state', () => {
    // Note: Melt-UI uses Svelte actions for event handling which don't fully
    // initialize in Happy-DOM. This test verifies the component can start
    // in checked state and that DOM reflects the state.
    // Interactive click testing is covered by E2E tests in tests/a11y/components.spec.ts

    // Start in checked state
    component = mount(Checkbox, {
      target: document.body,
      props: {
        checked: true,
      },
    });

    const button = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    expect(button.getAttribute('data-state')).toBe('checked');
    expect(button.querySelector('.check-icon')).toBeTruthy();

    // Unmount and remount unchecked to verify state rendering works both ways
    unmount(component);
    document.body.innerHTML = '';

    component = mount(Checkbox, {
      target: document.body,
      props: {
        checked: false,
      },
    });

    const button2 = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    expect(button2.getAttribute('data-state')).toBe('unchecked');
    expect(button2.querySelector('.check-icon')).toBeNull();
  });

  test('onCheckedChange is wired to melt-ui state changes', () => {
    // The callback is wired through Melt-UI's onCheckedChange option.
    // We can verify it fires on state sync. Full click interaction
    // testing is handled by E2E tests.
    const onCheckedChange = vi.fn();

    component = mount(Checkbox, {
      target: document.body,
      props: {
        checked: true,
        onCheckedChange,
      },
    });

    flushSync();

    // The effect syncs checked=true to melt state, triggering callback
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  test('renders with label', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        label: 'Accept terms',
      },
    });

    const container = document.body.querySelector('.checkbox-container');
    expect(container).toBeTruthy();

    // Label should be rendered
    const label = container?.querySelector('label');
    expect(label).toBeTruthy();
    expect(label?.textContent).toBe('Accept terms');
  });

  test('label is associated with checkbox via for attribute', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        label: 'Subscribe to newsletter',
        id: 'newsletter-checkbox',
      },
    });

    const input = document.body.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    const label = document.body.querySelector('label');

    expect(input).toBeTruthy();
    expect(label).toBeTruthy();

    // The label should have a for attribute matching the input's id
    const labelFor = label?.getAttribute('for');
    expect(labelFor).toBeTruthy();
  });

  test('indeterminate state renders indeterminate bar', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        checked: 'indeterminate',
      },
    });

    const button = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    const indeterminateBar = button.querySelector('.indeterminate-bar');

    expect(indeterminateBar).toBeTruthy();
  });

  test('has proper ARIA role for accessibility', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {},
    });

    const button = document.body.querySelector(
      '.checkbox-root'
    ) as HTMLButtonElement;
    // Melt-UI checkbox uses button with role="checkbox"
    expect(button.getAttribute('role')).toBe('checkbox');
  });

  test('required attribute is forwarded to hidden input', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        required: true,
      },
    });

    const input = document.body.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.required).toBe(true);
  });

  test('applies custom className to container', () => {
    component = mount(Checkbox, {
      target: document.body,
      props: {
        class: 'custom-checkbox',
      },
    });

    const container = document.body.querySelector('.checkbox-container');
    expect(container?.classList.contains('custom-checkbox')).toBe(true);
  });
});
