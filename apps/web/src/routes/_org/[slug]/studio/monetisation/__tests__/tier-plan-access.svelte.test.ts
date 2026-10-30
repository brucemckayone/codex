/**
 * Studio → Monetisation × plan access (Codex-2hxff.91).
 *
 * - Each tier row says what it includes ("18 films · 2 courses", a link into
 *   its checklist) and carries the guidance note when a cheaper tier has
 *   items it lacks. Both stream from the access summary: a failed summary
 *   hides them and nothing else.
 * - Create Tier asks "Include everything from…", dearest tier first and
 *   preselected (owner decision U3), and sends the choice with the create.
 *   The source is part of the attempt, so changing it is a new submissionId.
 *   "Nothing" on a dearer tier previews what it will lack.
 * - Delete Tier reads what is only in the tier. Nothing is preselected and
 *   Delete stays disabled until the creator moves those items or keeps them
 *   subscribers-only (U5); a tier with live subscribers is refused up front;
 *   a failed check never reads as "nothing only here". "Keep" says which
 *   films close and which stay on sale. After a refusal the dialog acts only
 *   on a FRESH preview: kit keeps the old one through the re-read, and for
 *   good when it fails (`deferRefresh` models exactly that).
 *
 * Mounts the real `+page.svelte`; `$app/*` and the remote modules are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionTier } from '$lib/types';
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
  accessSummarySlot,
  createTier,
  deferRefresh,
  deleteImpactSlot,
  deleteTier,
  fail,
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
    isRecommended: false,
  }) as unknown as SubscriptionTier;
// Display (creation) order; Premium is the dearest.
const BASIC = tier('basic', 'Basic', 500);
const PRO = tier('pro', 'Pro', 1200);
const PREMIUM = tier('premium', 'Premium', 2000);

const SUMMARY = {
  tiers: [
    { tierId: 'basic', films: 12, courses: 1, missingFromCheaper: [] },
    {
      tierId: 'pro',
      films: 18,
      courses: 2,
      missingFromCheaper: [
        {
          cheaperTierId: 'basic',
          films: 2,
          courses: 0,
          sampleItems: [
            { kind: 'film', id: 'f-1', title: 'Winter Light' },
            { kind: 'film', id: 'f-2', title: 'Casting Calls That Work' },
          ],
        },
      ],
    },
    { tierId: 'premium', films: 24, courses: 3, missingFromCheaper: [] },
  ],
  eligibleFilms: 24,
  totalCourses: 3,
  closedFilms: 0,
  ineligibleFilms: 9,
};

const IMPACT_ONLY_HERE = {
  liveSubscriberCount: 0,
  onlyHere: {
    films: {
      total: 4,
      closing: 4,
      staysForSale: 0,
      items: [
        {
          id: 'm-1',
          title: 'Masterclass: Ruth Ellery on Landscape',
          status: 'published',
          isPurchasable: false,
        },
        {
          id: 'm-2',
          title: 'Masterclass: Tom Okafor on the Edit',
          status: 'published',
          isPurchasable: false,
        },
        {
          id: 'm-3',
          title: 'Masterclass: Maya Lind on Sound',
          status: 'draft',
          isPurchasable: false,
        },
        {
          id: 'm-4',
          title: 'Masterclass: Priya Shah on Producing',
          status: 'draft',
          isPurchasable: false,
        },
      ],
    },
    courses: {
      total: 1,
      items: [
        {
          id: 'c-1',
          title: 'Producing Your First Feature',
          status: 'published',
        },
      ],
    },
  },
  alsoInOtherPlans: { films: 20, courses: 2 },
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

function mountPage({ summary = true }: { summary?: boolean } = {}) {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [BASIC, PRO, PREMIUM]);
  if (summary) land(accessSummarySlot(), SUMMARY);
  flushSync();
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const buttonNamed = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name
  ) as HTMLButtonElement | undefined;
const byLabel = (label: string) =>
  document.querySelector(
    `button[aria-label="${label}"]`
  ) as HTMLButtonElement | null;
const radio = (name: string, value: string) =>
  document.querySelector(
    `input[name="${name}"][value="${value}"]`
  ) as HTMLInputElement | null;

describe('the tier rows', () => {
  test('say what each tier includes, linking into its checklist', () => {
    mountPage();
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="tier-contents-link"]'
      ),
    ];
    expect(links).toHaveLength(3);
    expect(links[1].textContent).toContain('18 films · 2 courses');
    expect(links[1].getAttribute('href')).toBe(
      '/studio/monetisation/tiers/pro'
    );
  });

  test('carry the guidance note on a tier that lacks what a cheaper one has', () => {
    mountPage();
    const notes = [
      ...document.querySelectorAll('[data-testid="tier-row-gap"]'),
    ];
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain(
      m.plan_gap_tier_row_other({ dearer: 'Pro', count: 2, cheaper: 'Basic' })
    );
    expect(notes[0].querySelector('a')?.getAttribute('href')).toBe(
      '/studio/monetisation/tiers/pro?filter=missing&cheaper=basic'
    );
  });

  test('a failed summary hides the counts and notes, and only them', () => {
    mountPage({ summary: false });
    fail(accessSummarySlot());
    flushSync();
    expect(
      document.querySelectorAll('[data-testid="tier-contents-link"]')
    ).toHaveLength(0);
    expect(
      document.querySelectorAll('[data-testid="tier-row-gap"]')
    ).toHaveLength(0);
    expect(document.querySelectorAll('.tier-item')).toHaveLength(3);
  });
});

describe('Create Tier: "Include everything from…"', () => {
  function openCreate() {
    buttonNamed(m.monetisation_tiers_create())?.click();
    flushSync();
  }
  function typeName(value: string) {
    const input = document.querySelector('#tier-name') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  function typeMonthly(value: string) {
    const input = document.querySelector(
      '#tier-price-monthly'
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }
  const save = async () => {
    buttonNamed(m.monetisation_save())?.click();
    await settle();
  };
  const sent = (call = 0) =>
    createTier.mock.calls[call][0] as Record<string, unknown>;

  test('lists the tiers dearest first, then Nothing, with the dearest chosen', () => {
    mountPage();
    openCreate();
    const values = [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[name="tier-copy-from"]'
      ),
    ].map((input) => input.value);
    expect(values).toEqual(['premium', 'pro', 'basic', '']);
    expect(radio('tier-copy-from', 'premium')?.checked).toBe(true);
    expect(text()).toContain(
      m.monetisation_tier_copy_option_desc({
        counts: '18 films and 2 courses',
        price: '£12.00',
      })
    );
  });

  test('sends the chosen source with the create, or null for Nothing', async () => {
    createTier.mockResolvedValue({ success: true, tier: { id: 'new' } });
    mountPage();
    openCreate();
    typeName('Founders');
    await save();
    expect(sent(0)).toMatchObject({
      name: 'Founders',
      copyAccessFromTierId: 'premium',
    });

    openCreate();
    typeName('Starter');
    radio('tier-copy-from', '')?.click();
    flushSync();
    await save();
    expect(sent(1)).toMatchObject({
      name: 'Starter',
      copyAccessFromTierId: null,
    });
  });

  test('a changed source after a failed send is a new attempt with a new id', async () => {
    createTier
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ success: true, tier: { id: 'new' } });
    mountPage();
    openCreate();
    typeName('Founders');
    await save();
    radio('tier-copy-from', 'pro')?.click();
    flushSync();
    await save();
    expect(sent(1).copyAccessFromTierId).toBe('pro');
    expect(sent(1).submissionId).not.toBe(sent(0).submissionId);
  });

  test('"Nothing" on a dearer tier previews what it will lack, and offers the copy', () => {
    mountPage();
    openCreate();
    typeName('Platinum');
    typeMonthly('2500');
    radio('tier-copy-from', '')?.click();
    flushSync();
    const note = document.querySelector('[data-testid="tier-create-gap"]');
    expect(note?.textContent).toContain(
      m.plan_gap_create_many({
        name: 'Platinum',
        items: '27 items',
        cheaper: 'Premium',
        others: 'Pro and Basic',
      })
    );
    buttonNamed(m.plan_gap_create_action({ tierName: 'Premium' }))?.click();
    flushSync();
    expect(radio('tier-copy-from', 'premium')?.checked).toBe(true);
    expect(
      document.querySelector('[data-testid="tier-create-gap"]')
    ).toBeNull();
  });
});

describe('Delete Tier: what is only in this tier', () => {
  function openDelete(name: string) {
    byLabel(m.monetisation_tiers_delete_aria({ name }))?.click();
    flushSync();
  }
  const deleteButton = () => buttonNamed(m.monetisation_tiers_delete());

  test('stays disabled while the check loads', () => {
    mountPage();
    openDelete('Premium');
    deleteImpactSlot('premium');
    flushSync();
    expect(deleteButton()?.disabled).toBe(true);
  });

  test('lists what is only here, and Delete waits for a choice (U5)', async () => {
    deleteTier.mockResolvedValue({ success: true });
    mountPage();
    land(deleteImpactSlot('premium'), IMPACT_ONLY_HERE);
    openDelete('Premium');

    expect(text()).toContain(
      m.monetisation_tier_delete_only_here_other({
        counts: '4 films and 1 course',
        name: 'Premium',
      })
    );
    expect(text()).toContain('Producing Your First Feature');
    expect(text()).toContain(
      m.monetisation_tier_delete_unaffected_other({
        counts: '20 films and 2 courses',
        tiers: 'Basic or Pro',
      })
    );
    expect(radio('tier-delete-choice', 'move')?.checked).toBe(false);
    expect(radio('tier-delete-choice', 'keep')?.checked).toBe(false);
    expect(deleteButton()?.disabled).toBe(true);

    radio('tier-delete-choice', 'keep')?.click();
    flushSync();
    expect(deleteButton()?.disabled).toBe(false);
    deleteButton()?.click();
    await settle();
    expect(deleteTier).toHaveBeenCalledWith({
      orgId: ORG.id,
      tierId: 'premium',
      choice: { onlyHere: 'keep' },
    });
  });

  test('"Move them" needs a tier ticked, and sends every tier ticked', async () => {
    deleteTier.mockResolvedValue({ success: true });
    mountPage();
    land(deleteImpactSlot('premium'), IMPACT_ONLY_HERE);
    openDelete('Premium');
    radio('tier-delete-choice', 'move')?.click();
    flushSync();
    expect(deleteButton()?.disabled).toBe(true);

    const proRow = [
      ...document.querySelectorAll<HTMLButtonElement>('button.tier'),
    ].find((b) => b.querySelector('.tier__name')?.textContent === 'Pro');
    proRow?.click();
    flushSync();
    expect(deleteButton()?.disabled).toBe(false);
    deleteButton()?.click();
    await settle();
    expect(deleteTier).toHaveBeenCalledWith({
      orgId: ORG.id,
      tierId: 'premium',
      choice: { onlyHere: 'move', moveTo: ['pro'] },
    });
  });

  test('moving to the cheaper tier alone previews the dearer one lacking them', () => {
    mountPage();
    land(deleteImpactSlot('premium'), IMPACT_ONLY_HERE);
    openDelete('Premium');
    radio('tier-delete-choice', 'move')?.click();
    flushSync();
    [...document.querySelectorAll<HTMLButtonElement>('button.tier')]
      .find((b) => b.querySelector('.tier__name')?.textContent === 'Basic')
      ?.click();
    flushSync();
    expect(text()).toContain(
      m.plan_gap_delete_other({ dearer: 'Pro', count: 5, cheaper: 'Basic' })
    );
  });

  test('a tier with live subscribers is refused up front, with no Delete', () => {
    mountPage();
    land(deleteImpactSlot('pro'), {
      ...IMPACT_ONLY_HERE,
      liveSubscriberCount: 23,
    });
    openDelete('Pro');
    expect(
      document.querySelector('[data-testid="tier-delete-refused"]')?.textContent
    ).toContain(
      m.monetisation_tier_delete_refused_body_other({ count: 23, name: 'Pro' })
    );
    expect(deleteButton()).toBeUndefined();
    expect(buttonNamed(m.monetisation_tier_delete_close())).toBeDefined();
  });

  test('a failed check never reads as "nothing only here"', () => {
    mountPage();
    fail(deleteImpactSlot('premium'));
    openDelete('Premium');
    expect(
      document.querySelector('[data-testid="tier-delete-impact-failed"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="tier-delete-nothing-only-here"]')
    ).toBeNull();
    expect(deleteButton()?.disabled).toBe(true);
  });

  test('nothing only here: a bare delete, no choice', async () => {
    deleteTier.mockResolvedValue({ success: true });
    mountPage();
    land(deleteImpactSlot('basic'), {
      liveSubscriberCount: 0,
      onlyHere: {
        films: { total: 0, closing: 0, staysForSale: 0, items: [] },
        courses: { total: 0, items: [] },
      },
      alsoInOtherPlans: { films: 12, courses: 1 },
    });
    openDelete('Basic');
    expect(text()).toContain(
      m.monetisation_tier_delete_nothing_only_here({
        name: 'Basic',
        tiers: 'Pro or Premium',
      })
    );
    deleteButton()?.click();
    await settle();
    expect(deleteTier).toHaveBeenCalledWith({
      orgId: ORG.id,
      tierId: 'basic',
      choice: undefined,
    });
  });

  test('a stale check (TIER_HAS_ONLY_ITEMS) says so, clears the choice and re-reads', async () => {
    deleteTier.mockResolvedValue({
      success: false,
      status: 409,
      code: 'CONFLICT',
      detailsCode: 'TIER_HAS_ONLY_ITEMS',
      message: 'refused',
    });
    mountPage();
    const slot = deleteImpactSlot('premium');
    land(slot, IMPACT_ONLY_HERE);
    openDelete('Premium');
    radio('tier-delete-choice', 'keep')?.click();
    flushSync();
    deleteButton()?.click();
    await settle();
    expect(text()).toContain(
      m.monetisation_tier_delete_only_here_changed({ name: 'Premium' })
    );
    expect(radio('tier-delete-choice', 'keep')?.checked).toBe(false);
    expect(slot.refresh).toHaveBeenCalled();
  });

  test('"keep" names what each film becomes: closed, or still on sale', () => {
    mountPage();
    land(deleteImpactSlot('premium'), IMPACT_ONLY_HERE);
    openDelete('Premium');
    const desc = document.querySelector(
      '[data-testid="tier-delete-keep-desc"]'
    )?.textContent;
    expect(text()).toContain(m.monetisation_tier_delete_keep_other());
    expect(desc).toContain(
      m.monetisation_tier_delete_keep_desc_other({ count: 4 })
    );
    expect(desc).toContain(m.monetisation_tier_delete_keep_course_one());
  });
});

/**
 * A preview whose only-here films are `closing` subscribers-only ones and
 * `forSale` paid ones (design §3.4: "keep" leaves a paid film on sale).
 */
