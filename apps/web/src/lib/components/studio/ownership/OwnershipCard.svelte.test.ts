/**
 * OwnershipCard — every face of the card, and the transitions between them
 * (Codex-2hxff.2, mockup states 1, 4, 6, 7, 7b and 9).
 *
 * Mounts the real card with the real offer dialog, and mocks only the remote
 * modules (they import `$app/server`) and `$app/navigation`. The query double
 * is reactive, so "the command's single-flight refresh landed a new view" is a
 * `setView(...)` inside the command mock — the same two inputs the card reads
 * in production.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from '$lib/components/ui/Toast/toast-store';
import type { OwnershipView } from '$lib/types';
import { formatDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async (_dep: string) => {}),
  goto: vi.fn(async (_url: string) => {}),
}));

vi.mock('$app/navigation', () => navigation);
vi.mock(
  '$lib/remote/ownership.remote',
  () => import('./__fixtures__/ownership-remote.mock.svelte')
);

import {
  acceptOwnershipOffer,
  declineOwnershipOffer,
  refresh,
  reset,
  setLoadError,
  setView,
  withdrawOwnershipOffer,
} from './__fixtures__/ownership-remote.mock.svelte';
import OwnershipCard from './OwnershipCard.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const ORG_NAME = 'Studio Alpha';
const OFFER_ID = '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37';

const OPEN_OFFER = {
  id: OFFER_ID,
  recipient: { userId: 'sam', name: 'Sam Patel', payoutsReady: false },
  offeredBy: { userId: 'alex', name: 'Alex Morgan' },
  offeredAt: '2026-10-13T10:00:00.000Z',
  expiresAt: '2026-10-20T10:00:00.000Z',
};

function ownerView(overrides: Partial<OwnershipView> = {}): OwnershipView {
  return {
    owner: {
      userId: 'alex',
      name: 'Alex Morgan',
      avatarUrl: null,
      ownerSince: '2026-03-02T00:00:00.000Z',
      payoutsReady: true,
    },
    viewerRole: 'owner',
    openOffer: null,
    lastOutcome: null,
    eligibleRecipients: [
      {
        userId: 'sam',
        name: 'Sam Patel',
        role: 'creator',
        joinedAt: '2026-06-01T00:00:00.000Z',
        payoutsReady: false,
      },
    ],
    ownerHasSubscriptionAgreement: false,
    activeAgreements: [],
    ...overrides,
  };
}

/** What Sam, the recipient, is sent: no owner-only fields. */
function recipientView(overrides: Partial<OwnershipView> = {}): OwnershipView {
  return {
    owner: ownerView().owner,
    viewerRole: 'creator',
    openOffer: OPEN_OFFER,
    activeAgreements: [
      {
        creatorName: 'Alex Morgan',
        revenueType: 'subscription',
        shareBps: 6000,
        since: '2026-10-13T00:00:00.000Z',
      },
      {
        creatorName: 'Jordan Lee',
        revenueType: 'content_purchase',
        shareBps: 7000,
        since: '2026-05-04T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function text(): string {
  return document.body.textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
}

function card(): HTMLElement {
  const el = document.getElementById('ownership');
  if (!el) throw new Error('card not rendered');
  return el;
}

let component: ReturnType<typeof mount> | null = null;

function mountCard() {
  component = mount(OwnershipCard, {
    target: document.body,
    props: { orgId: ORG_ID, orgName: ORG_NAME },
  });
  flushSync();
}

beforeEach(() => {
  reset();
  navigation.invalidate.mockClear();
  navigation.goto.mockClear();
  vi.spyOn(toast, 'success').mockImplementation(() => ({}) as never);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('loading and failure', () => {
  test('before the view arrives: a skeleton, no actions', () => {
    mountCard();
    expect(card().querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(card().querySelectorAll('button')).toHaveLength(0);
  });

  test('a REJECTED view renders an error with a retry — not an empty card', () => {
    // Exactly what kit leaves behind: current undefined, rejection on `error`.
    setLoadError({
      status: 500,
      body: { message: 'An unexpected error occurred' },
    });
    mountCard();

    expect(card().querySelector('[role="alert"]')?.textContent).toContain(
      m.ownership_error_load()
    );
    expect(text()).not.toContain(m.ownership_transfer_cta());

    button(m.common_try_again())?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('owner (states 1, 4, 7, 9)', () => {
  test('state 1: the owner summary and the way to transfer', () => {
    setView(ownerView());
    mountCard();

    expect(text()).toContain(m.ownership_owner_you({ name: 'Alex Morgan' }));
    expect(text()).toContain(
      m.ownership_owner_since({ date: formatDate('2026-03-02T00:00:00.000Z') })
    );
    expect(text()).toContain(m.ownership_payouts_ready());
    expect(text()).toContain(m.ownership_leave_hint({ orgName: ORG_NAME }));
    expect(button(m.ownership_transfer_cta())?.disabled).toBe(false);
    expect(button(m.ownership_offer_cancel())).toBeUndefined();
  });

  test('Transfer ownership… opens the offer dialog', () => {
    setView(ownerView());
    mountCard();

    button(m.ownership_transfer_cta())?.click();
    flushSync();

    expect(document.querySelector('.dialog-content')?.textContent).toContain(
      m.ownership_choose_title({ orgName: ORG_NAME })
    );
  });

  test('state 4: an open offer can be cancelled, and blocks a second', async () => {
    setView(ownerView({ openOffer: OPEN_OFFER }));
    mountCard();

    expect(text()).toContain(
      m.ownership_offer_pending({
        name: 'Sam Patel',
        date: formatDate(OPEN_OFFER.offeredAt),
      })
    );
    expect(text()).toContain(
      m.ownership_offer_waiting({
        name: 'Sam Patel',
        date: formatDate(OPEN_OFFER.expiresAt),
      })
    );
    expect(button(m.ownership_transfer_cta())?.disabled).toBe(true);

    button(m.ownership_offer_cancel())?.click();
    await vi.waitFor(() =>
      expect(withdrawOwnershipOffer).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        offerId: OFFER_ID,
      })
    );
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(m.ownership_offer_cancelled())
    );
  });

  test.each([
    [
      'declined',
      { status: 'declined', withdrawnReason: null },
      () =>
        m.ownership_outcome_declined({
          name: 'Sam Patel',
          date: formatDate('2026-10-15T10:00:00.000Z'),
        }),
    ],
    [
      'expired (no email — the card is the only notice)',
      { status: 'expired', withdrawnReason: null },
      () =>
        m.ownership_outcome_expired({
          name: 'Sam Patel',
          date: formatDate('2026-10-15T10:00:00.000Z'),
        }),
    ],
    [
      'withdrawn: recipient no longer eligible',
      { status: 'withdrawn', withdrawnReason: 'recipient_ineligible' },
      () => m.ownership_outcome_ineligible({ name: 'Sam Patel' }),
    ],
  ] as const)('state 9: %s', (_label, outcome, expected) => {
    setView(
      ownerView({
        lastOutcome: {
          ...outcome,
          recipientName: 'Sam Patel',
          at: '2026-10-15T10:00:00.000Z',
        },
      })
    );
    mountCard();
    expect(text()).toContain(expected());
  });

  test.each([
    ['the owner cancelled their own offer', 'owner_cancelled'],
    // `lastOutcome` covers only the CURRENT owner's offers (amended contract);
    // a reassignment withdraws the REMOVED owner's offer, so no note for it.
    ['support reassigned ownership', 'support_reassigned'],
  ] as const)('state 9: no note when %s', (_label, withdrawnReason) => {
    setView(
      ownerView({
        lastOutcome: {
          status: 'withdrawn',
          withdrawnReason,
          recipientName: 'Sam Patel',
          at: '2026-10-15T10:00:00.000Z',
        },
      })
    );
    mountCard();
    expect(text()).not.toContain('Sam Patel');
    expect(card().querySelector('.alert[data-variant="info"]')).toBeNull();
  });

  test('state 7: an owner without payouts is sent to set them up', () => {
    setView(
      ownerView({ owner: { ...ownerView().owner, payoutsReady: false } })
    );
    mountCard();

    expect(text()).toContain(m.ownership_payouts_not_ready());
    expect(text()).toContain(m.ownership_payouts_prompt_title());
    const cta = [...card().querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === m.ownership_payouts_prompt_cta()
    );
    expect(cta?.getAttribute('href')).toBe('/studio/monetisation');
  });
});

describe('admin (state 7b)', () => {
  test('sees who owns it, read-only', () => {
    setView({ owner: ownerView().owner, viewerRole: 'admin', openOffer: null });
    mountCard();

    expect(text()).toContain('Alex Morgan');
    expect(text()).not.toContain(
      m.ownership_owner_you({ name: 'Alex Morgan' })
    );
    expect(text()).toContain(
      m.ownership_readonly({ role: m.team_role_admin() })
    );
    expect(card().querySelectorAll('button')).toHaveLength(0);
  });
});

describe('recipient (states 6 and 7)', () => {
  test('state 6: what they would take on, every active agreement listed', () => {
    setView(recipientView());
    mountCard();

    expect(text()).toContain(m.ownership_recipient_title());
    expect(text()).toContain(
      m.ownership_recipient_lede({ name: 'Alex Morgan', orgName: ORG_NAME })
    );
    expect(text()).toContain(
      m.ownership_recipient_agreement_subscription({
        share: '60%',
        date: formatDate('2026-10-13T00:00:00.000Z'),
      })
    );
    expect(text()).toContain(
      m.ownership_recipient_agreement_purchase({
        share: '70%',
        date: formatDate('2026-05-04T00:00:00.000Z'),
      })
    );
    expect(text()).toContain(
      m.ownership_recipient_expires({ date: formatDate(OPEN_OFFER.expiresAt) })
    );
    expect(button(m.ownership_recipient_accept())).toBeTruthy();
    expect(button(m.ownership_recipient_decline())).toBeTruthy();
  });

  test('state 6: no agreements reads "None — …"', () => {
    setView(recipientView({ activeAgreements: [] }));
    mountCard();
    expect(text()).toContain(m.ownership_recipient_agreements_none());
  });

  test('state 6: warns when the recipient has no payouts — and accepting stays allowed', () => {
    setView(recipientView());
    mountCard();

    expect(text()).toContain(m.ownership_recipient_payouts_title());
    expect(button(m.ownership_recipient_accept())?.disabled).toBe(false);
  });

  test('state 6: no payouts warning once the recipient has payouts', () => {
    setView(
      recipientView({
        openOffer: {
          ...OPEN_OFFER,
          recipient: { ...OPEN_OFFER.recipient, payoutsReady: true },
        },
      })
    );
    mountCard();

    expect(text()).not.toContain(m.ownership_recipient_payouts_title());
  });

  test('accepting refreshes the studio role, then shows the new owner state 7', async () => {
    setView(recipientView());
    // The command's single-flight refresh lands the OWNER view.
    acceptOwnershipOffer.mockImplementation(async () => {
      setView(
        ownerView({
          owner: {
            userId: 'sam',
            name: 'Sam Patel',
            avatarUrl: null,
            ownerSince: '2026-10-14T10:00:00.000Z',
            payoutsReady: false,
          },
          eligibleRecipients: [],
        })
      );
      return {};
    });
    mountCard();

    button(m.ownership_recipient_accept())?.click();

    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledWith('cache:studio')
    );
    expect(acceptOwnershipOffer).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      offerId: OFFER_ID,
    });
    await vi.waitFor(() =>
      expect(text()).toContain(m.ownership_accepted({ orgName: ORG_NAME }))
    );
    expect(text()).toContain(m.ownership_owner_you({ name: 'Sam Patel' }));
    expect(text()).toContain(m.ownership_payouts_prompt_title());
  });

  test('declining refreshes the studio role (a creator then leaves Settings)', async () => {
    setView(recipientView());
    mountCard();

    button(m.ownership_recipient_decline())?.click();

    await vi.waitFor(() =>
      expect(navigation.invalidate).toHaveBeenCalledWith('cache:studio')
    );
    expect(declineOwnershipOffer).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      offerId: OFFER_ID,
    });
    expect(toast.success).toHaveBeenCalledWith(
      m.ownership_recipient_declined()
    );
  });

  test('a refused accept says why, re-reads the view, and changes no role', async () => {
    setView(recipientView());
    acceptOwnershipOffer.mockRejectedValue({
      status: 409,
      body: { message: 'Offer is not open', code: 'OWNERSHIP_OFFER_NOT_OPEN' },
    });
    mountCard();

    button(m.ownership_recipient_accept())?.click();

    await vi.waitFor(() =>
      expect(card().querySelector('[role="alert"]')?.textContent).toContain(
        m.ownership_error_not_open()
      )
    );
    expect(refresh).toHaveBeenCalled();
    expect(navigation.invalidate).not.toHaveBeenCalled();
  });
});

describe('offer closed after the layout loaded', () => {
  test('a creator is told, and taken back to the studio with a fresh layout', async () => {
    setView({
      owner: ownerView().owner,
      viewerRole: 'creator',
      openOffer: null,
    });
    mountCard();

    expect(text()).toContain(m.ownership_offer_closed());
    button(m.settings_error_back_to_studio())?.click();

    await vi.waitFor(() =>
      expect(navigation.goto).toHaveBeenCalledWith('/studio')
    );
    expect(navigation.invalidate).toHaveBeenCalledWith('cache:studio');
  });
});
