/**
 * ContentDetailView — the media slot never claims a paywall it has no verdict
 * for (Codex-h3ipg).
 *
 * The view used to render the player only for `hasAccess && streamingUrl`, and
 * every other state fell to the lock, whose copy read "Purchase to watch" for
 * any signed-in viewer. So an owner, a buyer or a subscriber whose media was
 * still processing, or a free item with no media, saw a paywall. These tests
 * pin the three states apart:
 *   - access with nothing to play → a plain note, no lock, no purchase copy;
 *   - a FAILED check → "couldn't check your access", and no purchase gate;
 *   - a real lock → copy that names the real reason, purchase only when paid.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/content/morning-somatic-flow') },
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn() }));
vi.mock('$lib/remote/org.remote', () => ({ followOrganization: vi.fn() }));
vi.mock('$lib/remote/checkout.remote', () => ({}));
vi.mock('$lib/remote/subscription.remote', () => ({
  reactivateSubscription: vi.fn(),
}));
vi.mock('$lib/remote/account.remote', () => ({ openBillingPortal: vi.fn() }));
vi.mock('$lib/collections/progress', () => ({ updateLocalProgress: vi.fn() }));
vi.mock('$lib/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
// The view lazy-loads its player in an effect as soon as the content is video
// or audio. No test here plays anything, and the real modules pull in
// media-chrome and hls, a load slow enough on CI that the file ended with it
// still in flight and vitest failed the run on "Closing rpc while 'fetch' was
// pending". Stub them, and settle every dynamic import before teardown.
vi.mock('$lib/components/VideoPlayer/VideoPlayer.svelte', () => ({
  default: () => {},
}));
vi.mock('$lib/components/AudioPlayer', () => ({ AudioPlayer: () => {} }));

import ContentDetailView from './ContentDetailView.svelte';

type Props = Parameters<typeof ContentDetailView>[1];
type Content = Props['content'];

const PURCHASE_FORM = 'test-purchase-form';

function makeContent(overrides: Record<string, unknown> = {}): Content {
  return {
    id: 'c1',
    title: 'Morning Somatic Flow',
    slug: 'morning-somatic-flow',
    contentType: 'video',
    description: 'A gentle start.',
    organizationId: 'org-1',
    priceCents: 0,
    isFollowerGated: false,
    isTeamOnly: false,
    mediaItem: { id: 'm1', durationSeconds: 754, thumbnailUrl: null },
    ...overrides,
  } as unknown as Content;
}

let component: ReturnType<typeof mount> | null = null;

function render(props: Partial<Props> & { content: Content }) {
  component = mount(ContentDetailView, {
    target: document.body,
    props: {
      contentBodyHtml: null,
      hasAccess: false,
      streamingUrl: null,
      waveformUrl: null,
      progress: null,
      isAuthenticated: true,
      formResult: null,
      creatorName: 'Luzura',
      titleSuffix: 'Of Blood and Bones',
      purchaseForm: createRawSnippet(() => ({
        render: () => `<form class="${PURCHASE_FORM}"></form>`,
      })),
      ...props,
    } as Props,
  });
  flushSync();
}

function player(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.content-detail__player');
  if (!el) throw new Error('no player slot rendered');
  return el;
}

const bodyText = () => document.body.textContent ?? '';

afterEach(async () => {
  await vi.dynamicImportSettled();
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('access with nothing to play', () => {
  test('a granted video with no stream says it is not ready, never a paywall', () => {
    render({ content: makeContent(), hasAccess: true });
    expect(player().textContent).toContain(
      "This video isn't ready to play yet"
    );
    expect(
      player().querySelector('.content-detail__preview--unplayable')
    ).not.toBeNull();
    expect(player().querySelector('.content-detail__lock-icon')).toBeNull();
    expect(bodyText()).not.toContain('Purchase to watch');
  });

  test('a granted audio item gets the same note in its own card', () => {
    render({ content: makeContent({ contentType: 'audio' }), hasAccess: true });
    expect(player().textContent).toContain(
      "This audio isn't ready to play yet"
    );
    expect(
      player().querySelector('.content-detail__audio-locked--unplayable')
    ).not.toBeNull();
    expect(player().querySelector('.content-detail__lock-icon')).toBeNull();
    expect(bodyText()).not.toContain('Purchase to watch');
  });

  test('a paid item the viewer owns is not offered for sale again', () => {
    render({ content: makeContent({ priceCents: 900 }), hasAccess: true });
    expect(player().textContent).toContain(
      "This video isn't ready to play yet"
    );
    expect(document.querySelector(`.${PURCHASE_FORM}`)).toBeNull();
    expect(bodyText()).not.toContain('Purchase to watch');
  });

  test('public content whose check failed says it could not load', () => {
    render({
      content: makeContent(),
      hasAccess: true,
      accessCheckFailed: true,
    });
    expect(player().textContent).toContain("We couldn't load this video");
    expect(player().textContent).toContain('Refresh the page to try again.');
  });

  test('an anonymous visitor with media still gets the sign-in lock', () => {
    // A stream needs a session, so "not ready" would be wrong here.
    render({ content: makeContent(), hasAccess: true, isAuthenticated: false });
    expect(player().textContent).toContain('Sign in to watch');
    expect(
      player().querySelector('.content-detail__preview--unplayable')
    ).toBeNull();
  });

  test('an anonymous visitor on a free item with NO media is not asked to sign in', () => {
    render({
      content: makeContent({ mediaItem: null }),
      hasAccess: true,
      isAuthenticated: false,
    });
    expect(player().textContent).toContain(
      "This video isn't ready to play yet"
    );
    expect(player().textContent).not.toContain('Sign in to watch');
  });
});

describe('a failed access check', () => {
  test('names no paywall and offers no purchase', () => {
    render({
      content: makeContent({ priceCents: 900 }),
      hasAccess: false,
      accessCheckFailed: true,
    });
    expect(player().textContent).toContain("We couldn't check your access");
    expect(document.getElementById('purchase-label-check')).not.toBeNull();
    expect(document.getElementById('purchase-label-buy')).toBeNull();
    expect(document.querySelector(`.${PURCHASE_FORM}`)).toBeNull();
    expect(bodyText()).not.toContain('Purchase to watch');
  });
});

describe('a real lock names its real reason', () => {
  test('paid content still says purchase, with the purchase gate', () => {
    render({ content: makeContent({ priceCents: 900 }), hasAccess: false });
    expect(player().textContent).toContain('Purchase to watch');
    expect(document.getElementById('purchase-label-buy')).not.toBeNull();
    expect(document.querySelector(`.${PURCHASE_FORM}`)).not.toBeNull();
  });

  test('follower-gated content asks for a follow, not a purchase', () => {
    render({
      content: makeContent({ isFollowerGated: true }),
      hasAccess: false,
    });
    expect(player().textContent).toContain('Follow to unlock');
    expect(player().textContent).toContain('Follow to start watching.');
    expect(player().textContent).not.toContain('Purchase to watch');
  });

  test('team-only content says so', () => {
    render({ content: makeContent({ isTeamOnly: true }), hasAccess: false });
    expect(player().textContent).toContain('Team Only');
    expect(player().textContent).not.toContain('Purchase to watch');
  });

  test('tier-gated content asks for a subscription', () => {
    render({
      content: makeContent(),
      hasAccess: false,
      requiresSubscription: true,
      hasSubscription: false,
      subscriptionCoversContent: false,
    });
    expect(player().textContent).toContain('Subscribe to Watch');
    expect(player().textContent).not.toContain('Purchase to watch');
  });

  test('a free lock with no named reason says access is required', () => {
    // e.g. a course-only practice: there is nothing to buy on this page.
    render({ content: makeContent(), hasAccess: false });
    expect(player().textContent).toContain('Access required');
    expect(player().textContent).not.toContain('Purchase to watch');
  });
});

describe('the picture (Codex-une9r)', () => {
  const CUSTOM = 'https://cdn.example.test/c1/thumbnail/lg.webp';
  const POSTER = 'https://cdn.example.test/u1/media-thumbnails/m1/lg.webp';
  const ogImage = () =>
    document.head
      .querySelector('meta[property="og:image"]')
      ?.getAttribute('content');
  const imageSources = () =>
    [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));

  test('the creator’s custom thumbnail wins over the video poster, on the page and in og:image', () => {
    render({
      content: makeContent({
        thumbnailUrl: CUSTOM,
        mediaItem: { id: 'm1', durationSeconds: 754, thumbnailUrl: POSTER },
      }),
    });
    expect(ogImage()).toBe(CUSTOM);
    expect(imageSources()).toContain(CUSTOM);
    expect(imageSources()).not.toContain(POSTER);
  });

  test('the poster still shows when there is no custom thumbnail', () => {
    render({
      content: makeContent({
        thumbnailUrl: null,
        mediaItem: { id: 'm1', durationSeconds: 754, thumbnailUrl: POSTER },
      }),
    });
    expect(ogImage()).toBe(POSTER);
    expect(imageSources()).toContain(POSTER);
  });
});
