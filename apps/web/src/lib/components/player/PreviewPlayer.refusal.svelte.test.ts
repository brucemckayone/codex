/**
 * A refused Buy on the paywall says so (review M7). The button used to flip
 * back from "Loading" and nothing else happened. Now a plain line, never the
 * worker's message (the pricing page's rule, Codex-2hxff.69):
 * - already owned: "You already own this", with Reload;
 * - no answer, a server error, a timeout or too many requests: "Please try
 *   again", where the Buy button is the retry;
 * - any other refusal: plainly, with no "try again".
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { FakeRemoteForm } from '$tests/utils/fake-remote-form.svelte';

const { PAGE } = vi.hoisted(() => ({
  PAGE: 'http://creators.lvh.me:3000/@ellie/content/rootwork',
}));
vi.mock('$app/state', () => ({
  page: {
    url: new URL(PAGE),
    params: { username: '@ellie', contentSlug: 'rootwork' },
  },
}));
vi.mock('$lib/remote/checkout.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { createCheckout: createFakeRemoteForm() };
});
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));

import { createCheckout } from '$lib/remote/checkout.remote';
import PreviewPlayer from './PreviewPlayer.svelte';

const form = createCheckout as unknown as FakeRemoteForm;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  form.__reset();
});

async function buyAndGet(result: Record<string, unknown>) {
  form.__reset({ respond: () => ({ result }) });
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
  expect(alert()).toBeNull();
  document
    .querySelector('.preview-player__overlay form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

const alert = () => document.querySelector('[role="alert"]');
const clean = (el: Element | null) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe("the paywall's Buy, refused", () => {
  test('already owned: says so, with Reload to this page', async () => {
    await buyAndGet({
      success: false,
      error: 'Content already purchased',
      status: 409,
      code: 'ALREADY_PURCHASED',
    });

    expect(clean(alert())).toBe(
      `${m.checkout_refusal_owned()} ${m.checkout_refusal_reload()}`
    );
    expect(alert()?.querySelector('a')?.getAttribute('href')).toBe(PAGE);
    expect(clean(alert())).not.toContain('Content already purchased');
  });

  test.each([
    ['no answer', undefined],
    ['a server error', 503],
    ['too many requests', 429],
  ])('%s: fixed copy, and the Buy button is the retry', async (_label, status) => {
    await buyAndGet({ success: false, error: 'internal detail', status });

    expect(clean(alert())).toBe(m.checkout_refusal_problem());
    expect(
      document.querySelector('.preview-player__overlay form button')
    ).not.toBeNull();
  });

  test('any other refusal: plainly, with no "try again" and never the worker\'s text', async () => {
    await buyAndGet({
      success: false,
      error: 'successUrl: Invalid redirect URL',
      status: 400,
      code: 'VALIDATION_ERROR',
    });

    expect(clean(alert())).toBe(m.checkout_refusal_refused());
    expect(clean(alert())).not.toMatch(/try again|Invalid redirect/i);
  });

  test('a Buy that goes through shows nothing', async () => {
    await buyAndGet({ success: true });

    expect(alert()).toBeNull();
  });
});
