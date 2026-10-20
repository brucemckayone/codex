/**
 * OwnershipOfferBanner — mockup state 5: the recipient is told on every studio
 * page until they respond (Codex-2hxff.2).
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const page = vi.hoisted(() => ({
  url: new URL('http://studio-alpha.lvh.me:3000/studio'),
}));

vi.mock('$app/state', () => ({ page }));

import OwnershipOfferBanner from './OwnershipOfferBanner.svelte';

const LIVE = {
  offerId: '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37',
  offeredByName: 'Alex Morgan',
  expiresAt: '2099-10-20T10:00:00.000Z',
};

let component: ReturnType<typeof mount> | null = null;

function mountBanner(offer: typeof LIVE | null, path = '/studio') {
  page.url = new URL(`http://studio-alpha.lvh.me:3000${path}`);
  component = mount(OwnershipOfferBanner, {
    target: document.body,
    props: { offer, orgName: 'Studio Alpha' },
  });
  flushSync();
}

const region = () => document.querySelector('[role="region"]');

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('OwnershipOfferBanner', () => {
  test('tells the recipient who offered, and by when to respond', () => {
    mountBanner(LIVE);

    expect(region()?.getAttribute('aria-label')).toBe(
      m.ownership_recipient_title()
    );
    expect(region()?.textContent).toContain(
      m.ownership_banner({
        name: 'Alex Morgan',
        orgName: 'Studio Alpha',
        date: formatDate(LIVE.expiresAt),
      })
    );
    const link = region()?.querySelector('a');
    expect(link?.textContent?.trim()).toBe(m.ownership_banner_cta());
    expect(link?.getAttribute('href')).toBe('/studio/settings#ownership');
  });

  test('shows on every studio page, e.g. a deep one', () => {
    mountBanner(LIVE, '/studio/content');
    expect(region()).toBeTruthy();
  });

  test('renders nothing without an offer', () => {
    mountBanner(null);
    expect(region()).toBeNull();
  });

  test('hides once the deadline has passed (expiry is lazy server-side)', () => {
    mountBanner({ ...LIVE, expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(region()).toBeNull();
  });

  test('hides on Settings, where the card shows the whole offer', () => {
    mountBanner(LIVE, '/studio/settings');
    expect(region()).toBeNull();
  });
});
