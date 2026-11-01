/**
 * Account → Subscriptions: course subscriptions (Codex-2hxff.52, decision
 * C1; mockup course-subscriptions.html states 1-10).
 *
 * A second headed section beside the memberships, the same card for both.
 * A course card names the course (a link to its page) and its organisation,
 * and offers Update card and Cancel Subscription, or Reactivate once
 * cancelled. Off sale it offers nothing; past due, Update card moves into the
 * alert; disputed, only Cancel. Each list fails on its own, and the empty
 * state is for nothing in either list.
 *
 * Mounts the real `+page.svelte`, mocked as in `page.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserCourseSubscription, UserOrgSubscription } from '$lib/types';
import { formatDate, formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const remote = vi.hoisted(() => ({
  keepCurrentPlan: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelCourseSubscription: vi.fn(),
  reactivateCourseSubscription: vi.fn(),
}));
const account = vi.hoisted(() => ({ openBillingPortal: vi.fn() }));
const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async () => {}),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock('$app/navigation', () => navigation);
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return new URL('https://revelations.studio/account/subscriptions');
    },
  },
}));
vi.mock('$lib/remote/subscription.remote', () => remote);
vi.mock('$lib/remote/account.remote', () => account);
vi.mock('$lib/collections', () => ({
  invalidateCollection: vi.fn(async () => {}),
}));

import SubscriptionsPage from '../+page.svelte';

const PERIOD_END = '2026-11-12T00:00:00.000Z';

function membership(): UserOrgSubscription {
  return {
    id: 'sub-hollow',
    organizationId: 'org-hollow',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: PERIOD_END,
    amountCents: 1200,
    billingInterval: 'month',
    disputedAt: null,
    tier: { id: 'tier-pro', name: 'Pro' },
    organization: {
      id: 'org-hollow',
      name: 'Hollow Oak Films',
      slug: 'hollow-oak',
      logoUrl: null,
    },
  } as UserOrgSubscription;
}

function documentary(
  overrides: Partial<UserCourseSubscription> = {}
): UserCourseSubscription {
  return {
    id: 'csub-doc',
    status: 'active',
    billingInterval: 'month',
    amountCents: 900,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    disputedAt: null,
    canReactivate: false,
    course: {
      id: 'course-doc',
      title: 'Documentary from Idea to Festival',
      slug: 'documentary-idea-to-festival',
      offSale: false,
    },
    organization: {
      id: 'org-hollow',
      name: 'Hollow Oak Films',
      slug: 'hollow-oak',
      logoUrl: null,
    },
    ...overrides,
  };
}

function fieldRecording(): UserCourseSubscription {
  return documentary({
    id: 'csub-field',
    billingInterval: 'year',
    amountCents: 6000,
    currentPeriodEnd: '2027-04-03T00:00:00.000Z',
    course: {
      id: 'course-field',
      title: 'Field Recording Basics',
      slug: 'field-recording-basics',
      offSale: false,
    },
    organization: {
      id: 'org-salt',
      name: 'Saltmarsh Sound',
      slug: 'saltmarsh',
      logoUrl: null,
    },
  });
}

const CANCELLING = {
  status: 'cancelling',
  cancelAtPeriodEnd: true,
  canReactivate: true,
} as const;

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  for (const fn of Object.values(remote)) fn.mockReset();
  account.openBillingPortal.mockReset();
  navigation.invalidate.mockClear();
  navigation.invalidateAll.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountPage(
  data: {
    subscriptions?: UserOrgSubscription[];
    loadError?: boolean;
    courseSubscriptions?: UserCourseSubscription[];
    courseLoadError?: boolean;
  } = {}
) {
  component = mount(SubscriptionsPage, {
    target: document.body,
    props: {
      data: {
        subscriptions: [],
        loadError: false,
        courseSubscriptions: [],
        courseLoadError: false,
        ...data,
      },
    } as never,
  });
  flushSync();
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flushSync();
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const headings = () =>
  Array.from(document.querySelectorAll('h2.subscriptions-section__title')).map(
    (h) => clean(h)
  );

function courseCard(slug: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="course-subscription-card"][data-course-slug="${slug}"]`
  );
  if (!found) throw new Error(`no course card for ${slug}`);
  return found;
}
const within = (card: HTMLElement, testId: string) =>
  card.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const DOC = 'documentary-idea-to-festival';

describe('the two lists', () => {
  test('memberships and courses, each under its heading (state 1)', () => {
    mountPage({
      subscriptions: [membership()],
      courseSubscriptions: [documentary(), fieldRecording()],
    });

    expect(headings()).toEqual([
      m.subscription_section_memberships(),
      m.subscription_section_courses(),
    ]);
    // A `.subscription-card` locator still finds the membership only.
    expect(document.querySelectorAll('.subscription-card')).toHaveLength(1);

    const card = courseCard(DOC);
    const title = within(card, 'course-subscription-title');
    expect(title?.tagName).toBe('A');
    expect(clean(title)).toBe('Documentary from Idea to Festival');
    const href = new URL(title?.getAttribute('href') ?? '', 'https://x.test');
    expect(href.pathname).toBe(`/journeys/${DOC}`);
    expect(href.href).toContain('hollow-oak');
    expect(clean(card)).toContain(
      m.subscription_course_kind({ org: 'Hollow Oak Films' })
    );
    expect(clean(within(card, 'course-subscription-status-badge'))).toBe(
      m.subscription_status_active()
    );
    expect(
      clean(card.querySelector('.subscription-price')).replace(/\s/g, '')
    ).toBe(`${formatPrice(900)}/mo`);
    expect(clean(card)).toContain(
      m.subscription_current_period_ends({ date: formatDate(PERIOD_END) })
    );
    expect(within(card, 'course-subscription-update-card')).not.toBeNull();
    expect(within(card, 'course-subscription-cancel-button')).not.toBeNull();
    // A course has one plan.
    expect(clean(card)).not.toContain(m.subscription_change_tier());

    expect(
      clean(
        courseCard('field-recording-basics').querySelector(
          '.subscription-price'
        )
      ).replace(/\s/g, '')
    ).toBe(`${formatPrice(6000)}/yr`);
  });

  test('a course subscriber with no membership sees the course, not the empty state (state 2)', () => {
    mountPage({ courseSubscriptions: [documentary()] });

    expect(headings()).toEqual([m.subscription_section_courses()]);
    expect(document.body.textContent).not.toContain(
      m.subscription_no_subscriptions()
    );
    expect(courseCard(DOC)).toBeTruthy();
  });

  test('nothing in either list: the empty state, as today', () => {
    mountPage();

    expect(document.body.textContent).toContain(
      m.subscription_no_subscriptions()
    );
    expect(headings()).toEqual([]);
  });

  test('no amount yet: the price is left out, the period stays', () => {
    mountPage({ courseSubscriptions: [documentary({ amountCents: null })] });

    const card = courseCard(DOC);
    expect(card.querySelector('.subscription-price')).toBeNull();
    expect(clean(card)).toContain(
      m.subscription_current_period_ends({ date: formatDate(PERIOD_END) })
    );
  });
});

describe('the course list failing (state 9)', () => {
  test('its own alert under its heading; the memberships still show; Try Again reads once', () => {
    mountPage({ subscriptions: [membership()], courseLoadError: true });

    expect(headings()).toEqual([
      m.subscription_section_memberships(),
      m.subscription_section_courses(),
    ]);
    const alert = byTestId('course-subscriptions-load-error');
    expect(clean(alert)).toContain(m.subscription_course_load_error());
    expect(document.querySelectorAll('.subscription-card')).toHaveLength(1);
    expect(document.body.textContent).not.toContain(
      m.subscription_no_subscriptions()
    );

    alert?.querySelector('button')?.click();
    expect(navigation.invalidate).toHaveBeenCalledTimes(1);
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
  });

  test('the course list failing with no memberships is never the empty state', () => {
    mountPage({ courseLoadError: true });

    expect(byTestId('course-subscriptions-load-error')).not.toBeNull();
    expect(document.body.textContent).not.toContain(
      m.subscription_no_subscriptions()
    );
  });
});

describe('Cancel Subscription', () => {
  async function openDialog() {
    within(courseCard(DOC), 'course-subscription-cancel-button')?.click();
    await settle();
  }

  test('the dialog: course and org, the plain note, no churn reasons (state 3)', async () => {
    mountPage({ courseSubscriptions: [documentary()] });
    await openDialog();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(clean(dialog)).toContain(
      'Documentary from Idea to Festival — Hollow Oak Films'
    );
    expect(clean(byTestId('course-cancel-note'))).toBe(
      m.subscription_course_cancel_note({ date: formatDate(PERIOD_END) })
    );
    expect(dialog?.querySelector('input[type="radio"]')).toBeNull();
  });

  test('confirm: one call, then the lists are read again', async () => {
    remote.cancelCourseSubscription.mockResolvedValueOnce({
      success: true,
      data: documentary(CANCELLING),
    });
    mountPage({ courseSubscriptions: [documentary()] });
    await openDialog();

    byTestId('course-cancel-confirm-button')?.click();
    await settle();

    expect(remote.cancelCourseSubscription).toHaveBeenCalledTimes(1);
    expect(remote.cancelCourseSubscription).toHaveBeenCalledWith({
      courseSubscriptionId: 'csub-doc',
    });
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
    expect(byTestId('course-cancel-note')).toBeNull();
  });

  test("refused: fixed copy, never the worker's text, and the dialog stays (state 4)", async () => {
    remote.cancelCourseSubscription.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'stripe said no',
      status: 502,
    });
    mountPage({ courseSubscriptions: [documentary()] });
    await openDialog();

    byTestId('course-cancel-confirm-button')?.click();
    await settle();

    expect(clean(byTestId('course-cancel-error'))).toBe(
      m.subscription_course_cancel_error()
    );
    expect(document.body.textContent).not.toContain('stripe said no');
    expect(byTestId('course-cancel-confirm-button')).not.toBeNull();
    expect(navigation.invalidate).not.toHaveBeenCalled();
  });

  test('no answer at all: the lists are read again, to show whichever is true', async () => {
    remote.cancelCourseSubscription.mockResolvedValueOnce({
      success: false,
      code: undefined,
      detailsCode: undefined,
      message: 'An unexpected error occurred',
      status: 500,
    });
    mountPage({ courseSubscriptions: [documentary()] });
    await openDialog();

    byTestId('course-cancel-confirm-button')?.click();
    await settle();

    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
    expect(byTestId('course-cancel-error')).toBeNull();
  });
});

describe('cancelled', () => {
  test("the membership's cancelling line, Update card and Reactivate (state 5)", async () => {
    remote.reactivateCourseSubscription.mockResolvedValueOnce({
      success: true,
      data: documentary(),
    });
    mountPage({ courseSubscriptions: [documentary(CANCELLING)] });
    const card = courseCard(DOC);

    expect(clean(within(card, 'course-subscription-status-badge'))).toBe(
      m.subscription_status_cancelling()
    );
    expect(clean(within(card, 'course-subscription-cancelling'))).toBe(
      m.subscription_cancelling_message({ date: formatDate(PERIOD_END) })
    );
    expect(within(card, 'course-subscription-update-card')).not.toBeNull();
    expect(within(card, 'course-subscription-cancel-button')).toBeNull();

    within(card, 'course-subscription-reactivate-button')?.click();
    await settle();

    expect(remote.reactivateCourseSubscription).toHaveBeenCalledWith({
      courseSubscriptionId: 'csub-doc',
    });
    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
  });

  test('Reactivate refused because the course went off sale: the list is read again, no error line', async () => {
    remote.reactivateCourseSubscription.mockResolvedValueOnce({
      success: false,
      code: 'CONFLICT',
      detailsCode: 'COURSE_NOT_ON_SALE',
      message: 'off sale',
      status: 409,
    });
    mountPage({ courseSubscriptions: [documentary(CANCELLING)] });

    within(courseCard(DOC), 'course-subscription-reactivate-button')?.click();
    await settle();

    expect(navigation.invalidate).toHaveBeenCalledWith('account:subscriptions');
    expect(clean(courseCard(DOC))).not.toContain(
      m.subscription_reactivate_error()
    );
  });

  test('Reactivate refused for another reason: the fixed error line', async () => {
    remote.reactivateCourseSubscription.mockResolvedValueOnce({
      success: false,
      code: 'INTERNAL_ERROR',
      detailsCode: undefined,
      message: 'boom',
      status: 502,
    });
    mountPage({ courseSubscriptions: [documentary(CANCELLING)] });

    within(courseCard(DOC), 'course-subscription-reactivate-button')?.click();
    await settle();

    expect(clean(courseCard(DOC))).toContain(m.subscription_reactivate_error());
    expect(navigation.invalidate).not.toHaveBeenCalled();
  });

  test('off sale: why it ends, no actions, and the title is not a link (state 6)', () => {
    mountPage({
      courseSubscriptions: [
        documentary({
          ...CANCELLING,
          canReactivate: false,
          course: { ...documentary().course, offSale: true },
        }),
      ],
    });
    const card = courseCard(DOC);

    expect(clean(within(card, 'course-subscription-cancelling'))).toBe(
      m.subscription_course_off_sale({ date: formatDate(PERIOD_END) })
    );
    expect(card.querySelector('.subscription-actions')).toBeNull();
    expect(card.querySelectorAll('button')).toHaveLength(0);
    expect(within(card, 'course-subscription-title')?.tagName).toBe('SPAN');
  });
});

describe('payment states', () => {
  test('past due: the alert holds Update card, and the actions are Cancel only (state 7)', () => {
    mountPage({ courseSubscriptions: [documentary({ status: 'past_due' })] });
    const card = courseCard(DOC);

    const alert = card.querySelector('[role="alert"]');
    expect(clean(alert)).toContain(m.subscription_past_due_message());
    expect(
      alert?.querySelector('[data-testid="course-subscription-update-card"]')
    ).not.toBeNull();
    // Moved into the alert, so it isn't shown twice.
    expect(
      card.querySelectorAll('[data-testid="course-subscription-update-card"]')
    ).toHaveLength(1);
    expect(within(card, 'course-subscription-cancel-button')).not.toBeNull();
  });

  test('Update card opens the portal for this page', async () => {
    account.openBillingPortal.mockResolvedValueOnce({ url: '' });
    mountPage({ courseSubscriptions: [documentary()] });

    within(courseCard(DOC), 'course-subscription-update-card')?.click();
    await settle();

    expect(account.openBillingPortal).toHaveBeenCalledWith({
      returnUrl: 'https://revelations.studio/account/subscriptions',
    });
  });

  test('the portal failing says so on the card pressed, not the others (state 8)', async () => {
    account.openBillingPortal.mockRejectedValueOnce(new Error('502'));
    mountPage({ courseSubscriptions: [documentary(), fieldRecording()] });

    within(courseCard(DOC), 'course-subscription-update-card')?.click();
    await settle();

    expect(
      clean(within(courseCard(DOC), 'course-subscription-portal-error'))
    ).toBe(m.subscription_portal_error());
    expect(
      within(
        courseCard('field-recording-basics'),
        'course-subscription-portal-error'
      )
    ).toBeNull();
  });

  test("a member's Update Payment gets the same line", async () => {
    account.openBillingPortal.mockRejectedValueOnce(new Error('502'));
    mountPage({ subscriptions: [{ ...membership(), status: 'past_due' }] });
    const card = document.querySelector<HTMLElement>(
      '[data-testid="subscription-card"]'
    );

    const update = Array.from(card?.querySelectorAll('button') ?? []).find(
      (b) => clean(b) === m.subscription_update_payment()
    );
    update?.click();
    await settle();

    expect(
      clean(card?.querySelector('[data-testid="subscription-portal-error"]'))
    ).toBe(m.subscription_portal_error());
  });

  test('disputed: the label, the notice, and only Cancel (state 10)', () => {
    mountPage({
      courseSubscriptions: [
        documentary({ disputedAt: '2026-10-20T09:00:00.000Z' }),
      ],
    });
    const card = courseCard(DOC);

    const badge = within(card, 'course-subscription-status-badge');
    expect(clean(badge)).toBe(m.access_paused_dispute_label());
    expect(badge?.getAttribute('data-variant')).toBe('warning');
    expect(clean(within(card, 'course-subscription-dispute-notice'))).toBe(
      m.access_paused_dispute_subscription()
    );
    expect(within(card, 'course-subscription-update-card')).toBeNull();
    expect(within(card, 'course-subscription-cancel-button')).not.toBeNull();
    expect(card.querySelectorAll('button')).toHaveLength(1);
  });
});
