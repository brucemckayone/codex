/**
 * The preview ends on the paywall's own words (Codex-2hxff.99; owner-approved
 * mockup locked-with-preview.html). Nothing covers the clip while it plays.
 * When it ends, the core swaps its controls for the end screen: "Preview
 * ended", the lock's own line, the paywall's first action (`end`, chosen by
 * `describePreviewEnd`), and Watch preview again, which is the core's own
 * replay.
 *
 * Buy is drawn only for a `buy` action, so no caller can bring it back by
 * leaving something out (Codex-2hxff.14). Which action each gate gets is
 * pinned in `preview-end.test.ts`; the end screen as the content page mounts
 * it, in `ContentDetailView.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { collectionState } = vi.hoisted(() => ({
  collectionState: new Map<string, unknown>(),
}));

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/content/winter-light') },
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
// The plan action is the paywall's own SubscribeButton, which reads the
// member's row from the subscription collection.
vi.mock('$lib/collections', () => ({
  subscriptionCollection: { state: collectionState, update: vi.fn() },
  invalidateCollection: vi.fn(),
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));

import PreviewPlayer from './PreviewPlayer.svelte';
import type { PreviewEnd } from './preview-end';

const PRICING = '/pricing?for=winter-light&returnTo=%2Fcontent%2Fwinter-light';
const LINE = 'Included with Pro and above.';

const BUY: PreviewEnd = {
  line: 'Buy it once, watch it any time.',
  action: { kind: 'buy', label: 'Purchase for £4.99' },
  signIn: null,
};

let component: ReturnType<typeof mount> | null = null;
let playSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  collectionState.clear();
  // jsdom's play() returns nothing; Watch preview again plays.
  playSpy = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockResolvedValue(undefined);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  playSpy?.mockRestore();
  playSpy = null;
  document.body.innerHTML = '';
});

async function render(
  end: PreviewEnd,
  follow?: { following: boolean; busy: boolean; onfollow: () => void },
  audio = false
) {
  component = mount(PreviewPlayer, {
    target: document.body,
    props: {
      previewUrl: 'https://cdn.example.test/c1/preview/master.m3u8',
      contentId: 'c1',
      contentTitle: 'Winter Light',
      end,
      follow,
      audio,
    },
  });
  // Let the async HLS init settle, so a failure there (which swaps the whole
  // video container for an error) would show up as a missing end screen.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

const video = () => {
  const el = document.querySelector<HTMLVideoElement>('.preview-player video');
  if (!el) throw new Error('no preview video rendered');
  return el;
};
const endScreen = () =>
  document.querySelector<HTMLElement>('[data-testid="preview-end"]');

/** Play the clip to its end, then let the focus move. */
async function endClip(): Promise<HTMLElement> {
  video().dispatchEvent(new Event('ended'));
  flushSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  const el = endScreen();
  if (!el) throw new Error('no end screen rendered');
  return el;
}

const replayButton = (el: HTMLElement) => {
  const button = [...el.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(m.player_preview_watch_again())
  );
  if (!button) throw new Error('no Watch preview again');
  return button;
};
/** The end's own announcement; the core has its own live line inside. */
const liveLine = () =>
  document
    .querySelector('.preview-player > [aria-live="polite"]')
    ?.textContent?.trim();

describe('while the clip plays', () => {
  test('nothing covers it, and nothing is announced', async () => {
    await render(BUY);
    expect(endScreen()).toBeNull();
    expect(document.querySelector('.preview-player form')).toBeNull();
    expect(liveLine()).toBe('');
  });
});

describe('when it ends', () => {
  test('Preview ended names the group, the lock’s line follows, and it is announced', async () => {
    await render(BUY);
    const el = await endClip();
    const title = el.querySelector('.preview-player__cta-title');
    expect(title?.textContent).toBe(m.player_preview_ended());
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(
      el.querySelector('.preview-player__cta-description')?.textContent
    ).toBe('Buy it once, watch it any time.');
    expect(liveLine()).toBe(m.player_preview_ended());
  });

  test('with no line yet (the plan names loading), no line is drawn', async () => {
    await render({ ...BUY, line: null });
    const el = await endClip();
    expect(el.querySelector('.preview-player__cta-description')).toBeNull();
  });

  test('buy: the checkout form, the price on its button', async () => {
    await render(BUY);
    const el = await endClip();
    expect(el.dataset.action).toBe('buy');
    expect(
      el.querySelector('form input[name="contentId"]')?.getAttribute('value')
    ).toBe('c1');
    expect(
      el.querySelector('form button[type="submit"]')?.textContent?.trim()
    ).toBe('Purchase for £4.99');
  });

  test('link: the paywall’s link, and Sign in beside Watch again', async () => {
    await render({
      line: LINE,
      action: {
        kind: 'link',
        href: PRICING,
        label: m.subscribe_cta_see_plans(),
      },
      signIn: {
        href: '/login?redirect=%2Fcontent%2Fwinter-light',
        label: m.auth_signin_link(),
      },
    });
    const el = await endClip();
    const cta = el.querySelector('a.preview-player__cta-button');
    expect(cta?.getAttribute('href')).toBe(PRICING);
    expect(cta?.textContent?.trim()).toBe('See plans');
    const signIn = el.querySelector('.preview-player__cta-more a');
    expect(signIn?.textContent?.trim()).toBe('Sign in');
    expect(signIn?.getAttribute('href')).toBe(
      '/login?redirect=%2Fcontent%2Fwinter-light'
    );
    expect(el.querySelector('form')).toBeNull();
  });

  test('none: no button and no form, only Watch preview again', async () => {
    await render({
      line: 'Not available right now.',
      action: { kind: 'none' },
      signIn: null,
    });
    const el = await endClip();
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('.preview-player__cta-button')).toBeNull();
    expect(el.querySelector('[data-testid="subscribe-button"]')).toBeNull();
    expect([...el.querySelectorAll('a, button')]).toEqual([replayButton(el)]);
  });
});

