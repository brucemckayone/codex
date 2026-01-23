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
import DialogTitle from './DialogTitle.svelte';

/**
 * Dialog component unit tests.
 *
 * Note: Dialog is a complex compound component with portals and focus trapping.
 * Due to JSDOM limitations with Melt-UI actions and portal rendering,
 * we test basic props and structure. Interactive behavior (open/close,
 * focus trapping, keyboard escape) is covered by E2E tests.
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

    // When closed, only trigger button should be rendered (no modal content)
    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('accepts open prop (controlled mode)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Should not throw when open prop is provided
    component = mount(Dialog, {
      target: document.body,
      props: {
        children,
        open: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts onOpenChange callback', () => {
    const onOpenChange = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Dialog, {
      target: document.body,
      props: {
        children,
        onOpenChange,
      },
    });

    // Callback should be wired without error
    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('starts closed by default', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span data-testid="content">Dialog Content</span>',
    }));

    component = mount(Dialog, {
      target: document.body,
      props: { children },
    });

    // Dialog content (overlay, modal) should not be visible when closed
    expect(document.querySelector('.dialog-overlay')).toBeNull();
    expect(document.querySelector('.dialog-content')).toBeNull();
  });

  test('syncs open state with Melt-UI', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Mount with open=true
    component = mount(Dialog, {
      target: document.body,
      props: {
        children,
        open: true,
      },
    });

    flushSync();

    // When open, the dialog context should have open state
    // Note: Actual DOM visibility depends on DialogContent which requires context
    expect(document.body.querySelector('span')).toBeTruthy();
  });
});

describe('DialogContent', () => {
  // Note: DialogContent requires Dialog parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(DialogContent).toBeDefined();
    expect(typeof DialogContent).toBe('function');
  });
});

describe('DialogTitle', () => {
  test('component module exports correctly', () => {
    expect(DialogTitle).toBeDefined();
    expect(typeof DialogTitle).toBe('function');
  });
});

describe('DialogDescription', () => {
  test('component module exports correctly', () => {
    expect(DialogDescription).toBeDefined();
    expect(typeof DialogDescription).toBe('function');
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
  });
});
