/**
 * The phone's glass dock (Codex-r9ws7): icon-only controls that still carry
 * their names, the lens that follows the current tab and which way it moved,
 * shrink on scroll, and the page banner it carries.
 *
 * jsdom has no layout and no scrolling, so a test sets `scrollY` and fires the
 * scroll event itself. The look and the motion (the lens's stretch and squash,
 * the capsule closing) were measured in Chromium on the approved mock,
 * docs/handover/org-landing-sources/mobile-dock/.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);

import {
  type DockBannerOffer,
  offerDockBanner,
} from '$lib/components/layout/DockBanner';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MobileBottomNav from './MobileBottomNav.svelte';

let component: ReturnType<typeof mount> | null = null;
let withdraw: (() => void) | null = null;
const onSearchClick = vi.fn();
const onMoreClick = vi.fn();

afterEach(() => {
  withdraw?.();
  withdraw = null;
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  Object.defineProperty(window, 'scrollY', {
    value: 0,
    configurable: true,
    writable: true,
  });
  vi.clearAllMocks();
});

function mountDock(path: string) {
  setPage(path);
  component = mount(MobileBottomNav, {
    target: document.body,
    props: { variant: 'org', onSearchClick, onMoreClick },
  });
  flushSync();
}

function nav(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    'nav[aria-label="Mobile navigation"]'
  );
  if (!el) throw new Error('no Mobile navigation landmark');
  return el;
}

function control(name: string): HTMLElement {
  const el = nav().querySelector<HTMLElement>(`[aria-label="${name}"]`);
  if (!el) throw new Error(`no control named ${name}`);
  return el;
}

function bar(): HTMLElement {
  const el = nav().querySelector<HTMLElement>('.dock__bar');
  if (!el) throw new Error('no capsule');
  return el;
}

function isInert(el: HTMLElement): boolean {
  return el.inert === true || el.hasAttribute('inert');
}

function scrollToY(y: number) {
  Object.defineProperty(window, 'scrollY', {
    value: y,
    configurable: true,
    writable: true,
  });
  window.dispatchEvent(new Event('scroll'));
  flushSync();
}

function navigate(path: string) {
  setPage(path);
  flushSync();
}

function dock(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.dock');
  if (!el) throw new Error('no dock');
  return el;
}

const compact = () => dock().hasAttribute('data-compact');

/** A page offering a banner, the way SubscribeNudge does. */
function offer(banner: DockBannerOffer) {
  withdraw = $effect.root(() => {
    offerDockBanner(() => banner);
  });
  flushSync();
}

const SUBSCRIBE: DockBannerOffer = {
  id: 'subscribe:test',
  priority: 10,
  region: 'Subscribe call to action',
  title: 'Become a member',
  subtitle: 'Tidewater Yoga',
  action: { label: 'Subscribe', href: '/pricing' },
  dismiss: { label: 'Dismiss subscribe banner', onclick: () => {} },
};

function banner(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Subscribe call to action"]'
  );
}

describe('MobileBottomNav', () => {
  test('every icon-only control is named, and Search and More stay inside the landmark', () => {
    mountDock('/');

    for (const [name, href] of [
      ['Home', '/'],
      ['Explore', '/explore'],
      ['Library', '/library'],
    ]) {
      const link = control(name);
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe(href);
    }
    // The e2e specs reach both through the "Mobile navigation" landmark.
    expect(control('Search').tagName).toBe('BUTTON');
    expect(control('More').tagName).toBe('BUTTON');

    control('Search').click();
    control('More').click();
    expect(onSearchClick).toHaveBeenCalledOnce();
    expect(onMoreClick).toHaveBeenCalledOnce();
  });

  test('only the current tab is marked, and the lens sits under it', () => {
    mountDock('/explore');

    expect(control('Explore').getAttribute('aria-current')).toBe('page');
    expect(control('Home').hasAttribute('aria-current')).toBe(false);
    expect(control('Library').hasAttribute('aria-current')).toBe(false);
    expect(bar().style.getPropertyValue('--_i')).toBe('1');
    // Three tabs and More share the capsule.
    expect(bar().style.getPropertyValue('--_n')).toBe('4');
    expect(bar().hasAttribute('data-no-current')).toBe(false);
  });

  test("on a page that is no tab's the lens fades where it stands", () => {
    mountDock('/library');
    navigate('/content/a-year-in-clay');

    expect(nav().querySelector('[aria-current]')).toBeNull();
    expect(bar().hasAttribute('data-no-current')).toBe(true);
    expect(bar().style.getPropertyValue('--_i')).toBe('2');
  });

  test('the lens moves with its direction, and each move restarts the squash', () => {
    mountDock('/');
    // Nothing to squash before the first move.
    expect(bar().hasAttribute('data-squash')).toBe(false);

    navigate('/library');
    expect(bar().dataset.dir).toBe('right');
    const first = bar().dataset.squash;
    expect(first).toBeDefined();

    navigate('/explore');
    expect(bar().dataset.dir).toBe('left');
    expect(bar().dataset.squash).toBeDefined();
    expect(bar().dataset.squash).not.toBe(first);
  });

  test('a run of scrolling down shrinks it; jitter does not; scrolling up or the top opens it', () => {
    mountDock('/');

    scrollToY(100);
    expect(compact()).toBe(true);
    expect(isInert(control('Home'))).toBe(true);
    expect(isInert(control('More'))).toBe(true);
    expect(isInert(control('Show navigation'))).toBe(false);
    // Search is reachable shrunk or not.
    expect(isInert(control('Search'))).toBe(false);

    scrollToY(95);
    expect(compact()).toBe(true);

    scrollToY(80);
    expect(compact()).toBe(false);
    expect(isInert(control('Home'))).toBe(false);
    expect(isInert(control('Show navigation'))).toBe(true);

    scrollToY(300);
    expect(compact()).toBe(true);
    scrollToY(320);
    scrollToY(30);
    expect(compact()).toBe(false);
  });

  test('tapping the bubble opens it, and so does a new page', () => {
    mountDock('/');
    scrollToY(400);
    expect(compact()).toBe(true);

    control('Show navigation').click();
    flushSync();
    expect(compact()).toBe(false);

    scrollToY(800);
    expect(compact()).toBe(true);
    navigate('/explore');
    expect(compact()).toBe(false);
  });

  test('it carries the page banner on top, and inside itself once shrunk', () => {
    mountDock('/');
    expect(banner()).toBeNull();

    offer(SUBSCRIBE);
    const region = banner();
    expect(region).not.toBeNull();
    // Beside the navigation landmark, not inside it.
    expect(nav().contains(region)).toBe(false);
    expect(dock().contains(region)).toBe(true);
    expect(region?.querySelector('a')?.getAttribute('href')).toBe('/pricing');
    expect(region?.hasAttribute('data-compact')).toBe(false);

    scrollToY(100);
    expect(banner()?.hasAttribute('data-compact')).toBe(true);

    withdraw?.();
    withdraw = null;
    flushSync();
    expect(banner()).toBeNull();
  });
});
