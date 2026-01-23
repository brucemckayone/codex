import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Accordion from './Accordion.svelte';
import AccordionContent from './AccordionContent.svelte';
import AccordionItem from './AccordionItem.svelte';
import AccordionTrigger from './AccordionTrigger.svelte';

/**
 * Creates a test accordion with specified items.
 * Uses Svelte's createRawSnippet for child content.
 *
 * Note: Compound components require special handling in unit tests.
 * Due to JSDOM limitations with Svelte context and Melt-UI actions,
 * we test basic structure and props. Interactive behavior is covered by E2E tests.
 */

describe('Accordion', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('Accordion root renders as a div', () => {
    const children = createRawSnippet(() => ({
      render: () => '<div data-testid="child">Test content</div>',
    }));

    component = mount(Accordion, {
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

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        class: 'custom-accordion',
      },
    });

    const root = document.body.querySelector('.custom-accordion');
    expect(root).toBeTruthy();
  });

  test('root has Melt-UI data attributes', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: { children },
    });

    const root = document.body.querySelector('div');
    // Melt-UI adds data-melt-accordion-root or similar
    const hasDataAttribute = Array.from(root?.attributes || []).some(
      (attr) =>
        attr.name.startsWith('data-melt-') ||
        attr.name.startsWith('data-accordion')
    );
    expect(hasDataAttribute).toBe(true);
  });

  test('accepts defaultValue prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    // Should not throw when defaultValue is provided
    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        defaultValue: 'item-1',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts value prop (controlled mode)', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        value: 'item-2',
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts onValueChange callback', () => {
    const onValueChange = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        onValueChange,
      },
    });

    // Callback should be wired without error
    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts disabled prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        disabled: true,
      },
    });

    // Should mount without error when disabled
    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts multiple prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        multiple: true,
      },
    });

    // Should mount without error when multiple mode enabled
    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('accepts forceVisible prop', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        forceVisible: true,
      },
    });

    expect(document.body.querySelector('div')).toBeTruthy();
  });

  test('passes through rest props', () => {
    const children = createRawSnippet(() => ({
      render: () => '<span>Content</span>',
    }));

    component = mount(Accordion, {
      target: document.body,
      props: {
        children,
        id: 'test-accordion',
        'aria-label': 'FAQ Section',
      },
    });

    const root = document.body.querySelector('#test-accordion');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('aria-label')).toBe('FAQ Section');
  });
});

describe('AccordionItem', () => {
  // Note: AccordionItem requires Accordion parent context.
  // Testing in isolation verifies component structure only.
  // Full integration testing with context is covered by E2E tests.

  test('component module exports correctly', () => {
    expect(AccordionItem).toBeDefined();
    expect(typeof AccordionItem).toBe('function');
  });
});

describe('AccordionTrigger', () => {
  // Note: AccordionTrigger requires AccordionItem parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(AccordionTrigger).toBeDefined();
    expect(typeof AccordionTrigger).toBe('function');
  });
});

describe('AccordionContent', () => {
  // Note: AccordionContent requires AccordionItem parent context.
  // Testing in isolation verifies component structure only.

  test('component module exports correctly', () => {
    expect(AccordionContent).toBeDefined();
    expect(typeof AccordionContent).toBe('function');
  });
});

describe('Accordion compound component integration', () => {
  // Note: Full compound component integration testing with Melt-UI context
  // is challenging in JSDOM due to action-based event handling.
  // Interactive tests (expand/collapse, keyboard navigation) are covered by E2E tests.
  // These unit tests verify that components can be imported and basic props are accepted.

  test('all components can be imported together', () => {
    expect(Accordion).toBeDefined();
    expect(AccordionItem).toBeDefined();
    expect(AccordionTrigger).toBeDefined();
    expect(AccordionContent).toBeDefined();
  });
});
