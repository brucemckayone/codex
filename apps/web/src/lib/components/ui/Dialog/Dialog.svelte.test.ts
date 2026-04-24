import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Dialog from './Dialog.svelte';
import DialogContent from './DialogContent.svelte';
import DialogDescription from './DialogDescription.svelte';
import DialogHarness from './DialogHarness.test.svelte';
import DialogTitle from './DialogTitle.svelte';

/**
 * Dialog component unit tests.
 *
 * Dialog is a compound component built on Melt UI's createDialog. Sub-components
 * (DialogContent/Title/Description) require the parent Dialog context, so they
 * are tested via DialogHarness which wires a realistic composition. Interactive
 * focus-trap and keyboard escape behaviour is covered by E2E tests — Melt UI's
 * actions register focus handlers that JSDOM cannot fully exercise.
 */

describe('Dialog', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children when closed', () => {
    const children = createRawSnippet(() => ({
      render: () => '<button data-testid="trigger">Open Dialog</button>',
    }));

    component = mount(Dialog, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('does not render portal content when closed', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    expect(document.querySelector('.dialog-content')).toBeNull();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
    expect(
      document.querySelector('[data-testid="first-focusable"]')
    ).toBeNull();
  });

  test('renders portal content when open', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    expect(document.querySelector('.dialog-content')).toBeTruthy();
    expect(document.querySelector('.dialog-overlay')).toBeTruthy();
    expect(
      document.querySelector('[data-testid="first-focusable"]')
    ).toBeTruthy();
  });

  test('fires onOpenChange when Melt-UI syncs close state', () => {
    const onOpenChange = vi.fn();
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });

    flushSync();

    const closeButton =
      document.querySelector<HTMLButtonElement>('.dialog-close');
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    flushSync();

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('DialogContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children inside the content panel when open', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content).toBeTruthy();
    expect(
      content?.querySelector('[data-testid="first-focusable"]')
    ).toBeTruthy();
    expect(
      content?.querySelector('[data-testid="second-focusable"]')
    ).toBeTruthy();
  });

  test('content panel has dialog role and aria-modal via Melt UI', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('role')).toBe('dialog');
    expect(content?.getAttribute('aria-modal')).toBe('true');
  });

  test('close button has accessible label', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const closeButton = document.querySelector('.dialog-close');
    expect(closeButton?.getAttribute('aria-label')).toBe('Close');
  });

  test('applies size variant via data-size attribute', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, size: 'lg' },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('data-size')).toBe('lg');
  });
});

describe('DialogTitle', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders as h2 with provided text', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const title = document.querySelector('h2.dialog-title');
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain('Dialog Title');
  });

  test('title id is referenced by content aria-labelledby', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const title = document.querySelector<HTMLElement>('h2.dialog-title');
    const content = document.querySelector('.dialog-content');

    expect(title?.id).toBeTruthy();
    expect(content?.getAttribute('aria-labelledby')).toBe(title?.id);
  });
});

describe('DialogDescription', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders as p with provided text', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const description = document.querySelector('p.dialog-description');
    expect(description).toBeTruthy();
    expect(description?.textContent).toContain('Dialog description text');
  });

  test('description id is referenced by content aria-describedby', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const description = document.querySelector<HTMLElement>(
      'p.dialog-description'
    );
    const content = document.querySelector('.dialog-content');

    expect(description?.id).toBeTruthy();
    expect(content?.getAttribute('aria-describedby')).toBe(description?.id);
  });
});

describe('Dialog compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Dialog).toBeDefined();
    expect(DialogContent).toBeDefined();
    expect(DialogTitle).toBeDefined();
    expect(DialogDescription).toBeDefined();
  });

  test('index exports named components', async () => {
    const exports = await import('./index.js');
    expect(exports.Root).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Title).toBeDefined();
    expect(exports.Description).toBeDefined();
    expect(exports.Header).toBeDefined();
    expect(exports.Footer).toBeDefined();
    expect(exports.Body).toBeDefined();
  });
});
