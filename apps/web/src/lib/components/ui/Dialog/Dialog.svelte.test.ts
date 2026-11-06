import type { Component, Snippet } from 'svelte';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { CssLength } from './css-length';
import Dialog from './Dialog.svelte';
import DialogBody from './DialogBody.svelte';
import DialogContent from './DialogContent.svelte';
import DialogDescription from './DialogDescription.svelte';
import DialogFooter from './DialogFooter.svelte';
import DialogFormElement from './DialogFormElement.svelte';
import DialogHarness from './DialogHarness.test.svelte';
import DialogHeader from './DialogHeader.svelte';
import DialogTitle from './DialogTitle.svelte';
import DialogToolbar from './DialogToolbar.svelte';

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

describe('Dialog scroll lock', () => {
  const mounted: ReturnType<typeof mount>[] = [];
  const locked = () => document.body.hasAttribute('data-melt-scroll-lock');

  afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component);
    document.body.innerHTML = '';
  });

  // `drop` keeps the panel while it animates out (jsdom never finishes the
  // animation): the window in which a reopen lost Melt's release for good.
  test('the page is let go at the close, also after a reopen during the outro', () => {
    const props = $state({ open: true, motion: 'drop' as const });
    mounted.push(mount(DialogHarness, { target: document.body, props }));
    flushSync();
    expect(locked()).toBe(true);

    props.open = false;
    flushSync();
    expect(document.querySelector('.dialog-content')).toBeTruthy();
    expect(locked()).toBe(false);

    props.open = true;
    flushSync();
    expect(locked()).toBe(true);
    props.open = false;
    flushSync();
    expect(locked()).toBe(false);
  });

  test('a dialog over a dialog keeps the page locked until the last one closes', () => {
    const outer = $state({ open: true });
    const inner = $state({ open: true });
    mounted.push(mount(DialogHarness, { target: document.body, props: outer }));
    mounted.push(mount(DialogHarness, { target: document.body, props: inner }));
    flushSync();

    inner.open = false;
    flushSync();
    expect(locked()).toBe(true);

    outer.open = false;
    flushSync();
    expect(locked()).toBe(false);
  });
});

describe('Dialog focus return', () => {
  const mounted: ReturnType<typeof mount>[] = [];
  // Melt moves focus a tick after open and after close.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component);
    document.body.innerHTML = '';
  });

  function opener(): HTMLButtonElement {
    const button = document.createElement('button');
    button.innerHTML = '<span>Edit tier</span>';
    document.body.appendChild(button);
    return button;
  }

  async function openAndClose(whileOpen?: () => void) {
    const props = $state({ open: false });
    mounted.push(mount(DialogHarness, { target: document.body, props }));
    flushSync();
    props.open = true;
    flushSync();
    whileOpen?.();
    await settle();
    props.open = false;
    flushSync();
    await settle();
  }

  const press = (button: HTMLButtonElement) =>
    button
      .querySelector('span')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  const key = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

  test('opened from the keyboard, focus goes back to what had it', async () => {
    const button = opener();
    button.focus();
    key();

    await openAndClose();

    expect(document.activeElement).toBe(button);
  });

  // WebKit focuses no button on a click or a tap: focus is still on <body>.
  test('a press that focused nothing still names the opener', async () => {
    const button = opener();
    press(button);

    await openAndClose();

    expect(document.activeElement).toBe(button);
  });

  // In WebKit a press inside an open dialog focuses its panel, not the button.
  test('a press beats a focus left on something else', async () => {
    const button = opener();
    opener().focus();
    press(button);

    await openAndClose();

    expect(document.activeElement).toBe(button);
  });

  test('a key pressed after the press forgets it', async () => {
    const button = opener();
    press(button);
    key();

    await openAndClose();

    expect(document.activeElement).not.toBe(button);
  });

  /** A menu's button and an item in its menu, as Melt's DropdownMenu renders them. */
  function menu() {
    const trigger = opener();
    trigger.setAttribute('aria-controls', 'menu-1');
    const list = document.createElement('div');
    list.id = 'menu-1';
    list.setAttribute('role', 'menu');
    list.innerHTML =
      '<div role="menuitem" tabindex="-1"><span>Delete</span></div>';
    document.body.appendChild(list);
    const item = list.querySelector<HTMLElement>('[role="menuitem"]');
    item
      ?.querySelector('span')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    return { trigger, list, item };
  }

  // A menu closes as its item is chosen and takes the item with it.
  test("opened from a menu item, focus goes back to the menu's button once the menu has gone", async () => {
    const { trigger, list } = menu();

    await openAndClose(() => list.remove());

    expect(document.activeElement).toBe(trigger);
  });

  test('a menu item still on the page takes the focus back itself', async () => {
    const { item } = menu();

    await openAndClose();

    expect(document.activeElement).toBe(item);
  });

  // A dialog a timer or a response opens long after the last press must not
  // send focus, and the page's scroll, back to wherever that press was.
  test('a press long before the open is not the opener', async () => {
    const button = opener();
    const field = opener();
    field.focus();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    press(button);
    now.mockReturnValue(61_000);

    await openAndClose();
    now.mockRestore();

    expect(document.activeElement).toBe(field);
  });
});

