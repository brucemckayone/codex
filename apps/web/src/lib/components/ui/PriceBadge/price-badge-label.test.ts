/**
 * `priceBadgeLabel` / `priceBadgeVariant`: PriceBadge's wording as pure
 * functions (Codex-7104r, D10), so the card styles' StyledCard says a price
 * exactly as the badge does.
 *
 * Each branch is pinned twice: the function's own answer, and the text and
 * `data-variant` the mounted PriceBadge renders for the same props, so the
 * extraction cannot drift from the component that draws it.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import PriceBadge from './PriceBadge.svelte';
import {
  isHybridPrice,
  type PriceBadgeInput,
  type PriceBadgeVariant,
  priceBadgeLabel,
  priceBadgeVariant,
} from './price-badge-label';

const CASES: [string, PriceBadgeInput, PriceBadgeVariant, () => string][] = [
  [
    'purchased beats everything',
    { amount: 1000, purchased: true, included: true, accessType: 'paid' },
    'purchased',
    () => m.content_price_purchased(),
  ],
  [
    'included',
    { amount: 1000, included: true, accessType: 'subscribers' },
    'included',
    () => m.content_price_included(),
  ],
  [
    'followers content, viewer follows',
    { amount: null, accessType: 'followers', isFollower: true },
    'included',
    () => m.content_price_included(),
  ],
  [
    'stacked hybrid: the price is the first line',
    {
      amount: 1000,
      accessType: 'paid',
      tierName: 'Basic and above',
      stacked: true,
    },
    'hybrid',
    () => formatPrice(1000),
  ],
  [
    'paid and on a plan, NOT stacked: a plain price',
    { amount: 1000, accessType: 'paid', tierName: 'Basic and above' },
    'paid',
    () => formatPrice(1000),
  ],
  [
    'subscribers with a legacy price',
    { amount: 1500, accessType: 'subscribers', tierName: 'Pro only' },
    'subscribers',
    () => formatPrice(1500),
  ],
  [
    'subscribers with a plan label',
    { amount: null, accessType: 'subscribers', tierName: 'Pro only' },
    'subscribers',
    () => 'Pro only',
  ],
  [
    'subscribers with no plan label',
    { amount: null, accessType: 'subscribers' },
    'subscribers',
    () => m.content_price_subscribers(),
  ],
  [
    'followers, viewer does not follow',
    { amount: null, accessType: 'followers' },
    'followers',
    () => m.content_price_followers(),
  ],
  [
    'team',
    { amount: null, accessType: 'team' },
    'team',
    () => m.content_price_team(),
  ],
  ['zero amount', { amount: 0 }, 'free', () => m.content_price_free()],
  [
    'free access type',
    { amount: null, accessType: 'free' },
    'free',
    () => m.content_price_free(),
  ],
  [
    'a price',
    { amount: 2599, accessType: 'paid' },
    'paid',
    () => formatPrice(2599),
  ],
  [
    'a price with no access type',
    { amount: 2599 },
    'paid',
    () => formatPrice(2599),
  ],
];

describe('priceBadgeLabel / priceBadgeVariant', () => {
  test.each(CASES)('%s', (_name, input, variant, label) => {
    expect(priceBadgeVariant(input)).toBe(variant);
    expect(priceBadgeLabel(input)).toBe(label());
  });

  test('nothing to say: an empty label', () => {
    expect(priceBadgeLabel({ amount: null })).toBe('');
  });

  test('a hybrid needs every condition', () => {
    const hybrid: PriceBadgeInput = {
      amount: 1000,
      accessType: 'paid',
      tierName: 'Basic and above',
      stacked: true,
    };
    expect(isHybridPrice(hybrid)).toBe(true);
    expect(isHybridPrice({ ...hybrid, stacked: false })).toBe(false);
    expect(isHybridPrice({ ...hybrid, tierName: null })).toBe(false);
    expect(isHybridPrice({ ...hybrid, purchased: true })).toBe(false);
    expect(isHybridPrice({ ...hybrid, included: true })).toBe(false);
    expect(isHybridPrice({ ...hybrid, amount: 0 })).toBe(false);
    expect(isHybridPrice({ ...hybrid, accessType: 'subscribers' })).toBe(false);
  });
});

describe('PriceBadge renders the extracted wording', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  test.each(
    CASES.filter(([, , variant]) => variant !== 'hybrid')
  )('%s', (_name, input, variant) => {
    component = mount(PriceBadge, { target: document.body, props: input });
    const badge = document.querySelector('.price-badge');
    expect(badge?.getAttribute('data-variant')).toBe(variant);
    expect(badge?.querySelector('.price-badge__label')?.textContent).toBe(
      priceBadgeLabel(input)
    );
  });

  test('a stacked hybrid draws the price line, then the plans', () => {
    const input: PriceBadgeInput = {
      amount: 1000,
      accessType: 'paid',
      tierName: 'Basic and above',
      stacked: true,
    };
    component = mount(PriceBadge, { target: document.body, props: input });
    const stack = document.querySelector('.price-badge-stack');
    expect(stack?.getAttribute('data-variant')).toBe('hybrid');
    const lines = [...(stack?.querySelectorAll(':scope > .price-badge') ?? [])];
    expect(lines.map((line) => line.textContent?.trim())).toEqual([
      priceBadgeLabel(input),
      'Basic and above',
    ]);
  });
});
