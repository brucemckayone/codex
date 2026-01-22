import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Input from './Input.svelte';

describe('Input', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders with initial value', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        value: 'initial text',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('initial text');
  });

  test('renders with placeholder', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        placeholder: 'Enter your name',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Enter your name');
  });

  test('password toggle changes input type', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        type: 'password',
        value: 'secret123',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    const toggleButton = document.body.querySelector(
      '.password-toggle'
    ) as HTMLButtonElement;

    expect(input).toBeTruthy();
    expect(toggleButton).toBeTruthy();
    expect(input.type).toBe('password');
    expect(toggleButton.getAttribute('aria-label')).toBe('Show password');

    // Click toggle to show password
    toggleButton.click();
    flushSync();

    expect(input.type).toBe('text');
    expect(toggleButton.getAttribute('aria-label')).toBe('Hide password');

    // Click again to hide
    toggleButton.click();
    flushSync();

    expect(input.type).toBe('password');
    expect(toggleButton.getAttribute('aria-label')).toBe('Show password');
  });

  test('password toggle is not rendered for non-password types', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        type: 'text',
      },
    });

    const toggleButton = document.body.querySelector('.password-toggle');
    expect(toggleButton).toBeNull();
  });

  test('error state shows error message', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        error: 'This field is required',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    const errorText = document.body.querySelector('.error-text');

    expect(input).toBeTruthy();
    expect(input.getAttribute('data-error')).toBe('true');
    expect(errorText).toBeTruthy();
    expect(errorText?.textContent).toBe('This field is required');
  });

  test('no error state when error is not provided', () => {
    component = mount(Input, {
      target: document.body,
      props: {},
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    const errorText = document.body.querySelector('.error-text');

    expect(input.getAttribute('data-error')).toBe('false');
    expect(errorText).toBeNull();
  });

  test('disabled state prevents interaction', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        disabled: true,
        value: 'cannot change',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(true);
  });

  test('accepts different input types', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        type: 'email',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('email');
  });

  test('forwards additional HTML attributes', () => {
    component = mount(Input, {
      target: document.body,
      props: {
        name: 'username',
        id: 'username-input',
        'aria-describedby': 'username-hint',
      },
    });

    const input = document.body.querySelector('input') as HTMLInputElement;
    expect(input.name).toBe('username');
    expect(input.id).toBe('username-input');
    expect(input.getAttribute('aria-describedby')).toBe('username-hint');
  });
});
