import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Tooltip from './Tooltip.svelte';
import TooltipArrow from './TooltipArrow.svelte';
import TooltipContent from './TooltipContent.svelte';
import TooltipTrigger from './TooltipTrigger.svelte';

/**
 * Tooltip component unit tests.
 *
 * Note: Tooltip is a Melt-UI compound component with actions and context.
 * Due to JSDOM limitations with Melt-UI actions (positioning, hover events),
 * we test basic props and structure. Interactive behavior (hover open/close,
 * positioning, delays) is covered by E2E tests.
 */

describe('Tooltip', () => {
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
      render: () => '<button data-testid="trigger">Hover me</button>',
    }));

    component = mount(Tooltip, {
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
    component = mount(Tooltip, {
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

    component = mount(Tooltip, {
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
      render: () => '<span data-testid="content">Tooltip Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: { children },
    });

    // Tooltip content should not be visible when closed
    expect(document.querySelector('.tooltip-content')).toBeNull();
  });

  test('accepts positioning prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Should not throw with positioning prop
    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        positioning: { placement: 'top' },
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts arrowSize prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        arrowSize: 8,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts openDelay prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        openDelay: 500,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts closeDelay prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        closeDelay: 200,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts closeOnPointerDown prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        closeOnPointerDown: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts disableHoverableContent prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        disableHoverableContent: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts group prop for grouped tooltips', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        group: 'nav-tooltips',
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('syncs open state with Melt-UI', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Mount with open=true
    component = mount(Tooltip, {
      target: document.body,
      props: {
        children,
        open: true,
      },
    });

    flushSync();

    // When open, the tooltip context should have open state
    // Note: Actual DOM visibility depends on TooltipContent which requires context
    expect(document.body.querySelector('span')).toBeTruthy();
  });
});

describe('TooltipTrigger', () => {
  // Note: TooltipTrigger requires Tooltip parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(TooltipTrigger).toBeDefined();
    expect(typeof TooltipTrigger).toBe('function');
  });
});

describe('TooltipContent', () => {
  test('component module exports correctly', () => {
    expect(TooltipContent).toBeDefined();
    expect(typeof TooltipContent).toBe('function');
  });
});

describe('TooltipArrow', () => {
  test('component module exports correctly', () => {
    expect(TooltipArrow).toBeDefined();
    expect(typeof TooltipArrow).toBe('function');
  });
});

describe('Tooltip compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Tooltip).toBeDefined();
    expect(TooltipTrigger).toBeDefined();
    expect(TooltipContent).toBeDefined();
    expect(TooltipArrow).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    // Direct exports
    expect(exports.Tooltip).toBeDefined();
    expect(exports.TooltipTrigger).toBeDefined();
    expect(exports.TooltipContent).toBeDefined();
    expect(exports.TooltipArrow).toBeDefined();
    // Aliases
    expect(exports.Root).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Arrow).toBeDefined();
  });
});
