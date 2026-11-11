/**
 * Portals › Offer panel: the note about how the course plan's price change
 * is going (Codex-2hxff.86; batch C1 Part B page 4, P11), under the plan's
 * prices, with the same states as the tier row: P2 saved, P10 the read
 * failed, P8 a price typed while its emails still go out.
 *
 * Mounts the real panel over the real monetisation store; the journeys
 * remote and the page-builder store are mocked. Only `Date` is faked.
 */

import type { PriceChangeProgress } from '@codex/subscription';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { COURSE_ID } = vi.hoisted(() => ({
  COURSE_ID: '00000000-0000-4000-8000-0000000000c0',
}));

vi.mock('$lib/remote/journeys.remote', async () => {
  const fixture = await import(
    '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
  );
  return {
    getCourseMonetisation: vi.fn(async () => ({
      courseId: COURSE_ID,
      subscription: { priceMonthly: 1500, priceAnnual: 15000 },
      tierIds: [],
      tierOptions: [],
    })),
    updateCourseMonetisation: vi.fn(),
    // Any reactive query slot will do: the panel reads `current`, `error`
    // and `refresh`, as on the tier page. A Try again test takes the read as
    // kit hands it (`kitPriceChanges`).
    getCoursePlanPriceChanges: vi.fn(() => fixture.priceChangesRead()),
  };
});
vi.mock('$lib/page-builder/page-builder-store.svelte', () => ({
  pageBuilder: {
    pending: { subjectType: 'course', subjectId: COURSE_ID, offer: {} },
    updateOffer: vi.fn(),
  },
}));

