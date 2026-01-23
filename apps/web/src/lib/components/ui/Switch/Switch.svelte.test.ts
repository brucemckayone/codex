import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Switch from './Switch.svelte';

describe('Switch', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders with switch role', () => {
    component = mount(Switch, {
      target: document.body,
      props: {},
    });

    const toggle = document.body.querySelector('[role="switch"]');
    expect(toggle).toBeTruthy();
  });

  test('renders unchecked by default', () => {
    component = mount(Switch, {
      target: document.body,
      props: {},
    });

    const toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(toggle?.getAttribute('data-state')).toBe('unchecked');
  });

  test('renders checked state correctly', () => {
    component = mount(Switch, {
      target: document.body,
      props: { checked: true },
    });

    const toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(toggle?.getAttribute('data-state')).toBe('checked');
  });

  test('both checked states render properly', () => {
    // Note: Melt-UI uses Svelte actions for event handling which don't fully
    // initialize in Happy-DOM. This test verifies the component can render
    // in both states and that DOM reflects the state.
    // Interactive click testing is covered by E2E tests.

    // Start in checked state
    component = mount(Switch, {
      target: document.body,
      props: { checked: true },
    });

    const toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('data-state')).toBe('checked');

    // Unmount and remount unchecked to verify state rendering works both ways
    unmount(component);
    document.body.innerHTML = '';

    component = mount(Switch, {
      target: document.body,
      props: { checked: false },
    });

    const toggle2 = document.body.querySelector('[role="switch"]');
    expect(toggle2?.getAttribute('data-state')).toBe('unchecked');
  });

  test('onCheckedChange is wired to melt-ui state changes', () => {
    // The callback is wired through Melt-UI's onCheckedChange option.
    // We can verify it fires on state sync. Full click interaction
    // testing is handled by E2E tests.
    const onCheckedChange = vi.fn();

    component = mount(Switch, {
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

  test('renders disabled state', () => {
    component = mount(Switch, {
      target: document.body,
      props: { disabled: true },
    });

    const toggle = document.body.querySelector(
      '[role="switch"]'
    ) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.hasAttribute('data-disabled')).toBe(true);
  });

  test('disabled switch can still render checked', () => {
    component = mount(Switch, {
      target: document.body,
      props: { disabled: true, checked: true },
    });

    const toggle = document.body.querySelector(
      '[role="switch"]'
    ) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('data-state')).toBe('checked');
  });

  test('applies custom className', () => {
    component = mount(Switch, {
      target: document.body,
      props: { class: 'custom-switch-class' },
    });

    const toggle = document.body.querySelector('.switch');
    expect(toggle?.classList.contains('custom-switch-class')).toBe(true);
  });

  test('contains hidden input for form submission', () => {
    component = mount(Switch, {
      target: document.body,
      props: { required: true },
    });

    const input = document.body.querySelector('input[type="hidden"]');
    expect(input).toBeTruthy();
    expect(input?.hasAttribute('required')).toBe(true);
  });

  test('renders as a button element (keyboard accessible)', () => {
    component = mount(Switch, {
      target: document.body,
      props: {},
    });

    const toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.tagName.toLowerCase()).toBe('button');
    // Button elements are keyboard accessible by default (focusable, Space/Enter activate)
  });

  test('contains thumb element for visual indicator', () => {
    component = mount(Switch, {
      target: document.body,
      props: {},
    });

    const thumb = document.body.querySelector('.thumb');
    expect(thumb).toBeTruthy();
  });

  test('has correct aria-checked value for each state', () => {
    // Verify aria-checked attribute aligns with checked state
    component = mount(Switch, {
      target: document.body,
      props: { checked: false },
    });

    let toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');

    unmount(component);
    document.body.innerHTML = '';

    component = mount(Switch, {
      target: document.body,
      props: { checked: true },
    });

    toggle = document.body.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });
});
