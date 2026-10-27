/**
 * Creators checkout return — where the success page's links go.
 *
 * The player paywall now returns here (Codex-2hxff.22 WEB-03) with no
 * username or slug, and verify names neither. This host finds content by
 * username and slug only, and its `/` matches no route, so with no username
 * every link goes to the platform: Start Watching and Go to library to the
 * library, which lists the purchase; Continue Browsing and Start Over to
 * Discover. The detail page's own return carries both, and keeps its links.
 *
 * Mounts the real `+page.svelte`; `$app/navigation`, `$app/state` and the
 * collections are mocked.
 */

import type { CheckoutSessionVerifyResult } from '@codex/purchase';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(() => Promise.resolve()),
}));
vi.mock('$app/state', () => ({
  page: {
    url: new URL(
      'http://creators.lvh.me:3000/checkout/success?session_id=cs_1'
    ),
  },
}));
vi.mock('$lib/collections', () => ({
  invalidateCollection: vi.fn(() => Promise.resolve()),
}));

import CreatorCheckoutSuccess from '../+page.svelte';

const UNLOCKED: CheckoutSessionVerifyResult = {
  sessionStatus: 'complete',
  state: 'unlocked',
  amountTotalCents: 1500,
  purchase: {
    id: 'p1',
    contentId: 'c1',
    amountPaidCents: 1500,
    purchasedAt: '2026-10-22T10:00:00.000Z',
  },
  content: { id: 'c1', title: 'Rootwork', contentType: 'video' },
};
const EXPIRED: CheckoutSessionVerifyResult = {
  sessionStatus: 'expired',
  state: 'expired',
};

const PLATFORM_LIBRARY = 'http://lvh.me:3000/library';
const PLATFORM_DISCOVER = 'http://lvh.me:3000/discover';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(data: {
  verification: CheckoutSessionVerifyResult | null;
  verifyFailed?: boolean;
  username?: string | null;
  contentSlug?: string | null;
}) {
  component = mount(CreatorCheckoutSuccess, {
    target: document.body,
    props: {
      data: {
        verifyFailed: false,
        unlock: null,
        username: null,
        contentSlug: null,
        ...data,
      } as never,
    },
  });
  flushSync();
}

const clean = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
const hrefOf = (label: string) =>
  [...document.querySelectorAll('a')]
    .find((a) => clean(a) === label)
    ?.getAttribute('href');
const hrefs = () =>
  [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('creators checkout success — the paywall return (no username)', () => {
  test('unlocked: Start Watching goes to the platform library, never to /', () => {
    mountWith({ verification: UNLOCKED });

    expect(hrefOf(m.checkout_success_watch_now())).toBe(PLATFORM_LIBRARY);
    expect(hrefOf(m.checkout_success_browse())).toBe(PLATFORM_DISCOVER);
    expect(hrefs()).not.toContain('/');
  });

  test('expired: Start Over goes to Discover, never to /', () => {
    mountWith({ verification: EXPIRED });

    expect(hrefOf(m.checkout_success_start_over())).toBe(PLATFORM_DISCOVER);
    expect(hrefs()).not.toContain('/');
  });

  test('a lasting verify failure: Go to Library goes to the platform library', () => {
    mountWith({ verification: null, verifyFailed: true });

    expect(hrefOf(m.checkout_success_go_to_library())).toBe(PLATFORM_LIBRARY);
    expect(hrefs()).not.toContain('/');
  });
});

describe("creators checkout success — the detail page's return", () => {
  test('keeps its links to the creator and the piece', () => {
    mountWith({
      verification: UNLOCKED,
      username: 'ellie',
      contentSlug: 'rootwork',
    });

    expect(hrefOf(m.checkout_success_watch_now())).toBe(
      '/ellie/content/rootwork'
    );
    expect(hrefOf(m.checkout_success_browse())).toBe('/ellie/content');
  });

  test('with a username but no slug, Start Watching goes to the creator', () => {
    mountWith({ verification: UNLOCKED, username: 'ellie' });

    expect(hrefOf(m.checkout_success_watch_now())).toBe('/ellie/content');
  });
});
