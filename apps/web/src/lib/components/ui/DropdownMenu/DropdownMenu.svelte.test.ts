import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DropdownMenu from './DropdownMenu.svelte';
import DropdownMenuContent from './DropdownMenuContent.svelte';
import DropdownMenuItem from './DropdownMenuItem.svelte';
import DropdownMenuSeparator from './DropdownMenuSeparator.svelte';
import DropdownMenuTrigger from './DropdownMenuTrigger.svelte';

/**
 * DropdownMenu component unit tests.
 *
 * Note: DropdownMenu is a complex compound component with portals and positioning.
 * Due to JSDOM limitations with Melt-UI actions and portal rendering,
 * we test basic props and structure. Interactive behavior (open/close,
 * keyboard navigation, item selection) is covered by E2E tests.
 */

describe('DropdownMenu', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children', () => {
    const children = createRawSnippet(() => ({
      render: () => '<button data-testid="trigger">Menu</button>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('accepts open prop (controlled mode)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        open: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts defaultOpen prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        defaultOpen: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts onOpenChange callback', () => {
    const onOpenChange = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        onOpenChange,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts positioning prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        positioning: { placement: 'bottom-start' },
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts loop prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        loop: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts closeOnItemClick prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        closeOnItemClick: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts closeOnOutsideClick prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        closeOnOutsideClick: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts portal prop (defaults to true)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        portal: false,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts forceVisible prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        forceVisible: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });

  test('accepts preventScroll prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Menu</span>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: {
        children,
        preventScroll: true,
      },
    });

    expect(document.body.querySelector('span')).toBeTruthy();
  });
});

describe('DropdownMenuTrigger', () => {
  // Note: DropdownMenuTrigger requires DropdownMenu parent context.

  test('component module exports correctly', () => {
    expect(DropdownMenuTrigger).toBeDefined();
    expect(typeof DropdownMenuTrigger).toBe('function');
  });
});

describe('DropdownMenuContent', () => {
  test('component module exports correctly', () => {
    expect(DropdownMenuContent).toBeDefined();
    expect(typeof DropdownMenuContent).toBe('function');
  });
});

describe('DropdownMenuItem', () => {
  test('component module exports correctly', () => {
    expect(DropdownMenuItem).toBeDefined();
    expect(typeof DropdownMenuItem).toBe('function');
  });
});

describe('DropdownMenuSeparator', () => {
  test('component module exports correctly', () => {
    expect(DropdownMenuSeparator).toBeDefined();
    expect(typeof DropdownMenuSeparator).toBe('function');
  });
});

describe('DropdownMenu compound component integration', () => {
  test('all components can be imported together', () => {
    expect(DropdownMenu).toBeDefined();
    expect(DropdownMenuTrigger).toBeDefined();
    expect(DropdownMenuContent).toBeDefined();
    expect(DropdownMenuItem).toBeDefined();
    expect(DropdownMenuSeparator).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    // Full names
    expect(exports.DropdownMenu).toBeDefined();
    expect(exports.DropdownMenuTrigger).toBeDefined();
    expect(exports.DropdownMenuContent).toBeDefined();
    expect(exports.DropdownMenuItem).toBeDefined();
    expect(exports.DropdownMenuSeparator).toBeDefined();
    // Aliases
    expect(exports.Root).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Item).toBeDefined();
    expect(exports.Separator).toBeDefined();
  });
});
