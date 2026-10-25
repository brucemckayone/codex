/**
 * The Support link (Codex-2hxff.28): in the platform rail, and on a phone in
 * the More sheet's account section, for the platform owner only. The /admin
 * pages 404 for everyone else, so anyone else would be offered a dead link.
 * The bottom bar itself does not change.
 *
 * Mounts the real SidebarRail and MobileBottomSheet; only `$app/state` is the
 * reactive double.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { LayoutUser } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);

import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MobileBottomSheet from '../MobileNav/MobileBottomSheet.svelte';
import SidebarRail from '../SidebarRail/SidebarRail.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function user(role: string): LayoutUser {
  return { name: 'Jordan Reid', email: 'jordan@example.com', role };
}

const supportLink = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => a.getAttribute('href') === '/admin'
  );

describe('the rail', () => {
  test.each([
    ['the platform owner', user('platform_owner'), true],
    ['a creator', user('creator'), false],
    ['an organisation admin', user('admin'), false],
    ['a customer', user('customer'), false],
    ['nobody signed in', null, false],
  ])('%s: Support shown is %s', (_who, who, shown) => {
    setPage('/');
    component = mount(SidebarRail, {
      target: document.body,
      props: { variant: 'platform', user: who },
    });
    flushSync();
    expect(supportLink() !== undefined).toBe(shown);
    if (shown)
      expect(supportLink()?.getAttribute('aria-label')).toBe(
        m.support_nav_label()
      );
  });

  test('is marked current anywhere under /admin', () => {
    setPage('/admin/refunds/ch_3QeT8xLk2vRb09aZ');
    component = mount(SidebarRail, {
      target: document.body,
      props: { variant: 'platform', user: user('platform_owner') },
    });
    flushSync();
    expect(supportLink()?.getAttribute('aria-current')).toBe('page');
  });

  test('is not in an organisation’s rail', () => {
    setPage('/');
    component = mount(SidebarRail, {
      target: document.body,
      props: {
        variant: 'org',
        user: user('platform_owner'),
        org: { name: 'Studio Alpha', slug: 'studio-alpha' },
      },
    });
    flushSync();
    expect(supportLink()).toBeUndefined();
  });
});

describe('the phone’s More sheet', () => {
  test.each([
    ['the platform owner', 'platform_owner', true],
    ['a creator', 'creator', false],
    ['an organisation admin', 'admin', false],
  ])('%s: Support shown is %s', (_who, role, shown) => {
    setPage('/');
    component = mount(MobileBottomSheet, {
      target: document.body,
      props: { open: true, variant: 'platform', user: user(role) },
    });
    flushSync();
    expect(supportLink() !== undefined).toBe(shown);
    if (shown)
      expect(supportLink()?.textContent).toContain(m.support_nav_label());
  });
});
