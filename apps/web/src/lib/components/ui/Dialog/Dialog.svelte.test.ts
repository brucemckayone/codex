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
import DialogHarness from './DialogHarness.test.svelte';
import DialogTitle from './DialogTitle.svelte';

/**
 * Dialog component unit tests.
 *
 * Dialog is a compound component built on Melt UI's createDialog. Sub-components
 * (DialogContent/Title/Description) require the parent Dialog context, so they
 * are tested via DialogHarness which wires a realistic composition. Interactive
 * focus-trap and keyboard escape behaviour is covered by E2E tests — Melt UI's
 * actions register focus handlers that JSDOM cannot fully exercise.
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

    expect(document.querySelector('[data-testid="trigger"]')).toBeTruthy();
  });

  test('does not render portal content when closed', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: false },
    });

    flushSync();

    expect(document.querySelector('.dialog-content')).toBeNull();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
    expect(
      document.querySelector('[data-testid="first-focusable"]')
    ).toBeNull();
  });

  test('renders portal content when open', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    expect(document.querySelector('.dialog-content')).toBeTruthy();
    expect(document.querySelector('.dialog-overlay')).toBeTruthy();
    expect(
      document.querySelector('[data-testid="first-focusable"]')
    ).toBeTruthy();
  });

  test('fires onOpenChange when Melt-UI syncs close state', () => {
    const onOpenChange = vi.fn();
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });

    flushSync();

    const closeButton =
      document.querySelector<HTMLButtonElement>('.dialog-close');
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    flushSync();

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Melt calls its onOpenChange on every set of its store, false to false
  // included. Reported, a closed dialog said "closed" on mount and a close
  // said it twice; the media drawer's close wrote the URL, and the page
  // navigated in a loop (Codex-a6ofh.1.7).
  test('a closed dialog reports nothing on mount', () => {
    const onOpenChange = vi.fn();
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: false, onOpenChange },
    });
    flushSync();

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test('a close is reported once', () => {
    const onOpenChange = vi.fn();
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });
    flushSync();
    onOpenChange.mockClear();

    document.querySelector<HTMLButtonElement>('.dialog-close')?.click();
    flushSync();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Dialog dismissible', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  // Melt debounces its outside-press handlers by 10 ms.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
  async function pressOutside() {
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    );
    await settle();
    document.body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await settle();
    flushSync();
  }
  const isOpen = () => document.querySelector('.dialog-content') !== null;

  test('while not dismissible, a press outside leaves it open; once dismissible, one closes it', async () => {
    const props = $state({ open: true, dismissible: false });
    component = mount(DialogHarness, { target: document.body, props });
    flushSync();
    await settle();

    await pressOutside();
    expect(isOpen()).toBe(true);

    props.dismissible = true;
    flushSync();
    await pressOutside();
    expect(isOpen()).toBe(false);
  });

  test('turning it off and on again moves no focus: Melt’s focus trap is not rebuilt', async () => {
    const props = $state({ open: true, dismissible: true });
    component = mount(DialogHarness, { target: document.body, props });
    flushSync();
    await settle();
    // A browser blurs a button that disables itself (Submit, while busy), so
    // focus is on the page when the request ends. A rebuilt trap would then
    // take it to the first tabbable element, over whatever the dialog moves
    // it to (R2-L3).
    const second = document.querySelector<HTMLButtonElement>(
      '[data-testid="second-focusable"]'
    );
    second?.focus();
    second?.blur();
    expect(document.activeElement).toBe(document.body);

    props.dismissible = false;
    flushSync();
    await settle();
    props.dismissible = true;
    flushSync();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('DialogContent', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders children inside the content panel when open', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content).toBeTruthy();
    expect(
      content?.querySelector('[data-testid="first-focusable"]')
    ).toBeTruthy();
    expect(
      content?.querySelector('[data-testid="second-focusable"]')
    ).toBeTruthy();
  });

  test('content panel has dialog role and aria-modal via Melt UI', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('role')).toBe('dialog');
    expect(content?.getAttribute('aria-modal')).toBe('true');
  });

  test('close button has accessible label', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const closeButton = document.querySelector('.dialog-close');
    expect(closeButton?.getAttribute('aria-label')).toBe('Close');
  });

  test('applies size variant via data-size attribute', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, size: 'lg' },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('data-size')).toBe('lg');
  });

  test('defaults to the dialog variant, and Body learns its layout from Content', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, sheet: true, flush: true, floating: true },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('data-variant')).toBe('dialog');
    // sheet and floating are drawer-only, and a dialog's panel has no
    // padding for flush to drop (flush strips its parts instead).
    expect(content?.hasAttribute('data-sheet')).toBe(false);
    expect(content?.hasAttribute('data-flush')).toBe(false);
    expect(content?.hasAttribute('data-floating')).toBe(false);
    expect(
      document.querySelector('.dialog-body')?.getAttribute('data-layout')
    ).toBe('dialog');
    expect(
      document.querySelector('.dialog-footer')?.getAttribute('data-align')
    ).toBe('end');
  });

  test('a drawer marks the panel, the overlay, its Body and its Footer', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: {
        open: true,
        variant: 'drawer',
        sheet: true,
        flush: true,
        size: 'sm',
      },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('data-variant')).toBe('drawer');
    expect(content?.getAttribute('data-size')).toBe('sm');
    expect(content?.hasAttribute('data-sheet')).toBe(true);
    expect(content?.hasAttribute('data-flush')).toBe(true);
    expect(
      document.querySelector('.dialog-overlay')?.getAttribute('data-variant')
    ).toBe('drawer');
    expect(
      document.querySelector('.dialog-body')?.getAttribute('data-layout')
    ).toBe('drawer');
    expect(
      document.querySelector('.dialog-footer')?.getAttribute('data-layout')
    ).toBe('drawer');
  });

  test('a drawer marks a Dialog.Form too', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, variant: 'drawer', withForm: true },
    });

    flushSync();

    const form = document.querySelector('.dialog-content > form.dialog-form');
    expect(form?.getAttribute('data-layout')).toBe('drawer');
    expect(form?.querySelector('.dialog-body')).toBeTruthy();
  });

  test('a floating drawer scrolls Body, so its parts read the floating layout', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: {
        open: true,
        variant: 'drawer',
        floating: true,
        sheet: true,
        footerAlign: 'between',
      },
    });

    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(content?.getAttribute('data-variant')).toBe('drawer');
    expect(content?.hasAttribute('data-floating')).toBe(true);
    expect(content?.hasAttribute('data-sheet')).toBe(true);
    expect(
      document.querySelector('.dialog-overlay')?.hasAttribute('data-floating')
    ).toBe(true);
    expect(
      document.querySelector('.dialog-body')?.getAttribute('data-layout')
    ).toBe('floating');
    const footer = document.querySelector('.dialog-footer');
    expect(footer?.getAttribute('data-layout')).toBe('floating');
    expect(footer?.getAttribute('data-align')).toBe('between');
  });

  test('a flush dialog makes every part a bare box; without flush none is', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, flush: true, withToolbar: true },
    });
    flushSync();

    const parts = [
      '.dialog-header',
      '.dialog-toolbar',
      '.dialog-body',
      '.dialog-footer',
    ];
    for (const part of parts) {
      expect(
        document.querySelector(part)?.hasAttribute('data-flush'),
        part
      ).toBe(true);
    }
    unmount(component);
    document.body.innerHTML = '';

    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, withToolbar: true },
    });
    flushSync();

    for (const part of parts) {
      expect(
        document.querySelector(part)?.hasAttribute('data-flush'),
        part
      ).toBe(false);
    }
  });

  test('placement, radius and motion mark a dialog; a drawer ignores them', () => {
    const props = {
      open: true,
      placement: 'top',
      radius: 'lg',
      motion: 'drop',
    } as const;
    component = mount(DialogHarness, { target: document.body, props });
    flushSync();

    const content = document.querySelector('.dialog-content');
    const overlay = document.querySelector('.dialog-overlay');
    expect(
      document
        .querySelector('.dialog-content-wrapper')
        ?.getAttribute('data-placement')
    ).toBe('top');
    expect(content?.getAttribute('data-placement')).toBe('top');
    expect(content?.getAttribute('data-radius')).toBe('lg');
    expect(content?.getAttribute('data-motion')).toBe('drop');
    expect(overlay?.getAttribute('data-motion')).toBe('drop');
    unmount(component);
    document.body.innerHTML = '';

    component = mount(DialogHarness, {
      target: document.body,
      props: { ...props, variant: 'drawer' },
    });
    flushSync();

    const drawer = document.querySelector('.dialog-content');
    expect(
      document
        .querySelector('.dialog-content-wrapper')
        ?.hasAttribute('data-placement')
    ).toBe(false);
    for (const attr of ['data-placement', 'data-radius', 'data-motion']) {
      expect(drawer?.hasAttribute(attr), attr).toBe(false);
    }
    expect(
      document.querySelector('.dialog-overlay')?.hasAttribute('data-motion')
    ).toBe(false);
  });

  test('the defaults add no placement, radius, overlay or motion mark', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();

    const content = document.querySelector('.dialog-content');
    expect(
      document
        .querySelector('.dialog-content-wrapper')
        ?.hasAttribute('data-placement')
    ).toBe(false);
    for (const attr of [
      'data-placement',
      'data-radius',
      'data-motion',
      'style',
    ]) {
      expect(content?.hasAttribute(attr), attr).toBe(false);
    }
    expect(content?.getAttribute('data-surface')).toBe('elevated');
    const overlay = document.querySelector('.dialog-overlay');
    expect(overlay?.hasAttribute('data-overlay')).toBe(false);
    expect(overlay?.hasAttribute('data-motion')).toBe(false);
  });

  test.each([
    [{}, 'elevated'],
    [{ surface: 'base' }, 'base'],
    [{ surface: 'glass' }, 'glass'],
    [{ variant: 'drawer' }, 'elevated'],
    [{ variant: 'drawer', floating: true }, 'glass'],
    [{ variant: 'drawer', floating: true, surface: 'base' }, 'base'],
  ] as const)('surface %o reads %s', (props, expected) => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, ...props },
    });
    flushSync();

    expect(
      document.querySelector('.dialog-content')?.getAttribute('data-surface')
    ).toBe(expected);
  });

  test('overlay dim and dark mark the overlay, on a drawer too', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, variant: 'drawer', overlay: 'dark' },
    });
    flushSync();

    expect(
      document.querySelector('.dialog-overlay')?.getAttribute('data-overlay')
    ).toBe('dark');
  });

  test("maxWidth and maxHeight set the panel's own limits", () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, maxWidth: '35rem', maxHeight: '60vh' },
    });
    flushSync();

    // A plain length: jsdom's CSSOM drops min(). The browser proof covers it.
    const content = document.querySelector<HTMLElement>('.dialog-content');
    expect(content?.style.maxWidth).toBe('35rem');
    expect(content?.style.maxHeight).toBe('60vh');
  });

  // The motion transitions return no config for every other panel, and
  // Svelte finishes such a transition at once: a default dialog must still
  // leave the DOM in the same flush as its close.
  test('a dialog with the default motion is gone as soon as it closes', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();

    document.querySelector<HTMLButtonElement>('.dialog-close')?.click();
    flushSync();

    expect(document.querySelector('.dialog-content')).toBeNull();
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  test('closeButton={false} drops the built-in close button', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, variant: 'drawer', closeButton: false },
    });

    flushSync();

    expect(document.querySelector('.dialog-content')).toBeTruthy();
    expect(document.querySelector('.dialog-close')).toBeNull();
  });
});

describe('DialogTitle', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders as h2 with provided text', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const title = document.querySelector('h2.dialog-title');
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain('Dialog Title');
  });

  test('title id is referenced by content aria-labelledby', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const title = document.querySelector<HTMLElement>('h2.dialog-title');
    const content = document.querySelector('.dialog-content');

    expect(title?.id).toBeTruthy();
    expect(content?.getAttribute('aria-labelledby')).toBe(title?.id);
  });
});

describe('DialogDescription', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('renders as p with provided text', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const description = document.querySelector('p.dialog-description');
    expect(description).toBeTruthy();
    expect(description?.textContent).toContain('Dialog description text');
  });

  test('description id is referenced by content aria-describedby', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    const description = document.querySelector<HTMLElement>(
      'p.dialog-description'
    );
    const content = document.querySelector('.dialog-content');

    expect(description?.id).toBeTruthy();
    expect(content?.getAttribute('aria-describedby')).toBe(description?.id);
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
    expect(exports.Body).toBeDefined();
    expect(exports.Form).toBeDefined();
    expect(exports.Toolbar).toBeDefined();
  });
});
