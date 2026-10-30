/**
 * PriceBadge and the card that hosts it: the plan label (Codex-2hxff.91, owner
 * decision U8, mockup badge A).
 *
 * The label names the SET of plans that include the item ("Basic and above",
 * "Pro only", "Basic, Premium", from `planBadgeLabel`), not one plan "and
 * above". These pin what reaches the pill: the label as given, the generic
 * "Subscription" while there is none, the price over the plans for a paid
 * item that is also in plans, the price ALONE for a closed item on sale (U11),
 * and the full text as the pill's title, since a long label is cut with an
 * ellipsis rather than wrapped.
 *
 * jsdom applies no component styles, so the ellipsis itself is not measured
 * here; the DOM contract it keys on (`.price-badge__label`, `title`) is.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { planBadgeLabel } from '$lib/utils/plan-label';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import ContentCard from '../ContentCard/ContentCard.svelte';
import PriceBadge from './PriceBadge.svelte';

const BASIC = { id: 'basic', name: 'Basic', priceMonthly: 500, sortOrder: 1 };
const PRO = { id: 'pro', name: 'Pro', priceMonthly: 1200, sortOrder: 2 };
const PREMIUM = {
  id: 'premium',
  name: 'Premium',
  priceMonthly: 2000,
  sortOrder: 3,
};
const TIERS = [BASIC, PRO, PREMIUM];

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

const pill = () => document.querySelector<HTMLElement>('.price-badge');
const pills = () =>
  [...document.querySelectorAll<HTMLElement>('.price-badge')].map((el) =>
    el.textContent?.trim()
  );

describe('PriceBadge: the plan label (U8)', () => {
  test.each([
    [[BASIC.id, PRO.id, PREMIUM.id], 'Basic and above'],
    [[PRO.id], 'Pro only'],
    [[BASIC.id, PREMIUM.id], 'Basic, Premium'],
  ])('a subscriber item in %j reads %s', (ids, label) => {
    component = mount(PriceBadge, {
      target: document.body,
      props: {
        amount: null,
        accessType: 'subscribers',
        tierName: planBadgeLabel(ids, TIERS),
      },
    });
    expect(pill()?.dataset.variant).toBe('subscribers');
    expect(pill()?.textContent?.trim()).toBe(label);
  });

  test('carries the full label as its title, for the ellipsis', () => {
    const long = `${'Foundations '.repeat(8).trim()} and above`;
    component = mount(PriceBadge, {
      target: document.body,
      props: { amount: null, accessType: 'subscribers', tierName: long },
    });
    expect(pill()?.getAttribute('title')).toBe(long);
    expect(pill()?.querySelector('.price-badge__label')?.textContent).toBe(
      long
    );
  });

  test('falls back to "Subscription" while no label is known', () => {
    component = mount(PriceBadge, {
      target: document.body,
      props: { amount: null, accessType: 'subscribers', tierName: null },
    });
    expect(pill()?.textContent?.trim()).toBe('Subscription');
    expect(pill()?.hasAttribute('title')).toBe(false);
  });

  test('"Included" wins over any plan label', () => {
    component = mount(PriceBadge, {
      target: document.body,
      props: {
        amount: null,
        accessType: 'subscribers',
        tierName: 'Basic, Premium',
        included: true,
      },
    });
    expect(pill()?.textContent?.trim()).toBe('Included');
  });
});

describe('ContentCard: the badge it builds', () => {
  const card = (props: Record<string, unknown>) =>
    mount(ContentCard, {
      target: document.body,
      props: { id: 'c1', title: 'The Cutting Room', ...props },
    });

  test('a paid item also in plans stacks the price over the plan label', () => {
    component = card({
      price: { amount: 499, currency: 'GBP' },
      contentAccessType: 'paid',
      tierName: planBadgeLabel([PRO.id, PREMIUM.id], TIERS),
    });
    expect(
      document.querySelector('.price-badge-stack')?.getAttribute('data-variant')
    ).toBe('hybrid');
    expect(pills()).toEqual(['£4.99', 'Pro and above']);
  });

  test('a closed item on sale shows only its price (U11)', () => {
    // Gated with no plan ticked: no plan label, so no plan line.
    component = card({
      price: { amount: 499, currency: 'GBP' },
      contentAccessType: 'paid',
      tierName: planBadgeLabel([], TIERS),
    });
    expect(document.querySelector('.price-badge-stack')).toBeNull();
    expect(pills()).toEqual(['£4.99']);
  });
});
