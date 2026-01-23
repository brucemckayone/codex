import { afterEach, describe, expect, test } from 'vitest';
import {
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
});
