/**
 * "What's in {tier}", the tier checklist (Codex-2hxff.91).
 *
 * - Ticks are drafts until Save; one save is one DELTA of adds and removes.
 * - Unticking the last tier of a subscribers-only film is allowed and says
 *   the film will be CLOSED, never free.
 * - A list that failed to load offers Retry and no save bar.
 * - The guidance note's "Tick both" drafts the missing items; "Review" links
 *   (?filter=missing&cheaper=) open the list on just those.
 * - Free / follower / team films are disabled rows with the reason.
 *
 * Mounts the real page; `$app/*` and the remote module are mocked.
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
  beforeNavigate: vi.fn(),
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

import { PLAN_ITEMS_DELTA_LIST_MAX } from '@codex/validation';
import { beforeNavigate } from '$app/navigation';
import {
  accessSummarySlot,
  deferRefresh,
  fail,
  land,
  listTierItems,
  type QuerySlot,
  reset,
  setTierItems,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import ChecklistPage from '../+page.svelte';

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
  }) as unknown as SubscriptionTier;
const TIERS = [
  tier('basic', 'Basic', 500),
  tier('pro', 'Pro', 1200),
  tier('premium', 'Premium', 2000),
];

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
            { kind: 'film', id: 'f-winter', title: 'Winter Light' },
            { kind: 'film', id: 'f-casting', title: 'Casting Calls That Work' },
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

const row = (overrides: Record<string, unknown>) => ({
  kind: 'film',
  thumbnailUrl: null,
  status: 'published',
  access: 'subscribers',
  eligible: true,
  included: false,
  otherTierIds: [],
  durationSeconds: 1500,
  stageCount: null,
  priceCents: null,
  ...overrides,
});
const ROWS = [
  row({
    id: 'f-long',
    title: 'The Long Field',
    included: true,
    otherTierIds: ['basic', 'premium'],
  }),
  row({ id: 'f-only', title: 'Directing Non-Actors', included: true }),
  row({
    id: 'f-winter',
    title: 'Winter Light',
    otherTierIds: ['basic', 'premium'],
  }),
  row({
    id: 'f-free',
    title: 'Sound Design Basics',
    access: 'free',
    eligible: false,
  }),
  row({
    kind: 'course',
    id: 'c-doc',
    title: 'Documentary from Idea to Festival',
    durationSeconds: null,
    stageCount: 8,
    included: true,
  }),
];
const PAGE = (items: unknown[]) => ({
  items,
  pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 },
});

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setPage('/studio/monetisation/tiers/pro', { tierId: 'pro' });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const lastItemsSlot = () =>
  listTierItems.mock.results.at(-1)?.value as QuerySlot<unknown>;
const lastItemsArgs = () =>
  listTierItems.mock.calls.at(-1)?.[0] as {
    tierId: string;
    query: Record<string, unknown>;
  };

function mountPage({
  items = ROWS as unknown[] | null,
  tiers = true,
}: {
  items?: unknown[] | null;
  tiers?: boolean;
} = {}) {
  component = mount(ChecklistPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  if (tiers) land(tiersSlot(), TIERS);
  land(accessSummarySlot(), SUMMARY);
  flushSync();
  if (items) land(lastItemsSlot() as never, PAGE(items));
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
const checkbox = (title: string) =>
  [...document.querySelectorAll('[data-testid="tier-checklist-row"]')]
    .find((li) => li.querySelector('.check-title')?.textContent === title)
    ?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
const saveBar = () =>
  document.querySelector('[data-testid="tier-checklist-save-bar"]');

function toggle(title: string) {
  checkbox(title)?.click();
  flushSync();
}

describe('the checklist', () => {
  test('heads the page with the tier, its price and what it includes', () => {
    mountPage();
    expect(text()).toContain(m.monetisation_tier_items_title({ name: 'Pro' }));
    expect(text()).toContain(
      m.monetisation_tier_items_price({ price: '£12.00' })
    );
    expect(text()).toContain(
      m.monetisation_tier_items_includes({ counts: '18 films and 2 courses' })
    );
    expect(lastItemsArgs()).toMatchObject({
      tierId: 'pro',
      query: { filter: 'all', page: 1 },
    });
  });

  test('shows each row ticked as stored, and a free film disabled with the reason', () => {
    mountPage();
    expect(checkbox('The Long Field')?.checked).toBe(true);
    expect(checkbox('Winter Light')?.checked).toBe(false);
    expect(checkbox('Sound Design Basics')?.disabled).toBe(true);
    expect(text()).toContain(m.monetisation_tier_items_ineligible_free());
    expect(text()).toContain(
      m.monetisation_tier_items_also_in({ tiers: 'Basic and Premium' })
    );
  });

  test('a tick is a draft until Save, and the save sends a delta', async () => {
    setTierItems.mockResolvedValue({
      success: true,
      result: { films: 19, courses: 1, closedNow: { contentIds: [] } },
    });
    mountPage();
    expect(saveBar()).toBeNull();
    toggle('Winter Light');
    toggle('Documentary from Idea to Festival');
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_changes_other({ count: 2 })
    );
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_will_include({
        name: 'Pro',
        counts: '19 films and 1 course',
      })
    );
    const slot = lastItemsSlot();

    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();

    expect(setTierItems).toHaveBeenCalledWith({
      orgId: ORG.id,
      tierId: 'pro',
      delta: {
        add: { contentIds: ['f-winter'], courseIds: [] },
        remove: { contentIds: [], courseIds: ['c-doc'] },
      },
    });
    expect(saveBar()).toBeNull();
    expect(text()).toContain(
      m.monetisation_tier_items_saved({
        name: 'Pro',
        counts: '19 films and 1 course',
      })
    );
    expect(slot.refresh).toHaveBeenCalled();
    expect(accessSummarySlot().refresh).toHaveBeenCalled();
  });

  test('ticking back to the stored state is no change', () => {
    mountPage();
    toggle('Winter Light');
    toggle('Winter Light');
    expect(saveBar()).toBeNull();
  });

  test("unticking a subscribers-only film's last tier says it will be closed", () => {
    mountPage();
    toggle('Directing Non-Actors');
    expect(text()).toContain(m.monetisation_tier_items_tag_closed());
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_will_close_one()
    );
  });

  test('a refused save keeps the draft and says why', async () => {
    setTierItems.mockResolvedValue({
      success: false,
      status: 422,
      code: 'BUSINESS_LOGIC_ERROR',
      detailsCode: 'CREATOR_CONNECT_REQUIRED',
      message: 'refused',
    });
    mountPage();
    toggle('Winter Light');
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_save_payouts()
    );
    expect(checkbox('Winter Light')?.checked).toBe(true);
  });

  test('"Tick both" drafts the items Pro lacks, and the note goes', () => {
    mountPage();
    expect(
      document.querySelector('[data-testid="tier-checklist-gap"]')?.textContent
    ).toContain('Winter Light and Casting Calls That Work');
    buttonNamed(m.plan_gap_tick_both())?.click();
    flushSync();
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_changes_other({ count: 2 })
    );
    expect(
      document.querySelector('[data-testid="tier-checklist-gap"]')
    ).toBeNull();
  });

  test('a filter re-reads the list', () => {
    mountPage();
    buttonNamed(`${m.monetisation_tier_items_filter_included()}20`)?.click();
    flushSync();
    expect(lastItemsArgs().query).toMatchObject({
      filter: 'included',
      page: 1,
    });
  });
});

describe('opened from a guidance note', () => {
  test('?filter=missing&cheaper= lists just what the cheaper tier has', () => {
    setPage('/studio/monetisation/tiers/pro?filter=missing&cheaper=basic', {
      tierId: 'pro',
    });
    mountPage();
    expect(lastItemsArgs().query).toMatchObject({
      filter: 'missing',
      cheaperTierId: 'basic',
    });
  });

  test('missing without a cheaper tier falls back to all', () => {
    setPage('/studio/monetisation/tiers/pro?filter=missing', { tierId: 'pro' });
    mountPage();
    expect(lastItemsArgs().query).toMatchObject({ filter: 'all' });
    expect(lastItemsArgs().query).not.toHaveProperty('cheaperTierId');
  });
});

describe('a list that failed to load', () => {
  test('offers Retry and no list or save bar', () => {
    mountPage({ items: null });
    fail(lastItemsSlot() as never);
    flushSync();
    const alert = document.querySelector(
      '[data-testid="tier-checklist-failed"]'
    );
    expect(alert?.textContent).toContain(
      m.monetisation_tier_items_load_failed({ name: 'Pro' })
    );
    expect(document.querySelector('[data-testid="tier-checklist"]')).toBeNull();
    expect(saveBar()).toBeNull();
    buttonNamed(m.monetisation_tier_items_retry())?.click();
    expect(lastItemsSlot().refresh).toHaveBeenCalled();
  });
});

describe('a tier list that failed to load (M2)', () => {
  test('says so with Retry, never an endless skeleton', () => {
    mountPage({ tiers: false });
    fail(tiersSlot());
    flushSync();
    expect(
      document.querySelector('[data-testid="tier-checklist-tiers-failed"]')
        ?.textContent
    ).toContain(m.monetisation_tier_items_tier_load_failed());
    expect(document.querySelector('.checklist-loading')).toBeNull();
    buttonNamed(m.monetisation_tier_items_retry())?.click();
    expect(tiersSlot().refresh).toHaveBeenCalled();
  });
});

/** `n` subscriber films, unticked, numbered from `from`. */
const films = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) =>
    row({ id: `f-${from + i}`, title: `Film ${from + i}` })
  );
