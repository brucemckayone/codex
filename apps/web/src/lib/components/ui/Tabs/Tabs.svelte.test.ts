import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Tabs from './Tabs.svelte';
import TabsContent from './TabsContent.svelte';
import TabsList from './TabsList.svelte';
import TabsTrigger from './TabsTrigger.svelte';

/**
 * Tabs component unit tests.
 *
 * Note: Compound components require special handling in unit tests.
 * Due to JSDOM limitations with Svelte context and Melt-UI actions,
 * we test basic structure and props. Interactive behavior (tab switching,
 * keyboard navigation) is covered by E2E tests.
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

  test('Tabs root renders as a div', () => {
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
      props: {
        children,
        class: 'custom-tabs',
      },
    });

    const root = document.body.querySelector('.custom-tabs');
    expect(root).toBeTruthy();
  });

  test('root has Melt-UI data attributes', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: { children },
    });

    const root = document.body.querySelector('div');
    // Melt-UI adds data-melt-tabs-root or similar
    const hasDataAttribute = Array.from(root?.attributes || []).some(
      (attr) =>
        attr.name.startsWith('data-melt-') || attr.name.startsWith('data-tabs')
    );
    expect(hasDataAttribute).toBe(true);
  });

  test('accepts defaultValue prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        defaultValue: 'tab-1',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts value prop (controlled mode)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        value: 'tab-2',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts onValueChange callback', () => {
    const onValueChange = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        onValueChange,
      },
    });

    // Callback should be wired without error
    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts orientation prop (horizontal)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        orientation: 'horizontal',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts orientation prop (vertical)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        orientation: 'vertical',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts activateOnFocus prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        activateOnFocus: false,
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts loop prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        loop: false,
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts autoSet prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Tabs, {
      target: document.body,
      props: {
        children,
        autoSet: false,
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('passes through rest props', () => {
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
});

describe('TabsList', () => {
  // Note: TabsList requires Tabs parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(TabsList).toBeDefined();
    expect(typeof TabsList).toBe('function');
  });
});

describe('TabsTrigger', () => {
  // Note: TabsTrigger requires Tabs parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(TabsTrigger).toBeDefined();
    expect(typeof TabsTrigger).toBe('function');
  });
});

describe('TabsContent', () => {
  // Note: TabsContent requires Tabs parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(TabsContent).toBeDefined();
    expect(typeof TabsContent).toBe('function');
  });
});

describe('Tabs compound component integration', () => {
  // Note: Full compound component integration testing with Melt-UI context
  // is challenging in JSDOM due to action-based event handling.
  // Interactive tests (tab switching, keyboard navigation) are covered by E2E tests.
  // These unit tests verify that components can be imported and basic props are accepted.

  test('all components can be imported together', () => {
    expect(Tabs).toBeDefined();
    expect(TabsList).toBeDefined();
    expect(TabsTrigger).toBeDefined();
    expect(TabsContent).toBeDefined();
  });

  test('components have expected exports', () => {
    // Verify the index re-exports work
    import('./index.js').then((exports) => {
      expect(exports.Tabs).toBeDefined();
      expect(exports.TabsList).toBeDefined();
      expect(exports.TabsTrigger).toBeDefined();
      expect(exports.TabsContent).toBeDefined();
      // Aliases
      expect(exports.Root).toBeDefined();
      expect(exports.List).toBeDefined();
      expect(exports.Trigger).toBeDefined();
      expect(exports.Content).toBeDefined();
    });
  });
});