function impactWith(closing: number, forSale: number) {
  const film = (i: number, isPurchasable: boolean) => ({
    id: `m-${i}`,
    title: `Film ${i}`,
    status: 'published',
    isPurchasable,
  });
  return {
    liveSubscriberCount: 0,
    onlyHere: {
      films: {
        total: closing + forSale,
        closing,
        staysForSale: forSale,
        items: [
          ...Array.from({ length: closing }, (_, i) => film(i, false)),
          ...Array.from({ length: forSale }, (_, i) => film(closing + i, true)),
        ],
      },
      courses: { total: 0, items: [] },
    },
    alsoInOtherPlans: { films: 0, courses: 0 },
  };
}

const NOTHING_ONLY_HERE = {
  liveSubscriberCount: 0,
  onlyHere: {
    films: { total: 0, closing: 0, staysForSale: 0, items: [] },
    courses: { total: 0, items: [] },
  },
  alsoInOtherPlans: { films: 12, courses: 1 },
};

describe('Delete Tier: "keep" on films that are for sale (M4)', () => {
  function openDelete(name: string) {
    byLabel(m.monetisation_tiers_delete_aria({ name }))?.click();
    flushSync();
  }
  const keepDesc = () =>
    document.querySelector('[data-testid="tier-delete-keep-desc"]')
      ?.textContent ?? '';

  test('paid films stay on sale: never called closed or subscribers-only', () => {
    mountPage();
    land(deleteImpactSlot('premium'), impactWith(0, 3));
    openDelete('Premium');
    expect(text()).toContain(m.monetisation_tier_delete_keep_no_tier_other());
    expect(text()).not.toContain(m.monetisation_tier_delete_keep_other());
    expect(keepDesc()).toContain(
      m.monetisation_tier_delete_keep_for_sale_other({ count: 3 })
    );
    expect(keepDesc()).not.toMatch(/closed/i);
  });

  test('a mix says how many close and how many stay on sale', () => {
    mountPage();
    land(deleteImpactSlot('premium'), impactWith(3, 1));
    openDelete('Premium');
    expect(text()).toContain(m.monetisation_tier_delete_keep_other());
    expect(keepDesc()).toContain(
      m.monetisation_tier_delete_keep_desc_other({ count: 3 })
    );
    expect(keepDesc()).toContain(
      m.monetisation_tier_delete_keep_for_sale_one()
    );
  });
});

