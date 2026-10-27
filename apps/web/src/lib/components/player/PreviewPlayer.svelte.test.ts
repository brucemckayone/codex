/**
 * PreviewPlayer offers its Buy form only when a purchase would open the
 * content (Codex-2hxff.14). The caller decides with `canBeSold` and passes
 * `canPurchase`; the sign-in and subscription prompts are untouched by it.
 *
 * The ended-preview path, as the content page mounts it, is pinned in
 * `ContentDetailView.svelte.test.ts`.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/content/morning-somatic-flow') },
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

import type { AccessState } from './access-state';
import PreviewPlayer from './PreviewPlayer.svelte';

const PURCHASE_LOCK: AccessState = {
  status: 'locked',
  reason: 'purchase_required',
};

let component: ReturnType<typeof mount> | null = null;

async function render(props: {
  canPurchase: boolean;
  accessState?: AccessState;
}) {
  component = mount(PreviewPlayer, {
    target: document.body,
    props: {
      previewUrl: 'https://cdn.example.test/c1/preview/master.m3u8',
      contentId: 'c1',
      contentTitle: 'Morning Somatic Flow',
      accessState: PURCHASE_LOCK,
      ...props,
    },
  });
  // Let the async HLS init settle, so a failure there (which swaps the whole
  // video container for an error) would show up as a missing overlay.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function overlay(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.preview-player__overlay');
  if (!el) throw new Error('no CTA overlay rendered');
  return el;
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('the Buy form follows canPurchase', () => {
  test('shown when a purchase would open the content', async () => {
    await render({ canPurchase: true });
    expect(overlay().querySelector('form')).not.toBeNull();
    expect(overlay().textContent).toContain('Purchase to Watch');
  });

  test('absent when it would not, leaving the access line', async () => {
    await render({ canPurchase: false });
    expect(overlay().querySelector('form')).toBeNull();
    expect(overlay().textContent).not.toContain('Purchase to Watch');
    expect(overlay().textContent).toContain('Get full access to this content');
  });

  test('the sign-in prompt does not depend on it', async () => {
    await render({
      canPurchase: false,
      accessState: { status: 'locked', reason: 'auth_required' },
    });
    expect(overlay().querySelector('a[href^="/login"]')).not.toBeNull();
    expect(overlay().querySelector('form')).toBeNull();
  });
});
