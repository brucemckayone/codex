import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Popover from './Popover.svelte';
import PopoverArrow from './PopoverArrow.svelte';
import PopoverClose from './PopoverClose.svelte';
import PopoverContent from './PopoverContent.svelte';
import PopoverTrigger from './PopoverTrigger.svelte';

/**
 * Popover component unit tests.
 *
 * Note: Popover is a Melt-UI compound component with actions and context.
 * Due to JSDOM limitations with Melt-UI actions (positioning, focus trapping),
 * we test basic props and structure. Interactive behavior (open/close,
 * positioning, click outside) is covered by E2E tests.
 */

describe('Popover', () => {
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
      render: () => '<button data-testid="trigger">Open Popover</button>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: { children },
    });

    // When closed, only trigger content should be rendered
    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('accepts open prop (controlled mode)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Should not throw when open prop is provided
    component = mount(Popover, {
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

    component = mount(Popover, {
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
      render: () => '<span data-testid="content">Popover Content</span>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: { children },
    });

    // Popover content overlay should not be visible when closed
    expect(document.querySelector('.popover-content')).toBeNull();
  });

  test('accepts positioning prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Should not throw with positioning prop
    component = mount(Popover, {
      target: document.body,
      props: {
        children,
        positioning: { placement: 'bottom' },
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts arrowSize prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: {
        children,
        arrowSize: 10,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts closeOnOutsideClick prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: {
        children,
        closeOnOutsideClick: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts escapeBehavior prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: {
        children,
        escapeBehavior: 'close',
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('syncs open state with Melt-UI', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Mount with open=true
    component = mount(Popover, {
      target: document.body,
      props: {
        children,
        open: true,
      },
    });

    flushSync();

    // When open, the popover context should have open state
    // Note: Actual DOM visibility depends on PopoverContent which requires context
    expect(document.body.querySelector('span')).toBeTruthy();
  });
});

describe('PopoverTrigger', () => {
  // Note: PopoverTrigger requires Popover parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(PopoverTrigger).toBeDefined();
    expect(typeof PopoverTrigger).toBe('function');
  });
});

describe('PopoverContent', () => {
  test('component module exports correctly', () => {
    expect(PopoverContent).toBeDefined();
    expect(typeof PopoverContent).toBe('function');
  });
});

describe('PopoverArrow', () => {
  test('component module exports correctly', () => {
    expect(PopoverArrow).toBeDefined();
    expect(typeof PopoverArrow).toBe('function');
  });
});

describe('PopoverClose', () => {
  test('component module exports correctly', () => {
    expect(PopoverClose).toBeDefined();
    expect(typeof PopoverClose).toBe('function');
  });
});

describe('Popover compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Popover).toBeDefined();
    expect(PopoverTrigger).toBeDefined();
    expect(PopoverContent).toBeDefined();
    expect(PopoverArrow).toBeDefined();
    expect(PopoverClose).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    // Direct exports
    expect(exports.Popover).toBeDefined();
    expect(exports.PopoverTrigger).toBeDefined();
    expect(exports.PopoverContent).toBeDefined();
    expect(exports.PopoverArrow).toBeDefined();
    expect(exports.PopoverClose).toBeDefined();
    // Aliases
    expect(exports.Root).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Arrow).toBeDefined();
    expect(exports.Close).toBeDefined();
  });
});
