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
import PopoverHarness from './PopoverHarness.test.svelte';
import PopoverTrigger from './PopoverTrigger.svelte';

/**
 * Popover component unit tests.
 *
 * Popover is a compound component built on Melt UI's createPopover. Sub-
 * components (PopoverTrigger/Content/Close/Arrow) require the parent context,
 * so they are tested via PopoverHarness which wires a realistic composition.
 * Interactive focus-trap, outside-click, and positioning behaviour is covered
 * by E2E tests — Melt UI's actions rely on pointer events and floating-ui
 * layout which JSDOM cannot fully exercise.
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
      render: () => '<button data-testid="trigger">Open</button>',
    }));

    component = mount(Popover, {
      target: document.body,
      props: { children },
    });

    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('does not render content when closed', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    expect(
      document.querySelector('[data-testid="popover-content"]')
    ).toBeNull();
  });

  test('renders content when open', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="popover-content"]');
    expect(content).toBeTruthy();
    expect(content?.textContent).toContain('Popover body text');
  });

  test('fires onOpenChange when close button is clicked', () => {
    const onOpenChange = vi.fn();
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });

    flushSync();

    const closeButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="popover-close"]'
    );
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    flushSync();

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('PopoverTrigger', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has aria-haspopup="dialog" and aria-expanded reflecting state', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="popover-trigger"]');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  test('aria-expanded becomes "true" when popover is open', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="popover-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.getAttribute('data-state')).toBe('open');
  });

  // Popover.Root's default. Melt derives its own aria-expanded from
  // visibility there, which is always on, so a closed popover said "true".
  test('under forceVisible, a closed popover says aria-expanded="false"', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: false, forceVisible: true },
    });
    flushSync();
    const trigger = document.querySelector('[data-testid="popover-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  test('aria-controls references the popover content id when open', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="popover-trigger"]');
    const controlsId = trigger?.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    const content = document.getElementById(controlsId!);
    expect(content).toBe(
      document.querySelector('[data-testid="popover-content"]')
    );
  });
});

describe('PopoverContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('is focusable via tabindex="-1"', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="popover-content"]');
    expect(content?.getAttribute('tabindex')).toBe('-1');
  });

  test('is a dialog, so its aria-label names it', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();
    const content = document.querySelector('[data-testid="popover-content"]');
    expect(content?.getAttribute('role')).toBe('dialog');
  });

  test('has data-state="open" when popover is open', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('[data-testid="popover-content"]');
    expect(content?.getAttribute('data-state')).toBe('open');
  });
});

describe('Popover focus on close', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  // Melt sets the panel up a tick after it opens, and moves focus a moment
  // after it closes (a 1ms sleep, then a tick): each is let settle, as a
  // person's open and close are never in the same microtask.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  function close() {
    document
      .querySelector<HTMLButtonElement>('[data-testid="popover-close"]')
      ?.click();
    flushSync();
  }

  test('goes back to the trigger by default', async () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();
    await settle();
    close();
    await settle();
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="popover-trigger"]')
    );
  });

  test('Escape closes it', async () => {
    const onOpenChange = vi.fn();
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });
    flushSync();
    await settle();
    // From inside the panel, as a key press is: Melt ignores one whose target
    // is not an element.
    document
      .querySelector('[data-testid="popover-content"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    flushSync();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('goes where closeFocus says', async () => {
    const editor = document.createElement('div');
    editor.tabIndex = -1;
    document.body.appendChild(editor);
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true, closeFocus: () => editor },
    });
    flushSync();
    await settle();
    close();
    await settle();
    expect(document.activeElement).toBe(editor);
  });
});

describe('Popover motion', () => {
  let component: ReturnType<typeof mount> | null = null;
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    window.matchMedia = realMatchMedia;
    document.body.innerHTML = '';
  });

  function openThenClose() {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();
    document
      .querySelector<HTMLButtonElement>('[data-testid="popover-close"]')
      ?.click();
    flushSync();
    return document.querySelector<HTMLElement>(
      '[data-testid="popover-content"]'
    );
  }

  // The control: with motion, the panel is still flying out (jsdom never
  // ends a transition, and Svelte makes a leaving panel inert).
  test('with motion, the panel flies out', () => {
    const panel = openThenClose();
    expect(panel?.inert).toBe(true);
  });

  test('under reduced motion, the panel goes at once', () => {
    window.matchMedia = ((query: string) => ({
      ...realMatchMedia(query),
      matches: query.includes('prefers-reduced-motion: reduce'),
    })) as typeof window.matchMedia;
    expect(openThenClose()).toBeNull();
  });
});

describe('PopoverClose', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders as a button inside content', () => {
    component = mount(PopoverHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const close = document.querySelector('[data-testid="popover-close"]');
    expect(close?.tagName.toLowerCase()).toBe('button');
    expect(close?.textContent).toContain('Close');
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
    expect(exports.Popover).toBeDefined();
    expect(exports.PopoverTrigger).toBeDefined();
    expect(exports.PopoverContent).toBeDefined();
    expect(exports.PopoverArrow).toBeDefined();
    expect(exports.PopoverClose).toBeDefined();
    expect(exports.Root).toBeDefined();
    expect(exports.Trigger).toBeDefined();
    expect(exports.Content).toBeDefined();
    expect(exports.Arrow).toBeDefined();
    expect(exports.Close).toBeDefined();
  });
});