// WebKit kept the caret of a field focused in the closing panel, and when
// the panel left the DOM it scrolled the page to the caret's new place at
// the top (review N7). The caret goes with the close.
describe('Dialog caret at the close', () => {
  const mounted: ReturnType<typeof mount>[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const component of mounted.splice(0)) unmount(component);
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  function openDialog() {
    const props = $state({ open: true, withField: true });
    mounted.push(mount(DialogHarness, { target: document.body, props }));
    flushSync();
    return props;
  }
  const panelButton = () =>
    document.querySelector<HTMLElement>('[data-testid="first-focusable"]');

  // WebKit anchors a field's caret in the field's own inner tree, a node
  // the panel does not contain: a detached one stands in for it.
  test('a field focused in the panel loses its caret as the dialog closes', () => {
    const props = openDialog();
    document.querySelector<HTMLInputElement>('[data-testid="field"]')?.focus();
    const caret = {
      anchorNode: document.createElement('div'),
      removeAllRanges: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(
      caret as unknown as Selection
    );

    props.open = false;
    flushSync();

    expect(caret.removeAllRanges).toHaveBeenCalled();
  });

  test('a selection in the panel goes as the dialog closes', () => {
    const props = openDialog();
    const button = panelButton();
    button?.focus();
    if (button) window.getSelection()?.selectAllChildren(button);

    props.open = false;
    flushSync();

    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  test('a selection on the page behind stays', () => {
    const text = document.createElement('p');
    text.textContent = 'On the page';
    document.body.appendChild(text);
    const props = openDialog();
    panelButton()?.focus();
    window.getSelection()?.selectAllChildren(text);

    props.open = false;
    flushSync();

    expect(window.getSelection()?.rangeCount).toBe(1);
  });
});

// A page's attributes go on before a part's own, so a page can never switch
// on another layout: `data-layout="drawer"` on a centred dialog's Body turned
// on its `display: contents` and clipped the Footer (review c2, G2-M2).
describe('Dialog parts own their attributes', () => {
  const PAGE = {
    'data-layout': 'drawer',
    'data-flush': '',
    'data-variant': 'drawer',
    'data-size': 'lg',
    'data-direction': 'column',
    'data-align': 'between',
  };
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  test("a centred dialog's Body and panel keep their own layout", () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, contentProps: PAGE, bodyProps: PAGE },
    });
    flushSync();

    const content = document.querySelector('.dialog-content');
    const body = document.querySelector('.dialog-body');
    expect(content?.getAttribute('data-variant')).toBe('dialog');
    expect(content?.getAttribute('data-size')).toBe('md');
    expect(content?.hasAttribute('data-flush')).toBe(false);
    expect(body?.getAttribute('data-layout')).toBe('dialog');
    expect(body?.hasAttribute('data-flush')).toBe(false);
  });

  const children = createRawSnippet(() => ({ render: () => '<span>x</span>' }));
  // Each part's own attributes, as it sets them outside a dialog (null: absent).
  // One component type for every row: mount() takes no union of components.
  const parts: [
    string,
    Component<{ children: Snippet }>,
    string,
    Record<string, string | null>,
  ][] = [
    ['Header', DialogHeader, '.dialog-header', { 'data-flush': null }],
    [
      'Toolbar',
      DialogToolbar,
      '.dialog-toolbar',
      { 'data-direction': 'row', 'data-layout': null, 'data-flush': null },
    ],
    [
      'Footer',
      DialogFooter,
      '.dialog-footer',
      { 'data-align': 'end', 'data-layout': null, 'data-flush': null },
    ],
    ['Form', DialogFormElement, '.dialog-form', { 'data-layout': null }],
    [
      'Body',
      DialogBody,
      '.dialog-body',
      { 'data-layout': null, 'data-flush': null },
    ],
  ];
  test.each(
    parts
  )('%s keeps its own data-* over a page’s', (_name, Part, selector, own) => {
    component = mount(Part, {
      target: document.body,
      props: { children, ...PAGE },
    });
    flushSync();

    const root = document.querySelector(selector);
    for (const [name, value] of Object.entries(own)) {
      expect(root?.getAttribute(name)).toBe(value);
    }
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

  test('a role set on Dialog.Root reaches the panel', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, role: 'alertdialog' },
    });

    flushSync();

    expect(
      document.querySelector('.dialog-content')?.getAttribute('role')
    ).toBe('alertdialog');
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
    expect(content?.style.getPropertyValue('--dialog-max-height')).toBe('60vh');
  });

  // Checked by svelte-check, not at run time: a keyword or a bare number
  // inside the panel's min() made the whole height invalid, and the panel
  // lost its cap (review G3-M1).
  test('maxWidth and maxHeight take CSS lengths, never a keyword or a bare number', () => {
    expectTypeOf<'48rem'>().toMatchTypeOf<CssLength>();
    expectTypeOf<'60vh'>().toMatchTypeOf<CssLength>();
    expectTypeOf<'min(35rem, 90vw)'>().toMatchTypeOf<CssLength>();
    expectTypeOf<'var(--container-sm)'>().toMatchTypeOf<CssLength>();
    expectTypeOf<'none'>().not.toMatchTypeOf<CssLength>();
    expectTypeOf<'auto'>().not.toMatchTypeOf<CssLength>();
    expectTypeOf<'90'>().not.toMatchTypeOf<CssLength>();
  });

  // A rem value taller than the screen put the Footer out of reach: the
  // height goes through `--dialog-max`, which the CSS clamps to the room
  // the placement leaves (the browser proof measures it).
  test('maxHeight reaches the panel clamped, never as written', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, maxHeight: '48rem' },
    });
    flushSync();

    const content = document.querySelector<HTMLElement>('.dialog-content');
    expect(content?.style.maxHeight).toBe('var(--dialog-max)');
  });

  test('without maxHeight the panel keeps its default cap', () => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true },
    });
    flushSync();

    const content = document.querySelector<HTMLElement>('.dialog-content');
    expect(content?.style.maxHeight).toBe('');
    expect(content?.style.getPropertyValue('--dialog-max-height')).toBe('');
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

  // A drawer that scrolls as a whole pins its close button (sticky, keyed
  // on this attribute); a floating drawer and a dialog clip, so theirs stays
  // absolute.
  test.each([
    [{}, 'dialog'],
    [{ variant: 'drawer' }, 'drawer'],
    [{ variant: 'drawer', sheet: true }, 'drawer'],
    [{ variant: 'drawer', floating: true }, 'floating'],
  ] as const)('the close button of %o reads the %s layout', (props, expected) => {
    component = mount(DialogHarness, {
      target: document.body,
      props: { open: true, ...props },
    });
    flushSync();

    const content = document.querySelector('.dialog-content');
    const close = document.querySelector('.dialog-close');
    expect(close?.getAttribute('data-layout')).toBe(expected);
    // Still last in the panel: the tab order and Melt's first focus are unchanged.
    expect(content?.lastElementChild).toBe(close);
  });

  // The portal escapes .org-layout to <body>, so it carries the org's brand
  // scope with it and no font of its own: an inline value beats
  // [data-org-brand]'s brand font with <body>'s Inter.
  test('a portal under an org brand carries its scope and sets no font', () => {
    const layout = document.createElement('div');
    layout.className = 'org-layout';
    layout.setAttribute('data-org-brand', '');
    layout.style.setProperty('--brand-font-body', 'Georgia');
    document.body.appendChild(layout);

    component = mount(DialogHarness, {
      target: layout,
      props: { open: true },
    });
    flushSync();

    const portal = document.querySelector('.dialog-overlay')?.parentElement;
    expect(portal?.parentElement).toBe(document.body);
    expect(portal?.hasAttribute('data-org-brand')).toBe(true);
    expect(portal?.style.getPropertyValue('--brand-font-body')).toBe('Georgia');
    expect(portal?.style.fontFamily).toBe('');
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
