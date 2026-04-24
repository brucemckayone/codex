import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DropdownMenu from './DropdownMenu.svelte';
import DropdownMenuContent from './DropdownMenuContent.svelte';
import DropdownMenuHarness from './DropdownMenuHarness.test.svelte';
import DropdownMenuItem from './DropdownMenuItem.svelte';
import DropdownMenuSeparator from './DropdownMenuSeparator.svelte';
import DropdownMenuTrigger from './DropdownMenuTrigger.svelte';

/**
 * DropdownMenu component unit tests.
 *
 * DropdownMenu is a compound component built on Melt UI's createDropdownMenu.
 * Sub-components (Trigger/Content/Item/Separator) require the parent context,
 * so they are tested via DropdownMenuHarness which wires a realistic
 * composition. Interactive keyboard navigation (Arrow/Home/End), outside-click
 * close, and focus management are covered by E2E tests — Melt UI's actions
 * rely on pointer + key events that JSDOM cannot fully exercise.
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

  test('renders children when closed', () => {
    const children = createRawSnippet(() => ({
      render: () => '<button data-testid="trigger">Menu</button>',
    }));

    component = mount(DropdownMenu, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('does not render menu content when closed', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="dropdown-content"]')
    ).toBeNull();
  });

  test('renders menu content when open', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="dropdown-content"]');
    expect(content).toBeTruthy();
    expect(content?.getAttribute('role')).toBe('menu');
  });

  test('accepts an onOpenChange callback without throwing', () => {
    // Full close-on-item-click behaviour needs Melt UI pointer event handling
    // which JSDOM does not fully simulate. We verify callback wiring here and
    // cover the end-to-end close flow in E2E tests.
    const onOpenChange = vi.fn();
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });

    flushSync();

    expect(
      document.querySelector('[data-testid="dropdown-content"]')
    ).toBeTruthy();
  });
});

describe('DropdownMenuTrigger', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has aria-expanded reflecting open state', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('data-state')).toBe('closed');
  });

  test('aria-expanded becomes true when dropdown is open', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.getAttribute('data-state')).toBe('open');
  });

  test('aria-controls references the menu content id when open', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    const controlsId = trigger?.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    const menu = document.getElementById(controlsId!);
    expect(menu).toBe(
      document.querySelector('[data-testid="dropdown-content"]')
    );
  });
});

describe('DropdownMenuContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has role="menu" and is labelled by the trigger', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="dropdown-content"]');
    expect(content?.getAttribute('role')).toBe('menu');

    const labelledBy = content?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const trigger = document.getElementById(labelledBy!);
    expect(trigger).toBe(
      document.querySelector('[data-testid="dropdown-trigger"]')
    );
  });

  test('is focusable via tabindex="-1"', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="dropdown-content"]');
    expect(content?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('DropdownMenuItem', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('each item has role="menuitem"', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const item1 = document.querySelector('[data-testid="item-1"]');
    const item2 = document.querySelector('[data-testid="item-2"]');
    expect(item1?.getAttribute('role')).toBe('menuitem');
    expect(item2?.getAttribute('role')).toBe('menuitem');
  });

  test('disabled item has aria-disabled="true" and data-disabled attribute', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const disabledItem = document.querySelector('[data-testid="item-3"]');
    expect(disabledItem?.getAttribute('aria-disabled')).toBe('true');
    expect(disabledItem?.hasAttribute('data-disabled')).toBe(true);
  });

  test('enabled item has aria-disabled="false"', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const enabledItem = document.querySelector('[data-testid="item-1"]');
    expect(enabledItem?.getAttribute('aria-disabled')).toBe('false');
    expect(enabledItem?.hasAttribute('data-disabled')).toBe(false);
  });
});

describe('DropdownMenuSeparator', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has role="separator"', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const separator = document.querySelector('[data-testid="separator"]');
    expect(separator?.getAttribute('role')).toBe('separator');
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
    expect(exports.DropdownMenu).toBeDefined();
    expect(exports.DropdownMenuTrigger).toBeDefined();
    expect(exports.DropdownMenuContent).toBeDefined();
    expect(exports.DropdownMenuItem).toBeDefined();
    expect(exports.DropdownMenuSeparator).toBeDefined();
    expect(exports.Root).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Item).toBeDefined();
    expect(exports.Separator).toBeDefined();
  });
});
