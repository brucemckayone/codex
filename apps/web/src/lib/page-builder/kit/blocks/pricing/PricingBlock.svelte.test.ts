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
  app = mount(PricingBlock, {
    target: document.body,
    props: {
      props,
      section: section(layout),
      context: sampleContext({ offer }),
      edit,
    },
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

  it('derives a note from the path kind when the creator wrote none', async () => {
    await render({}, 'focus', 'sub');
    expect(text()).toContain('Billed monthly.');
    unmount(app);
    await render({ note: 'Try it for a week.' }, 'focus', 'sub');
    expect(text()).toContain('Try it for a week.');
    expect(text()).not.toContain('Billed monthly.');
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
