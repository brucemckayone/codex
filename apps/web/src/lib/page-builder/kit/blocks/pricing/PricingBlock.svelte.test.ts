import { join } from 'node:path';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { builderSalesContext } from '../../../render/builder-context';
import type { JourneySalesContext } from '../../../render/types';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { componentRules } from '../testing';
import { PRICING_COPY } from './copy';
import { PRICING_NO_WAY_IN } from './definition';
import PricingBlock from './PricingBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function section(layout: string): ResolvedSection {
  return {
    id: 'pricing-1',
    anchor: 'pricing',
    type: 'pricing',
    index: 3,
    layout,
    scheme: 'base',
    spacing: 'regular',
    headingLevel: 2,
  };
}

async function render(
  props: Record<string, unknown>,
  layout: string,
  offer: SampleOfferState,
  edit: BlockEdit | null = null
) {
  await renderWith(props, layout, sampleContext({ offer }), edit);
}

async function renderWith(
  props: Record<string, unknown>,
  layout: string,
  context: JourneySalesContext,
  edit: BlockEdit | null = null
) {
  app = mount(PricingBlock, {
    target: document.body,
    props: { props, section: section(layout), context, edit },
  });
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
const prices = () => [...text().matchAll(/£\d+(?:\.\d\d)?/g)].map((m) => m[0]);
const hrefs = () =>
  [...document.body.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('PricingBlock — priced only from the live offer', () => {
  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: shows each real path at the amount it charges', async (layout) => {
    await render({ heading: 'Choose how you join' }, layout, 'tiers');
    expect(document.body.querySelector('h2')?.textContent).toBe(
      'Choose how you join'
    );
    // purchase £49, Studio membership £15 (recommended), Inner circle £35.
    expect(new Set(prices())).toEqual(new Set(['£49', '£15', '£35']));
  });

  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: never invents a price when the offer could not be read', async (layout) => {
    await render({ heading: 'Join' }, layout, 'unknown');
    expect(prices()).toEqual([]);
    expect(hrefs()).toContain('/journeys/steady-ground/checkout');
    expect(text()).toContain(COPY.pricing.atCheckout);
  });

  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: says enrolment is closed, with no price and no checkout', async (layout) => {
    await render({ heading: 'Join', ctaLabel: 'Buy' }, layout, 'unavailable');
    expect(prices()).toEqual([]);
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(hrefs().some((href) => href?.includes('checkout'))).toBe(false);
  });

  // The canvas pins `purchasable` true for the hero's button, and drew a
  // course with no way in as "you will see the price before you pay", the
  // failed-read state (Codex-36vjw). It now draws what visitors see, plus the
  // creator's next step, which the public page never shows.
  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: on the canvas, a course with no way in reads as visitors see it, with the next step', async (layout) => {
    const { course, offer } = sampleContext({ offer: 'unavailable' });
    const canvas = builderSalesContext({ course, offer });
    expect(canvas.purchasable).toBe(true);

    await renderWith({ heading: 'Join', ctaLabel: 'Buy' }, layout, canvas, {
      commit: () => {},
    });
    expect(prices()).toEqual([]);
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(text()).not.toContain(COPY.pricing.atCheckout);
    expect(hrefs().some((href) => href?.includes('checkout'))).toBe(false);
    const hint = document.body.querySelector('[data-lp-edit-only]');
    expect(hint?.textContent).toBe(PRICING_NO_WAY_IN);
  });

  it('never shows the canvas’s next step on the public page', async () => {
    await render({ heading: 'Join' }, 'cards', 'unavailable');
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(text()).not.toContain(PRICING_NO_WAY_IN);
  });

  it('keeps an UNREAD offer price-less on the canvas, not closed', async () => {
    const { course, checkoutUrl } = sampleContext({ offer: 'unknown' });
    const canvas = builderSalesContext({ course, offer: null, checkoutUrl });

    await renderWith({ heading: 'Join' }, 'cards', canvas, {
      commit: () => {},
    });
    expect(text()).toContain(COPY.pricing.atCheckout);
    expect(text()).not.toContain(COPY.cta.unavailableTitle);
    expect(hrefs()).toContain('/journeys/steady-ground/checkout');
  });

  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: gives a member a way back in instead of prices', async (layout) => {
    await render({ heading: 'Join' }, layout, 'enrolled');
    expect(prices()).toEqual([]);
    expect(text()).toContain(COPY.pricing.enrolledTitle);
    expect(hrefs()).toContain('/journeys/steady-ground/dashboard');
  });

  it('deep-links every card to exactly its own path', async () => {
    await render({}, 'cards', 'tiers');
    expect(hrefs()).toEqual(
      expect.arrayContaining([
        '/journeys/steady-ground/checkout?offer=purchase',
        '/journeys/steady-ground/checkout?offer=tier%3Astudio',
        '/journeys/steady-ground/checkout?offer=tier%3Acircle',
      ])
    );
  });

  it('lets authored copy rename a real path, and never create one', async () => {
    await render(
      {
        offers: [
          { id: 'purchase', name: 'Keep it forever' },
          { id: 'subscription-monthly', name: 'A path that does not exist' },
        ],
      },
      'cards',
      'buy'
    );
    expect(text()).toContain('Keep it forever');
    expect(text()).not.toContain('A path that does not exist');
    expect(prices()).toEqual(['£49']);
  });

  it('never tells a one-off buyer they can cancel', async () => {
    for (const layout of SECTION_LAYOUTS.pricing) {
      await render({}, layout, 'buy');
      expect(text()).not.toMatch(/cancel anytime/i);
      unmount(app);
      app = null;
    }
  });

  it('bills each price by its own offer, whatever the note says', async () => {
    await render({}, 'focus', 'sub');
    expect(text()).toContain('Billed monthly.');
    unmount(app);
    await render({ note: 'Try it for a week.' }, 'focus', 'sub');
    expect(text()).toContain('Try it for a week.');
    expect(text()).toContain('Billed monthly.');
  });

  it('recommends only when there is a choice', async () => {
    await render({}, 'cards', 'buy');
    expect(text()).not.toContain(COPY.pricing.recommended);
    unmount(app);
    await render({}, 'cards', 'tiers');
    expect(text()).toContain(COPY.pricing.recommended);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'Choose' }, 'cards', 'tiers');
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render({ heading: 'Choose' }, 'cards', 'tiers', { commit: () => {} });
    expect(
      document.body.querySelector('h2')?.getAttribute('contenteditable')
    ).toBe('true');
    // One card edits the shared button label, so the canvas has one such field.
    expect(
      document.body.querySelectorAll('[data-field="ctaLabel"]')
    ).toHaveLength(1);
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