describe('a plan: the paywall’s own button, Manage plan left in the paywall', () => {
  const plan = (upgradeRequired: boolean, changePlan: boolean): PreviewEnd => ({
    line: LINE,
    action: {
      kind: 'plan',
      organizationId: 'org-1',
      subscribeHref: PRICING,
      upgradeRequired,
      changePlan,
    },
    signIn: null,
  });
  const seed = (status: string) =>
    collectionState.set('org-1', {
      organizationId: 'org-1',
      tier: { id: 'tier-basic', name: 'Basic', sortOrder: 1 },
      status,
      currentPeriodEnd: '2026-11-12T09:00:00.000Z',
      cancelAtPeriodEnd: false,
    });

  test('no plan: Subscribe, to pricing with the item marked', async () => {
    await render(plan(false, true));
    const el = await endClip();
    expect(el.dataset.action).toBe('plan');
    const subscribe = el.querySelector(
      '[data-testid="subscribe-button-subscribe"]'
    );
    expect(subscribe?.getAttribute('href')).toBe(PRICING);
    expect(subscribe?.textContent?.trim()).toBe(m.pricing_subscribe());
  });

  test.each([
    [
      'every including plan dearer: Upgrade to Watch',
      false,
      m.upgrade_cta_title(),
    ],
    [
      'a cheaper one includes it: Change Plan',
      true,
      m.subscription_change_tier(),
    ],
  ])('%s, and no Manage plan', async (_label, changePlan, words) => {
    seed('active');
    await render(plan(true, changePlan));
    const el = await endClip();
    const cta = el.querySelector('[data-testid="subscribe-button-upgrade"]');
    expect(cta?.getAttribute('href')).toBe(PRICING);
    expect(cta?.textContent?.trim()).toBe(words);
    expect(
      el.querySelector('[data-testid="subscribe-button-manage"]')
    ).toBeNull();
  });

  test('a member’s own first step is kept, without Manage plan or the badge', async () => {
    seed('past_due');
    await render(plan(true, true));
    const el = await endClip();
    expect(
      el.querySelector('[data-testid="subscribe-button-update-payment"]')
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="subscribe-button-manage"]')
    ).toBeNull();
    expect(el.textContent).not.toContain('Payment failed');
  });
});

describe('followers only', () => {
  test('Follow, the page’s own handler', async () => {
    const onfollow = vi.fn();
    await render(
      { line: LINE, action: { kind: 'follow' }, signIn: null },
      { following: false, busy: false, onfollow }
    );
    const el = await endClip();
    const button = el.querySelector<HTMLButtonElement>(
      'button.preview-player__cta-button'
    );
    expect(button?.textContent?.trim()).toBe(m.org_follow());
    button?.click();
    expect(onfollow).toHaveBeenCalledOnce();
  });

  test('already following: Following, and it can’t be pressed again', async () => {
    await render(
      { line: LINE, action: { kind: 'follow' }, signIn: null },
      { following: true, busy: false, onfollow: vi.fn() }
    );
    const el = await endClip();
    const button = el.querySelector<HTMLButtonElement>(
      'button.preview-player__cta-button'
    );
    expect(button?.textContent?.trim()).toBe(m.org_following());
    expect(button?.disabled).toBe(true);
  });
});

describe('the replay’s words (C2-W4)', () => {
  test('video: Watch preview again', async () => {
    await render(BUY);
    const el = await endClip();
    expect(replayButton(el).textContent?.trim()).toBe('Watch preview again');
  });

  test('audio: Listen to preview again, the owner’s words', async () => {
    await render(BUY, undefined, true);
    const el = await endClip();
    const listen = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === m.player_preview_listen_again()
    );
    expect(listen?.textContent?.trim()).toBe('Listen to preview again');
    expect(el.textContent).not.toContain('Watch preview again');
  });
});

describe('Watch preview again', () => {
  test('starts the clip over and gives focus to the play button', async () => {
    await render(BUY);
    const el = await endClip();
    playSpy?.mockClear();
    video().currentTime = 12;
    replayButton(el).click();
    flushSync();

    expect(endScreen()).toBeNull();
    expect(video().currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(
      document.querySelector('.player__play')
    );
    expect(liveLine()).toBe('');
  });
});

describe('focus as it ends', () => {
  test('on the controls: moves to the first action, since they have gone', async () => {
    await render(BUY);
    document.querySelector<HTMLElement>('.player__play')?.focus();
    expect(document.activeElement?.classList.contains('player__play')).toBe(
      true
    );
    const el = await endClip();
    expect(document.activeElement).toBe(
      el.querySelector('form button[type="submit"]')
    );
  });

  test('anywhere else: stays where it is', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await render(BUY);
    outside.focus();
    await endClip();
    expect(document.activeElement).toBe(outside);
  });
});
