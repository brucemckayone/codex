import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { sampleContext, samplePage } from './model/sample';
import { FakeObserver, install } from './motion/testing';
import PageRenderer from './PageRenderer.svelte';
import StickyCta from './StickyCta.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('StickyCta', () => {
  // `PageRenderer` passes the Style's scheme, else `base`; the bar's own
  // default is the same, so a host that passes none draws the org's raised
  // card (owner, D9), never a dark band the org's site does not show.
  it('defaults to the base scheme, as PageRenderer does', () => {
    app = mount(StickyCta, {
      target: document.body,
      props: { context: sampleContext({ offer: 'tiers' }) },
    });
    flushSync();
    expect(
      document.body.querySelector('.lp-sticky')?.getAttribute('data-lp-scheme')
    ).toBe('base');
  });

  // A Button section is an ask with the page's own price (03 X64): the bar
  // must never show the same ask beside it.
  it('steps aside while a Button section is on screen, as for the offer and the closing ask', async () => {
    install();
    app = mount(PageRenderer, {
      target: document.body,
      props: {
        page: samplePage('studio', ['hero', 'problem', 'button', 'faq']),
        context: sampleContext({ offer: 'tiers' }),
      },
    });
    flushSync();
    await tick();
    const page = document.body.querySelector('.lp-page');
    const hero = page?.querySelector('[data-lp-type="hero"]');
    const ask = page?.querySelector('[data-lp-type="button"]');
    const bar = () => document.body.querySelector('.lp-sticky');
    const report = (el: Element | null | undefined, intersecting: boolean) => {
      for (const o of FakeObserver.all)
        if (el) o.report(el, { top: intersecting ? 300 : -900, intersecting });
      flushSync();
    };
    expect(hero && ask).toBeTruthy();
    // Past the hero, nothing to buy on screen: the bar shows.
    report(hero, false);
    expect(bar()?.hasAttribute('data-shown')).toBe(true);
    // The Button scrolls in: the bar yields to it.
    report(ask, true);
    expect(bar()?.hasAttribute('data-shown')).toBe(false);
    report(ask, false);
    expect(bar()?.hasAttribute('data-shown')).toBe(true);
  });
});