// Codex-61zsk.38: the creator's note sat under whichever offer was featured, so
// "One payment, yours to repeat." described a £15 monthly membership.
describe('PricingBlock — the words beside a price describe that price', () => {
  const NOTE = 'One payment, yours to repeat.';
  // The featured offer moves from the one-off to the membership.
  const FEATURED = {
    buy: { price: '£49', print: 'Pay once and keep it for good.' },
    tiers: {
      price: '£15',
      print: 'Billed monthly as part of Studio membership.',
    },
  } as const;

  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: the small print follows the featured offer; the note stays in the words', async (layout) => {
    for (const offer of ['buy', 'tiers'] as const) {
      await render(
        { heading: 'Join', body: 'Pick your way in.', note: NOTE },
        layout,
        offer
      );
      const { price, print } = FEATURED[offer];
      const other = FEATURED[offer === 'buy' ? 'tiers' : 'buy'].print;
      const unit = offerUnit(price);
      expect(
        unit,
        `${layout} · ${offer}: ${price} and its way in`
      ).not.toBeNull();
      expect(unit?.textContent).toContain(print);
      expect(unit?.textContent).not.toContain(other);
      expect(unit?.textContent).not.toContain(NOTE);
      // The creator's words: in the heading's own box, and only once.
      expect(
        document.body.querySelector('h2')?.parentElement?.textContent
      ).toContain(NOTE);
      expect(text().split(NOTE)).toHaveLength(2);
      unmount(app);
      app = null;
    }
  });

  it('keeps "you will see the price" when the offer could not be read, with the note in the words', async () => {
    await render({ heading: 'Join', note: NOTE }, 'cards', 'unknown');
    expect(text()).toContain(COPY.pricing.atCheckout);
    expect(
      document.body.querySelector('h2')?.parentElement?.textContent
    ).toContain(NOTE);
  });

  it.each([
    'enrolled',
    'unavailable',
  ] as const)('drops the note, which sells, when there is nothing to buy (%s)', async (offer) => {
    await render({ heading: 'Join', note: NOTE }, 'cards', offer);
    expect(text()).not.toContain(NOTE);
  });

  it('lets the canvas edit the note in the words, never the kit’s billing line', async () => {
    await render({ heading: 'Join', note: NOTE }, 'focus', 'tiers', {
      commit: () => {},
    });
    const notes = [...document.body.querySelectorAll('[data-field="note"]')];
    expect(notes.map((el) => el.textContent?.trim())).toEqual([NOTE]);
    const unit = offerUnit('£15');
    expect(unit?.textContent).toContain(FEATURED.tiers.print);
    expect(unit?.querySelector('[data-field="note"]')).toBeNull();
  });
});

