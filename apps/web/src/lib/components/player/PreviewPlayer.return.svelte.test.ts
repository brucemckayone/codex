/**
 * Where the paywall's Buy returns (Codex-2hxff.22). It names the piece the
 * way each detail page's own purchase form does, so the success page's Start
 * Watching opens it: the creators host finds a piece by username and slug only,
 * and the checkout's default return names neither. Off a detail page there is
 * no slug, and the default return stands.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { pageState } = vi.hoisted(() => ({
  pageState: {
    url: new URL('http://localhost/'),
    params: {} as Record<string, string>,
  },
}));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$lib/remote/checkout.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { createCheckout: createFakeRemoteForm() };
});
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));

import PreviewPlayer from './PreviewPlayer.svelte';

let component: ReturnType<typeof mount> | null = null;

async function renderOn(url: string, params: Record<string, string>) {
  pageState.url = new URL(url);
  pageState.params = params;
  component = mount(PreviewPlayer, {
    target: document.body,
    props: {
      previewUrl: 'https://cdn.example.test/c1/preview/master.m3u8',
      contentId: 'c1',
      contentTitle: 'Rootwork',
      accessState: { status: 'locked', reason: 'purchase_required' },
      canPurchase: true,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

const successUrlField = () =>
  document.querySelector<HTMLInputElement>(
    '.preview-player__overlay form input[name="successUrl"]'
  );
const cancelUrlField = () =>
  document.querySelector<HTMLInputElement>(
    '.preview-player__overlay form input[name="cancelUrl"]'
  );

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe("the paywall's Buy names the piece it returns to", () => {
  test('on the creators host: the slug and the creator, as the detail page sends', async () => {
    await renderOn('http://creators.lvh.me:3000/@ellie/content/rootwork', {
      username: '@ellie',
      contentSlug: 'rootwork',
    });

    expect(successUrlField()?.value).toBe(
      'http://creators.lvh.me:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=rootwork&username=%40ellie'
    );
  });

  test('on an org host: the slug, as the detail page sends', async () => {
    await renderOn('http://of-blood.lvh.me:3000/content/rootwork', {
      slug: 'of-blood',
      contentSlug: 'rootwork',
    });

    expect(successUrlField()?.value).toBe(
      'http://of-blood.lvh.me:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}&contentSlug=rootwork'
    );
  });

  test('off a detail page: no slug, so the default return stands', async () => {
    await renderOn('http://of-blood.lvh.me:3000/', { slug: 'of-blood' });

    expect(
      document.querySelector('.preview-player__overlay form')
    ).not.toBeNull();
    expect(successUrlField()).toBeNull();
  });
});

// Cancel at Stripe comes back to the page the buyer left (Codex-2hxff.78):
// the default, `/content/{id}`, matches no route on the creators host.
describe("the paywall's Buy cancels back to the page it is on", () => {
  test.each([
    [
      'on the creators host',
      'http://creators.lvh.me:3000/@ellie/content/rootwork',
      { username: '@ellie', contentSlug: 'rootwork' },
    ],
    [
      'on an org host',
      'http://of-blood.lvh.me:3000/content/rootwork',
      { slug: 'of-blood', contentSlug: 'rootwork' },
    ],
    ['off a detail page', 'http://of-blood.lvh.me:3000/', { slug: 'of-blood' }],
  ])('%s', async (_label, url, params) => {
    await renderOn(url, params);

    expect(cancelUrlField()?.value).toBe(url);
  });
});