import type {
  KitQuery,
  KitRead,
} from '$lib/components/studio/__fixtures__/kit-query.mock.svelte';
import {
  fail,
  kitPriceChanges,
  land,
  priceChangesSlot,
  reset,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { monetisation } from '$lib/page-builder/monetisation-store.svelte';
import { updateCourseMonetisation } from '$lib/remote/journeys.remote';
import * as m from '$paraglide/messages';
import PagePricingPanel from './PagePricingPanel.svelte';

function change(
  over: Omit<Partial<PriceChangeProgress>, 'counts'> & {
    counts?: Partial<PriceChangeProgress['counts']>;
  } = {}
): PriceChangeProgress {
  const { counts, ...rest } = over;
  return {
    id: 'plan-month',
    tierId: null,
    courseSubscriptionPlanId: 'plan',
    interval: 'month',
    fromAmountCents: 1200,
    newAmountCents: 1500,
    state: 'running',
    createdAt: '2026-10-30T14:12:00.000Z',
    counts: {
      total: 30,
      emailed: 0,
      scheduled: 0,
      held: 0,
      due: 30,
      retrying: 0,
      ...counts,
    },
    lastRunAt: null,
    nextRunAt: '2026-10-30T15:00:00.000Z',
    estimatedDoneAt: '2026-10-30T15:00:00.000Z',
    doneAt: null,
    supersededById: null,
    stoppedAt: null,
    ...rest,
  };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(async () => {
  reset();
  monetisation.close();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T14:12:30.000Z'));
  await monetisation.open(COURSE_ID);
  component = mount(PagePricingPanel, { target: document.body });
  flushSync();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  monetisation.close();
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
/** The course subscription's way in: the one holding the price fields. */
const subscriptionWay = () =>
  document
    .querySelector<HTMLElement>('input[inputmode="decimal"]')
    ?.closest<HTMLElement>('.way');

describe('the Offer panel note (P11)', () => {
  test('P2 saved: under the plan prices, the people subscribed to this course', () => {
    land(priceChangesSlot(), [
      change(),
      change({
        id: 'plan-year',
        interval: 'year',
        fromAmountCents: 12000,
        newAmountCents: 15000,
        counts: { total: 8, due: 8 },
      }),
    ]);
    flushSync();
    const note = subscriptionWay()?.querySelector(
      '[data-testid="price-change-note"]'
    );
    expect(text(note)).toBe(
      "New course prices saved. We'll start emailing the 38 people subscribed to this course at 15:00. Each moves to £15.00/mo or £150.00/yr at their first renewal at least 30 days after their own email."
    );
  });

  test('P10: a failed read says so, with Try again (one read)', () => {
    fail(priceChangesSlot());
    flushSync();
    const failed = subscriptionWay()?.querySelector<HTMLElement>(
      '[data-testid="price-change-note-failed"]'
    );
    expect(text(failed)).toContain(
      "We couldn't load how your price change is going."
    );
    failed?.querySelector('button')?.click();
    expect(priceChangesSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('P8: a new monthly price while £15.00 is going out', () => {
    land(priceChangesSlot(), [
      change({
        lastRunAt: '2026-10-30T15:00:00.000Z',
        counts: { emailed: 20, scheduled: 20, due: 10 },
      }),
    ]);
    flushSync();
    const monthly = document.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]'
    );
    if (!monthly) throw new Error('no monthly price');
    monthly.value = '18';
    monthly.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const hint = document.querySelector('[data-testid="plan-price-hint"]');
    expect(text(hint)).toBe(
      'Emails about £15.00/mo are still going out: 20 of 30 sent. If you save a new price, it replaces £15.00, and all 30 are emailed about the new price instead, including the 20 already told about £15.00.'
    );
    expect(monthly.getAttribute('aria-describedby')).toBe('plan-price-hint');
  });
});

/**
 * A yearly price below the monthly one, refused on save (owner decision
 * 2026-11-03, "Refuse yearly below monthly"): said from en.json at the
 * yearly price, as its `aria-describedby`.
 */
describe('the Offer panel: a yearly price below the monthly one', () => {
  const YEARLY_BELOW = {
    status: 400,
    body: {
      message: 'Worker: yearly below monthly.',
      code: 'YEARLY_PRICE_BELOW_MONTHLY',
    },
  };
  const annual = () =>
    document.querySelector<HTMLInputElement>(
      `input[aria-label="${m.studio_builder_pricing_annual_aria()}"]`
    );
  const refusalLine = () =>
    document.querySelector<HTMLElement>('[data-testid="plan-yearly-refusal"]');

  function typeAnnual(pounds: string) {
    const input = annual();
    if (!input) throw new Error('no annual price');
    input.value = pounds;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  /** The builder's Save: its monetisation leg, refused. */
  async function saveRefused() {
    vi.mocked(updateCourseMonetisation).mockRejectedValueOnce(YEARLY_BELOW);
    await monetisation.save().catch(() => {});
    flushSync();
  }

  test('refused while the panel is open: at the yearly price, which takes focus', async () => {
    typeAnnual('10');
    await saveRefused();

    const line = refusalLine();
    expect(text(line)).toBe(m.price_refusal_yearly_below_monthly());
    expect(document.body.textContent).not.toContain(YEARLY_BELOW.body.message);
    expect(annual()?.getAttribute('aria-describedby')?.split(' ')).toContain(
      line?.id
    );
    expect(annual()?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(annual());

    typeAnnual('150');
    expect(refusalLine()).toBeNull();
    expect(annual()?.hasAttribute('aria-describedby')).toBe(false);
    expect(annual()?.hasAttribute('aria-invalid')).toBe(false);
  });

  test('a refusal already standing when the tab opens is shown, never focused', async () => {
    typeAnnual('10');
    if (component) unmount(component);
    await saveRefused();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    component = mount(PagePricingPanel, { target: document.body });
    flushSync();

    expect(text(refusalLine())).toBe(m.price_refusal_yearly_below_monthly());
    expect(document.activeElement).toBe(outside);
  });

  test('an autosave refusal while typing in the monthly price: said, and focus stays (C3-W2)', async () => {
    typeAnnual('10');
    const monthly = document.querySelector<HTMLInputElement>(
      `input[aria-label="${m.studio_builder_pricing_monthly_aria()}"]`
    );
    monthly?.focus();
    expect(document.activeElement).toBe(monthly);

    await saveRefused();

    const line = refusalLine();
    expect(text(line)).toBe(m.price_refusal_yearly_below_monthly());
    expect(annual()?.getAttribute('aria-describedby')?.split(' ')).toContain(
      line?.id
    );
    expect(annual()?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(monthly);
  });

  test('nor while typing anywhere else on the page (C3-W2)', async () => {
    typeAnnual('10');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable);

    await saveRefused();

    expect(text(refusalLine())).toBe(m.price_refusal_yearly_below_monthly());
    expect(document.activeElement).toBe(editable);
  });
});

/**
 * Try again on the failed note, as kit runs it (Codex-if444). A failed first
 * read is dropped, so Try again hands the panel a NEW query, still loading.
 * The panel used to await the refreshed query's stray read: the failed note,
 * with the focused Try again inside it, unmounted for the round trip, and
 * focus fell to <body> when the answer came.
 */
describe('Try again on the failed note, as kit runs it (P10)', () => {
  let kit: KitQuery<unknown[]>;

  beforeEach(() => {
    // Remounted so the panel reads the kit double from the start.
    if (component) unmount(component);
    kit = kitPriceChanges();
    component = mount(PagePricingPanel, { target: document.body });
    flushSync();
    kit.fail();
    flushSync();
  });

  const failedNote = () =>
    subscriptionWay()?.querySelector<HTMLElement>(
      '[data-testid="price-change-note-failed"]'
    );
  const tryAgain = () =>
    failedNote()?.querySelector('button') as HTMLButtonElement | null;
  /** Lets reads settle and Try again run on from them, focus moves included. */
  const settle = async () => {
    for (let turn = 0; turn < 3; turn++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    flushSync();
  };

  /** Presses Try again; returns the refreshed query WRAPPED (it is thenable). */
  async function pressTryAgain(): Promise<{ refreshed: KitRead<unknown[]> }> {
    const refreshed = kit.held();
    tryAgain()?.focus();
    tryAgain()?.click();
    await settle();
    expect(kit.refreshes(refreshed)).toBe(1);
    expect(kit.held()).not.toBe(refreshed);
    expect(kit.held().loading).toBe(true);
    return { refreshed };
  }

  test('keeps the failed note and its focused Try again, busy, while the new read loads', async () => {
    await pressTryAgain();

    expect(text(failedNote())).toContain(
      "We couldn't load how your price change is going."
    );
    expect(document.activeElement).toBe(tryAgain());
    expect(tryAgain()?.getAttribute('aria-busy')).toBe('true');
  });

  test('a Try again that fails again keeps the note and moves focus to its words', async () => {
    const { refreshed } = await pressTryAgain();

    kit.fail(undefined, refreshed);
    kit.fail();
    await settle();

    expect(failedNote()).not.toBeNull();
    expect(document.activeElement).toBe(
      failedNote()?.querySelector('[data-testid="price-note-status"]')
    );
    expect(tryAgain()?.getAttribute('aria-busy')).toBeNull();
  });

  test('a Try again that loads shows the note and moves focus to it', async () => {
    const { refreshed } = await pressTryAgain();

    kit.land([change()]);
    await settle();

    expect(refreshed.loading).toBe(true);
    expect(failedNote()).toBeNull();
    const note = subscriptionWay()?.querySelector(
      '[data-testid="price-change-note"]'
    );
    expect(note).not.toBeNull();
    expect(document.activeElement).toBe(
      note?.querySelector('[data-testid="price-note-status"]')
    );
  });

  test('a Try again that loads with nothing going out moves focus to the monthly price', async () => {
    await pressTryAgain();

    kit.land([]);
    await settle();

    expect(failedNote()).toBeNull();
    expect(document.activeElement).toBe(
      subscriptionWay()?.querySelector('input[inputmode="decimal"]')
    );
  });
});