// Codex-61zsk.73: a single way in stood alone, its card filled with three
// ways of saying "yours to keep" while what the course holds went unsaid.
describe('PricingBlock — a single way in, beside what the course holds', () => {
  const list = () => document.body.querySelector('.pricing__included');
  const lines = () =>
    [...(list()?.querySelectorAll('li') ?? [])].map((li) =>
      li.textContent?.trim()
    );
  // The sample course: six stages of four, its films and recordings timed.
  const COURSE_LINES = [
    '6 stages',
    '24 practices',
    '2 hr 41 min of video and audio',
    '7 videos · 8 audio · 9 readings',
  ];

  /** The sample's offer with one tier and nothing else. */
  function oneTier(): JourneySalesContext {
    const context = sampleContext({ offer: 'tiers' });
    const tiers = context.offer?.tiers.slice(0, 1) ?? [];
    return {
      ...context,
      offer: context.offer && {
        ...context.offer,
        paths: ['tier'],
        purchase: null,
        tiers,
      },
    };
  }

  it('sets the lone card beside the course’s own lines, card first', async () => {
    await render({}, 'cards', 'buy');
    const cards = document.body.querySelector('.pricing__cards');
    expect(cards?.getAttribute('data-count')).toBe('1');
    expect(cards?.hasAttribute('data-included')).toBe(true);
    expect(cards?.firstElementChild?.tagName).toBe('ARTICLE');
    expect(cards?.lastElementChild).toBe(list());
    expect(list()?.querySelector('h3')?.textContent).toBe(
      PRICING_COPY.included
    );
    expect(lines()).toEqual(COURSE_LINES);
  });

  it('draws the list under the card in focus', async () => {
    await render({}, 'focus', 'buy');
    expect(list()?.parentElement?.className).toContain('pricing__focus');
    expect(list()?.getAttribute('data-form')).toBe('list');
    expect(lines()).toEqual(COURSE_LINES);
  });

  it('runs the lines along the price strip in band, which stays a strip', async () => {
    // Poster's own layout: no card and no title, so a label and a line of
    // facts under the strip's rule, as the other ways to join are set.
    await render({}, 'band', 'buy');
    expect(list()?.getAttribute('data-form')).toBe('strip');
    expect(list()?.previousElementSibling?.className).toContain(
      'pricing__band'
    );
    expect(list()?.querySelector('h3')).toBeNull();
    expect(list()?.querySelector('.pricing__included-label')?.textContent).toBe(
      PRICING_COPY.included
    );
    expect(lines()).toEqual(COURSE_LINES);
  });

  it.each(
    SECTION_LAYOUTS.pricing
  )('%s: draws the list beside one way in, a one-off or a single tier', async (layout) => {
    for (const context of [sampleContext({ offer: 'buy' }), oneTier()]) {
      await renderWith({}, layout, context);
      expect(lines(), layout).toEqual(COURSE_LINES);
      unmount(app);
      app = null;
    }
  });

  it('sets a single tier beside the list too, and keeps the tier’s own points', async () => {
    await renderWith({}, 'cards', oneTier());
    expect(prices()).toEqual(['£15']);
    expect(lines()).toEqual(COURSE_LINES);
    expect(text()).toContain('Plus everything else in Studio membership');
  });

  // `sub` is one way in drawn as two cards (monthly and yearly); `tiers` is a
  // one-off and two memberships.
  it.each([
    'sub',
    'tiers',
  ] as const)('leaves two or more cards as they were (%s)', async (offer) => {
    for (const layout of SECTION_LAYOUTS.pricing) {
      await render({}, layout, offer);
      expect(list(), layout).toBeNull();
      expect(document.body.querySelector('[data-included]'), layout).toBeNull();
      unmount(app);
      app = null;
    }
  });

  it.each([
    'enrolled',
    'unavailable',
    'unknown',
  ] as const)('draws no list when there is no price to stand beside (%s)', async (offer) => {
    await render({}, 'cards', offer);
    expect(list()).toBeNull();
  });

  it('draws no list for a free course: it has no way in to stand beside', async () => {
    // A price of 0 gives no purchase path (`course-access-service`), and
    // with nothing else to join by the course is not open.
    await renderWith(
      {},
      'cards',
      sampleContext({ offer: 'unavailable', course: { priceCents: 0 } })
    );
    expect(list()).toBeNull();
    expect(text()).toContain(COPY.cta.unavailableTitle);
  });

  it('draws the creator’s rows: live, rewritten and their own, in their order', async () => {
    await render(
      {
        included: [
          { text: 'Printable workbook' },
          { fact: 'practices', text: 'Two dozen practices' },
          { fact: 'stages' },
        ],
      },
      'cards',
      'buy'
    );
    expect(lines()).toEqual([
      'Printable workbook',
      'Two dozen practices',
      '6 stages',
    ]);
  });

  it('draws the card alone when the list is switched off', async () => {
    await render({ included: [] }, 'cards', 'buy');
    expect(list()).toBeNull();
    const cards = document.body.querySelector('.pricing__cards');
    expect(cards?.hasAttribute('data-included')).toBe(false);
    expect(prices()).toEqual(['£49']);
  });

  it('draws the card alone for a course with nothing to count yet', async () => {
    const context = sampleContext({ offer: 'buy' });
    await renderWith({}, 'cards', {
      ...context,
      stages: context.stages.map((stage) => ({ ...stage, practices: [] })),
    });
    expect(list()).toBeNull();
  });

  it('says the one-off’s billing once: no generic points, no "for good" twice', async () => {
    await render({}, 'cards', 'buy');
    expect(text()).not.toMatch(
      /yours forever|no subscription|lifetime access/i
    );
    expect(text().match(/for good/gi)).toHaveLength(1);
    // "Prefer to own, not subscribe" sets a path apart from others there
    // are none of.
    expect(text()).not.toContain('Prefer to own, not subscribe');
    unmount(app);
    app = null;
    await render({}, 'cards', 'tiers');
    expect(text()).toContain('Prefer to own, not subscribe');
  });

  // The one-off beside two memberships had no points and a tall empty gap
  // down to its button, while theirs carried lists (p3g visual L6).
  const points = (price: string) =>
    [...(offerUnit(price)?.querySelectorAll('li') ?? [])].map((li) =>
      li.textContent?.trim()
    );

  it('gives the one-off beside other cards the course’s first lines as its points', async () => {
    await render({}, 'cards', 'tiers');
    expect(points('£49')).toEqual(COURSE_LINES.slice(0, 3));
    expect(points('£15')).toContain(
      'Plus everything else in Studio membership'
    );
    expect(list()).toBeNull();
    unmount(app);
    app = null;
    await render(
      { included: [{ text: 'Printable workbook' }, { fact: 'stages' }] },
      'cards',
      'tiers'
    );
    expect(points('£49')).toEqual(['Printable workbook', '6 stages']);
  });

  it('gives the one-off no points when the list is off, nor when it stands alone', async () => {
    await render({ included: [] }, 'cards', 'tiers');
    expect(points('£49')).toEqual([]);
    unmount(app);
    app = null;
    await render({}, 'cards', 'buy');
    expect(points('£49')).toEqual([]);
    expect(lines()).toEqual(COURSE_LINES);
  });

  it('draws the list the same on the canvas, where it is not edited inline', async () => {
    await render({}, 'cards', 'buy', { commit: () => {} });
    expect(lines()).toEqual(COURSE_LINES);
    expect(list()?.querySelector('[contenteditable], [data-field]')).toBeNull();
  });

  it('gives the card its share of the row as its width, so its name fits it', () => {
    const rules = componentRules(
      join(import.meta.dirname, 'PricingBlock.svelte')
    );
    const split = rules.find(
      (rule) =>
        rule.selector === '.pricing__cards[data-included]' &&
        rule.within.includes('@container (min-width: 44rem)')
    );
    expect(split?.decls.get('grid-template-columns')).toBe(
      'minmax(0, 5fr) minmax(0, 6fr)'
    );
    expect(split?.decls.get('--_track')).toBe(
      'calc((var(--lp-column) - var(--_split-gap)) * 5 / 11)'
    );
    expect(split?.decls.get('max-inline-size')).toBe('none');

    // Along the strip, the rule is the Style's own weight (Poster's thick
    // print), and wide it takes the strip's whole row.
    const strip = rules.find(
      (rule) => rule.selector === ".pricing__included[data-form='strip']"
    );
    expect(strip?.decls.get('border-block-start')).toBe(
      'var(--lp-rule) var(--border-style) var(--lp-line)'
    );
    const row = rules.find(
      (rule) =>
        rule.selector.includes(
          ".pricing[data-layout='band'] .pricing__included"
        ) && rule.within.includes('@container (min-width: 60rem)')
    );
    expect(row?.decls.get('flex-basis')).toBe('100%');

    // Narrow, the strip keeps the list's one fact to a line: a wrapped row
    // breaks raggedly (p3g visual L5).
    const inline = rules.filter(
      (rule) =>
        rule.selector.startsWith(".pricing__included[data-form='strip']") &&
        rule.decls.get('display') === 'flex'
    );
    expect(inline.map((rule) => rule.within)).toEqual([
      ['@container (min-width: 44rem)'],
    ]);

    // Soft centres the card and its list as one pair under its centred head
    // (p3g visual L4).
    const soft = rules.find(
      (rule) =>
        rule.selector.includes("[data-lp-style='soft']") &&
        rule.selector.endsWith('.pricing__cards[data-included]') &&
        rule.within.includes('@container (min-width: 44rem)')
    );
    expect(soft?.decls.get('justify-content')).toBe('center');
    expect(soft?.decls.get('grid-template-columns')).toBe(
      'var(--_track) minmax(0, max-content)'
    );
  });
});
