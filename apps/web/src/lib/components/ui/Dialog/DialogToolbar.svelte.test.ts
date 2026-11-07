import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DialogToolbar from './DialogToolbar.svelte';

/**
 * Dialog.Toolbar reads no Dialog context, so it mounts directly. That it
 * stays put while Body scrolls is a layout fact, proven by the Toolbar
 * stories in a real browser; this pins the element and its attributes.
 */

describe('Dialog.Toolbar', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders its controls in a .dialog-toolbar row by default', () => {
    const children = createRawSnippet(() => ({
      render: () => '<input data-testid="search" type="search" />',
    }));

    component = mount(DialogToolbar, {
      target: document.body,
      props: { children },
    });

    const bar = document.body.querySelector('div.dialog-toolbar');
    expect(bar?.getAttribute('data-direction')).toBe('row');
    expect(bar?.querySelector('[data-testid="search"]')).toBeTruthy();
  });

  test('takes direction="column", a custom class and rest attributes', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>x</span>',
    }));

    component = mount(DialogToolbar, {
      target: document.body,
      props: {
        children,
        direction: 'column',
        class: 'picker-bar',
        'aria-label': 'Filters',
      },
    });

    const bar = document.body.querySelector('.dialog-toolbar');
    expect(bar?.getAttribute('data-direction')).toBe('column');
    expect(bar?.classList.contains('picker-bar')).toBe(true);
    expect(bar?.getAttribute('aria-label')).toBe('Filters');
  });
});
