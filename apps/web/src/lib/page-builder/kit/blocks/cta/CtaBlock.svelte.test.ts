import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import CtaBlock from './CtaBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(
  props: Record<string, unknown>,
  layout: string,
  offer: SampleOfferState = 'buy',
  edit: BlockEdit | null = null,
  mediaBaseUrl: string | null = null
) {
  const section: ResolvedSection = {
    id: 'cta-1',
    anchor: 'cta',
    type: 'cta',
    index: 9,
    layout,
    scheme: 'brand',
    spacing: 'regular',
    headingLevel: 2,
  };
  app = mount(CtaBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({ offer, mediaBaseUrl }),
      edit,
    },
  });
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
const link = (label: string) =>
  [...document.body.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === label
  );

describe('CtaBlock', () => {
  it.each(
    SECTION_LAYOUTS.cta
  )('%s: an invitation with a way in', async (layout) => {
    await render(
      { heading: 'Begin this week', body: 'The first practice is waiting.' },
      layout
    );
    expect(document.body.querySelector('h2')?.textContent).toBe(
      'Begin this week'
    );
    expect(text()).toContain('The first practice is waiting.');
    // The one offer it prices, pre-selected at the checkout.
    expect(link(COPY.cta.buy)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout?offer=purchase'
    );
  });

  it.each(
    SECTION_LAYOUTS.cta
  )('%s: prices itself from the live offer only', async (layout) => {
    await render({ heading: 'Join' }, layout, 'tiers');
    expect(text()).toContain('£15 per month');
    unmount(app);
    await render({ heading: 'Join' }, layout, 'unknown');
    expect(text()).not.toMatch(/£/);
    expect(link(COPY.cta.buy)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
  });

  it.each(
    SECTION_LAYOUTS.cta
  )('%s: "Continue" for a member, a notice when closed', async (layout) => {
    const note = 'Start whenever you like.';
    await render(
      { heading: 'Join', ctaLabel: 'Buy it', note },
      layout,
      'enrolled'
    );
    expect(link(COPY.cta.continue)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/dashboard'
    );
    // Sales words have no place when there is nothing to buy.
    expect(text()).not.toContain(note);
    expect(text()).not.toMatch(/£/);
    unmount(app);
    await render(
      { heading: 'Join', ctaLabel: 'Buy it', note },
      layout,
      'unavailable'
    );
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(link('Buy it')).toBeUndefined();
    expect(text()).not.toContain(note);
  });

  it('renders only its own words', async () => {
    await render({}, 'band');
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text()).not.toContain(sampleContext().course.title);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'Join' }, 'band');
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render({ heading: 'Join' }, 'band', 'buy', { commit: () => {} });
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Call to action — Heading'
    );
  });

  describe('the band background image (contract A5)', () => {
    const CDN = 'https://cdn.test';
    const background = { key: 'landing-pages/p1/images/bg' };
    const root = () => document.body.querySelector('.cta');

    it('fills the band on the media ink set, decorative unless described', async () => {
      await render({ heading: 'Join', background }, 'band', 'buy', null, CDN);
      const img = document.body.querySelector('img');
      expect(img?.getAttribute('src')).toBe(`${CDN}/${background.key}/lg.webp`);
      expect(img?.getAttribute('alt')).toBe('');
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(true);
      expect(document.body.querySelector('.cta__atmos')).toBeNull();
      expect(link(COPY.cta.buy)).toBeDefined();
    });

    it.each(['split', 'compact'])('%s ignores it', async (layout) => {
      await render({ heading: 'Join', background }, layout, 'buy', null, CDN);
      expect(document.body.querySelector('img')).toBeNull();
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(false);
    });

    it('without a CDN base, draws the band exactly as without an image', async () => {
      await render({ heading: 'Join', background }, 'band');
      expect(document.body.querySelector('img')).toBeNull();
      expect(root()?.hasAttribute('data-lp-on-media')).toBe(false);
      expect(document.body.querySelector('.cta__atmos')).not.toBeNull();
    });
  });
});

/**
 * The smallest box that holds this price and a way to buy it: the offer as a
 * visitor reads it. No class names, so it finds the same box in any markup.
 */
function offerUnit(price: string): Element | null {
  const leaf = [...document.body.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && el.textContent?.includes(price)
  );
  for (
    let el = leaf?.parentElement;
    el && el !== document.body;
    el = el.parentElement
  ) {
    if (el.querySelector('a[href*="/checkout"]')) return el;
  }
  return null;
}

// Codex-61zsk.38: split printed "£15 per month" over the creator's "One payment,
// no deadline to finish."; band and compact never showed a price at all.
describe('CtaBlock — the button travels with the offer it sells', () => {
  const NOTE = 'One payment, no deadline to finish.';
  // The featured offer moves from the one-off to the membership.
  const FEATURED = {
    buy: {
      price: '£49',
      cadence: 'one-off',
      print: 'Pay once and keep it for good.',
      href: '/journeys/steady-ground/checkout?offer=purchase',
    },
    tiers: {
      price: '£15',
      cadence: 'per month',
      print: 'Billed monthly as part of Studio membership.',
      href: '/journeys/steady-ground/checkout?offer=tier%3Astudio',
    },
  } as const;

  it.each(
    SECTION_LAYOUTS.cta
  )('%s: the featured price, its period and its own billing line sit with the button', async (layout) => {
    for (const offer of ['buy', 'tiers'] as const) {
      await render(
        { heading: 'Join', body: 'The first practice is waiting.', note: NOTE },
        layout,
        offer
      );
      const { price, cadence, print, href } = FEATURED[offer];
      const other = FEATURED[offer === 'buy' ? 'tiers' : 'buy'].print;
      const unit = offerUnit(price);
      expect(
        unit,
        `${layout} · ${offer}: ${price} beside its button`
      ).not.toBeNull();
      expect(unit?.textContent).toMatch(new RegExp(`${price}\\s*${cadence}`));
      expect(unit?.textContent).toContain(print);
      expect(unit?.textContent).not.toContain(other);
      expect(unit?.textContent).not.toContain(NOTE);
      expect(
        unit?.querySelector('a[href*="/checkout"]')?.getAttribute('href')
      ).toBe(href);
      // The creator's words: in the heading's own box, and only once.
      expect(
        document.body.querySelector('h2')?.parentElement?.textContent
      ).toContain(NOTE);
      expect(text().split(NOTE)).toHaveLength(2);
      unmount(app);
      app = null;
    }
  });

  it('names the offer the button buys, for a listener', async () => {
    await render({ heading: 'Join' }, 'band', 'tiers');
    expect(link(COPY.cta.buy)?.getAttribute('aria-label')).toBe(
      `${COPY.cta.buy}, Studio membership`
    );
  });

  it('keeps the note in the words when the offer could not be read', async () => {
    await render({ heading: 'Join', note: NOTE }, 'split', 'unknown');
    expect(
      document.body.querySelector('h2')?.parentElement?.textContent
    ).toContain(NOTE);
    expect(text().split(NOTE)).toHaveLength(2);
  });

  it('lets the canvas edit the note in the words, never the kit’s billing line', async () => {
    await render({ heading: 'Join', note: NOTE }, 'split', 'tiers', {
      commit: () => {},
    });
    const notes = [...document.body.querySelectorAll('[data-field="note"]')];
    expect(notes.map((el) => el.textContent?.trim())).toEqual([NOTE]);
    expect(offerUnit('£15')?.querySelector('[data-field="note"]')).toBeNull();
    expect(
      document.body.querySelectorAll('[data-field="ctaLabel"]')
    ).toHaveLength(1);
  });
});
