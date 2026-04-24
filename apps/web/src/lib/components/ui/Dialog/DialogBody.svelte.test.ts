import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DialogBody from './DialogBody.svelte';

/**
 * DialogBody is a simple wrapper div for the scrollable body region of a
 * Dialog. It has no Dialog-parent context dependency, so it can be mounted
 * directly — unlike DialogContent/Title/Description (tested via DialogHarness).
 */

describe('DialogBody', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children inside a div with .dialog-body class', () => {
    const children = createRawSnippet(() => ({
      render: () => '<p data-testid="body-content">Body content</p>',
    }));

    component = mount(DialogBody, {
      target: document.body,
      props: { children },
    });

    const root = document.body.querySelector('div.dialog-body');
    expect(root).toBeTruthy();
    expect(root?.querySelector('[data-testid="body-content"]')).toBeTruthy();
    expect(root?.textContent).toContain('Body content');
  });

  test('forwards custom class via class prop (appended after dialog-body)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>x</span>',
    }));

    component = mount(DialogBody, {
      target: document.body,
      props: { children, class: 'my-custom-class another-one' },
    });

    const root = document.body.querySelector('div');
    expect(root?.classList.contains('dialog-body')).toBe(true);
    expect(root?.classList.contains('my-custom-class')).toBe(true);
    expect(root?.classList.contains('another-one')).toBe(true);
  });

  test('forwards rest HTML attributes onto the root element', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>x</span>',
    }));

    component = mount(DialogBody, {
      target: document.body,
      props: {
        children,
        id: 'body-id',
        'aria-label': 'Dialog body region',
        'data-size': 'lg',
      },
    });

    const root = document.body.querySelector('#body-id');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('aria-label')).toBe('Dialog body region');
    expect(root?.getAttribute('data-size')).toBe('lg');
  });

  test('renders without a custom class when class prop omitted', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>x</span>',
    }));

    component = mount(DialogBody, {
      target: document.body,
      props: { children },
    });

    const root = document.body.querySelector('div');
    // Svelte appends a scoped class (svelte-<hash>) automatically — check that
    // only the expected classes are present, excluding Svelte's internal one.
    const classes = (root?.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('svelte-'));
    expect(classes).toEqual(['dialog-body']);
  });
});