const PAGED = (items: unknown[], page: number, totalPages: number) => ({
  items,
  pagination: { page, limit: 50, total: totalPages * 50, totalPages },
});
const pageButton = (page: number) =>
  document.querySelector(
    `button[aria-label="${m.common_page_number({ page })}"]`
  ) as HTMLButtonElement | null;
const saved = (films: number) => ({
  success: true,
  result: { films, courses: 2, closedNow: { contentIds: [] } },
});
type Delta = {
  add: { contentIds: string[]; courseIds: string[] };
  remove: { contentIds: string[]; courseIds: string[] };
};
const sentDeltas = () =>
  setTierItems.mock.calls.map((call) => (call[0] as { delta: Delta }).delta);

/** "Tick all shown" on three full pages: 150 film adds, past one list's cap. */
function tickThreePages() {
  mountPage({ items: null });
  for (const p of [1, 2, 3]) {
    if (p > 1) {
      pageButton(p)?.click();
      flushSync();
    }
    land(lastItemsSlot(), PAGED(films((p - 1) * 50, 50), p, 3));
    flushSync();
    buttonNamed(m.monetisation_tier_items_tick_all())?.click();
    flushSync();
  }
  expect(saveBar()?.textContent).toContain(
    m.monetisation_tier_items_changes_other({ count: 150 })
  );
}

