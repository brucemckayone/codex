/**
 * Studio → Monetisation → Revenue share:
 *
 * - a list that FAILED to load is not an empty list (Codex-2hxff.74). A
 *   rejected agreements read used to render every creator as "No agreement"
 *   with Propose buttons and the whole pool as the organisation's; a rejected
 *   pending-proposals read hid a counter waiting on the owner. Each now shows
 *   "We couldn't load your …" with Retry in place of what depends on it.
 * - admins get the page read-only (Codex-2hxff.20 AGR-14): every share, name
 *   and thread, no owner-only action.
 * - the bar is what's left after Codex's fee (Codex-2hxff.20 AGR-11).
 *
 * Mounts the real `+page.svelte`, AgreementCard and pie; the remote modules
 * and `$app/navigation` are mocked. The members read is a plain object a
 * test swaps before mounting.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const members = vi.hoisted(() => ({
  result: null as unknown,
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgMembers: () => members.result,
}));

import {
  activeSlot,
  agreementRow,
  CREATOR_ID,
  fail,
  httpError,
  ORG_ID,
  orgThreadSlot,
  pendingSlot,
  reset,
  setActiveAgreements,
  setPendingProposals,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { logger } from '$lib/observability';
import RevenueSharePage from '../+page.svelte';

const MAYA = {
  userId: CREATOR_ID,
  email: 'maya@studio-alpha.test',
  name: 'Maya Lin',
  avatarUrl: null,
  role: 'creator',
  status: 'active',
  joinedAt: '2026-08-01T00:00:00.000Z',
  hasCreatorAccount: true,
};
const SAM = {
  ...MAYA,
  userId: 'creator-sam',
  email: 'sam@studio-alpha.test',
  name: 'Sam Reed',
};

function membersLoaded(rows = [MAYA, SAM]) {
  return {
    current: {
      items: rows,
      pagination: { page: 1, limit: 100, total: rows.length, totalPages: 1 },
    },
    error: undefined,
    loading: false,
    refresh: vi.fn(async () => {}),
  };
}

/** Sam has a subscription counter waiting on the owner. */
const SAM_COUNTER = {
  id: '55555555-5555-4555-8555-555555555555',
  organizationId: ORG_ID,
  creatorId: 'creator-sam',
  revenueType: 'subscription',
  roundNumber: 2,
  proposedByRole: 'creator',
  proposedCreatorSharePercent: 2000,
  proposedTermMonths: 12,
};

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  members.result = membersLoaded();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage(userRole: 'owner' | 'admin' = 'owner') {
  component = mount(RevenueSharePage, {
    target: document.body,
    props: {
      data: {
        userRole,
        org: { id: ORG_ID, name: 'Studio Alpha', slug: 'studio-alpha' },
      },
    } as never,
  });
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const buttons = () =>
  [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
const alertIn = (testId: string) => q(`[data-testid="${testId}"]`);
const retryIn = (testId: string) =>
  alertIn(testId)?.querySelector('button') as HTMLButtonElement | null;
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};
const legendLabels = () =>
  [...document.querySelectorAll('.revenue-split-pie__legend-label')].map((el) =>
    el.textContent?.trim()
  );

describe('the agreements read failed', () => {
  test('says so with Retry, in place of the bar, the roster and the active list', () => {
    setPendingProposals([]);
    mountPage();
    fail(activeSlot());
    flushSync();

    const alert = alertIn('agreements-load-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(m.agreement_load_failed());
    expect(retryIn('agreements-load-error')?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );

    // Nothing that reads the list as "none": no bar showing the whole pool
    // as the organisation's, no "No agreement", no Propose.
    expect(q('.revenue-split-pie')).toBeNull();
    expect(text()).not.toContain(m.monetisation_revshare_group_none());
    expect(text()).not.toContain('No agreement');
    expect(text()).not.toContain(m.monetisation_revshare_propose_prefix());
    expect(text()).not.toContain(m.monetisation_revshare_active_title());
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    setPendingProposals([]);
    mountPage();
    fail(activeSlot());
    flushSync();

    expect(error).toHaveBeenCalledWith(
      'studio/revenue-share: agreements failed to load',
      expect.objectContaining({ organizationId: ORG_ID })
    );
  });

  test('Retry refreshes; a second failure says "We still couldn\'t…"', async () => {
    setPendingProposals([]);
    mountPage();
    const slot = activeSlot();
    fail(slot);
    flushSync();
    slot.refresh.mockImplementationOnce(async () => {
      fail(slot);
      throw httpError();
    });

    retryIn('agreements-load-error')?.click();
    await settle();

    expect(slot.refresh).toHaveBeenCalledTimes(1);
    expect(alertIn('agreements-load-error')?.textContent).toContain(
      m.agreement_load_failed_again()
    );
    expect(document.activeElement).toBe(q('.load-failed'));
  });

  test('a Retry that loads it shows the page', async () => {
    setPendingProposals([]);
    mountPage();
    const slot = activeSlot();
    fail(slot);
    flushSync();
    slot.refresh.mockImplementationOnce(async () => {
      setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    });

    retryIn('agreements-load-error')?.click();
    await settle();

    expect(alertIn('agreements-load-error')).toBeNull();
    expect(q('.revenue-split-pie')).not.toBeNull();
    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.getAttribute('role')).toBe('status');
    expect(focused?.textContent?.trim()).toBe(m.agreement_load_retry_ok());
  });
});

describe('the pending-proposals read failed', () => {
  test('the alert stands in for the roster; the bar and the active list still render', () => {
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    mountPage();
    fail(pendingSlot());
    flushSync();

    expect(alertIn('pending-proposals-load-error')?.textContent).toContain(
      m.monetisation_revshare_proposals_load_failed()
    );
    // No roster: Sam's counter would have vanished from it, and Propose
    // offered over a live negotiation.
    expect(q('.agreement-card')).toBeNull();
    expect(q('.revenue-share-page__roster')).toBeNull();
    expect(text()).not.toContain(m.monetisation_revshare_propose_prefix());
    // These do not read pending proposals.
    expect(q('.revenue-split-pie')).not.toBeNull();
    expect(text()).toContain(m.monetisation_revshare_active_title());
  });
});

describe('the members read failed', () => {
  test('says it could not load the team, and shows nothing that needs names', () => {
    members.result = {
      current: undefined,
      error: httpError(),
      loading: false,
      refresh: vi.fn(async () => {}),
    };
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([]);
    mountPage();

    expect(alertIn('members-load-error')?.textContent).toContain(
      m.monetisation_revshare_team_load_failed()
    );
    expect(text()).not.toContain(m.monetisation_revshare_empty_team());
    expect(q('.revenue-split-pie')).toBeNull();
    expect(text()).not.toContain(m.monetisation_revshare_active_title());
  });
});

describe('the bar', () => {
  test("is what's left after Codex's fee: no fee slice, the rest is the organisation's", () => {
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([]);
    mountPage();

    expect(legendLabels()).toEqual([
      'Maya Lin',
      m.agreement_split_organisation(),
    ]);
    expect(text()).not.toContain('Platform fee');
    expect(text()).not.toContain('Org residual');
    // 30% + 70% of the pool. The old basis drew 30% + 60% after a 10% fee.
    const values = [
      ...document.querySelectorAll('.revenue-split-pie__legend-value'),
    ].map((el) => el.textContent?.trim());
    expect(values).toEqual(['30%', '70%']);
  });
});

describe('an admin', () => {
  function mountAdmin() {
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([SAM_COUNTER]);
    mountPage('admin');
  }

  test('is told only the owner can change agreements', () => {
    mountAdmin();
    expect(
      q('[data-testid="revenue-share-readonly-note"]')?.textContent?.trim()
    ).toBe(m.monetisation_revshare_readonly_note());
  });

  test('is offered no Propose, Amend, Review counter or Terminate', () => {
    mountAdmin();
    const labels = buttons();
    expect(labels).not.toContain('Propose agreement');
    expect(labels).not.toContain('Amend');
    expect(labels).not.toContain('Review counter');
    expect(labels).not.toContain(m.monetisation_revshare_terminate());
    expect(text()).not.toContain(m.monetisation_revshare_propose_prefix());
    // Reading the threads is still theirs.
    expect(labels).toContain('View thread');
  });

  test('sees the counter as waiting on the owner, not on them', () => {
    mountAdmin();
    expect(text()).toContain(
      m.monetisation_revshare_group_attention_readonly()
    );
    expect(text()).not.toContain(m.monetisation_revshare_group_attention());
    expect(text()).toContain(m.monetisation_revshare_default_split_readonly());
    expect(text()).not.toContain(m.monetisation_revshare_default_split());
  });
});

describe('the owner (negative control)', () => {
  test('keeps every action and no read-only note', () => {
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([SAM_COUNTER]);
    mountPage('owner');

    expect(q('[data-testid="revenue-share-readonly-note"]')).toBeNull();
    const labels = buttons();
    expect(labels).toContain('Amend');
    expect(labels).toContain('Review counter');
    expect(labels).toContain(m.monetisation_revshare_terminate());
    expect(text()).toContain(m.monetisation_revshare_group_attention());
  });
});

describe('before the role is known (ssr=false first render)', () => {
  test('nothing renders: no admin note, no action', () => {
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([SAM_COUNTER]);
    component = mount(RevenueSharePage, {
      target: document.body,
      props: {
        data: {
          userRole: undefined,
          org: { id: ORG_ID, name: 'Studio Alpha', slug: 'studio-alpha' },
        },
      } as never,
    });
    flushSync();

    expect(q('[data-testid="revenue-share-readonly-note"]')).toBeNull();
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('the thread dialog', () => {
  test('a failed thread read says so with Retry, and is logged; the dialog is never left empty', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    setActiveAgreements([agreementRow({ creatorSharePercent: 3000 })]);
    setPendingProposals([]);
    fail(orgThreadSlot());
    mountPage('owner');

    const viewThread = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'View thread'
    );
    viewThread?.click();
    await settle();

    expect(alertIn('thread-load-error')?.textContent).toContain(
      m.agreement_thread_load_failed()
    );
    expect(error).toHaveBeenCalledWith(
      'studio/revenue-share: thread failed to load',
      expect.objectContaining({ organizationId: ORG_ID })
    );
  });
});
