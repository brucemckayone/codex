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
 *
 * And Buy is offered only when a purchase would open the item (Codex-2hxff.14):
 * `canBeSold`, not a price alone, decides it, on the page and in the preview.
 */

import { PRICE_LIMITS } from '@codex/constants';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
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
vi.mock('$lib/remote/checkout.remote', async () => {
  const { createFakeRemoteForm } = await import(
    '$tests/utils/fake-remote-form.svelte'
  );
  return { createCheckout: createFakeRemoteForm() };
});
vi.mock('$lib/components/VideoPlayer/hls', () => ({
  createHlsPlayer: vi.fn(async () => ({ hls: null, cleanup: () => {} })),
}));
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
    isPurchasable: false,
    courseOnly: false,
    includedInTierId: null,
    isFollowerGated: false,
    isTeamOnly: false,
    mediaItem: { id: 'm1', durationSeconds: 754, thumbnailUrl: null },
    ...overrides,
  } as unknown as Content;
}

/** Marked for sale at a price checkout accepts. */
const SELLABLE = { isPurchasable: true, priceCents: 900 };

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
    render({ content: makeContent(SELLABLE), hasAccess: false });
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

describe('Buy only when a purchase opens the item (Codex-2hxff.14)', () => {
  const buyGate = () => document.getElementById('purchase-label-buy');
  const purchaseForm = () => document.querySelector(`.${PURCHASE_FORM}`);

  test('a price the seller has not put on sale offers no Buy', () => {
    render({ content: makeContent({ priceCents: 900 }), hasAccess: false });
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
    expect(player().textContent).toContain('Access required');
    expect(player().textContent).not.toContain('Purchase to watch');
  });

  test('a price below the checkout minimum offers no Buy', () => {
    render({
      content: makeContent({
        ...SELLABLE,
        priceCents: PRICE_LIMITS.MIN_CENTS - 1,
      }),
      hasAccess: false,
    });
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
  });

  test('a priced course-only item shows the course note in place of Buy', () => {
    render({
      content: makeContent({ ...SELLABLE, courseOnly: true }),
      hasAccess: false,
    });
    const title = document.getElementById('purchase-label-course');
    const gate = title?.closest('section');
    // Same markup as the team-only note: a title and a line, no link.
    expect(gate).toHaveClass('content-detail__purchase');
    expect(title).toHaveClass('content-detail__price-amount');
    expect(title?.textContent).toBe('Part of a course');
    expect(
      gate?.querySelector('.content-detail__price-label')?.textContent
    ).toBe('This lesson is available to people enrolled in its course.');
    expect(gate?.querySelector('a, button, form')).toBeNull();
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
    expect(player().textContent).toContain('Part of a course');
    expect(bodyText()).not.toContain('Purchase to watch');
  });

  test('an enrolled viewer sees no course note', () => {
    render({
      content: makeContent({ ...SELLABLE, courseOnly: true }),
      hasAccess: true,
    });
    expect(document.getElementById('purchase-label-course')).toBeNull();
    expect(purchaseForm()).toBeNull();
  });

  test('team-only content keeps its note and offers no Buy', () => {
    render({
      content: makeContent({ ...SELLABLE, isTeamOnly: true }),
      hasAccess: false,
    });
    expect(document.getElementById('purchase-label-team')).not.toBeNull();
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
  });

  test('followers-only content keeps its follow gate and offers no Buy', () => {
    render({
      content: makeContent({ ...SELLABLE, isFollowerGated: true }),
      hasAccess: false,
    });
    expect(document.getElementById('purchase-label-followers')).not.toBeNull();
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
  });

  describe('beside a subscription', () => {
    const tierGated = { requiresSubscription: true, hasSubscription: false };

    test('tier content that is also on sale offers the purchase', () => {
      render({
        content: makeContent({ ...SELLABLE, includedInTierId: 'tier-1' }),
        hasAccess: false,
        ...tierGated,
      });
      expect(bodyText()).toContain('or purchase for');
      expect(purchaseForm()).not.toBeNull();
    });

    test('tier content with a price but not on sale offers no purchase', () => {
      render({
        content: makeContent({ priceCents: 900, includedInTierId: 'tier-1' }),
        hasAccess: false,
        ...tierGated,
      });
      expect(document.getElementById('purchase-label-sub')).not.toBeNull();
      expect(bodyText()).not.toContain('or purchase for');
      expect(purchaseForm()).toBeNull();
    });

    test('orgless tier content, which no purchase opens, offers no purchase', () => {
      render({
        content: makeContent({
          ...SELLABLE,
          organizationId: null,
          includedInTierId: 'tier-1',
        }),
        hasAccess: false,
        ...tierGated,
      });
      expect(bodyText()).not.toContain('or purchase for');
      expect(purchaseForm()).toBeNull();
    });
  });

  describe('in the preview player', () => {
    const PREVIEW_URL = 'https://cdn.example.test/c1/preview/master.m3u8';
    let playSpy: ReturnType<typeof vi.spyOn> | null = null;

    // The view autoplays the preview, and jsdom's play() returns nothing, so
    // the player's `.catch` throws and it renders its error state instead of
    // the video. Resolve it, so the overlay these tests read is really there.
    beforeEach(() => {
      playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockResolvedValue(undefined);
    });
    afterEach(() => {
      playSpy?.mockRestore();
      playSpy = null;
    });

    function withPreview(overrides: Record<string, unknown>): Content {
      return makeContent({
        mediaItem: {
          id: 'm1',
          durationSeconds: 754,
          thumbnailUrl: null,
          hlsPreviewUrl: PREVIEW_URL,
        },
        ...overrides,
      });
    }

    /** Let the player's async init settle, then play the clip to its end. */
    async function endPreview(): Promise<HTMLElement> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const video = document.querySelector('.preview-player video');
      if (!video) throw new Error('no preview video rendered');
      video.dispatchEvent(new Event('ended'));
      flushSync();
      const overlay = document.querySelector<HTMLElement>(
        '.preview-player__overlay'
      );
      if (!overlay) throw new Error('no preview overlay rendered');
      expect(overlay.textContent).toContain('Preview ended');
      return overlay;
    }

    test('sellable content is offered for sale when the preview ends', async () => {
      render({ content: withPreview(SELLABLE), hasAccess: false });
      const overlay = await endPreview();
      expect(overlay.querySelector('form')).not.toBeNull();
    });

    test.each([
      ['course-only', { courseOnly: true }],
      ['team-only', { isTeamOnly: true }],
      ['followers-only', { isFollowerGated: true }],
      ['not on sale', { isPurchasable: false }],
    ])('%s content is not offered for sale when the preview ends', async (_label, flags) => {
      render({
        content: withPreview({ ...SELLABLE, ...flags }),
        hasAccess: false,
      });
      const overlay = await endPreview();
      expect(overlay.querySelector('form')).toBeNull();
      expect(overlay.textContent).not.toContain('Purchase to Watch');
    });
  });
});

