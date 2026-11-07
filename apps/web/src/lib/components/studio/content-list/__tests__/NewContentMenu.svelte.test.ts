/**
 * NewContentMenu (Codex-a6ofh.2.6, mockup W1): the newest drafts first, so
 * nothing is started twice, then the three kinds. The drafts are read when
 * the menu first opens, and a read that failed is never "no drafts".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { draftRow, withMedia } from '../../__fixtures__/draft-row';
import {
  failContent,
  landContent,
  listContent,
  refreshListContent,
  resetListContent,
} from '../../__fixtures__/list-content.mock.svelte';
import NewContentMenu from '../NewContentMenu.svelte';

vi.mock(
  '$lib/remote/content.remote',
  () => import('../../__fixtures__/list-content.mock.svelte')
);

const logged = vi.hoisted(() => vi.fn());
vi.mock('../../media-library/log-read-failure', () => ({
  logReadFailure: logged,
}));

const settle = async () => {
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  flushSync();
};

const trigger = () => document.querySelector<HTMLElement>('.new-trigger');
const menu = () => document.querySelector('[role="menu"]');
// jsdom never ends the menu's fly-out, so a closed menu's node lingers:
// the trigger says whether it is open, as in the DropdownMenu suite.
const isOpen = () => trigger()?.getAttribute('aria-expanded') === 'true';
const menuText = () => menu()?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const links = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('[role="menu"] a')].map(
    (a) => ({
      href: a.getAttribute('href'),
      text: a.textContent?.replace(/\s+/g, ' ').trim(),
    })
  );

async function openMenu() {
  trigger()?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  );
  await settle();
}

describe('NewContentMenu', () => {
  let component: ReturnType<typeof mount> | null = null;
  // jsdom does not navigate: a link press stops at the document.
  const stayHere = (event: Event) => event.preventDefault();

  function render(organizationId: string | null = 'org-1') {
    component = mount(NewContentMenu, {
      target: document.body,
      props: { organizationId, payouts: 'ready' },
    });
    flushSync();
  }

  beforeEach(() => {
    resetListContent();
    logged.mockClear();
    document.addEventListener('click', stayHere);
  });

  afterEach(async () => {
    // Closed before the unmount: a menu unmounted open closes late, in the next test.
    if (isOpen()) {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await settle();
    }
    if (component) {
      unmount(component);
      component = null;
    }
    document.removeEventListener('click', stayHere);
    document.body.innerHTML = '';
  });

  test('reads the drafts only once it is opened, the org’s newest three', async () => {
    render();
    expect(listContent).not.toHaveBeenCalled();

    await openMenu();

    expect(listContent).toHaveBeenCalledWith({
      organizationId: 'org-1',
      status: 'draft',
      page: 1,
      limit: 3,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  test('the trigger is named New, even where its label is hidden', () => {
    render();
    expect(trigger()?.getAttribute('aria-label')).toBe('New');
  });

  test('the personal studio asks for no org', async () => {
    render(null);
    await openMenu();

    expect(listContent.mock.calls[0]?.[0]).not.toHaveProperty('organizationId');
  });

  test('says it is finding the drafts, and offers the three kinds meanwhile', async () => {
    render();
    await openMenu();

    expect(menuText()).toContain('Finding your drafts…');
    expect(links().map((link) => link.href)).toEqual([
      '/studio/content/new?type=video',
      '/studio/content/new?type=audio',
      '/studio/content/new?type=written',
    ]);
  });

  test('offers the drafts first, each at the step still to do, then all of them', async () => {
    render();
    await openMenu();
    landContent(
      [
        draftRow({ id: 'c1', title: 'Runes deep dive' }),
        draftRow({ id: 'c2', title: 'Stores, retired', ...withMedia('ready') }),
      ],
      7
    );
    await settle();

    const offered = links();
    expect(offered.slice(0, 3)).toEqual([
      {
        href: '/studio/content/c1/edit',
        text: expect.stringContaining('Step 1 of 2'),
      },
      {
        href: '/studio/content/c2/edit?step=publish',
        text: expect.stringContaining('Ready to publish'),
      },
      { href: '/studio/content?status=draft', text: 'All drafts (7)' },
    ]);
    expect(offered[0]?.text).toContain('Runes deep dive');
    expect(menuText()).not.toContain('Finding your drafts…');
  });

  test('no drafts: straight to the kinds, with nothing said about drafts', async () => {
    render();
    await openMenu();
    landContent([], 0);
    await settle();

    expect(menuText()).not.toContain('draft');
    expect(links()).toHaveLength(3);
  });

  test('a read that failed says so and offers Try again, which keeps the menu open', async () => {
    render();
    await openMenu();
    failContent();
    await settle();

    expect(menuText()).toContain('Couldn’t load your drafts.');
    expect(menuText()).not.toContain('All drafts');
    const retry = document.querySelector<HTMLElement>('.new-menu-retry');
    expect(retry?.textContent?.trim()).toBe('Try Again');

    retry?.click();
    await settle();

    expect(refreshListContent).toHaveBeenCalledOnce();
    expect(isOpen()).toBe(true);
  });

  test('a read that failed is logged, with the org it was for', async () => {
    render();
    await openMenu();
    const outage = { status: 503, body: { message: 'Down' } };
    failContent(outage);
    await settle();

    expect(logged).toHaveBeenCalledWith(
      'studio_content.new_menu_drafts_unread',
      outage,
      { organizationId: 'org-1' }
    );
  });

  test('Try again says it is trying, once, and that it failed again', async () => {
    render();
    await openMenu();
    failContent();
    await settle();
    let fail: (reason: unknown) => void = () => {};
    refreshListContent.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        })
    );
    const retry = () =>
      document.querySelector<HTMLElement>('.new-menu-retry')?.click();

    retry();
    await settle();
    expect(menuText()).toContain('Trying again…');
    // A second press while one is in flight sends nothing.
    retry();
    await settle();
    expect(refreshListContent).toHaveBeenCalledOnce();

    // Kit rejects a failed refresh: caught, never an unhandled rejection.
    fail({ status: 503, body: { message: 'Still down' } });
    await settle();

    expect(menuText()).toContain('Still couldn’t load your drafts.');
    expect(isOpen()).toBe(true);
  });

  // The pressed item goes with the failure it put right. Pressed as a
  // person does: focused on it first (arrowed to, or roved by the pointer).
  const pressRetry = () => {
    const item = document
      .querySelector('.new-menu-retry')
      ?.closest<HTMLElement>('[role="menuitem"]');
    item?.focus();
    item?.click();
  };

  test('a Try again that loads them keeps focus in the menu, on its first item', async () => {
    render();
    await openMenu();
    failContent();
    await settle();
    refreshListContent.mockImplementationOnce(async () => {
      landContent([draftRow({ id: 'c1', title: 'Runes deep dive' })], 1);
    });

    pressRetry();
    await settle();

    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    expect(document.activeElement?.textContent).toContain('Runes deep dive');
    expect(isOpen()).toBe(true);
  });

  test('a Try again leaves focus on an item arrowed to meanwhile', async () => {
    render();
    await openMenu();
    failContent();
    await settle();
    const audio = () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.includes(m.content_type_audio())
      );
    refreshListContent.mockImplementationOnce(async () => {
      audio()?.focus();
      landContent([draftRow({ id: 'c1', title: 'Runes deep dive' })], 1);
    });

    pressRetry();
    await settle();

    expect(document.activeElement).toBe(audio());
  });

  test('choosing a link closes the menu', async () => {
    render();
    await openMenu();

    expect(isOpen()).toBe(true);
    // A link item is the link: one menu item, pressed.
    document
      .querySelector<HTMLElement>('[role="menu"] a[role="menuitem"]')
      ?.click();
    await settle();

    expect(isOpen()).toBe(false);
  });
});
