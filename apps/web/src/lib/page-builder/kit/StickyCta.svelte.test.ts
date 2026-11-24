import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentDockBanner,
  DOCK_BANNER_PRIORITY,
} from '$lib/components/layout/DockBanner';
import { showing } from '$lib/components/player/now-playing.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext } from '../render/types';
import { COPY, priceWithCadence } from './model/copy';
import type { SectionTypeId } from './model/ids';
import { pricingView } from './model/offer';
import { sampleContext, samplePage } from './model/sample';
import { FakeObserver, install } from './motion/testing';
import PageRenderer from './PageRenderer.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/**
 * A page with observers that only report when told to, and a way to say
 * whether one of its sections is on screen.
 */
async function render(
  sections: SectionTypeId[],
  context: JourneySalesContext = sampleContext({ offer: 'tiers' })
) {
  install();
  app = mount(PageRenderer, {
    target: document.body,
    props: { page: samplePage('studio', sections), context },
  });
  flushSync();
  await tick();
  const page = document.body.querySelector('.lp-page');
  return (type: SectionTypeId, intersecting: boolean) => {
    const el = page?.querySelector(`[data-lp-type="${type}"]`);
    if (!el) throw new Error(`no ${type} section on the page`);
    for (const o of FakeObserver.all)
      o.report(el, { top: intersecting ? 300 : -900, intersecting });
    flushSync();
  };
}

describe('StickyCta', () => {
  it('offers the page’s way in to the dock’s banner once the opening has left the screen, and not before', async () => {
    const context = sampleContext({ offer: 'tiers' });
    const report = await render(['hero', 'problem', 'faq'], context);
    // Nothing is offered on a guess: the page has not been observed yet.
    expect(currentDockBanner()).toBeNull();

    report('hero', false);
    const featured = pricingView(context, {}).featured;
    expect(featured).toBeDefined();
    expect(currentDockBanner()).toMatchObject({
      priority: DOCK_BANNER_PRIORITY.pageCta,
      region: COPY.sticky.region,
      title: context.course.title,
      subtitle: priceWithCadence(featured!),
      action: {
        label: COPY.cta.buy,
        href: context.checkoutUrl,
        ariaLabel: undefined,
      },
    });

    // Back up to the opening: its own button is in view, so the offer goes.
    report('hero', true);
    expect(currentDockBanner()).toBeNull();
  });

  // A Button section is an ask with the page's own price (03 X64): the banner
  // must never show the same ask beside it, as for the offer and the closing ask.
  it.each([
    'pricing',
    'cta',
    'button',
  ] as const)('steps aside while a %s section is on screen', async (type) => {
    const report = await render(['hero', 'problem', type, 'faq']);
    report('hero', false);
    expect(currentDockBanner()?.region).toBe(COPY.sticky.region);
    report(type, true);
    expect(currentDockBanner()).toBeNull();
    report(type, false);
    expect(currentDockBanner()?.region).toBe(COPY.sticky.region);
  });

  // On a phone the banner would sit on the film's controls.
  it('steps aside while a film’s player is on screen', async () => {
    const report = await render(['hero', 'problem', 'faq']);
    report('hero', false);
    expect(currentDockBanner()).not.toBeNull();
    const player = document.createElement('div');
    try {
      showing(player, true);
      flushSync();
      expect(currentDockBanner()).toBeNull();
    } finally {
      showing(player, false);
      flushSync();
    }
    expect(currentDockBanner()).not.toBeNull();
  });

  it('offers a member the way back in, named with the course, and no price', async () => {
    const context = sampleContext({ offer: 'enrolled' });
    const report = await render(['hero', 'problem', 'faq'], context);
    report('hero', false);
    const banner = currentDockBanner();
    expect(banner?.subtitle).toBeUndefined();
    expect(banner?.action).toEqual({
      label: COPY.cta.continue,
      href: context.dashboardUrl,
      ariaLabel: `${COPY.cta.continue}: ${context.course.title}`,
    });
  });

  it('withdraws its offer when the page goes', async () => {
    const report = await render(['hero', 'problem', 'faq']);
    report('hero', false);
    expect(currentDockBanner()).not.toBeNull();
    if (app) unmount(app);
    app = null;
    flushSync();
    expect(currentDockBanner()).toBeNull();
  });

  it('offers nothing, and watches nothing, where the page has no way in', async () => {
    const report = await render(
      ['hero', 'problem', 'faq'],
      sampleContext({ offer: 'unavailable' })
    );
    expect(document.body.querySelector('.lp-cta-anchor')).toBeNull();
    report('hero', false);
    expect(currentDockBanner()).toBeNull();
  });
});
