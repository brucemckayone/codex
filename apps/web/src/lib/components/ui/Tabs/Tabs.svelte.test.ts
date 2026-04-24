import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Tabs from './Tabs.svelte';
import TabsContent from './TabsContent.svelte';
import TabsHarness from './TabsHarness.test.svelte';
import TabsList from './TabsList.svelte';
import TabsTrigger from './TabsTrigger.svelte';

/**
 * Tabs component unit tests.
 *
 * Tabs is a compound component built on Melt UI's createTabs. Sub-components
 * (TabsList/Trigger/Content) require the parent Tabs context, so they are
 * tested via TabsHarness which wires a realistic composition. Interactive
 * keyboard navigation (Arrow keys, Home/End) is covered by E2E tests — Melt
 * UI's actions register key handlers that JSDOM cannot fully exercise.
 */

describe('Tabs', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders root as a div with children', () => {
    const children = createRawSnippet(() => ({
      render: () => '<div data-testid="child">Tab content</div>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: { children },
    });

    const root = document.body.querySelector('div');
    expect(root).toBeTruthy();
    expect(root?.querySelector('[data-testid="child"]')).toBeTruthy();
  });

  test('applies custom className to root', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: { children, class: 'custom-tabs' },
    });

    expect(document.body.querySelector('.custom-tabs')).toBeTruthy();
  });

  test('passes through rest props like id and aria-label', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        id: 'test-tabs',
        'aria-label': 'Settings Tabs',
      },
    });

    const root = document.body.querySelector('#test-tabs');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('aria-label')).toBe('Settings Tabs');
  });

  test('renders active tab panel when defaultValue matches', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const panel1 = document.querySelector('[data-testid="panel-1"]');
    expect(panel1).toBeTruthy();
    expect(panel1?.textContent).toContain('Panel One Content');
  });

  test('fires onValueChange when a trigger is clicked', () => {
    const onValueChange = vi.fn();
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1', onValueChange },
    });

    flushSync();

    const trigger2 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-2"]'
    );
    expect(trigger2).toBeTruthy();
    trigger2?.click();
    flushSync();

    expect(onValueChange).toHaveBeenCalledWith('tab-2');
  });

  test('switches active panel when trigger is clicked', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const trigger2 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-2"]'
    );
    trigger2?.click();
    flushSync();

    expect(trigger2?.getAttribute('data-state')).toBe('active');
    const trigger1 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-1"]'
    );
    expect(trigger1?.getAttribute('data-state')).toBe('inactive');
  });
});

describe('TabsList', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders with role="tablist" via Melt UI', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const list = document.querySelector('.tabs-list');
    expect(list).toBeTruthy();
    expect(list?.getAttribute('role')).toBe('tablist');
  });

  test('reflects orientation via aria-orientation', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1', orientation: 'vertical' },
    });

    flushSync();

    const list = document.querySelector('.tabs-list');
    expect(list?.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('TabsTrigger', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders with role="tab"', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const trigger1 = document.querySelector('[data-testid="trigger-1"]');
    expect(trigger1?.getAttribute('role')).toBe('tab');
  });

  test('has data-state reflecting active/inactive', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    expect(
      document
        .querySelector('[data-testid="trigger-1"]')
        ?.getAttribute('data-state')
    ).toBe('active');
    expect(
      document
        .querySelector('[data-testid="trigger-2"]')
        ?.getAttribute('data-state')
    ).toBe('inactive');
  });

  test('disabled trigger has data-disabled attribute', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const trigger3 = document.querySelector('[data-testid="trigger-3"]');
    expect(trigger3?.hasAttribute('data-disabled')).toBe(true);
  });

  test('exposes data-value linking the trigger to its panel value', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    expect(
      document
        .querySelector('[data-testid="trigger-1"]')
        ?.getAttribute('data-value')
    ).toBe('tab-1');
    expect(
      document
        .querySelector('[data-testid="trigger-2"]')
        ?.getAttribute('data-value')
    ).toBe('tab-2');
  });
});

describe('TabsContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('active panel has role="tabpanel"', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const panel1 = document.querySelector('[data-testid="panel-1"]');
    expect(panel1?.getAttribute('role')).toBe('tabpanel');
  });

  test('only the active panel is visible (inactive hidden)', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const panel1 = document.querySelector('[data-testid="panel-1"]');
    const panel2 = document.querySelector('[data-testid="panel-2"]');

    expect(panel1?.hasAttribute('hidden')).toBe(false);
    expect(panel2?.hasAttribute('hidden')).toBe(true);
  });

  test('inactive panel becomes visible after switching tabs', () => {
    component = mount(TabsHarness, {
      target: document.body,
      props: { defaultValue: 'tab-1' },
    });

    flushSync();

    const trigger2 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-2"]'
    );
    trigger2?.click();
    flushSync();

    const panel1 = document.querySelector('[data-testid="panel-1"]');
    const panel2 = document.querySelector('[data-testid="panel-2"]');
    expect(panel1?.hasAttribute('hidden')).toBe(true);
    expect(panel2?.hasAttribute('hidden')).toBe(false);
  });
});

describe('Tabs compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Tabs).toBeDefined();
    expect(TabsList).toBeDefined();
    expect(TabsTrigger).toBeDefined();
    expect(TabsContent).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    expect(exports.Tabs).toBeDefined();
    expect(exports.TabsList).toBeDefined();
    expect(exports.TabsTrigger).toBeDefined();
    expect(exports.TabsContent).toBeDefined();
    expect(exports.Root).toBeDefined();
    expect(exports.List).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
  });
});
