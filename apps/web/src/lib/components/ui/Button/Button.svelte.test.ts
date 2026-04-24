import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  textSnippet,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Button from './Button.svelte';

describe('Button', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    // Clean up any remaining DOM
    document.body.innerHTML = '';
  });

  test('renders with correct text', () => {
    component = mount(Button, {
      target: document.body,
      props: {
        children: textSnippet('Click me'),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain('Click me');
  });

  test('applies variant and size data attributes', () => {
    component = mount(Button, {
      target: document.body,
      props: {
        variant: 'destructive',
        size: 'lg',
        children: textSnippet('Delete'),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('data-variant')).toBe('destructive');
    expect(button?.getAttribute('data-size')).toBe('lg');
  });

  test('is disabled when loading', () => {
    component = mount(Button, {
      target: document.body,
      props: {
        loading: true,
        children: textSnippet('Saving...'),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
  });

  test('is disabled when disabled prop is true', () => {
    component = mount(Button, {
      target: document.body,
      props: {
        disabled: true,
        children: textSnippet('Disabled'),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
  });

  test('fires onclick handler exactly once with a MouseEvent', () => {
    const onclick = vi.fn();
    component = mount(Button, {
      target: document.body,
      props: {
        onclick,
        children: textSnippet('Click me'),
      },
    });

    const button = document.body.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();

    button.click();
    flushSync();

    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onclick.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
  });

  test('does not fire onclick when disabled', () => {
    const onclick = vi.fn();
    component = mount(Button, {
      target: document.body,
      props: {
        disabled: true,
        onclick,
        children: textSnippet('Disabled'),
      },
    });

    const button = document.body.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);

    button.click();
    flushSync();

    expect(onclick).not.toHaveBeenCalled();
  });

  test('does not fire onclick when loading', () => {
    const onclick = vi.fn();
    component = mount(Button, {
      target: document.body,
      props: {
        loading: true,
        onclick,
        children: textSnippet('Saving...'),
      },
    });

    const button = document.body.querySelector('button') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);

    button.click();
    flushSync();

    expect(onclick).not.toHaveBeenCalled();
  });

  test('renders as a native <button> element for free Enter/Space keyboard semantics', () => {
    // Button.svelte does not wire a custom keydown handler — it relies on
    // native <button> semantics, which the browser translates into click
    // events for Enter/Space. Guard the contract by asserting the tag.
    component = mount(Button, {
      target: document.body,
      props: {
        children: textSnippet('Submit'),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.tagName).toBe('BUTTON');
    // Default button type is "submit" on forms; no explicit type is set
    // by the component, but restProps allow overriding it. Nothing here
    // should be a non-button role.
    expect(button?.getAttribute('role')).toBeNull();
  });

  test.each([
    ['primary'],
    ['secondary'],
    ['ghost'],
    ['destructive'],
    ['accent'],
  ] as const)('renders variant=%s with matching data-variant attribute', (variant) => {
    component = mount(Button, {
      target: document.body,
      props: {
        variant,
        children: textSnippet(variant),
      },
    });

    const button = document.body.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('data-variant')).toBe(variant);
  });
});
