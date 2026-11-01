/**
 * Studio → Monetisation → Delete Tier while members are waiting to move to
 * it at their renewal (Codex-2hxff.16, decision T5; mockup C1
 * studio/delete-tier M1-M3).
 *
 * `getTierDeleteImpact` counts them (`movingInCount`, with `lastMoveAt` the
 * latest of their dates), and the delete is refused up front, as for a tier
 * with subscribers: only movers say "can't be deleted yet" with the last
 * date and no subscribers link (they are on their own tiers until then);
 * subscribers and movers share one sentence. With nobody left it is the
 * normal delete.
 *
 * Mounted as in `tier-plan-access.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionTier } from '$lib/types';
import { formatDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({
  goto: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));
vi.mock(
  '$app/state',
  () => import('$lib/components/support/__fixtures__/app-state.mock.svelte')
);
vi.mock(
  '$lib/remote/subscription.remote',
  () =>
    import(
      '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgSettings: () => ({
    current: { features: { enableSubscriptions: true } },
    error: undefined,
    loading: false,
  }),
}));

import {
  ACTIVE_ACCOUNT,
  deleteImpactSlot,
  land,
  myConnectSlot,
  reset,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Hollow Oak Films',
};
const tier = (id: string, name: string, priceMonthly: number) =>
  ({
    id,
    name,
    description: null,
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    sortOrder: 0,
    isRecommended: false,
    isActive: true,
  }) as unknown as SubscriptionTier;
const LITE = tier('lite', 'Lite', 300);
const BASIC = tier('basic', 'Basic', 500);
const PRO = tier('pro', 'Pro', 1200);

/** Nothing only in the tier: the dialog's own choices don't come into it. */
const EMPTY_IMPACT = {
  liveSubscriberCount: 0,
  movingInCount: 0,
  lastMoveAt: null,
  onlyHere: {
    films: { total: 0, closing: 0, staysForSale: 0, items: [] },
    courses: { total: 0, items: [] },
  },
  alsoInOtherPlans: { films: 6, courses: 0 },
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation');
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [LITE, BASIC, PRO]);
  flushSync();
}

function openDelete(name: string) {
  document
    .querySelector<HTMLButtonElement>(
      `button[aria-label="${m.monetisation_tiers_delete_aria({ name })}"]`
    )
    ?.click();
  flushSync();
}
const buttonNamed = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;
const refused = () =>
  document.querySelector<HTMLElement>('[data-testid="tier-delete-refused"]');
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('Delete Tier while members are moving to it', () => {
  test('only movers (M1): "can\'t be deleted yet", the last date, no link, no Delete', () => {
    mountPage();
    land(deleteImpactSlot('lite'), {
      ...EMPTY_IMPACT,
      movingInCount: 3,
      lastMoveAt: '2027-03-12T00:00:00.000Z',
    });
    openDelete('Lite');

    expect(clean(refused())).toBe(
      `${m.monetisation_tier_delete_moving_title({ name: 'Lite' })} ${m.monetisation_tier_delete_moving_body_other(
        { count: 3, date: formatDate('2027-03-12T00:00:00.000Z') }
      )}`
    );
    expect(refused()?.querySelector('a')).toBeNull();
    expect(buttonNamed(m.monetisation_tiers_delete())).toBeUndefined();
    expect(buttonNamed(m.monetisation_tier_delete_close())).toBeDefined();
  });

  test('one mover reads in the singular', () => {
    mountPage();
    land(deleteImpactSlot('lite'), {
      ...EMPTY_IMPACT,
      movingInCount: 1,
      lastMoveAt: '2026-11-12T00:00:00.000Z',
    });
    openDelete('Lite');

    expect(clean(refused())).toContain(
      m.monetisation_tier_delete_moving_body_one({
        date: formatDate('2026-11-12T00:00:00.000Z'),
      })
    );
  });

  test('subscribers and movers (M2): one sentence for both counts, with the link', () => {
    mountPage();
    land(deleteImpactSlot('basic'), {
      ...EMPTY_IMPACT,
      liveSubscriberCount: 41,
      movingInCount: 2,
      lastMoveAt: '2026-11-12T00:00:00.000Z',
    });
    openDelete('Basic');

    expect(clean(refused())).toContain(
      `${m.monetisation_tier_delete_refused_title({ name: 'Basic' })} ${m.monetisation_tier_delete_refused_moving_body_other_other(
        { count: 41, name: 'Basic', movers: 2 }
      )}`
    );
    expect(refused()?.querySelector('a')?.getAttribute('href')).toBe(
      '/studio/subscribers?tierId=basic'
    );
    expect(buttonNamed(m.monetisation_tiers_delete())).toBeUndefined();
  });

  test('members moving AWAY still count under their tier: the plain line', () => {
    mountPage();
    land(deleteImpactSlot('pro'), { ...EMPTY_IMPACT, liveSubscriberCount: 23 });
    openDelete('Pro');

    expect(clean(refused())).toContain(
      m.monetisation_tier_delete_refused_body_other({ count: 23, name: 'Pro' })
    );
  });

  test('nobody left (M3): the normal delete', () => {
    mountPage();
    land(deleteImpactSlot('lite'), EMPTY_IMPACT);
    openDelete('Lite');

    expect(refused()).toBeNull();
    expect(buttonNamed(m.monetisation_tiers_delete())?.disabled).toBe(false);
  });
});