describe('Delete Tier after a refusal: never the old preview (M1)', () => {
  function openDelete(name: string) {
    byLabel(m.monetisation_tiers_delete_aria({ name }))?.click();
    flushSync();
  }
  const deleteButton = () => buttonNamed(m.monetisation_tiers_delete());
  const testId = (id: string) =>
    document.querySelector(`[data-testid="${id}"]`);
  const refusal = (detailsCode: string) => ({
    success: false,
    status: 409,
    code: 'CONFLICT',
    detailsCode,
    message: 'refused',
  });

  /** Basic opens with nothing only in it; Delete is enabled at once. */
  function openBasic() {
    mountPage();
    const slot = deleteImpactSlot('basic');
    land(slot, NOTHING_ONLY_HERE);
    openDelete('Basic');
    expect(deleteButton()?.disabled).toBe(false);
    return slot;
  }

  test('TIER_HAS_SUBSCRIBERS is said, and Delete waits for the fresh check', async () => {
    deleteTier.mockResolvedValue(refusal('TIER_HAS_SUBSCRIBERS'));
    const slot = openBasic();
    const reread = deferRefresh(slot);
    deleteButton()?.click();
    await settle();

    expect(text()).toContain(
      m.monetisation_tier_delete_subscribed_meanwhile({ name: 'Basic' })
    );
    // kit still holds the old preview while it re-reads; the dialog won't act on it.
    expect(slot.current).toEqual(NOTHING_ONLY_HERE);
    expect(testId('tier-delete-nothing-only-here')).toBeNull();
    expect(deleteButton()?.disabled).toBe(true);

    reread.land({ ...NOTHING_ONLY_HERE, liveSubscriberCount: 1 });
    await settle();
    expect(testId('tier-delete-refused')).not.toBeNull();
    expect(deleteButton()).toBeUndefined();
  });

  test('a FAILED re-read (kit keeps the old value) shows "couldn\'t check", Delete stays off', async () => {
    deleteTier.mockResolvedValue(refusal('TIER_HAS_SUBSCRIBERS'));
    const slot = openBasic();
    const reread = deferRefresh(slot);
    deleteButton()?.click();
    await settle();

    reread.fail();
    await settle();
    expect(slot.current).toEqual(NOTHING_ONLY_HERE);
    expect(testId('tier-delete-impact-failed')).not.toBeNull();
    expect(testId('tier-delete-nothing-only-here')).toBeNull();
    expect(deleteButton()?.disabled).toBe(true);
    expect(deleteButton()?.getAttribute('aria-describedby')).toBe(
      'tier-delete-impact-failed-text'
    );
  });

  test('TIER_HAS_ONLY_ITEMS offers Move/Keep from the FRESH preview only', async () => {
    deleteTier
      .mockResolvedValueOnce(refusal('TIER_HAS_ONLY_ITEMS'))
      .mockResolvedValueOnce({ success: true });
    const slot = openBasic();
    const reread = deferRefresh(slot);
    deleteButton()?.click();
    await settle();

    expect(text()).toContain(
      m.monetisation_tier_delete_only_here_changed({ name: 'Basic' })
    );
    // No choices, and no "nothing only here", from the old preview.
    expect(testId('tier-delete-choice')).toBeNull();
    expect(testId('tier-delete-nothing-only-here')).toBeNull();
    expect(deleteButton()?.disabled).toBe(true);

    reread.land(IMPACT_ONLY_HERE);
    await settle();
    expect(testId('tier-delete-choice')).not.toBeNull();
    expect(text()).toContain(
      m.monetisation_tier_delete_only_here_other({
        counts: '4 films and 1 course',
        name: 'Basic',
      })
    );
    // U5 still holds: nothing chosen, nothing sent.
    expect(deleteButton()?.disabled).toBe(true);
    radio('tier-delete-choice', 'keep')?.click();
    flushSync();
    deleteButton()?.click();
    await settle();
    expect(deleteTier).toHaveBeenLastCalledWith({
      orgId: ORG.id,
      tierId: 'basic',
      choice: { onlyHere: 'keep' },
    });
  });

  test('TIER_HAS_ONLY_ITEMS with a failed re-read: the alert stays up through Retry until a read lands', async () => {
    deleteTier.mockResolvedValue(refusal('TIER_HAS_ONLY_ITEMS'));
    const slot = openBasic();
    const reread = deferRefresh(slot);
    deleteButton()?.click();
    await settle();
    reread.fail();
    await settle();
    expect(testId('tier-delete-impact-failed')).not.toBeNull();
    expect(testId('tier-delete-choice')).toBeNull();

    const retry = deferRefresh(slot);
    buttonNamed(m.monetisation_tier_delete_impact_retry())?.click();
    await settle();
    expect(testId('tier-delete-impact-failed')).not.toBeNull();
    expect(deleteButton()?.disabled).toBe(true);

    retry.land(IMPACT_ONLY_HERE);
    await settle();
    expect(testId('tier-delete-impact-failed')).toBeNull();
    expect(testId('tier-delete-choice')).not.toBeNull();
  });

  test('a double-clicked Retry whose newer read fails never brings back the old preview', async () => {
    deleteTier.mockResolvedValue(refusal('TIER_HAS_SUBSCRIBERS'));
    const slot = openBasic();
    const reread = deferRefresh(slot);
    deleteButton()?.click();
    await settle();
    reread.fail();
    await settle();

    const older = deferRefresh(slot);
    const newer = deferRefresh(slot);
    buttonNamed(m.monetisation_tier_delete_impact_retry())?.click();
    buttonNamed(m.monetisation_tier_delete_impact_retry())?.click();
    await settle();
    // The newer read fails, and kit then settles the older one as resolved.
    newer.fail();
    older.supersede();
    await settle();

    expect(slot.current).toEqual(NOTHING_ONLY_HERE);
    expect(testId('tier-delete-impact-failed')).not.toBeNull();
    expect(testId('tier-delete-nothing-only-here')).toBeNull();
    expect(deleteButton()?.disabled).toBe(true);
  });
});

describe('Delete Tier: a disabled Delete says why (L8)', () => {
  test('it is described by the choice it waits for, then the move target', () => {
    mountPage();
    land(deleteImpactSlot('premium'), IMPACT_ONLY_HERE);
    byLabel(m.monetisation_tiers_delete_aria({ name: 'Premium' }))?.click();
    flushSync();
    const deleteButton = () => buttonNamed(m.monetisation_tiers_delete());
    const describedBy = () =>
      document.getElementById(
        deleteButton()?.getAttribute('aria-describedby') ?? ''
      )?.textContent ?? '';

    expect(describedBy()).toContain(
      m.monetisation_tier_delete_choice_label_other()
    );
    radio('tier-delete-choice', 'move')?.click();
    flushSync();
    expect(describedBy()).toContain(
      m.monetisation_tier_delete_move_pick_other()
    );
    radio('tier-delete-choice', 'keep')?.click();
    flushSync();
    expect(deleteButton()?.disabled).toBe(false);
    expect(deleteButton()?.hasAttribute('aria-describedby')).toBe(false);
  });
});
