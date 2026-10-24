/**
 * The sales page for a disputed owner (Codex-2hxff.60): the owner's "no Buy
 * while disputed" plus "notice for courses too".
 *
 * Every Buy and Join slot on a kit page goes through `resolvePrimaryCta` or
 * `pricingView`. With the refused can-enter's `disputeHold` in the context,
 * the whole page must carry no link to the checkout, only the content page's
 * dispute notice and Contact support, and no floating buy bar. The same page
 * for a buyer is rendered first, so a checkout link the probe cannot see
 * would fail the test rather than pass it.
 */
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from './model/copy';
import { sampleContext, samplePage } from './model/sample';
import PageRenderer from './PageRenderer.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

/** Every section with a way in: hero, pricing, the closing ask, a join button. */
const page = samplePage('bold', ['hero', 'pricing', 'cta', 'button']);

async function render(
  disputeHold: 'purchase_dispute' | 'subscription_dispute' | null
) {
  app = mount(PageRenderer, {
    target: document.body,
    props: {
      page,
      context: { ...sampleContext({ offer: 'tiers' }), disputeHold },
      sticky: true,
    },
  });
  flushSync();
  await tick();
  await Promise.resolve();
  flushSync();
}

const checkoutLinks = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) =>
    a.getAttribute('href')?.includes('/checkout')
  );

describe('the sales page for a disputed owner', () => {
  it('a buyer sees checkout links (the probe can see them)', async () => {
    await render(null);
    expect(checkoutLinks().length).toBeGreaterThan(1);
    expect(document.querySelector('.lp-notice')).toBeNull();
  });

  it.each([
    ['purchase_dispute', COPY.cta.pausedPurchase],
    ['subscription_dispute', COPY.cta.pausedSubscription],
  ] as const)('a %s leaves no Buy or Join anywhere, only the notice', async (hold, line) => {
    await render(hold);

    expect(checkoutLinks()).toEqual([]);
    expect(document.querySelector('.lp-sticky')).toBeNull();

    const notices = [...document.querySelectorAll('.lp-notice')];
    expect(notices.length).toBeGreaterThan(1);
    for (const notice of notices) {
      expect(notice.querySelector('.lp-notice__heading')?.textContent).toBe(
        COPY.cta.pausedTitle
      );
      expect(notice.querySelector('.lp-notice__body')?.textContent).toBe(line);
    }

    const support = [
      ...document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'),
    ];
    expect(support.length).toBe(notices.length);
    for (const link of support) {
      expect(link.getAttribute('href')).toBe(
        'mailto:support@revelations.studio?subject=Access%20issue'
      );
      expect(link.textContent?.trim()).toBe(COPY.cta.contactSupport);
    }
  });
});
