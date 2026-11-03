/**
 * Studio → Monetisation: the note on a tier row about how its price change
 * is going (Codex-2hxff.85 M3, .86; batch C1 Part B page 4, P2 to P10), and
 * the Edit Tier warning while a change's emails are still going out (P8).
 *
 * The cost rule: the note reads once per visit; Check again and Try again
 * are one read per press, never two at once.
 *
 * Mounts the real `+page.svelte`; `$app/*`, the remote modules and the
 * dismissal collection are mocked. Only `Date` is faked, for the clock.
 */

import type { PriceChangeProgress } from '@codex/subscription';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SubscriptionTier } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const dismissed = vi.hoisted(() => new Set<string>());

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
vi.mock('$lib/collections/dismissals', () => ({
  dismiss: vi.fn((key: string) => dismissed.add(key)),
  isDismissed: vi.fn((key: string) => dismissed.has(key)),
}));

import { dismiss } from '$lib/collections/dismissals';
import {
  ACTIVE_ACCOUNT,
  deferRefresh,
  fail,
  failRefresh,
  land,
  myConnectSlot,
  priceChangesSlot,
  reset,
  statsSlot,
  tiersSlot,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import { setPage } from '$lib/components/support/__fixtures__/app-state.mock.svelte';
import MonetisationPage from '../+page.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Northlight Collective',
};
const tier = (id: string, name: string, priceMonthly: number) =>
  ({
    id,
    name,
    description: '',
    priceMonthly,
    priceAnnual: priceMonthly * 10,
    isRecommended: false,
  }) as unknown as SubscriptionTier;
const MEMBERS = tier('members', 'Members', 900);
const PATRONS = tier('patrons', 'Patrons', 2500);

