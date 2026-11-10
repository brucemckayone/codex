import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import DropdownMenu from './DropdownMenu.svelte';
import DropdownMenuContent from './DropdownMenuContent.svelte';
import DropdownMenuDialogHarness from './DropdownMenuDialogHarness.test.svelte';
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

  // A guard against `preventScroll = true`, Melt's default, coming back.
  // It cannot tell `false` from unset: Melt's effect reads an undefined
  // preventScroll as falsy too (review G4-N4).
  test('a menu never locks the page', () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true },
    });

    flushSync();

    expect(
      document.querySelector('[data-testid="dropdown-content"]')
    ).toBeTruthy();
    expect(document.body.hasAttribute('data-melt-scroll-lock')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  test('an item press closes the menu', async () => {
    // closeOnItemClick at Melt's default. Left unset, it was set to
    // undefined over that default, and no item press closed the menu: an
    // item that opens a dialog left the menu open under it.
    const onOpenChange = vi.fn();
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });
    flushSync();

    document.querySelector<HTMLElement>('[data-testid="item-1"]')?.click();

    // Melt closes a millisecond later, so a form can submit first. Read
    // the trigger, not the panel: whether the panel's outro ends under the
    // stubbed animate() depends on which tests ran before this one.
    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    await vi.waitFor(() =>
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // A Try again that reloads what the menu shows (Codex-a6ofh.2.6, the New
  // menu's drafts): the menu stays open, and the item's own press still runs.
  test('a keepOpen item runs its press and leaves the menu open', async () => {
    const onOpenChange = vi.fn();
    const onKeep = vi.fn();
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true, onOpenChange, onKeep },
    });
    flushSync();

    document.querySelector<HTMLElement>('[data-testid="item-keep"]')?.click();
    // Past Melt's millisecond, when a press that closes has closed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    flushSync();

    expect(onKeep).toHaveBeenCalledOnce();
    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Closed before the unmount: a menu unmounted open closes late, in the next test.
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await vi.waitFor(() =>
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    );
  });

  // A link item is the link (Codex-a6ofh.2.6): one menu item, one tab
  // stop, and a press follows it and closes the menu.
  test('an href item is a link menu item that closes the menu', async () => {
    const onOpenChange = vi.fn();
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true, onOpenChange },
    });
    flushSync();

    const link = document.querySelector<HTMLElement>(
      '[data-testid="item-link"]'
    );
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('role')).toBe('menuitem');
    expect(link?.getAttribute('href')).toBe('#drafts');
    expect(document.querySelector('[data-testid="item-1"]')?.tagName).toBe(
      'DIV'
    );

    link?.click();

    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    await vi.waitFor(() =>
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Melt's own close put focus back on the trigger, whatever had it by
  // then. An item that opens a dialog had already handed focus to the
  // dialog: the trigger, behind the overlay, took it, focus-trap pulled it
  // back without preventScroll, and a Body-less panel scrolled down to its
  // Footer again (Codex-vlphc review G5-C-L1).
  describe('an item that opens a dialog', () => {
    const visits: Element[] = [];
    const record = (event: FocusEvent) => {
      if (event.target instanceof Element) visits.push(event.target);
    };

    afterEach(() => {
      window.removeEventListener('focusin', record, true);
      visits.length = 0;
      vi.restoreAllMocks();
    });

    // Window, capturing: focus-trap stops a stray focusin at the document.
    function pressItem(testId: string, props: { forceVisible?: boolean } = {}) {
      component = mount(DropdownMenuDialogHarness, {
        target: document.body,
        props,
      });
      flushSync();
      window.addEventListener('focusin', record, true);
      document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
      flushSync();
    }
    const trigger = () => document.querySelector('[data-testid="trigger"]');
    const panel = () => document.querySelector('.dialog-content');
    // Melt moves focus through chained sleep(1) timers, which a loaded
    // machine stretches well past any fixed wait. What must HAPPEN is
    // waited for; a fixed wait is only for what must NEVER happen, and
    // starts once a positive anchor holds, not from the press.
    const happens = (assertion: () => void) =>
      vi.waitFor(assertion, { timeout: 2000 });
    const lingers = () => new Promise((resolve) => setTimeout(resolve, 50));

    test('leaves focus in the dialog: the trigger never takes it', async () => {
      pressItem('opens-dialog');
      // A panel that scrolls as a whole, scrolled down as focus-trap left it.
      const dialog = document.querySelector<HTMLElement>('.dialog-content');
      let scrollTop = 166;
      if (dialog)
        Object.defineProperty(dialog, 'scrollTop', {
          configurable: true,
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = value;
          },
        });
      await happens(() => {
        expect(dialog?.contains(document.activeElement)).toBe(true);
        expect(scrollTop).toBe(0);
      });
      await lingers();

      expect(dialog?.contains(document.activeElement)).toBe(true);
      expect(visits).not.toContain(trigger());
      // Pins openFocus (G4-U3), its one write to the stand-in. jsdom's
      // focus() never scrolls, so a closeFocus regression fails `visits`
      // above, not this (review c6).
      expect(scrollTop).toBe(0);
    });

    const mouse = (type: string) => {
      const event = new MouseEvent(type);
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      return event;
    };

    // In Chromium the overlay covering the pressed item fires a pointerleave
    // on it. Melt's roving answered a millisecond later by taking tabindex 0
    // from whatever had focus by then: the dialog's buttons (review c5).
    test('the pointer leaving the pressed item takes no tab stop from the dialog', async () => {
      // forceVisible, as in the app: the menu stays through its outro, inert,
      // and a browser's focus() refuses an inert node. jsdom keeps Svelte's
      // `inert` as a plain property and focuses anything, so here focus()
      // refuses a node under one, as a browser does.
      const focus = HTMLElement.prototype.focus;
      const inert = (el: HTMLElement | null): boolean =>
        !!el && (el.inert || inert(el.parentElement));
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
        this: HTMLElement,
        options?: FocusOptions
      ) {
        if (!inert(this)) focus.call(this, options);
      });
      pressItem('opens-dialog', { forceVisible: true });
      const item = document.querySelector('[data-testid="opens-dialog"]');
      item?.dispatchEvent(mouse('pointerleave'));
      await happens(() =>
        expect(panel()?.contains(document.activeElement)).toBe(true)
      );
      await lingers();
      // The menu has closed: a pointer still over what is left of it,
      // which its outro keeps in the DOM.
      await happens(() =>
        expect(trigger()?.getAttribute('aria-expanded')).toBe('false')
      );
      expect(item?.isConnected).toBe(true);
      item?.dispatchEvent(mouse('pointermove'));
      await lingers();

      expect(
        document.querySelector<HTMLElement>('[data-testid="cancel"]')?.tabIndex
      ).toBe(0);
      expect(panel()?.contains(document.activeElement)).toBe(true);
      // Nothing behind the dialog took focus, even for a moment.
      expect(visits.filter((el) => el.closest('[role="menu"]'))).toEqual([]);
    });

    // Melt deferred it by a millisecond, which a dialog's render can stretch
    // past the press: so it happens at once, and only while the menu is open.
    test('the pointer moves focus through the menu at once', async () => {
      component = mount(DropdownMenuDialogHarness, { target: document.body });
      flushSync();
      const item = document.querySelector<HTMLElement>('[data-testid="plain"]');

      item?.dispatchEvent(mouse('pointermove'));
      expect(document.activeElement).toBe(item);
      expect(item?.tabIndex).toBe(0);

      item?.dispatchEvent(mouse('pointerleave'));
      expect(document.activeElement?.getAttribute('role')).toBe('menu');
      expect(item?.tabIndex).toBe(-1);

      // Closed before the unmount: a menu unmounted open closes late, in
      // the next test.
      item?.click();
      await happens(() =>
        expect(trigger()?.getAttribute('aria-expanded')).toBe('false')
      );
    });

    // A press that leaves the menu open: in the app, a menu reopened during
    // its closing animation keeps its items, pressed one and all. A move
    // onto the item shows nothing covers it, and its leave counts again.
    test('a pressed item still open under the pointer gives focus back to the menu', async () => {
      component = mount(DropdownMenuDialogHarness, {
        target: document.body,
        props: { closeOnItemClick: false },
      });
      flushSync();
      const item = document.querySelector<HTMLElement>('[data-testid="plain"]');
      item?.click();
      // Left open: whatever the press set off in Melt has run by now.
      await lingers();
      expect(trigger()?.getAttribute('aria-expanded')).toBe('true');

      item?.dispatchEvent(mouse('pointermove'));
      item?.dispatchEvent(mouse('pointerleave'));
      expect(document.activeElement?.getAttribute('role')).toBe('menu');

      // Closed before the unmount, as above.
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await happens(() =>
        expect(trigger()?.getAttribute('aria-expanded')).toBe('false')
      );
    });

    // The usual close in the app: focus on the item, where the menu's own
    // focus trap keeps it. With forceVisible the leaving menu stays in the
    // DOM, item focused, when closeFocus asks where focus is (review c6,
    // Codex-q6qjb). The trap, live in jsdom, then pulls focus back onto
    // the item, so the trigger's focus() is what is checked.
    test('an item chosen by keyboard gives focus back to the trigger', async () => {
      component = mount(DropdownMenuDialogHarness, {
        target: document.body,
        props: { forceVisible: true },
      });
      flushSync();
      // Melt's own focus on open, a few timers later: into the menu.
      await happens(() =>
        expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull()
      );
      const item = document.querySelector<HTMLElement>('[data-testid="plain"]');
      const button = trigger();
      const focus =
        button instanceof HTMLElement ? vi.spyOn(button, 'focus') : null;
      item?.focus();
      item?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );

      await happens(() => expect(focus).toHaveBeenCalled());
      expect(item?.isConnected).toBe(true);
    });

    test('an item that opens nothing gives focus back to the trigger', async () => {
      pressItem('plain');

      await happens(() => expect(document.activeElement).toBe(trigger()));
    });
  });

  test('accepts an onOpenChange callback without throwing', () => {
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

  // The menu's aria-labelledby names the trigger's id, and Melt's keyboard
  // open and a dialog's way back to this button find the menu through its
  // aria-controls (review fu-focus-2, as Content's id in review c6).
  test("keeps Melt's id and aria-controls whatever a page passes, so the menu and its button still name each other", () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: {
        open: true,
        triggerAttrs: { id: 'page-trigger', 'aria-controls': 'page-menu' },
      },
    });

    flushSync();

    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    const content = document.querySelector('[data-testid="dropdown-content"]');
    expect(trigger?.id).not.toBe('page-trigger');
    expect(trigger?.getAttribute('aria-controls')).not.toBe('page-menu');
    expect(trigger?.getAttribute('aria-controls')).toBe(content?.id);
    expect(content?.getAttribute('aria-labelledby')).toBe(trigger?.id);
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

  // The trigger's aria-controls, the close focus and a dialog's way back
  // to the menu's button all find the menu by Melt's id (review c6).
  test("keeps Melt's id whatever a page passes, so the trigger still names it", () => {
    component = mount(DropdownMenuHarness, {
      target: document.body,
      props: { open: true, contentAttrs: { id: 'page-id' } },
    });

    flushSync();

    const content = document.querySelector('[data-testid="dropdown-content"]');
    const trigger = document.querySelector('[data-testid="dropdown-trigger"]');
    expect(content?.id).not.toBe('page-id');
    expect(content?.id).toBe(trigger?.getAttribute('aria-controls'));
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