describe('withdrawn from sale, still the reader’s (Codex-ov2ii)', () => {
  const note = () => document.querySelector('[role="note"]');
  const buyGate = () => document.getElementById('purchase-label-buy');
  const purchaseForm = () => document.querySelector(`.${PURCHASE_FORM}`);

  test('a buyer is told it stays in their library, and sees Purchased', () => {
    render({
      content: makeContent(SELLABLE),
      hasAccess: true,
      withdrawnHeld: { by: 'purchase', until: null },
    });
    expect(note()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'This is no longer on sale. It stays in your library because you bought it.'
    );
    expect(bodyText()).toContain('Purchased');
  });

  test('a subscriber is told until when, and sees Included, never Purchased', () => {
    render({
      content: makeContent({ includedInTierId: 'tier-1' }),
      hasAccess: true,
      withdrawnHeld: { by: 'subscription', until: '2026-11-12T09:00:00.000Z' },
    });
    expect(note()?.textContent).toContain(
      "It's included in your subscription until 12 November"
    );
    expect(bodyText()).toContain('Included');
    expect(bodyText()).not.toContain('Purchased');
  });

  test('a course owner is told it stays in their course', () => {
    render({
      content: makeContent({ ...SELLABLE, courseOnly: true }),
      hasAccess: true,
      withdrawnHeld: { by: 'course', until: null },
    });
    expect(note()?.textContent).toContain(
      'It stays available as part of your course.'
    );
  });

  // An access refresh can come back denied after the page rendered (a refund
  // landing): the item is off sale, so the page must still offer nothing.
  test('offers no Buy even when access later reads denied', () => {
    render({
      content: makeContent(SELLABLE),
      hasAccess: false,
      withdrawnHeld: { by: 'purchase', until: null },
    });
    expect(buyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
  });

  test('an item on the storefront shows no note', () => {
    render({ content: makeContent(SELLABLE), hasAccess: true });
    expect(note()).toBeNull();
  });
});

// Stored text that failed to render used to leave a granted reader a page
// with no article and nothing said (Codex-uuz1g).
describe('a body that did not render', () => {
  const unavailable = () =>
    document.querySelector('.content-detail__body-unavailable');

  test('says it did not load, in the body’s place', () => {
    render({
      content: makeContent({ ...SELLABLE, contentType: 'written' }),
      hasAccess: true,
      contentBodyUnavailable: true,
    });
    expect(unavailable()?.textContent).toContain(
      "This text didn't load. Refresh the page to try again."
    );
  });

  test('a rendered body shows no such note', () => {
    render({
      content: makeContent({ ...SELLABLE, contentType: 'written' }),
      hasAccess: true,
      contentBodyHtml: '<p>The article.</p>',
      contentBodyUnavailable: false,
    });
    expect(unavailable()).toBeNull();
    expect(bodyText()).toContain('The article.');
  });
});

describe('paused by a payment dispute (Codex-2hxff.60)', () => {
  const anyGate = () => document.querySelector('.content-detail__purchase');
  const purchaseForm = () => document.querySelector(`.${PURCHASE_FORM}`);
  const subscribeButton = () =>
    document.querySelector('[data-testid="subscribe-button"]');
  const announcement = () =>
    document
      .querySelector('.content-detail__player-status')
      ?.textContent?.trim();

  test('a disputed buyer sees the notice in the player and no Buy below it', () => {
    render({
      content: makeContent(SELLABLE),
      hasAccess: false,
      revocationReason: 'purchase_dispute',
    });
    const overlay = player().querySelector('.access-revoked');
    expect(overlay?.getAttribute('data-reason')).toBe('purchase_dispute');
    expect(anyGate()).toBeNull();
    expect(purchaseForm()).toBeNull();
    expect(announcement()).toBe('Access paused.');
  });

  test('a disputed subscriber is offered no Subscribe, Upgrade or Buy', () => {
    render({
      content: makeContent({ ...SELLABLE, includedInTierId: 'tier-1' }),
      hasAccess: false,
      requiresSubscription: true,
      hasSubscription: false,
      revocationReason: 'subscription_dispute',
    });
    expect(
      player().querySelector('.access-revoked')?.getAttribute('data-reason')
    ).toBe('subscription_dispute');
    expect(anyGate()).toBeNull();
    expect(subscribeButton()).toBeNull();
    expect(purchaseForm()).toBeNull();
    expect(announcement()).toBe('Access paused.');
  });

  test.each([
    ['purchase_dispute', m.access_paused_dispute_purchase()],
    ['subscription_dispute', m.access_paused_dispute_subscription()],
  ] as const)('a written item, with no player, shows the %s notice in the gate slot', (reason, line) => {
    render({
      content: makeContent({
        ...SELLABLE,
        contentType: 'written',
        mediaItem: null,
      }),
      contentBodyHtml: '<p>The first paragraph of the article.</p>',
      hasAccess: false,
      revocationReason: reason,
    });
    const gate = document
      .getElementById('purchase-label-dispute')
      ?.closest('.content-detail__purchase');
    expect(gate?.textContent).toContain(m.access_paused_dispute_title());
    expect(gate?.textContent).toContain(line);
    const support = gate?.querySelector('a');
    expect(support?.textContent?.trim()).toBe(m.access_contact_support());
    expect(support?.getAttribute('href')).toBe(
      'mailto:support@revelations.studio?subject=Access%20issue'
    );
    // The dispute section is the only gate, and the body lock agrees with it.
    expect(document.querySelectorAll('.content-detail__purchase')).toHaveLength(
      1
    );
    expect(purchaseForm()).toBeNull();
    expect(
      document.querySelector('.content-detail__body-lock-text')?.textContent
    ).toBe(m.access_paused_dispute_title());
  });

  // Owner decision 2026-10-24: a course lesson keeps the notice while the
  // course purchase or the course subscription is disputed. The stream names
  // the dispute for a course-only item, and the notice must win over the
  // course note, which would otherwise say "Part of a course" to someone who
  // owns the course.
  describe('a course lesson', () => {
    const courseLesson = (overrides: Record<string, unknown> = {}) =>
      makeContent({ ...SELLABLE, courseOnly: true, ...overrides });
    const journeyLink = { title: 'Rootwork', salesHref: '/journeys/rootwork' };

    test.each([
      'purchase_dispute',
      'subscription_dispute',
    ] as const)('a video lesson under a %s shows the notice, not the course note', (reason) => {
      render({
        content: courseLesson(),
        hasAccess: false,
        revocationReason: reason,
        journeyLink,
      });
      expect(
        player().querySelector('.access-revoked')?.getAttribute('data-reason')
      ).toBe(reason);
      expect(player().textContent).not.toContain('Part of a course');
      expect(document.getElementById('purchase-label-course')).toBeNull();
      expect(anyGate()).toBeNull();
      expect(purchaseForm()).toBeNull();
      expect(subscribeButton()).toBeNull();
      expect(announcement()).toBe('Access paused.');
    });

    test.each([
      ['purchase_dispute', m.access_paused_dispute_purchase()],
      ['subscription_dispute', m.access_paused_dispute_subscription()],
    ] as const)('a written lesson under a %s shows the notice in the gate slot', (reason, line) => {
      render({
        content: courseLesson({ contentType: 'written', mediaItem: null }),
        contentBodyHtml: '<p>The first paragraph of the lesson.</p>',
        hasAccess: false,
        revocationReason: reason,
        journeyLink,
      });
      const gates = document.querySelectorAll('.content-detail__purchase');
      expect(gates).toHaveLength(1);
      expect(gates[0]?.textContent).toContain(line);
      expect(document.getElementById('purchase-label-course')).toBeNull();
      expect(purchaseForm()).toBeNull();
      expect(subscribeButton()).toBeNull();
      expect(
        document.querySelector('.content-detail__body-lock-text')?.textContent
      ).toBe(m.access_paused_dispute_title());
    });
  });
});

describe('checkout help (Codex-2hxff.60)', () => {
  test('the third failed checkout links to the platform support address', () => {
    render({
      content: makeContent(SELLABLE),
      hasAccess: false,
      formResult: { checkoutError: 'Your card was declined.', retryCount: 3 },
    });
    const link = document.querySelector<HTMLAnchorElement>(
      '.content-detail__purchase-error-escalation a'
    );
    expect(link?.getAttribute('href')).toBe(
      'mailto:support@revelations.studio?subject=Checkout%20help'
    );
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

  test("the audio card's picture is sized for the 12rem-tall card it covers, not only the column (Codex-kk9nv.3)", () => {
    // A 2.4:1 picture covering a card at least 12rem tall is drawn 28.8rem
    // wide on a phone, past the column; declared as the column it was 0.63x.
    const WIDE =
      'https://cdn.example.test/c1/thumbnail/2400x1000-0a1b2c3d/md.webp';
    render({
      content: makeContent({ contentType: 'audio', thumbnailUrl: WIDE }),
      hasAccess: false,
    });
    expect(
      document
        .querySelector('.content-detail__audio-locked-image')
        ?.getAttribute('sizes')
    ).toBe(
      '(min-width: 60rem) 58rem, (min-width: 30.8rem) calc(100vw - 2rem), 28.8rem'
    );
  });

  describe('the head preloads the file the page draws (Codex-kk9nv.3)', () => {
    const SIZED =
      'https://cdn.example.test/c1/thumbnail/2400x1000-0a1b2c3d/md.webp';
    const preload = () =>
      document.head.querySelector('link[rel="preload"][as="image"]');

    test("for the audio card: the card's own src, srcset and sizes, so it is fetched once", () => {
      render({
        content: makeContent({ contentType: 'audio', thumbnailUrl: SIZED }),
        hasAccess: false,
      });
      const img = document.querySelector('.content-detail__audio-locked-image');
      const link = preload();
      expect(img?.getAttribute('srcset')).toBeTruthy();
      expect(link?.getAttribute('href')).toBe(img?.getAttribute('src'));
      expect(link?.getAttribute('imagesrcset')).toBe(
        img?.getAttribute('srcset')
      );
      expect(link?.getAttribute('imagesizes')).toBe(img?.getAttribute('sizes'));
    });

    test('for a video: the one largest file its poster uses, with no srcset', () => {
      render({ content: makeContent({ thumbnailUrl: SIZED }) });
      expect(preload()?.getAttribute('href')).toBe(
        SIZED.replace('/md.webp', '/xl.webp')
      );
      expect(preload()?.hasAttribute('imagesrcset')).toBe(false);
    });

    test('for an audio page whose access is still loading: nothing, since either file may follow', () => {
      render({
        content: makeContent({ contentType: 'audio', thumbnailUrl: SIZED }),
        accessLoading: true,
      });
      expect(preload()).toBeNull();
    });
  });

  test('the structured data names the same file as og:image, not the one the page drew', () => {
    const SIZED =
      'https://cdn.example.test/c1/thumbnail/2400x1350-0a1b2c3d/md.webp';
    render({ content: makeContent({ thumbnailUrl: SIZED }) });
    const jsonLd = JSON.parse(
      document.head.querySelector('script[type="application/ld+json"]')
        ?.textContent ?? '{}'
    );
    expect(ogImage()).toBe(SIZED.replace('/md.webp', '/xl.webp'));
    expect(jsonLd.image).toBe(ogImage());
    expect(jsonLd.thumbnailUrl).toBe(ogImage());
  });
});