describe("a save past one request's per-list cap (M3)", () => {
  test('goes as two requests, each list within the cap, every change once', async () => {
    setTierItems
      .mockResolvedValueOnce(saved(118))
      .mockResolvedValueOnce(saved(168));
    tickThreePages();
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();

    expect(setTierItems).toHaveBeenCalledTimes(2);
    const [first, second] = sentDeltas();
    expect(first.add.contentIds).toHaveLength(PLAN_ITEMS_DELTA_LIST_MAX);
    expect(second.add.contentIds).toHaveLength(50);
    expect(
      new Set([...first.add.contentIds, ...second.add.contentIds]).size
    ).toBe(150);
    expect(saveBar()).toBeNull();
    expect(text()).toContain(
      m.monetisation_tier_items_saved({
        name: 'Pro',
        counts: '168 films and 2 courses',
      })
    );
  });

  test('a refused second request keeps only the unwritten changes, and says so', async () => {
    setTierItems.mockResolvedValueOnce(saved(118)).mockResolvedValueOnce({
      success: false,
      status: 422,
      code: 'BUSINESS_LOGIC_ERROR',
      detailsCode: 'CREATOR_CONNECT_REQUIRED',
      message: 'refused',
    });
    tickThreePages();
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();

    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_save_partial_other({ name: 'Pro', count: 50 })
    );
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_changes_other({ count: 50 })
    );
    expect(lastItemsSlot().refresh).toHaveBeenCalled();
  });
});