function change(
  over: Omit<Partial<PriceChangeProgress>, 'counts'> & {
    counts?: Partial<PriceChangeProgress['counts']>;
  } = {}
): PriceChangeProgress {
  const { counts, ...rest } = over;
  return {
    id: 'members-9',
    tierId: 'members',
    courseSubscriptionPlanId: null,
    interval: 'month',
    fromAmountCents: 800,
    newAmountCents: 900,
    state: 'running',
    createdAt: '2026-10-30T13:20:00.000Z',
    counts: {
      total: 6240,
      emailed: 4500,
      scheduled: 4493,
      held: 7,
      due: 1740,
      retrying: 0,
      ...counts,
    },
    lastRunAt: '2026-10-30T16:00:00.000Z',
    nextRunAt: '2026-10-30T17:00:00.000Z',
    estimatedDoneAt: '2026-10-30T18:00:00.000Z',
    doneAt: null,
    supersededById: null,
    stoppedAt: null,
    ...rest,
  };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  dismissed.clear();
  vi.mocked(dismiss).mockClear();
  setPage('/studio/monetisation');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T16:04:00.000Z'));
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mountPage() {
  component = mount(MonetisationPage, {
    target: document.body,
    props: { data: { userRole: 'owner', org: ORG } } as never,
  });
  land(myConnectSlot(), ACTIVE_ACCOUNT);
  land(tiersSlot(), [MEMBERS, PATRONS]);
  land(statsSlot(), {
    totalSubscribers: 6550,
    activeSubscribers: 6550,
    mrrCents: 0,
    tierBreakdown: [
      {
        tierId: 'members',
        tierName: 'Members',
        subscriberCount: 6240,
        mrrCents: 0,
      },
      {
        tierId: 'patrons',
        tierName: 'Patrons',
        subscriberCount: 310,
        mrrCents: 0,
      },
    ],
  });
  flushSync();
}

/** The tier row that holds `name`. */
function row(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('.tier-item')].find(
    (el) => el.querySelector('.tier-name')?.textContent === name
  );
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

const notesIn = (el: HTMLElement | Document) => [
  ...el.querySelectorAll<HTMLElement>('[data-testid="price-change-note"]'),
];
const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

function button(el: HTMLElement | Document, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

describe('the note on the tier row (P2 to P10)', () => {
  test('nothing while the read is out: the slot stays empty', () => {
    priceChangesSlot().loading = true;
    priceChangesSlot().current = undefined;
    mountPage();
    expect(notesIn(document)).toEqual([]);
    expect(
      document.querySelector('[data-testid="price-change-note-failed"]')
    ).toBeNull();
  });

  test('P5 on its own row only, with its counts and Check again', () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    expect(notesIn(row('Patrons'))).toEqual([]);
    const [note] = notesIn(row('Members'));
    expect(text(note?.querySelector('.price-note__text'))).toBe(
      'Emailing your 6,240 Members subscribers about £9.00/mo. Each moves at their first renewal at least 30 days after their own email, and keeps paying £8.00/mo until then.'
    );
    expect(note?.getAttribute('role')).toBe('note');
    expect(
      note?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')
    ).toBe('72');
    expect(text(note?.querySelector('[data-testid="price-note-meta"]'))).toBe(
      'We email about 1,125 an hour, so the rest by about 18:00. Our support team is handling the 7. As of the 16:00 run.'
    );
    expect(
      button(note as HTMLElement, 'Check again').getAttribute('aria-label')
    ).toBe(m.price_note_check_again_aria({ name: 'Members' }));
  });

  test('P10: a failed read says so once, with Try again, never "no change"', () => {
    mountPage();
    fail(priceChangesSlot());
    flushSync();
    const failed = document.querySelector<HTMLElement>(
      '[data-testid="price-change-note-failed"]'
    );
    expect(text(failed)).toContain(
      "We couldn't load how your price change is going."
    );
    // The tier list still shows.
    expect(document.querySelectorAll('.tier-item')).toHaveLength(2);
    button(failed as HTMLElement, 'Try again').click();
    expect(priceChangesSlot().refresh).toHaveBeenCalledTimes(1);
  });

  test('P6 Check again: one read per press, then "nothing has changed"', async () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    const pending = deferRefresh(priceChangesSlot());
    vi.setSystemTime(new Date('2026-10-30T16:30:00.000Z'));
    const check = button(row('Members'), 'Check again');
    check.click();
    flushSync();
    expect(check.getAttribute('aria-busy')).toBe('true');
    // A second press while the read is out reads nothing more.
    check.click();
    expect(priceChangesSlot().refresh).toHaveBeenCalledTimes(1);
    pending.land([change()]);
    await vi.waitFor(() =>
      expect(
        text(row('Members').querySelector('[data-testid="price-note-meta"]'))
      ).toBe(
        'Checked at 16:30: nothing has changed since the 16:00 run. The next 1,125 go at 17:00, and the rest by about 18:00.'
      )
    );
    // The line is polite: it is rewritten in place.
    expect(
      row('Members')
        .querySelector('[data-testid="price-note-meta"]')
        ?.getAttribute('aria-live')
    ).toBe('polite');
  });

  test('a Check again that failed shows the failed line, not "nothing has changed"', async () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    const pending = deferRefresh(priceChangesSlot());
    button(row('Members'), 'Check again').click();
    pending.fail();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="price-change-note-failed"]')
      ).not.toBeNull()
    );
    expect(
      text(row('Members').querySelector('[data-testid="price-note-meta"]'))
    ).not.toContain('nothing has changed');
  });

  // Kit resolves an older refresh once a later read settles, a failed one
  // included (2.55 `query.svelte.js` #run): the press's promise resolves
  // with the error set, and must not read as "nothing has changed".
  test('a Check again overtaken by a failed read is not "nothing has changed"', async () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    const pending = deferRefresh(priceChangesSlot());
    button(row('Members'), 'Check again').click();
    failRefresh(priceChangesSlot());
    pending.supersede();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="price-change-note-failed"]')
      ).not.toBeNull()
    );
    await vi.waitFor(() =>
      expect(
        button(row('Members'), 'Check again').getAttribute('aria-busy')
      ).toBeNull()
    );
    expect(
      text(row('Members').querySelector('[data-testid="price-note-meta"]'))
    ).not.toContain('nothing has changed');
  });

  test('P3 Dismiss: the note goes, by its key, and focus goes to the tier', async () => {
    mountPage();
    land(priceChangesSlot(), [
      change({
        state: 'done',
        doneAt: '2026-10-30T15:01:00.000Z',
        nextRunAt: null,
        estimatedDoneAt: null,
        counts: { emailed: 6240, scheduled: 6240, held: 0, due: 0 },
      }),
    ]);
    flushSync();
    button(row('Members'), 'Dismiss').click();
    flushSync();
    expect(dismiss).toHaveBeenCalledWith('price-change:members-9');
    expect(notesIn(row('Members'))).toEqual([]);
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        m.monetisation_tiers_edit_aria({ name: 'Members' })
      )
    );
  });
});

describe('Edit Tier while the emails are still going out (P8)', () => {
  function openEdit(name: string) {
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${m.monetisation_tiers_edit_aria({ name })}"]`
      )
      ?.click();
    flushSync();
  }

  function setMonthly(pence: number) {
    const input = document.querySelector<HTMLInputElement>(
      '#tier-price-monthly'
    );
    if (!input) throw new Error('no monthly price');
    input.value = String(pence);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  }

  const hint = () =>
    document.querySelector<HTMLElement>('[data-testid="tier-price-hint"]');

  test('a new price while £9.00 is going out: the save replaces it', () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    openEdit('Members');
    setMonthly(1000);
    expect(hint()?.dataset.kind).toBe('going_out');
    expect(text(hint())).toBe(
      'Emails about £9.00/mo are still going out: 4,500 of 6,240 sent. If you save a new price, it replaces £9.00, and all 6,240 are emailed about the new price instead, including the 4,500 already told about £9.00.'
    );
  });

  test('a tier with nothing going out keeps the quiet line (P1)', () => {
    mountPage();
    land(priceChangesSlot(), [change()]);
    flushSync();
    openEdit('Patrons');
    setMonthly(3000);
    expect(hint()?.dataset.kind).toBe('emailed');
  });
});
