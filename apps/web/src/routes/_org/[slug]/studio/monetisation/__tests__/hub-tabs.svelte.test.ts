/**
 * Studio → Monetisation hub: the Subscriptions tab is the owner's alone.
 *
 * Its page sends anyone else to /studio, so an admin reading Revenue share
 * (which they may, read-only, Codex-2hxff.20 AGR-14) was offered a tab that
 * redirected them away. The tab now shows only while the role is unknown
 * (ssr=false: the first render has none) or the viewer is the owner, the same
 * test the page's own guard uses.
 *
 * Mounts the real `+layout.svelte`; `$app/state` is a plain object a test
 * sets before mounting.
 */

import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const appState = vi.hoisted(() => ({
  page: {
    url: new URL(
      'http://studio-alpha.lvh.me:3000/studio/monetisation/revenue-share'
    ),
    data: {} as { userRole?: string },
  },
}));

vi.mock('$app/state', () => ({
  page: appState.page,
  navigating: null,
}));

import MonetisationLayout from '../+layout.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountAs(userRole: string | undefined) {
  appState.page.data = userRole === undefined ? {} : { userRole };
  component = mount(MonetisationLayout, {
    target: document.body,
    props: {
      children: createRawSnippet(() => ({ render: () => '<p>leaf</p>' })),
    },
  });
  flushSync();
}

const tabs = () =>
  [...document.querySelectorAll('.tab-trigger')].map((a) =>
    a.textContent?.trim()
  );

describe('the hub tabs', () => {
  test('an admin is not offered Subscriptions', () => {
    mountAs('admin');
    expect(tabs()).toEqual([
      m.monetisation_revenue_share_title(),
      m.monetisation_pricing_faq_title(),
    ]);
  });

  test('the owner gets all three', () => {
    mountAs('owner');
    expect(tabs()).toEqual([
      m.monetisation_subscriptions_title(),
      m.monetisation_revenue_share_title(),
      m.monetisation_pricing_faq_title(),
    ]);
  });

  test('before the role has loaded, the tab stays, so it never pops in for the owner', () => {
    mountAs(undefined);
    expect(tabs()).toContain(m.monetisation_subscriptions_title());
  });
});