describe('after a save (L5)', () => {
  const savedOne = () =>
    setTierItems.mockResolvedValue({
      success: true,
      result: { films: 19, courses: 2, closedNow: { contentIds: [] } },
    });
  const rereadAlert = () =>
    document.querySelector('[data-testid="tier-checklist-reread-failed"]');

  test('a just-saved row keeps its new tick while kit still holds the old page', async () => {
    savedOne();
    mountPage();
    const slot = lastItemsSlot();
    const reread = deferRefresh(slot);
    toggle('Winter Light');
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();

    expect(saveBar()).toBeNull();
    expect(checkbox('Winter Light')?.checked).toBe(true);

    // The re-read lands: the fresh page decides (here someone else unticked it).
    reread.land(PAGE(ROWS));
    await settle();
    expect(checkbox('Winter Light')?.checked).toBe(false);
    expect(rereadAlert()).toBeNull();
  });

  test('a FAILED re-read (old page kept) keeps the saved ticks and says so, with Retry', async () => {
    savedOne();
    mountPage();
    const slot = lastItemsSlot();
    const reread = deferRefresh(slot);
    toggle('Winter Light');
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();
    reread.fail();
    await settle();

    expect(checkbox('Winter Light')?.checked).toBe(true);
    expect(rereadAlert()?.textContent).toContain(
      m.monetisation_tier_items_reread_failed()
    );
    // Unticking it again is a change against what was SAVED, not the old page.
    toggle('Winter Light');
    expect(saveBar()?.textContent).toContain(
      m.monetisation_tier_items_changes_one()
    );

    const calls = slot.refresh.mock.calls.length;
    buttonNamed(m.monetisation_tier_items_retry())?.click();
    expect(slot.refresh.mock.calls.length).toBe(calls + 1);
  });

  test('a save that empties the last page steps back a page', async () => {
    savedOne();
    setPage('/studio/monetisation/tiers/pro?filter=excluded', {
      tierId: 'pro',
    });
    mountPage({ items: null });
    land(lastItemsSlot(), PAGED(films(0, 50), 1, 2));
    flushSync();
    pageButton(2)?.click();
    flushSync();
    const last = lastItemsSlot();
    land(last, PAGED(films(50, 20), 2, 2));
    flushSync();
    const reread = deferRefresh(last);
    buttonNamed(
      m.monetisation_tier_items_tick_all_count({ count: 20 })
    )?.click();
    flushSync();
    buttonNamed(m.monetisation_tier_items_save())?.click();
    await settle();

    reread.land(PAGED([], 2, 1));
    await settle();
    expect(lastItemsArgs().query).toMatchObject({
      filter: 'excluded',
      page: 1,
    });
  });
});

describe('empty and leaving', () => {
  test('an empty filter says so, not "nothing a tier can include"', () => {
    mountPage({ items: [] });
    expect(text()).toContain(m.monetisation_tier_items_empty());
    buttonNamed(`${m.monetisation_tier_items_filter_included()}20`)?.click();
    flushSync();
    land(lastItemsSlot(), PAGE([]));
    flushSync();
    expect(
      document.querySelector('[data-testid="tier-checklist-empty"]')
        ?.textContent
    ).toContain(m.monetisation_tier_items_empty_filter());
  });

  test('leaving with unsaved ticks asks first, in its own words', () => {
    mountPage();
    toggle('Winter Light');
    const guard = vi.mocked(beforeNavigate).mock.calls.at(-1)?.[0];
    const cancel = vi.fn();
    guard?.({
      to: { url: new URL('http://localhost/studio/content') },
      cancel,
    } as never);
    flushSync();
    expect(cancel).toHaveBeenCalled();
    expect(text()).toContain(m.monetisation_tier_items_leave_title());
    expect(text()).toContain(
      m.monetisation_tier_items_leave_body_one({ name: 'Pro' })
    );
    expect(
      buttonNamed(m.monetisation_tier_items_leave_confirm())
    ).toBeDefined();
    expect(buttonNamed(m.monetisation_tier_items_leave_stay())).toBeDefined();
  });
});
