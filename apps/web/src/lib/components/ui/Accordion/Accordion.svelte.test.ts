import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import Accordion from './Accordion.svelte';
import AccordionContent from './AccordionContent.svelte';
import AccordionHarness from './AccordionHarness.test.svelte';
import AccordionItem from './AccordionItem.svelte';
import AccordionMultipleHarness from './AccordionMultipleHarness.test.svelte';
import AccordionTrigger from './AccordionTrigger.svelte';

/**
 * Accordion component unit tests.
 *
 * Accordion is a compound component built on Melt UI's createAccordion. Sub-
 * components (AccordionItem/Trigger/Content) require the parent context, so
 * they are tested via AccordionHarness which wires a realistic composition.
 * Interactive keyboard navigation (Arrow keys, Home/End) is covered by E2E
 * tests — Melt UI's actions register key handlers that JSDOM cannot fully
 * exercise.
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

  test('renders root as a div with children', () => {
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
      props: { children, class: 'custom-accordion' },
    });

    expect(document.body.querySelector('.custom-accordion')).toBeTruthy();
  });

  test('passes through rest props like id and aria-label', () => {
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

  test('opens an item on trigger click (single mode)', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    expect(document.querySelector('[data-testid="content-1"]')).toBeNull();

    const trigger1 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-1"]'
    );
    trigger1?.click();
    flushSync();

    expect(document.querySelector('[data-testid="content-1"]')).toBeTruthy();
    expect(trigger1?.getAttribute('aria-expanded')).toBe('true');
  });

  test('closes previously-open item in single mode', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    const trigger1 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-1"]'
    );
    const trigger2 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-2"]'
    );

    trigger1?.click();
    flushSync();
    expect(trigger1?.getAttribute('aria-expanded')).toBe('true');

    trigger2?.click();
    flushSync();
    expect(trigger1?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger2?.getAttribute('aria-expanded')).toBe('true');
  });

  test('keeps multiple items open in multiple mode', () => {
    component = mount(AccordionMultipleHarness, {
      target: document.body,
      props: { defaultValue: ['item-1'] },
    });

    flushSync();

    const trigger1 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-1"]'
    );
    const trigger2 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-2"]'
    );
    trigger2?.click();
    flushSync();

    expect(trigger1?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger2?.getAttribute('aria-expanded')).toBe('true');
  });

  test('fires onValueChange when an item toggles', () => {
    const onValueChange = vi.fn();
    component = mount(AccordionHarness, {
      target: document.body,
      props: { onValueChange },
    });

    flushSync();

    const trigger1 = document.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-1"]'
    );
    trigger1?.click();
    flushSync();

    expect(onValueChange).toHaveBeenCalledWith('item-1');
  });

  test('respects defaultValue by rendering that item open', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: { defaultValue: 'item-2' },
    });

    flushSync();

    expect(document.querySelector('[data-testid="content-2"]')).toBeTruthy();
    const trigger2 = document.querySelector('[data-testid="trigger-2"]');
    expect(trigger2?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('AccordionItem', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders each item as a div with accordion-item class', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    const items = document.querySelectorAll('.accordion-item');
    expect(items.length).toBe(3);
  });

  test('disabled item propagates data-disabled to its item wrapper', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    // Melt UI sets data-disabled on the item wrapper (not the trigger button),
    // and aria-disabled on the trigger itself.
    const items = document.querySelectorAll('.accordion-item');
    const disabledItem = items[2];
    expect(disabledItem?.getAttribute('data-disabled')).toBe('true');
  });
});

describe('AccordionTrigger', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has aria-expanded reflecting open state', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    const trigger1 = document.querySelector('[data-testid="trigger-1"]');
    expect(trigger1?.getAttribute('aria-expanded')).toBe('false');

    (trigger1 as HTMLButtonElement).click();
    flushSync();

    expect(trigger1?.getAttribute('aria-expanded')).toBe('true');
  });

  test('data-state on trigger reflects item open/closed state', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: { defaultValue: 'item-1' },
    });

    flushSync();

    expect(
      document
        .querySelector('[data-testid="trigger-1"]')
        ?.getAttribute('data-state')
    ).toBe('open');
    expect(
      document
        .querySelector('[data-testid="trigger-2"]')
        ?.getAttribute('data-state')
    ).toBe('closed');
  });
});

describe('AccordionContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('content is not present when item is closed', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: {},
    });

    flushSync();

    expect(document.querySelector('[data-testid="content-1"]')).toBeNull();
  });

  test('content appears when item is open', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: { defaultValue: 'item-1' },
    });

    flushSync();

    const content = document.querySelector('[data-testid="content-1"]');
    expect(content).toBeTruthy();
    expect(content?.textContent).toContain('Answer One');
  });

  test('content reflects data-state="open" when its item is active', () => {
    component = mount(AccordionHarness, {
      target: document.body,
      props: { defaultValue: 'item-1' },
    });

    flushSync();

    const content = document.querySelector('[data-testid="content-1"]');
    expect(content?.getAttribute('data-state')).toBe('open');
    expect(content?.getAttribute('data-value')).toBe('item-1');
  });
});

describe('Accordion compound component integration', () => {
  test('all components can be imported together', () => {
    expect(Accordion).toBeDefined();
    expect(AccordionItem).toBeDefined();
    expect(AccordionTrigger).toBeDefined();
    expect(AccordionContent).toBeDefined();
  });

  test('index exports named components and aliases', async () => {
    const exports = await import('./index.js');
    expect(exports.Accordion).toBeDefined();
    expect(exports.AccordionItem).toBeDefined();
    expect(exports.AccordionTrigger).toBeDefined();
    expect(exports.AccordionContent).toBeDefined();
    expect(exports.Root).toBeDefined();
    expect(exports.Item).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
  });
});
